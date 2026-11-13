from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _points(days: int = 70):
    return [
        {"date": f"2026-01-{index % 28 + 1:02d}", "units": 5.0}
        for index in range(days)
    ]


def test_health_requires_token_when_configured(monkeypatch) -> None:
    monkeypatch.setenv("ML_SERVICE_TOKEN", "secret-token")
    try:
        assert client.get("/health").status_code == 401
        assert client.get("/v1/models").status_code == 401
        assert (
            client.post("/v1/predict/demand", json={"blood_group": "O+", "component": "red_cells", "points": _points()}).status_code
            == 401
        )
        # Liveness stays public for container probes.
        assert client.get("/livez").status_code == 200
        # Wrong token is rejected with a generic message.
        response = client.get("/health", headers={"Authorization": "Bearer wrong"})
        assert response.status_code == 401
        assert "traceback" not in response.text.lower()
        assert (
            client.get("/health", headers={"Authorization": "Bearer secret-token"}).status_code
            == 200
        )
    finally:
        monkeypatch.delenv("ML_SERVICE_TOKEN", raising=False)


def test_oversized_body_is_rejected_without_touching_the_model() -> None:
    # Declared Content-Length above the 512 KB cap is refused at the edge.
    response = client.post(
        "/v1/predict/demand",
        content=b"{}",
        headers={
            "Content-Type": "application/json",
            "Content-Length": str(600 * 1024),
        },
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "Request body is too large."


def test_strict_input_schema_rejects_extra_and_invalid_values() -> None:
    bad = client.post(
        "/v1/predict/demand",
        json={
            "blood_group": "O+",
            "component": "red_cells",
            "points": [{"date": "2026-01-01", "units": -4}],
        },
    )
    assert bad.status_code == 422

    huge_batch = client.post(
        "/v1/predict/demand/batch",
        json={
            "series": [
                {"blood_group": "O+", "component": "red_cells", "points": _points(2)}
                for _ in range(64)
            ]
        },
    )
    assert huge_batch.status_code == 422


def test_rate_limit_returns_429_without_leaking_internals(monkeypatch) -> None:
    monkeypatch.setenv("ML_RATE_LIMIT_PER_MINUTE", "10")
    try:
        statuses = []
        for _ in range(20):
            statuses.append(
                client.post(
                    "/v1/predict/demand/batch",
                    json={
                        "series": [
                            {
                                "blood_group": "O+",
                                "component": "red_cells",
                                "points": _points(2),
                            }
                        ]
                    },
                ).status_code
            )
        assert 429 in statuses
        limited = client.post(
            "/v1/predict/demand/batch",
            json={
                "series": [
                    {"blood_group": "O+", "component": "red_cells", "points": _points(2)}
                ]
            },
        )
        assert limited.status_code == 429
        assert "Traceback" not in limited.text
        assert limited.headers.get("Cache-Control") == "no-store"
    finally:
        monkeypatch.delenv("ML_RATE_LIMIT_PER_MINUTE", raising=False)


def test_security_headers_are_present() -> None:
    response = client.get("/livez")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"


def test_wildcard_cors_is_refused(monkeypatch) -> None:
    # The origin check runs at import time; calling it directly documents the
    # refusal without restarting the app.
    import app.main as main

    monkeypatch.setenv("ML_CORS_ORIGINS", "*")
    try:
        try:
            main._cors_origins()
        except RuntimeError as error:
            assert "Wildcard CORS" in str(error)
        else:  # pragma: no cover
            raise AssertionError("wildcard CORS was accepted")
    finally:
        monkeypatch.delenv("ML_CORS_ORIGINS", raising=False)
