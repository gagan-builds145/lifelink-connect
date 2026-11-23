from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _demand_points() -> list[dict]:
    from app.features import synthetic_demand_records

    records = [
        record
        for record in synthetic_demand_records()
        if record.blood_group == "O+" and record.component == "red_cells"
    ][-70:]
    return [{"date": record.date, "units": record.units} for record in records]


def test_ai_health_lists_models_and_advisory_rule():
    response = client.get("/ai/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "xgboost_demand" in body["active_models"]
    assert body["advisory_only"] is True
    assert "deterministic" in body["clinical_rule"]


def test_ai_model_catalog_does_not_pretend_deep_models_are_trained():
    response = client.get("/ai/models")
    assert response.status_code == 200
    models = {item["name"]: item for item in response.json()["models"]}
    assert models["xgboost_demand"]["ready"] is True
    assert models["random_forest_donor"]["ready"] is True
    assert models["isolation_forest"]["ready"] is True
    if not models["ann_donor"]["ready"]:
        assert models["ann_donor"]["artifact_present"] is False
    assert models["cnn_research"]["ready"] is False
    assert "intentionally not trained" in models["cnn_research"]["error"]


def test_ai_model_status_and_synthetic_metrics_context():
    status = client.get("/ai/models/xgboost_demand/status")
    assert status.status_code == 200
    assert status.json()["ready"] is True
    metrics = client.get("/ai/models/xgboost_demand/metrics")
    assert metrics.status_code == 200
    body = metrics.json()
    assert body["synthetic"] is True
    assert "synthetic-data" in body["metrics_context"]
    assert "mae" in body["metrics"]


def test_ai_unknown_model_and_missing_metrics_return_meaningful_404():
    assert client.get("/ai/models/does_not_exist/status").status_code == 404
    response = client.get("/ai/models/cnn_research/metrics")
    assert response.status_code == 404
    assert "No evaluation metrics" in response.json()["detail"]


def test_ai_demand_alias_returns_structured_response():
    response = client.post(
        "/ai/demand/predict",
        json={
            "blood_group": "O+",
            "component": "red_cells",
            "points": _demand_points(),
            "horizon_days": 7,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["horizons"]["h7"] is not None
    assert len(body["daily"]) == 7


def test_ai_donor_alias_requires_consent_and_returns_probability():
    denied = client.post(
        "/ai/donor-response/predict",
        json={
            "distance_km": 10,
            "days_since_donation": 90,
            "previous_donations": 3,
            "prior_response_rate": 0.7,
            "consented": False,
        },
    )
    assert denied.status_code == 403
    response = client.post(
        "/ai/donor-response/predict",
        json={
            "distance_km": 10,
            "days_since_donation": 90,
            "previous_donations": 3,
            "prior_response_rate": 0.7,
            "consented": True,
        },
    )
    assert response.status_code == 200
    assert 0 <= response.json()["response_probability"] <= 1


def test_ai_inventory_anomaly_alias_finds_spike():
    start = date(2026, 2, 1)
    observations = [
        {"date": (start + timedelta(days=index)).isoformat(), "units": 10 + (index % 3)}
        for index in range(40)
    ]
    observations.append({"date": (start + timedelta(days=40)).isoformat(), "units": 75})
    response = client.post("/ai/inventory/anomaly-detect", json={"observations": observations})
    assert response.status_code == 200
    assert any(finding["direction"] == "spike" for finding in response.json()["findings"])


def test_concurrent_demand_predictions_do_not_race_model_loading():
    payload = {
        "blood_group": "O+",
        "component": "red_cells",
        "points": _demand_points(),
        "horizon_days": 7,
    }

    def call(_: int) -> int:
        return client.post("/ai/demand/predict", json=payload).status_code

    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = list(pool.map(call, range(12)))
    assert statuses == [200] * 12


def test_ai_endpoints_reject_invalid_input():
    response = client.post("/ai/demand/predict", json={"blood_group": "O+"})
    assert response.status_code == 422
    response = client.post(
        "/ai/inventory/anomaly-detect",
        json={"observations": [{"date": "not-a-date", "units": -1}]},
    )
    assert response.status_code == 422
