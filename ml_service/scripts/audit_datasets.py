"""Audit the checked-in synthetic AI datasets.

Checks missing values, duplicates, numeric ranges, IQR outliers, class balance,
PHI-like columns and split feasibility. It never modifies the CSVs.
"""

from __future__ import annotations

import csv
import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUTPUT = ROOT / "artifacts" / "dataset-audit.json"
PHI_COLUMNS = {"name", "email", "phone", "address", "dob", "mrn", "patient_id", "donor_id"}


def rows(name: str) -> tuple[list[dict[str, str]], list[str]]:
    with (DATA / name).open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader), list(reader.fieldnames or [])


def numeric(values: list[str]) -> list[float]:
    result = []
    for value in values:
        try:
            parsed = float(value)
            if math.isfinite(parsed):
                result.append(parsed)
        except ValueError:
            continue
    return result


def describe(values: list[str]) -> dict:
    numbers = numeric(values)
    if not numbers:
        return {"count": 0}
    ordered = sorted(numbers)
    q1 = ordered[int(0.25 * (len(ordered) - 1))]
    q3 = ordered[int(0.75 * (len(ordered) - 1))]
    iqr = q3 - q1
    low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    return {
        "count": len(numbers),
        "min": round(ordered[0], 4),
        "max": round(ordered[-1], 4),
        "mean": round(sum(numbers) / len(numbers), 4),
        "iqr_outliers": sum(1 for value in numbers if value < low or value > high),
    }


def base_audit(name: str) -> tuple[list[dict[str, str]], list[str], dict]:
    data, columns = rows(name)
    missing = {column: sum(1 for row in data if not (row.get(column) or "").strip()) for column in columns}
    duplicates = len(data) - len({tuple(row.get(column, "") for column in columns) for row in data})
    return data, columns, {
        "rows": len(data),
        "columns": columns,
        "missing": {key: value for key, value in missing.items() if value},
        "duplicate_rows": duplicates,
        "phi_columns": sorted(set(columns) & PHI_COLUMNS),
        "numeric": {
            column: describe([row.get(column, "") for row in data])
            for column in columns
            if any((row.get(column) or "").strip() for row in data)
            and any(
                (row.get(column) or "").replace(".", "", 1).replace("-", "", 1).isdigit()
                for row in data
            )
        },
    }


def main() -> int:
    demand, demand_cols, demand_report = base_audit("demand_history.csv")
    donor, donor_cols, donor_report = base_audit("donor_responses.csv")
    anomaly, anomaly_cols, anomaly_report = base_audit("anomaly_observations.csv")

    demand_dates = sorted({row["date"] for row in demand})
    series = Counter((row["blood_group"], row["component"]) for row in demand)
    cutoff_index = int(len(demand_dates) * 0.8)
    cutoff = demand_dates[cutoff_index] if cutoff_index < len(demand_dates) else None
    train_rows = [row for row in demand if row["date"] < cutoff]
    test_rows = [row for row in demand if row["date"] >= cutoff]
    demand_train = len(train_rows)
    demand_test = len(test_rows)
    train_max = max((row["date"] for row in train_rows), default=None)
    test_min = min((row["date"] for row in test_rows), default=None)
    demand_report.update(
        {
            "synthetic_flag": all(row.get("is_synthetic") == "true" for row in demand),
            "date_start": demand_dates[0],
            "date_end": demand_dates[-1],
            "unique_dates": len(demand_dates),
            "series_count": len(series),
            "series_lengths": sorted(set(series.values())),
            "chronological_split": {
                "cutoff": cutoff,
                "train_rows": demand_train,
                "test_rows": demand_test,
                "train_max_date": train_max,
                "test_min_date": test_min,
                "no_date_overlap": bool(train_max and test_min and train_max < test_min),
                "leakage_check": "chronological split; no future-held-out date is in training",
            },
        }
    )

    donor_labels = Counter(row["responded"] for row in donor)
    consented = sum(1 for row in donor if row["consented"] == "true")
    donor_report.update(
        {
            "synthetic_flag": all(row.get("is_synthetic") == "true" for row in donor),
            "consented": consented,
            "not_consented": len(donor) - consented,
            "class_counts": dict(donor_labels),
            "positive_ratio": round(donor_labels.get("true", 0) / max(1, len(donor)), 4),
            "recommended_split": "stratified 70/15/15 or 80/20 by responded label",
        }
    )

    anomaly_labels = Counter(row["is_anomaly"] for row in anomaly)
    anomaly_report.update(
        {
            "synthetic_flag": all(row.get("is_synthetic") == "true" for row in anomaly),
            "normal_rows": anomaly_labels.get("false", 0),
            "anomaly_rows": anomaly_labels.get("true", 0),
            "anomaly_ratio": round(anomaly_labels.get("true", 0) / max(1, len(anomaly)), 4),
            "recommended_split": (
                "fit scaler/Isolation Forest only on normal training rows; use labelled "
                "anomalies for independent evaluation"
            ),
        }
    )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "warning": (
            "All checked-in datasets are deterministic synthetic development data. "
            "Metrics from them are not real-world medical performance."
        ),
        "privacy": {
            "phi_columns_found": sorted(
                set(demand_cols + donor_cols + anomaly_cols) & PHI_COLUMNS
            ),
            "action": "No direct identifiers permitted in AI datasets.",
        },
        "demand": demand_report,
        "donor": donor_report,
        "anomaly": anomaly_report,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
