"""Consented donor-response classifier.

The model ranks who is more likely to respond to an invitation. It does not
determine medical eligibility, blood compatibility or whether a donation can be
released. Those remain deterministic and human-controlled.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

FEATURE_NAMES = [
    "distance_km",
    "days_since_donation",
    "previous_donations",
    "prior_response_rate",
]


@dataclass(frozen=True)
class DonorSample:
    distance_km: float
    days_since_donation: int
    previous_donations: int
    prior_response_rate: float
    consented: bool
    responded: bool
    is_synthetic: bool = True

    def features(self) -> list[float]:
        return [
            max(0.0, float(self.distance_km)),
            max(0, int(self.days_since_donation)),
            max(0, int(self.previous_donations)),
            min(1.0, max(0.0, float(self.prior_response_rate))),
        ]


def _atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, prefix=f".{path.name}.", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(json.dumps(data, indent=2) + "\n")
        temporary = handle.name
    os.replace(temporary, path)


class DonorModel:
    def __init__(self, artifacts_dir: Path):
        self.artifacts_dir = artifacts_dir
        self.model: RandomForestClassifier | None = None
        self.metadata: dict[str, Any] | None = None
        self.load_error: str | None = None
        self.refresh()

    @property
    def model_path(self) -> Path:
        return self.artifacts_dir / "donor_response.joblib"

    @property
    def metadata_path(self) -> Path:
        return self.artifacts_dir / "donor_metadata.json"

    @property
    def ready(self) -> bool:
        return self.model is not None and self.metadata is not None

    def refresh(self) -> None:
        self.model = None
        self.metadata = None
        self.load_error = None
        try:
            if not self.model_path.exists() or not self.metadata_path.exists():
                self.load_error = "No trained donor-response artifact is present."
                return
            self.model = joblib.load(self.model_path)
            with self.metadata_path.open(encoding="utf-8") as handle:
                self.metadata = json.load(handle)
        except Exception as error:
            self.load_error = f"Could not load donor model: {error}"

    def predict(self, sample: DonorSample) -> dict[str, Any]:
        if not sample.consented:
            raise PermissionError(
                "Donor scoring is only allowed for donors who explicitly consented."
            )
        if not self.ready:
            return {
                "status": "model_unavailable",
                "response_probability": None,
                "model_version": None,
                "explanation": self.load_error
                or "The donor-response model has not been trained.",
            }
        probability = float(
            self.model.predict_proba(np.asarray([sample.features()], dtype=float))[0][1]
        )
        probability = round(min(1.0, max(0.0, probability)), 4)
        return {
            "status": "ok",
            "response_probability": probability,
            "model": "random_forest_donor_response",
            "model_version": self.metadata.get("version") if self.metadata else None,
            "metrics": self.metadata.get("metrics") if self.metadata else None,
            "explanation": (
                "Predicted likelihood of an invitation response among consented, "
                "eligible donors. This is not a medical eligibility decision, and "
                "an invited donor is never counted as available blood."
            ),
        }

    def train(
        self, samples: Sequence[DonorSample], dataset_label: str
    ) -> dict[str, Any]:
        consented = [sample for sample in samples if sample.consented]
        if len(consented) < 40:
            raise ValueError("At least 40 consented donor-response samples are required.")
        labels = np.asarray([1 if sample.responded else 0 for sample in consented])
        positives = int(labels.sum())
        negatives = int(len(labels) - positives)
        if positives < 8 or negatives < 8:
            raise ValueError(
                "At least 8 positive and 8 negative response outcomes are required."
            )
        matrix = np.asarray([sample.features() for sample in consented], dtype=float)
        x_train, x_test, y_train, y_test = train_test_split(
            matrix,
            labels,
            test_size=0.2,
            random_state=42,
            stratify=labels,
        )
        classifier = RandomForestClassifier(
            n_estimators=240,
            max_depth=7,
            min_samples_leaf=4,
            class_weight="balanced",
            random_state=42,
            n_jobs=2,
        )
        classifier.fit(x_train, y_train)
        probabilities = classifier.predict_proba(x_test)[:, 1]
        predictions = (probabilities >= 0.5).astype(int)
        metrics = {
            "roc_auc": round(float(roc_auc_score(y_test, probabilities)), 4),
            "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
            "precision": round(float(precision_score(y_test, predictions, zero_division=0)), 4),
            "recall": round(float(recall_score(y_test, predictions, zero_division=0)), 4),
            "f1": round(float(f1_score(y_test, predictions, zero_division=0)), 4),
            "base_rate": round(float(labels.mean()), 4),
            "train_size": int(len(y_train)),
            "holdout_size": int(len(y_test)),
        }
        # Refit on every consented row after evaluation.
        final_model = RandomForestClassifier(
            n_estimators=240,
            max_depth=7,
            min_samples_leaf=4,
            class_weight="balanced",
            random_state=42,
            n_jobs=2,
        )
        final_model.fit(matrix, labels)

        fingerprint = hashlib.sha256(
            json.dumps(
                [sample.features() + [sample.responded] for sample in consented],
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:10]
        version = f"rf-donor-{datetime.now(timezone.utc).date().isoformat()}-{fingerprint}"
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        version_dir = self.artifacts_dir / "versions"
        version_dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(final_model, self.model_path)
        joblib.dump(final_model, version_dir / f"{version}.joblib")

        metadata = {
            "model": "random_forest_donor_response",
            "version": version,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "dataset_label": dataset_label,
            "synthetic": all(sample.is_synthetic for sample in consented),
            "sample_size": len(consented),
            "feature_names": FEATURE_NAMES,
            "metrics": metrics,
            "validation_method": (
                "Stratified 80/20 holdout. Metrics describe this dataset only; "
                "the final model is refit on all consented samples."
            ),
            "constraints": (
                "Consent required. Not used for medical eligibility or clinical "
                "compatibility. Non-responders are not penalised medically."
            ),
        }
        _atomic_json(self.metadata_path, metadata)
        _atomic_json(version_dir / f"{version}.metadata.json", metadata)
        self.refresh()
        return metadata


def synthetic_donor_samples(seed: int = 7, count: int = 900) -> list[DonorSample]:
    """Labelled synthetic examples for development, never hospital data."""

    import random

    generator = random.Random(seed)
    samples: list[DonorSample] = []
    for _ in range(count):
        distance = max(0.5, generator.gauss(22.0, 13.0))
        days_since = max(1, int(generator.gauss(150, 90)))
        previous = max(0, int(generator.gauss(3.0, 2.4)))
        prior_rate = min(1.0, max(0.0, generator.betavariate(2.0, 2.0)))
        logit = (
            1.2
            - distance * 0.035
            - days_since * 0.002
            + previous * 0.18
            + prior_rate * 2.4
        )
        probability = 1.0 / (1.0 + math.exp(-logit))
        samples.append(
            DonorSample(
                distance_km=round(distance, 1),
                days_since_donation=days_since,
                previous_donations=previous,
                prior_response_rate=round(prior_rate, 3),
                consented=True,
                responded=generator.random() < probability,
                # type: ignore[call-arg]
            )
        )
    return samples
