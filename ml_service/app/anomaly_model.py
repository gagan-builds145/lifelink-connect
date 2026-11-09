"""Inventory/demand anomaly detection using Isolation Forest.

The model is trained on synthetic normal demand. A transparent rolling z-score
is reported next to the Isolation Forest score so reviewers can understand why
an observation was flagged.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.metrics import precision_recall_fscore_support
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURE_NAMES = [
    "units",
    "delta_1",
    "rolling_mean_7",
    "rolling_std_7",
    "rolling_mean_28",
    "ratio_to_rolling_28",
    "zscore_28",
]


@dataclass(frozen=True)
class Observation:
    date: str
    units: float


@dataclass(frozen=True)
class LabeledObservation:
    date: str
    units: float
    is_anomaly: bool
    is_synthetic: bool = True


def _atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, prefix=f".{path.name}.", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(json.dumps(data, indent=2) + "\n")
        temporary = handle.name
    os.replace(temporary, path)


def _feature_vector(values: Sequence[float], index: int) -> list[float]:
    window7 = [float(value) for value in values[max(0, index - 7) : index]]
    window28 = [float(value) for value in values[max(0, index - 28) : index]]
    mean7 = sum(window7) / len(window7) if window7 else 0.0
    mean28 = sum(window28) / len(window28) if window28 else 0.0
    variance = (
        sum((value - mean28) ** 2 for value in window28) / len(window28)
        if window28
        else 0.0
    )
    std28 = math.sqrt(variance)
    current = float(values[index])
    previous = float(values[index - 1]) if index > 0 else current
    return [
        current,
        current - previous,
        mean7,
        float(np.std(window7)) if window7 else 0.0,
        mean28,
        current / mean28 if mean28 > 0 else 0.0,
        (current - mean28) / std28 if std28 > 0 else 0.0,
    ]


class AnomalyModel:
    def __init__(self, artifacts_dir: Path):
        self.artifacts_dir = artifacts_dir
        self.model: IsolationForest | None = None
        self.metadata: dict[str, Any] | None = None
        self.load_error: str | None = None
        self.refresh()

    @property
    def model_path(self) -> Path:
        return self.artifacts_dir / "inventory_anomaly.joblib"

    @property
    def metadata_path(self) -> Path:
        return self.artifacts_dir / "anomaly_metadata.json"

    @property
    def ready(self) -> bool:
        return self.model is not None and self.metadata is not None

    def refresh(self) -> None:
        self.model = None
        self.metadata = None
        self.load_error = None
        try:
            if not self.model_path.exists() or not self.metadata_path.exists():
                self.load_error = "No trained anomaly artifact is present."
                return
            self.model = joblib.load(self.model_path)
            with self.metadata_path.open(encoding="utf-8") as handle:
                self.metadata = json.load(handle)
        except Exception as error:
            self.load_error = f"Could not load anomaly model: {error}"

    def detect(self, observations: Sequence[Observation]) -> dict[str, Any]:
        if len(observations) < 15:
            return {
                "status": "insufficient_data",
                "findings": [],
                "model_version": None,
                "explanation": "At least 15 daily observations are required for anomaly scoring.",
            }
        if not self.ready:
            return {
                "status": "model_unavailable",
                "findings": [],
                "model_version": None,
                "explanation": self.load_error or "The anomaly model is not trained.",
            }

        values = [max(0.0, float(item.units)) for item in observations]
        feature_rows = [_feature_vector(values, index) for index in range(14, len(values))]
        matrix = np.asarray(feature_rows, dtype=float)
        raw_predictions = self.model.predict(matrix)
        scores = self.model.decision_function(matrix)
        findings: list[dict[str, Any]] = []

        for offset, (prediction, score) in enumerate(zip(raw_predictions, scores)):
            index = 14 + offset
            row = feature_rows[offset]
            zscore = float(row[-1])
            # Isolation Forest is primary; a very large transparent z-score is
            # also flagged so an obvious spike is never silently missed.
            if prediction != -1 and abs(zscore) <= 3.5:
                continue
            prior = values[max(0, index - 28) : index]
            expected = float(sum(prior) / len(prior)) if prior else values[index]
            direction = "spike" if values[index] > expected else "drop"
            severity = "critical" if abs(zscore) >= 4.0 else "warning"
            findings.append(
                {
                    "date": observations[index].date,
                    "observed": round(values[index], 3),
                    "expected": round(expected, 3),
                    "direction": direction,
                    "z_score": round(zscore, 3),
                    "isolation_score": round(float(score), 4),
                    "severity": severity,
                    "reason": (
                        f"Isolation Forest flagged the observation; demand is "
                        f"{direction} relative to the trailing 28-day mean."
                    ),
                }
            )

        return {
            "status": "ok",
            "findings": findings,
            "model": "isolation_forest_inventory",
            "model_version": self.metadata.get("version") if self.metadata else None,
            "metrics": self.metadata.get("metrics") if self.metadata else None,
            "synthetic_training_data": self.metadata.get("synthetic")
            if self.metadata
            else None,
            "explanation": (
                "Isolation Forest plus a transparent trailing z-score. Findings are "
                "review prompts, not proof of theft, wastage or clinical error."
            ),
        }

    def train(self, observations: Sequence[LabeledObservation]) -> dict[str, Any]:
        normal_values = [item.units for item in observations if not item.is_anomaly]
        if len(normal_values) < 60:
            raise ValueError("At least 60 normal observations are required to fit Isolation Forest.")
        normal_matrix = np.asarray(
            [_feature_vector(normal_values, index) for index in range(14, len(normal_values))],
            dtype=float,
        )
        classifier = make_pipeline(
            StandardScaler(),
            IsolationForest(
                n_estimators=320,
                contamination=0.02,
                max_samples="auto",
                random_state=42,
                n_jobs=2,
            ),
        )
        classifier.fit(normal_matrix)

        all_values = [item.units for item in observations]
        eval_matrix = np.asarray(
            [_feature_vector(all_values, index) for index in range(14, len(all_values))],
            dtype=float,
        )
        pred = classifier.predict(eval_matrix)
        labels = np.asarray([1 if item.is_anomaly else 0 for item in observations[14:]])
        detected = (pred == -1).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(
            labels, detected, average="binary", zero_division=0
        )
        metrics = {
            "precision": round(float(precision), 4),
            "recall": round(float(recall), 4),
            "f1": round(float(f1), 4),
            "holdout_size": int(len(labels)),
            "labelled_anomalies": int(labels.sum()),
            "normal_samples": len(normal_values),
        }
        version = (
            "isolation-forest-"
            + datetime.now(timezone.utc).date().isoformat()
            + "-"
            + f"{len(observations)}"
        )
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        version_dir = self.artifacts_dir / "versions"
        version_dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(classifier, self.model_path)
        joblib.dump(classifier, version_dir / f"{version}.joblib")
        metadata = {
            "model": "isolation_forest_inventory",
            "version": version,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "synthetic": all(item.is_synthetic for item in observations),
            "sample_size": len(observations),
            "feature_names": FEATURE_NAMES,
            "metrics": metrics,
            "validation_method": (
                "Fit on synthetic normal demand and scored against injected labelled "
                "spikes/drops. These are synthetic evaluation metrics only."
            ),
            "constraints": (
                "Alerts require human review. The model does not identify a cause "
                "or make clinical, inventory or disciplinary decisions."
            ),
        }
        _atomic_json(self.metadata_path, metadata)
        _atomic_json(version_dir / f"{version}.metadata.json", metadata)
        self.refresh()
        return metadata


def synthetic_labeled_observations(seed: int = 11, days: int = 240) -> list[LabeledObservation]:
    """Synthetic stationary series with clearly labelled injected anomalies."""

    import random

    generator = random.Random(seed)
    values: list[LabeledObservation] = []
    start = date(2025, 1, 1)
    for index in range(days):
        weekly = 1.08 if index % 7 < 5 else 0.9
        # Stationary around a stable mean; no explosive feedback loop.
        target = max(0.0, 18.0 * weekly + generator.gauss(0, 1.4))
        anomaly = index in {70, 71, 142, 185, 186}
        units = target
        if index == 70:
            units = target + 18
        elif index == 71:
            units = max(0.0, target - 10)
        elif index == 142:
            units = target + 24
        elif index == 185:
            units = max(0.0, target - 14)
        elif index == 186:
            units = target + 25
        values.append(
            LabeledObservation(
                date=(start + timedelta(days=index)).isoformat(),
                units=round(max(0.0, units), 3),
                is_anomaly=anomaly,
                is_synthetic=True,
            )
        )
    return values
