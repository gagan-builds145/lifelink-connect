"""Generate labelled sample data and train all LifeLink ML artifacts.

Usage (from ml_service/):
    python scripts/train_all.py

Outputs:
    data/demand_history.csv
    data/donor_responses.csv
    data/anomaly_observations.csv
    artifacts/demand_model.json + metadata
    artifacts/donor_response.joblib + metadata
    artifacts/inventory_anomaly.joblib + metadata
    artifacts/training-summary.json

All data written by this script is synthetic and explicitly labelled. It is for
development and model verification only, never presented as hospital data.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.anomaly_model import AnomalyModel, synthetic_labeled_observations  # noqa: E402
from app.demand_model import DemandModel  # noqa: E402
from app.donor_model import DonorModel, synthetic_donor_samples  # noqa: E402
from app.features import synthetic_demand_records  # noqa: E402


def write_demand(records, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["date", "blood_group", "component", "units", "is_synthetic", "source"]
        )
        for record in records:
            writer.writerow(
                [
                    record.date,
                    record.blood_group,
                    record.component,
                    record.units,
                    "true" if record.is_synthetic else "false",
                    "deterministic_synthetic_generator_v1",
                ]
            )


def write_donors(samples, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "distance_km",
                "days_since_donation",
                "previous_donations",
                "prior_response_rate",
                "consented",
                "responded",
                "is_synthetic",
            ]
        )
        for sample in samples:
            writer.writerow(
                [
                    sample.distance_km,
                    sample.days_since_donation,
                    sample.previous_donations,
                    sample.prior_response_rate,
                    "true" if sample.consented else "false",
                    "true" if sample.responded else "false",
                    "true" if sample.is_synthetic else "false",
                ]
            )


def write_anomalies(samples, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["date", "units", "is_anomaly", "is_synthetic"])
        for sample in samples:
            writer.writerow(
                [
                    sample.date,
                    sample.units,
                    "true" if sample.is_anomaly else "false",
                    "true" if sample.is_synthetic else "false",
                ]
            )


def main() -> int:
    data_dir = SERVICE_ROOT / "data"
    artifacts_dir = SERVICE_ROOT / "artifacts"

    demand_records = synthetic_demand_records(days=365)
    donor_samples = synthetic_donor_samples()
    anomaly_observations = synthetic_labeled_observations()
    write_demand(demand_records, data_dir / "demand_history.csv")
    write_donors(donor_samples, data_dir / "donor_responses.csv")
    write_anomalies(anomaly_observations, data_dir / "anomaly_observations.csv")

    demand = DemandModel(artifacts_dir)
    demand_metadata = demand.train(
        demand_records,
        dataset_label=(
            "deterministic synthetic demand, 32 blood-group/component series, 365 days"
        ),
        source="train_all.py",
    )
    donor = DonorModel(artifacts_dir)
    donor_metadata = donor.train(
        donor_samples,
        dataset_label="deterministic synthetic consented donor-response sample",
    )
    anomaly = AnomalyModel(artifacts_dir)
    anomaly_metadata = anomaly.train(anomaly_observations)

    summary = {
        "synthetic_dataset": True,
        "warning": (
            "Every metric below was measured on deterministic synthetic data. "
            "These numbers are not evidence of performance on hospital demand."
        ),
        "demand": demand_metadata,
        "donor": donor_metadata,
        "anomaly": anomaly_metadata,
    }
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    (artifacts_dir / "training-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
