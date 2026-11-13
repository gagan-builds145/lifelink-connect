"""LifeLink ML service.

Run:
    uvicorn app.main:app --host 127.0.0.1 --port 8000

Authentication:
    Set ML_SERVICE_TOKEN and send `Authorization: Bearer <token>` from Convex.
    If it is unset, the service runs in local development mode and logs a
    warning that protected endpoints are unauthenticated. Never expose that
    mode publicly; set ML_REQUIRE_AUTH=true in containers so the service
    refuses to start without a token.

Security posture (see docs/security.md):
    * bearer-token authentication on every non-liveness endpoint;
    * hard request-size cap (413) and response-size cap;
    * per-client rate limiting (429) with configurable limits;
    * strict Pydantic schemas with bounded list lengths;
    * per-request model timeout (504);
    * safe error bodies: no stack traces, paths or model internals;
    * access logging without payloads, patient or donor identifiers.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Annotated, Any, Sequence

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .anomaly_model import AnomalyModel, LabeledObservation, Observation
from .demand_model import DemandModel
from .donor_model import DonorModel, DonorSample
from .features import MIN_TRAINING_DAYS, DemandPoint, DemandRecord, normalize_points
from .schemas import (
    AnomalyDetectRequest,
    AnomalyTrainRequest,
    DemandBatchPredictRequest,
    DemandPredictRequest,
    DemandTrainRequest,
    DonorBatchPredictRequest,
    DonorPredictRequest,
    DonorTrainRequest,
)

MAX_REQUEST_BYTES = 512 * 1024  # 512 KB practical cap on JSON bodies
MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MB practical cap on responses
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_TIMEOUT_SECONDS = 180.0

ARTIFACTS_DIR = Path(
    os.environ.get(
        "LIFELINK_ML_ARTIFACTS",
        str(Path(__file__).resolve().parents[1] / "artifacts"),
    )
)
SERVICE_VERSION = "1.0.0"

logger = logging.getLogger("lifelink.ml")
if not logger.handlers:
    logging.basicConfig(
        level=os.environ.get("ML_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _safe_log_event(event: str, **fields: Any) -> None:
    """Log an identifier-free event.

    Callers must never pass request bodies, donor/patient names, emails,
    tokens or OTP codes. Only coarse operational metadata belongs here.
    """
    if fields:
        detail = " ".join(f"{key}={value}" for key, value in sorted(fields.items()))
        logger.info("%s %s", event, detail)
    else:
        logger.info("%s", event)


def _timeout_seconds() -> float:
    try:
        configured = float(os.environ.get("ML_REQUEST_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))
    except ValueError:
        configured = DEFAULT_TIMEOUT_SECONDS
    return max(1.0, min(MAX_TIMEOUT_SECONDS, configured))


def _rate_limit_per_minute() -> int:
    try:
        configured = int(os.environ.get("ML_RATE_LIMIT_PER_MINUTE", "120"))
    except ValueError:
        configured = 120
    return max(10, min(10_000, configured))


demand_model = DemandModel(ARTIFACTS_DIR)
donor_model = DonorModel(ARTIFACTS_DIR)
anomaly_model = AnomalyModel(ARTIFACTS_DIR)

if os.environ.get("ML_REQUIRE_AUTH", "").lower() in {"1", "true", "yes"} and not os.environ.get(
    "ML_SERVICE_TOKEN"
):
    raise RuntimeError(
        "ML_REQUIRE_AUTH is enabled but ML_SERVICE_TOKEN is missing. "
        "Refusing to start an unauthenticated production service."
    )

if not os.environ.get("ML_SERVICE_TOKEN"):
    logger.warning(
        "ML_SERVICE_TOKEN is not configured: protected endpoints are UNAUTHENTICATED. "
        "This mode is for local development only."
    )

app = FastAPI(
    title="LifeLink ML Service",
    version=SERVICE_VERSION,
    description=(
        "XGBoost blood-demand forecasting, consented donor-response scoring and "
        "Isolation Forest anomaly detection. Clinical compatibility remains in "
        "deterministic LifeLink rules, never in these models."
    ),
    docs_url=None if os.environ.get("ML_REQUIRE_AUTH", "").lower() in {"1", "true", "yes"} else "/docs",
    redoc_url=None,
    openapi_url=None if os.environ.get("ML_REQUIRE_AUTH", "").lower() in {"1", "true", "yes"} else "/openapi.json",
)


def _cors_origins() -> list[str]:
    raw = os.environ.get("ML_CORS_ORIGINS", "http://localhost:5173")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    if "*" in origins:
        raise RuntimeError(
            "Wildcard CORS is not allowed for the ML service. Set explicit origins in ML_CORS_ORIGINS."
        )
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# ---------------------------------------------------------------------------
# Rate limiting (in-process, per client and path)
# ---------------------------------------------------------------------------

_rate_windows: dict[str, deque[float]] = defaultdict(deque)


def _client_ref(request: Request) -> str:
    # Behind a reverse proxy, the proxy should be trusted and configured to
    # overwrite this header. Never log the raw value; only use it as a bucket.
    forwarded = request.headers.get("x-forwarded-for")
    host = request.client.host if request.client else "unknown"
    return (forwarded.split(",")[0].strip() if forwarded else host) or "unknown"


def _enforce_rate_limit(request: Request) -> None:
    limit = _rate_limit_per_minute()
    bucket = f"{_client_ref(request)}:{request.url.path}"
    now = time.monotonic()
    window = _rate_windows[bucket]
    while window and now - window[0] > 60.0:
        window.popleft()
    if len(window) >= limit:
        _safe_log_event("ml_rate_limited", path=request.url.path)
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
    window.append(now)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    started = time.monotonic()
    if request.url.path not in {"/livez", "/health"}:
        try:
            _enforce_rate_limit(request)
        except HTTPException as error:
            return JSONResponse(
                status_code=error.status_code,
                content={"detail": error.detail},
                headers={"Cache-Control": "no-store"},
            )

    declared = request.headers.get("content-length")
    if declared:
        try:
            if int(declared) > MAX_REQUEST_BYTES:
                _safe_log_event("ml_oversized_request", path=request.url.path)
                return JSONResponse(
                    status_code=413,
                    content={"detail": "Request body is too large."},
                    headers={"Cache-Control": "no-store"},
                )
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={"detail": "Malformed Content-Length header."},
                headers={"Cache-Control": "no-store"},
            )

    response = await call_next(request)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    _safe_log_event(
        "ml_request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        ms=elapsed_ms,
    )
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Log the exception type only; never the payload or a stack trace body.
    _safe_log_event(
        "ml_unhandled_error",
        path=request.url.path,
        error_type=type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "The model service could not process this request."},
        headers={"Cache-Control": "no-store"},
    )


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


def require_token(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = os.environ.get("ML_SERVICE_TOKEN")
    if not expected:
        return
    supplied = authorization or ""
    if not hmac.compare_digest(supplied, f"Bearer {expected}"):
        _safe_log_event("ml_auth_failure", path=request.url.path)
        raise HTTPException(status_code=401, detail="Invalid ML service token.")


# ---------------------------------------------------------------------------
# Model helpers
# ---------------------------------------------------------------------------


async def _run_model(func, *args):
    """Run blocking model work off the event loop with a hard timeout."""
    try:
        return await asyncio.wait_for(run_in_threadpool(func, *args), timeout=_timeout_seconds())
    except asyncio.TimeoutError as error:
        _safe_log_event("ml_model_timeout")
        raise HTTPException(
            status_code=504, detail="The model did not respond in time. Please retry."
        ) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _demand_records(request: DemandTrainRequest) -> list[DemandRecord]:
    return [
        DemandRecord(
            date=record.date,
            blood_group=record.blood_group,
            component=record.component,
            units=record.units,
            is_synthetic=record.is_synthetic,
        )
        for record in request.records
    ]


def _points(points: Sequence) -> list[DemandPoint]:
    return [DemandPoint(date=point.date, units=point.units) for point in points]


def _model_summary(model, kind: str) -> dict:
    metadata = model.metadata or {}
    return {
        "kind": kind,
        "ready": model.ready,
        "model": metadata.get("model"),
        "version": metadata.get("version"),
        "trained_at": metadata.get("trained_at"),
        "synthetic": metadata.get("synthetic"),
        "dataset_label": metadata.get("dataset_label"),
        "metrics": metadata.get("metrics"),
        "sample_size": metadata.get("sample_size") or metadata.get("training_rows"),
        "error": model.load_error,
    }


def _labeled_observations(request: AnomalyTrainRequest) -> list[LabeledObservation]:
    return [
        LabeledObservation(
            date=item.date,
            units=item.units,
            is_anomaly=item.is_anomaly,
            is_synthetic=item.is_synthetic,
        )
        for item in request.observations
    ]


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/livez")
async def livez() -> dict:
    """Minimal unauthenticated liveness endpoint for container probes."""
    return {"status": "ok", "service": "lifelink-ml", "version": SERVICE_VERSION}


@app.get("/health", dependencies=[Depends(require_token)])
async def health() -> dict:
    return {
        "status": "ok"
        if all([demand_model.ready, donor_model.ready, anomaly_model.ready])
        else "degraded",
        "service": "lifelink-ml",
        "version": SERVICE_VERSION,
        "auth_required": bool(os.environ.get("ML_SERVICE_TOKEN")),
        "artifacts_dir": str(ARTIFACTS_DIR),
        "models": {
            "demand_forecast": _model_summary(demand_model, "demand_forecast"),
            "donor_response": _model_summary(donor_model, "donor_response"),
            "inventory_anomaly": _model_summary(anomaly_model, "inventory_anomaly"),
        },
        "clinical_rule": (
            "Compatibility and allocation are deterministic; this service does "
            "not decide whether blood is clinically suitable."
        ),
    }


@app.get("/v1/models", dependencies=[Depends(require_token)])
async def models() -> dict:
    return {
        "models": [
            _model_summary(demand_model, "demand_forecast"),
            _model_summary(donor_model, "donor_response"),
            _model_summary(anomaly_model, "inventory_anomaly"),
        ]
    }


# ---------------------------------------------------------------------------
# Demand
# ---------------------------------------------------------------------------


@app.post("/v1/train/demand", dependencies=[Depends(require_token)])
async def train_demand(request: DemandTrainRequest) -> dict:
    metadata = await _run_model(
        demand_model.train,
        _demand_records(request),
        request.dataset_label,
        request.source,
    )
    _safe_log_event("demand_model_trained")
    return {
        "trained": True,
        "minimum_days_per_series": MIN_TRAINING_DAYS,
        **metadata,
    }


@app.post("/v1/predict/demand", dependencies=[Depends(require_token)])
async def predict_demand(request: DemandPredictRequest) -> dict:
    series = normalize_points(_points(request.points), request.blood_group, request.component)
    return await _run_model(demand_model.predict, series, request.horizon_days)


@app.post("/v1/predict/demand/batch", dependencies=[Depends(require_token)])
async def predict_demand_batch(request: DemandBatchPredictRequest) -> dict:
    results = []
    for item in request.series:
        try:
            series = normalize_points(_points(item.points), item.blood_group, item.component)
            result = demand_model.predict(series, horizon_days=request.horizon_days)
        except ValueError as error:
            result = {
                "status": "invalid_request",
                "model": "xgboost_demand",
                "model_version": demand_model.metadata.get("version")
                if demand_model.metadata
                else None,
                "metrics": demand_model.metadata.get("metrics")
                if demand_model.metadata
                else None,
                "horizons": {"h24": None, "h7": None, "h30": None},
                "explanation": str(error),
            }
        results.append(
            {
                "blood_group": item.blood_group,
                "component": item.component,
                **result,
            }
        )
    return {
        "model_ready": demand_model.ready,
        "model_version": demand_model.metadata.get("version")
        if demand_model.metadata
        else None,
        "results": results,
    }


# ---------------------------------------------------------------------------
# Donor response
# ---------------------------------------------------------------------------


@app.post("/v1/train/donor", dependencies=[Depends(require_token)])
async def train_donor(request: DonorTrainRequest) -> dict:
    samples = [
        DonorSample(
            distance_km=sample.distance_km,
            days_since_donation=sample.days_since_donation,
            previous_donations=sample.previous_donations,
            prior_response_rate=sample.prior_response_rate,
            consented=sample.consented,
            responded=bool(sample.responded),
            is_synthetic=sample.is_synthetic,
        )
        for sample in request.samples
    ]
    metadata = await _run_model(donor_model.train, samples, request.dataset_label)
    _safe_log_event("donor_model_trained")
    return {"trained": True, **metadata}


@app.post("/v1/predict/donor", dependencies=[Depends(require_token)])
async def predict_donor(request: DonorPredictRequest) -> dict:
    sample = DonorSample(
        distance_km=request.distance_km,
        days_since_donation=request.days_since_donation,
        previous_donations=request.previous_donations,
        prior_response_rate=request.prior_response_rate,
        consented=request.consented,
        responded=False,
        is_synthetic=False,
    )
    return await _run_model(donor_model.predict, sample)


@app.post("/v1/predict/donor/batch", dependencies=[Depends(require_token)])
async def predict_donor_batch(request: DonorBatchPredictRequest) -> dict:
    results = []
    for donor in request.donors:
        try:
            result = donor_model.predict(
                DonorSample(
                    distance_km=donor.distance_km,
                    days_since_donation=donor.days_since_donation,
                    previous_donations=donor.previous_donations,
                    prior_response_rate=donor.prior_response_rate,
                    consented=donor.consented,
                    responded=False,
                    is_synthetic=False,
                )
            )
        except PermissionError as error:
            result = {
                "status": "forbidden",
                "model": "donor_response",
                "response_probability": None,
                "explanation": str(error),
            }
        except ValueError as error:
            result = {
                "status": "invalid_request",
                "model": "donor_response",
                "model_version": donor_model.metadata.get("version")
                if donor_model.metadata
                else None,
                "metrics": donor_model.metadata.get("metrics")
                if donor_model.metadata
                else None,
                "response_probability": None,
                "threshold": donor_model.metadata.get("threshold")
                if donor_model.metadata
                else None,
                "explanation": str(error),
            }
        results.append({"donor_id": donor.donor_id, **result})
    return {
        "model_ready": donor_model.ready,
        "model_version": donor_model.metadata.get("version")
        if donor_model.metadata
        else None,
        "results": results,
    }


# ---------------------------------------------------------------------------
# Anomaly detection
# ---------------------------------------------------------------------------


@app.post("/v1/detect/anomalies", dependencies=[Depends(require_token)])
async def detect_anomalies(request: AnomalyDetectRequest) -> dict:
    observations = [
        Observation(date=item.date, units=item.units) for item in request.observations
    ]
    return await _run_model(anomaly_model.detect, observations)


@app.post("/v1/train/anomalies", dependencies=[Depends(require_token)])
async def train_anomalies(request: AnomalyTrainRequest) -> dict:
    metadata = await _run_model(anomaly_model.train, _labeled_observations(request))
    _safe_log_event("anomaly_model_trained")
    return {"trained": True, **metadata}
