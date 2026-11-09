from __future__ import annotations

import json
import math
from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.features import synthetic_demand_records
from app.main import ARTIFACTS_DIR, app

client = TestClient(app)


def _demand_points(blood_group: str = "O+", component: str = "red_cells", days: int = 70):
    records = [
        record
        for record in synthetic_demand_records()
        if record.blood_group == blood_group and record.component == component
    ][-days:]
    return [{"date": record.date, "units": record.units} for record in records]


def test_health_reports_trained_artifacts() -> None:
    assert client.get("/livez").status_code == 200
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["models"]["demand_forecast"]["ready"] is True
    assert body["models"]["donor_response"]["ready"] is True
    assert body["models"]["inventory_anomaly"]["ready"] is True
    assert "does not decide" in body["clinical_rule"]


def test_demand_model_artifact_has_real_holdout_metrics() -> None:
    metadata = json.loads((ARTIFACTS_DIR / "demand_metadata.json").read_text())
    assert metadata["model"] == "xgboost_demand"
    assert metadata["synthetic"] is True
    assert metadata["metrics"]["holdout_size"] > 0
    assert math.isfinite(metadata["metrics"]["mae"])
    assert math.isfinite(metadata["metrics"]["baseline_mae"])
    assert metadata["chronological_split"]["cutoff"]


def test_predict_demand_returns_all_horizons() -> None:
    response = client.post(
        "/v1/predict/demand",
        json={
            "blood_group": "O+",
            "component": "red_cells",
            "points": _demand_points(),
            "horizon_days": 30,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model"] == "xgboost_demand"
    assert len(body["daily"]) == 30
    assert body["horizons"]["h24"] is not None
    assert body["horizons"]["h7"] is not None
    assert body["horizons"]["h30"] is not None
    assert body["horizons"]["h30"] >= body["horizons"]["h7"] >= body["horizons"]["h24"]
    assert body["synthetic_training_data"] is True


def test_predict_demand_refuses_short_history() -> None:
    response = client.post(
        "/v1/predict/demand",
        json={
            "blood_group": "O+",
            "component": "red_cells",
            "points": _demand_points(days=8),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "insufficient_data"
    assert body["horizons"] == {"h24": None, "h7": None, "h30": None}
    assert body["daily"] == []


def test_demand_training_rejects_too_little_history() -> None:
    response = client.post(
        "/v1/train/demand",
        json={
            "records": [
                {
                    "date": f"2026-01-{index + 1:02d}",
                    "blood_group": "O+",
                    "component": "red_cells",
                    "units": 5,
                    "is_synthetic": True,
                }
                for index in range(20)
            ],
            "dataset_label": "short test",
        },
    )
    assert response.status_code == 422
    assert "enough history" in response.json()["detail"]


def test_batch_prediction_preserves_group_and_component() -> None:
    response = client.post(
        "/v1/predict/demand/batch",
        json={
            "series": [
                {
                    "blood_group": "A+",
                    "component": "platelets",
                    "points": _demand_points("A+", "platelets"),
                },
                {
                    "blood_group": "O-",
                    "component": "whole_blood",
                    "points": _demand_points("O-", "whole_blood"),
                },
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 2
    assert body["results"][0]["blood_group"] == "A+"
    assert body["results"][1]["component"] == "whole_blood"


def test_donor_prediction_requires_consent() -> None:
    response = client.post(
        "/v1/predict/donor",
        json={
            "distance_km": 10,
            "days_since_donation": 90,
            "previous_donations": 3,
            "prior_response_rate": 0.7,
            "consented": False,
        },
    )
    assert response.status_code == 403


def test_donor_prediction_is_bounded() -> None:
    for rate in (0.0, 0.5, 1.0):
        response = client.post(
            "/v1/predict/donor",
            json={
                "distance_km": 12,
                "days_since_donation": 120,
                "previous_donations": 2,
                "prior_response_rate": rate,
                "consented": True,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert 0.0 <= body["response_probability"] <= 1.0


def test_anomaly_detection_finds_injected_spike() -> None:
    start = date(2026, 2, 1)
    observations = [
        {
            "date": (start + timedelta(days=index)).isoformat(),
            "units": 10 + (index % 3),
        }
        for index in range(40)
    ]
    observations.append(
        {"date": (start + timedelta(days=40)).isoformat(), "units": 70}
    )
    response = client.post("/v1/detect/anomalies", json={"observations": observations})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert any(finding["direction"] == "spike" for finding in body["findings"])


def test_anomaly_detection_refuses_short_history() -> None:
    response = client.post(
        "/v1/detect/anomalies",
        json={
            "observations": [
                {
                    "date": (date(2026, 2, 1) + timedelta(days=index)).isoformat(),
                    "units": 10,
                }
                for index in range(5)
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient_data"


def test_batch_donor_prediction_and_explainability() -> None:
    response = client.post(
        "/v1/predict/donor/batch",
        json={
            "donors": [
                {
                    "donor_id": "donor-1",
                    "distance_km": 4.2,
                    "days_since_donation": 120,
                    "previous_donations": 4,
                    "prior_response_rate": 0.8,
                    "consented": True,
                },
                {
                    "donor_id": "donor-2",
                    "distance_km": 19.0,
                    "days_since_donation": 300,
                    "previous_donations": 1,
                    "prior_response_rate": 0.2,
                    "consented": True,
                },
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["model_ready"] is True
    assert len(body["results"]) == 2
    first = body["results"][0]
    assert first["donor_id"] == "donor-1"
    assert first["status"] == "ok"
    assert 0 <= first["response_probability"] <= 1
    assert len(first["top_factors"]) == 3
    assert "not a causal" in first["explanation"]


def test_token_is_enforced_when_configured(monkeypatch) -> None:
    monkeypatch.setenv("ML_SERVICE_TOKEN", "test-secret")
    assert client.get("/health").status_code == 401
    assert client.get("/livez").status_code == 200
    assert client.get("/v1/models").status_code == 401
    response = client.get(
        "/v1/models", headers={"Authorization": "Bearer test-secret"}
    )
    assert response.status_code == 200
    assert client.get("/health", headers={"Authorization": "Bearer test-secret"}).status_code == 200
    assert len(response.json()["models"]) == 3
    monkeypatch.delenv("ML_SERVICE_TOKEN")


def test_artifacts_are_not_using_hospital_data_claim() -> None:
    metadata = json.loads((ARTIFACTS_DIR / "demand_metadata.json").read_text())
    assert "synthetic" in metadata["dataset_label"].lower()
    summary = json.loads((ARTIFACTS_DIR / "training-summary.json").read_text())
    assert summary["synthetic_dataset"] is True
    assert "not evidence" in summary["warning"]
