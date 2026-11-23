"""Report stored model metrics without retraining or inventing results.

Run:
    python scripts/evaluate_all.py

Only metrics found in saved metadata are reported. Deep-model rows appear only
after the corresponding TensorFlow training script has completed successfully.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = SERVICE_ROOT / "artifacts"


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def latest_deep(prefix: str) -> dict[str, Any] | None:
    candidates = sorted((ARTIFACTS / "deep").glob(f"{prefix}-*.metadata.json"))
    for path in reversed(candidates):
        payload = read_json(path)
        if payload:
            return payload
    return None


def main() -> int:
    summary = read_json(ARTIFACTS / "training-summary.json") or {}
    demand = summary.get("demand") or read_json(ARTIFACTS / "demand_metadata.json") or {}
    donor = summary.get("donor") or read_json(ARTIFACTS / "donor_metadata.json") or {}
    anomaly = summary.get("anomaly") or read_json(ARTIFACTS / "anomaly_metadata.json") or {}
    ann = latest_deep("ann-donor")
    lstm = latest_deep("lstm-demand")
    autoencoder = latest_deep("autoencoder-inventory")

    print("LifeLink model evaluation report")
    print("Data warning:", summary.get("warning", "Check each artifact's dataset label."))
    print()

    def row(name: str, variant: str, metadata: dict[str, Any] | None, metric_keys: list[str]) -> None:
        if not metadata:
            print(f"{name:<20} {variant:<12} artifacts not present / not trained")
            return
        metrics = metadata.get("metrics") or {}
        values = ", ".join(
            f"{key.upper()}={metrics[key]:.4f}"
            for key in metric_keys
            if isinstance(metrics.get(key), (int, float))
        )
        print(
            f"{name:<20} {variant:<12} {metadata.get('version', 'unknown')} "
            f"synthetic={metadata.get('synthetic')} {values}"
        )

    row("blood demand", "XGBoost", demand, ["mae", "rmse"])
    row("blood demand", "LSTM", lstm, ["mae", "rmse", "mape"])
    row("donor response", "RandomForest", donor, ["accuracy", "precision", "recall", "f1", "roc_auc"])
    row("donor response", "ANN", ann, ["accuracy", "precision", "recall", "f1", "roc_auc"])
    row("anomaly", "IsolationForest", anomaly, ["precision", "recall", "f1"])
    row("anomaly", "Autoencoder", autoencoder, ["precision", "recall", "f1", "false_positive_rate"])

    missing = [name for name, metadata in (("ANN", ann), ("LSTM", lstm), ("Autoencoder", autoencoder)) if not metadata]
    if missing:
        print()
        print(
            "Deep artifacts missing: "
            + ", ".join(missing)
            + ". Install requirements-deep.txt and run the corresponding training script. "
            "No metrics were imputed."
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
