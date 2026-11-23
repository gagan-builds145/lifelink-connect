from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from scripts.verify_deep_artifacts import verify

client = TestClient(app)


def _ann_payload(consented: bool = True) -> dict:
    return {
        "distance_km": 8.2,
        "days_since_donation": 120,
        "previous_donations": 3,
        "prior_response_rate": 0.6,
        "consented": consented,
    }


def test_ann_requires_consent_before_loading_any_model():
    response = client.post("/ai/ann/predict", json=_ann_payload(consented=False))
    assert response.status_code == 403
    assert "consented" in response.json()["detail"].lower()


def test_deep_endpoints_never_fabricate_a_prediction_when_untrained():
    ann = client.post("/ai/ann/predict", json=_ann_payload())
    lstm = client.post("/ai/lstm/predict", json={"units": [1.0] * 28})
    autoencoder = client.post("/ai/autoencoder/detect", json={"units": [1.0] * 30})

    assert ann.status_code in {200, 503}
    assert lstm.status_code in {200, 503}
    assert autoencoder.status_code in {200, 503}
    if ann.status_code == 503:
        assert "response_probability" not in ann.json()
        assert "not trained" in ann.json()["detail"].lower() or "tensorflow" in ann.json()[
            "detail"
        ].lower()
    else:
        assert 0.0 <= ann.json()["response_probability"] <= 1.0
        assert ann.json()["advisory_only"] is True
    if lstm.status_code == 200:
        assert lstm.json()["forecast_units"] >= 0
    if autoencoder.status_code == 200:
        assert autoencoder.json()["review_required"] is True


def test_deep_payload_shapes_are_validated():
    assert client.post("/ai/lstm/predict", json={"units": [1.0] * 27}).status_code == 422
    assert client.post("/ai/lstm/predict", json={"units": [-1.0] * 28}).status_code == 422
    assert client.post("/ai/autoencoder/detect", json={"units": [1.0] * 28}).status_code == 422
    assert client.post("/ai/autoencoder/detect", json={"units": [-1.0] * 30}).status_code == 422


def test_verifier_fails_closed_without_artifacts(tmp_path: Path):
    status, report = verify(tmp_path, None)
    assert status == 2
    assert report["status"] == "failed"
    assert set(report["missing"]) == {"ANN", "LSTM", "Autoencoder"}
    assert not (tmp_path / "deep" / "deep-artifacts-manifest.json").exists()
