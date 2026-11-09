"""XGBoost demand forecasting with a chronological holdout.

Metrics are computed on a time-ordered holdout and compared with a 7-day
rolling-average baseline. The final served model is then refit on all rows.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import xgboost as xgb

from .features import (
    FEATURE_NAMES,
    LOOKBACK_DAYS,
    MIN_TRAINING_DAYS,
    DemandRecord,
    Series,
    build_training_rows,
)


def _rmse(actual: Sequence[float], predicted: Sequence[float]) -> float:
    return math.sqrt(
        sum((float(a) - float(p)) ** 2 for a, p in zip(actual, predicted))
        / max(1, len(actual))
    )


def _mae(actual: Sequence[float], predicted: Sequence[float]) -> float:
    return sum(abs(float(a) - float(p)) for a, p in zip(actual, predicted)) / max(
        1, len(actual)
    )


def _atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, prefix=f".{path.name}.", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(data)
        temporary = handle.name
    os.replace(temporary, path)


class DemandModel:
    """Loads and serves the active XGBoost booster."""

    def __init__(self, artifacts_dir: Path):
        self.artifacts_dir = artifacts_dir
        self.booster: xgb.Booster | None = None
        self.metadata: dict[str, Any] | None = None
        self.load_error: str | None = None
        self.refresh()

    @property
    def model_path(self) -> Path:
        return self.artifacts_dir / "demand_model.json"

    @property
    def metadata_path(self) -> Path:
        return self.artifacts_dir / "demand_metadata.json"

    def refresh(self) -> None:
        self.booster = None
        self.metadata = None
        self.load_error = None
        try:
            if not self.model_path.exists() or not self.metadata_path.exists():
                self.load_error = "No trained demand model artifact is present."
                return
            booster = xgb.Booster()
            booster.load_model(str(self.model_path))
            with self.metadata_path.open(encoding="utf-8") as handle:
                metadata = json.load(handle)
            if metadata.get("feature_names") != FEATURE_NAMES:
                raise ValueError("Artifact feature schema does not match this service.")
            self.booster = booster
            self.metadata = metadata
        except Exception as error:  # surfaced by /health and prediction endpoints
            self.load_error = f"Could not load demand model: {error}"

    @property
    def ready(self) -> bool:
        return self.booster is not None and self.metadata is not None

    def predict(self, series: Series, horizon_days: int = 30) -> dict[str, Any]:
        if not self.ready:
            return {
                "status": "model_unavailable",
                "model": "xgboost_demand",
                "model_version": None,
                "metrics": None,
                "horizons": {"h24": None, "h7": None, "h30": None},
                "daily": [],
                "explanation": self.load_error
                or "The XGBoost demand model has not been trained.",
                "synthetic_training_data": None,
            }
        if len(series.units) < LOOKBACK_DAYS + 1:
            return {
                "status": "insufficient_data",
                "model": "xgboost_demand",
                "model_version": self.metadata.get("version") if self.metadata else None,
                "metrics": self.metadata.get("metrics") if self.metadata else None,
                "horizons": {"h24": None, "h7": None, "h30": None},
                "daily": [],
                "explanation": (
                    f"At least {LOOKBACK_DAYS + 1} continuous demand days are required; "
                    f"only {len(series.units)} are available. No forecast is fabricated."
                ),
                "synthetic_training_data": self.metadata.get("synthetic")
                if self.metadata
                else None,
            }

        history = [float(value) for value in series.units]
        last_day = series.dates[-1]
        daily: list[dict[str, Any]] = []
        for step in range(1, max(1, min(horizon_days, 90)) + 1):
            from .features import feature_row

            row = feature_row(history, last_day + timedelta(days=step), series.blood_group, series.component)
            matrix = xgb.DMatrix(np.asarray([row], dtype=float), feature_names=FEATURE_NAMES)
            raw = float(self.booster.predict(matrix)[0])  # type: ignore[union-attr]
            value = round(max(0.0, raw), 2)
            daily.append(
                {
                    "date": (last_day + timedelta(days=step)).isoformat(),
                    "units": value,
                }
            )
            history.append(value)

        values = [row["units"] for row in daily]
        daily_total = sum(values)
        h24 = values[0] if values else None
        h7 = round(sum(values[:7]), 2) if len(values) >= 7 else None
        h30 = round(sum(values[:30]), 2) if len(values) >= 30 else None
        metrics = self.metadata.get("metrics", {}) if self.metadata else {}
        holdout_size = int(metrics.get("holdout_size", 0) or 0)
        improvement = float(metrics.get("mae_improvement_pct", 0.0) or 0.0)
        confidence_label = (
            "high"
            if holdout_size >= 28 and improvement >= 10.0
            else "medium"
            if improvement >= 0.0 and holdout_size >= 14
            else "low"
        )
        return {
            "status": "ok",
            "model": "xgboost_demand",
            "model_version": self.metadata.get("version") if self.metadata else None,
            "metrics": metrics,
            "horizons": {"h24": h24, "h7": h7, "h30": h30},
            "daily": daily,
            "daily_total": round(daily_total, 2),
            "confidence_label": confidence_label,
            "confidence": round(
                min(1.0, max(0.0, 0.5 + improvement / 100.0)), 3
            ),
            "explanation": (
                "XGBoost recursive forecast. Horizons are sums of predicted daily "
                "demand; 24h is the next prediction day. Metrics are chronological "
                "one-step holdout metrics, not a guarantee of future accuracy."
            ),
            "synthetic_training_data": self.metadata.get("synthetic")
            if self.metadata
            else None,
        }

    def train(
        self,
        records: Sequence[DemandRecord],
        dataset_label: str,
        source: str = "api",
    ) -> dict[str, Any]:
        matrix, targets, row_dates, series_counts, synthetic, warnings = build_training_rows(
            records
        )
        unique_dates = sorted(set(row_dates))
        if len(unique_dates) < MIN_TRAINING_DAYS:
            raise ValueError(
                f"At least {MIN_TRAINING_DAYS} distinct training days are required; "
                f"got {len(unique_dates)}."
            )

        split_index = max(1, int(len(unique_dates) * 0.8))
        cutoff = unique_dates[split_index]
        train_positions = [index for index, day in enumerate(row_dates) if day < cutoff]
        holdout_positions = [index for index, day in enumerate(row_dates) if day >= cutoff]
        if len(train_positions) < 50 or len(holdout_positions) < 10:
            raise ValueError("Chronological train/holdout split is too small.")

        x_train = np.asarray([matrix[i] for i in train_positions], dtype=float)
        y_train = np.asarray([targets[i] for i in train_positions], dtype=float)
        x_holdout = np.asarray([matrix[i] for i in holdout_positions], dtype=float)
        y_holdout = np.asarray([targets[i] for i in holdout_positions], dtype=float)

        params = {
            "objective": "reg:squarederror",
            "eval_metric": "rmse",
            "max_depth": 4,
            "eta": 0.05,
            "subsample": 0.9,
            "colsample_bytree": 0.9,
            "min_child_weight": 2,
            "tree_method": "hist",
            "seed": 42,
            "nthread": 2,
        }
        rounds = 300
        eval_booster = xgb.train(
            params,
            xgb.DMatrix(x_train, label=y_train, feature_names=FEATURE_NAMES),
            num_boost_round=rounds,
        )
        predictions = eval_booster.predict(
            xgb.DMatrix(x_holdout, feature_names=FEATURE_NAMES)
        )
        predictions = [max(0.0, float(value)) for value in predictions]
        baseline = [max(0.0, float(row[4])) for row in x_holdout]
        mae = _mae(y_holdout, predictions)
        rmse = _rmse(y_holdout, predictions)
        baseline_mae = _mae(y_holdout, baseline)
        baseline_rmse = _rmse(y_holdout, baseline)
        improvement = (
            ((baseline_mae - mae) / baseline_mae) * 100.0 if baseline_mae > 0 else 0.0
        )

        fingerprint = hashlib.sha256(
            json.dumps(
                [
                    [record.date, record.blood_group, record.component, record.units]
                    for record in records
                ],
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:10]
        version = f"xgboost-demand-{unique_dates[-1].isoformat()}-{fingerprint}"

        final_booster = xgb.train(
            params,
            xgb.DMatrix(
                np.asarray(matrix, dtype=float),
                label=np.asarray(targets, dtype=float),
                feature_names=FEATURE_NAMES,
            ),
            num_boost_round=rounds,
        )
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        version_dir = self.artifacts_dir / "versions"
        version_dir.mkdir(parents=True, exist_ok=True)
        model_path = version_dir / f"{version}.json"
        final_booster.save_model(str(model_path))
        final_booster.save_model(str(self.model_path))

        metadata: dict[str, Any] = {
            "model": "xgboost_demand",
            "version": version,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "dataset_label": dataset_label,
            "synthetic": synthetic,
            "sample_rows": len(records),
            "training_rows": len(matrix),
            "series_counts": series_counts,
            "feature_names": FEATURE_NAMES,
            "lookback_days": LOOKBACK_DAYS,
            "chronological_split": {
                "cutoff": cutoff.isoformat(),
                "train_rows": len(train_positions),
                "holdout_rows": len(holdout_positions),
                "holdout_start": unique_dates[split_index].isoformat(),
                "holdout_end": unique_dates[-1].isoformat(),
            },
            "metrics": {
                "mae": round(mae, 4),
                "rmse": round(rmse, 4),
                "baseline_mae": round(baseline_mae, 4),
                "baseline_rmse": round(baseline_rmse, 4),
                "mae_improvement_pct": round(improvement, 2),
                "train_size": len(train_positions),
                "holdout_size": len(holdout_positions),
                "mean_actual": round(float(np.mean(y_holdout)), 4),
            },
            "validation_method": (
                "Chronological 80/20 date split; one-step-ahead holdout MAE/RMSE "
                "versus a 7-day rolling-mean baseline. Final model refit on all rows."
            ),
            "xgboost_version": xgb.__version__,
            "warnings": warnings,
        }
        _atomic_write(self.metadata_path, json.dumps(metadata, indent=2) + "\n")
        _atomic_write(
            version_dir / f"{version}.metadata.json",
            json.dumps(metadata, indent=2) + "\n",
        )
        history_path = self.artifacts_dir / "demand_history.json"
        history: list[dict[str, Any]] = []
        if history_path.exists():
            try:
                with history_path.open(encoding="utf-8") as handle:
                    loaded = json.load(handle)
                if isinstance(loaded, list):
                    history = loaded
            except (OSError, ValueError):
                history = []
        history.append(
            {
                "version": version,
                "trained_at": metadata["trained_at"],
                "metrics": metadata["metrics"],
                "synthetic": synthetic,
                "dataset_label": dataset_label,
            }
        )
        _atomic_write(history_path, json.dumps(history[-20:], indent=2) + "\n")
        self.refresh()
        return metadata
