"""LifeLink ML service.

Run:
    uvicorn app.main:app --host 127.0.0.1 --port 8000

Authentication:
    Set ML_SERVICE_TOKEN and send `Authorization: Bearer <token>` from Convex.
    If it is unset, the service runs in local-development mode and logs that
    protected endpoints are unauthenticated. Never expose that mode publicly.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

MAX_REQUEST_BYTES = 512 * 1024  # 512 KB practical cap on JSON bodies
MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2 MB practical cap on responses

logger = logging.getLogger(__name__)

def _safe_log_event(event: str, *, include_pii: bool = False) -> None:
    """Structured-ish log helper that never emits patient/donor identifiers.

    When ``include_pii`` is True the caller is asserting that the logged text
    has already been stripped of names, contact details, emails and similar
    identifiers. This helper itself does not add that stripping.
    """
    logger.info(event)

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

ARTIFACTS_DIR = Path(
    os.environ.get(
        "LIFELINK_ML_ARTIFACTS",
        str(Path(__file__).resolve().parents[1] / "artifacts"),
    )
)
SERVICE_VERSION = "1.0.0"

demand_model = DemandModel(ARTIFACTS_DIR)
donor_model = DonorModel(ARTIFACTS_DIR)
anomaly_model = AnomalyModel(ARTIFACTS_DIR)

if os.environ.get("ML_REQUIRE_AUTH", "").lower() in {"1", "true", "yes"} and not os.environ.get(
    "ML_SERVICE_TOKEN"
):
    raise RuntimeError(
        "ML_REQUIRE_AUTH is enabled but ML_SERVICE_TOKEN is missing. Refusing to start an unauthenticated production service."
    )

app = FastAPI(
    title="LifeLink ML Service",
    version=SERVICE_VERSION,
    description=(
        "XGBoost blood-demand forecasting, consented donor-response scoring and "
        "Isolation Forest anomaly detection. Clinical compatibility remains in "
        "deterministic LifeLink rules, never in these models."
    ),
)


def _cors_origins() -> list[str]:
    raw = os.environ.get("ML_CORS_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = os.environ.get("ML_SERVICE_TOKEN")
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Invalid ML service token.")


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


def _points(points: list) -> list[DemandPoint]:
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


@app.get("/livez")
def livez(request: Request) -> dict:
    """Minimal unauthenticated liveness endpoint for container probes."""
    return {"status": "ok", "service": "lifelink-ml", "version": SERVICE_VERSION}


@app.get("/health", dependencies=[Depends(require_token)])
def health(request: Request) -> dict:
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


@app.post("/v1/predict/donor/batch", dependencies=[Depends(require_token)])
def predict_donor_batch(request: DonorBatchPredictRequest) -> dict:
    # Size gate first so malformed huge payloads are rejected before model work.
    _guard_request_size(request)
    results = []
    for item in request.series:
        try:
            sample = DonorSample(
                distance_km=item.distance_km,
                days_since_donation=item.days_since_donation,
                previous_donations=item.previous_donations,
                prior_response_rate=item.prior_response_rate,
                consented=item.consented,
                responded=False,
                is_synthetic=False,
            )
            result = donor_model.predict(sample)
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
                "probability": None,
                "threshold": donor_model.metadata.get("threshold"),
                "explanation": str(error),
            }
        results.append(
            {
                "distance_km": item.distance_km,
                "days_since_donation": item.days_since_donation,
                "previous_donations": item.previous_donations,
                "prior_response_rate": item.prior_response_rate,
                "consented": item.consented,
                **result,
            }
        )
    _safe_log_event(
        "donor batch prediction completed",
        include_pii=False,
    )
    return {
        "model_ready": donor_model.ready,
        "model_version": donor_model.metadata.get("version")
        if donor_model.metadata
        else None,
        "results": results,
    }


def _guard_request_size(request: object, /) -> None:
    """Reject oversized requests before they reach model code."""
    payload = request.model_dump() if hasattr(request, "model_dump") else request
    encoded = json.dumps(payload, default=str).encode("utf-8")
    if len(encoded) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="Request payload is too large.")


def _strip_pii_from_result(result: dict) -> dict:
    """Keep model metadata, drop any accidental free-text that might contain names."""
    cleaned: dict = {}
    for key, value in result.items():
        if key in {"explanation", "note", "detail", "error"}:
            # Truncate and remove obvious identifier crudity. This is a safety net,
            # not a PII sanitizer.
            text = str(value).replace("\n", " ").strip()
            cleaned[key] = (text or "")[:200]
        else:
            cleaned[key] = value
    return cleaned


@app.post("/v1/anomaly/detect", dependencies=[Depends(require_token)])
def detect_anomaly(request: AnomalyDetectRequest) -> dict:
    try:
        observations = [
            Observation(
                timestamp=obs.timestamp,
                blood_group=obs.blood_group,
                component=obs.component,
                units=obs.units,
                storage_temp_c=(obs.storage_temp_c if obs.storage_temp_c is not None else None),
            )
            for obs in request.observations
        ]
        labels = anomaly_model.predict(observations)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _safe_log_event(
        "anomaly detection completed",
        include_pii=False,
    )
    return {
        "model_ready": anomaly_model.ready,
        "model_version": anomaly_model.metadata.get("version")
        if anomaly_model.metadata
        else None,
        "results": [
            _strip_pii_from_result({
                "timestamp": obs.timestamp,
                "blood_group": obs.blood_group,
                "component": obs.component,
                "units": obs.units,
                "storage_temp_c": obs.storage_temp_c,
                "label": label,
                "score": score,
            })
            for obs, label, score in zip(
                observations,
                labels.labels,
                labels.scores,
            )
        ],
    }


@app.post("/v1/anomaly/train", dependencies=[Depends(require_token)])
def train_anomaly(request: AnomalyTrainRequest) -> dict:
    try:
        samples = [
            LabeledObservation(
                timestamp=sample.timestamp,
                blood_group=sample.blood_group,
                component=sample.component,
                units=sample.units,
                storage_temp_c=(sample.storage_temp_c if sample.storage_temp_c is not None else None),
                label=bool(sample.label),
                is_synthetic=sample.is_synthetic,
            )
            for sample in request.observations
        ]
        metadata = anomaly_model.train(
            samples,
            dataset_label=request.dataset_label,
            source=request.source,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _safe_log_event(
        "anomaly model trained",
        include_pii=False,
    )
    return {
        "trained": True,
        "minimum_observations": anomaly_model.min observations,
        **metadata,
    }



@app.post("/v1/predict/donor/batch", dependencies=[Depends(require_token)])
def predict_donor_batch(request: DonorBatchPredictRequest) -> dict:
    # Size gate first so malformed huge payloads are rejected before model work.
    _guard_request_size(request)
    results = []
    for item in request.series:
        try:
            sample = DonorSample(
                distance_km=item.distance_km,
                days_since_donation=item.days_since_donation,
                previous_donations=item.previous_donations,
                prior_response_rate=item.prior_response_rate,
                consented=item.consented,
                responded=False,
                is_synthetic=False,
            )
            result = donor_model.predict(sample)
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
                "probability": None,
                "threshold": donor_model.metadata.get("threshold"),
                "explanation": str(error),
            }
        results.append(
            {
                "distance_km": item.distance_km,
                "days_since_donation": item.days_since_donation,
                "previous_donations": item.previous_donations,
                "prior_response_rate": item.prior_response_rate,
                "consented": item.consented,
                **result,
            }
        )
    _safe_log_event(
        "donor batch prediction completed",
        include_pii=False,
    )
    return {
        "model_ready": donor_model.ready,
        "model_version": donor_model.metadata.get("version")
        if donor_model.metadata
        else None,
        "results": results,
    }


def _guard_request_size(request: object, /) -> None:
    """Reject oversized requests before they reach model code."""
    payload = request.model_dump() if hasattr(request, "model_dump") else request
    encoded = json.dumps(payload, default=str).encode("utf-8")
    if len(encoded) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="Request payload is too large.")


def _strip_pii_from_result(result: dict) -> dict:
    """Keep model metadata, drop any accidental free-text that might contain names."""
    cleaned: dict = {}
    for key, value in result.items():
        if key in {"explanation", "note", "detail", "error"}:
            # Truncate and remove obvious identifier crudity. This is a safety net,
            # not a PII sanitizer.
            text = str(value).replace("\n", " ").strip()
            cleaned[key] = (text or "")[:200]
        else:
            cleaned[key] = value
    return cleaned


@app.post("/v1/anomaly/detect", dependencies=[Depends(require_token)])
def detect_anomaly(request: AnomalyDetectRequest) -> dict:
    try:
        observations = [
            Observation(
                timestamp=obs.timestamp,
                blood_group=obs.blood_group,
                component=obs.component,
                units=obs.units,
                storage_temp_c=(obs.storage_temp_c if obs.storage_temp_c is not None else None),
            )
            for obs in request.observations
        ]
        labels = anomaly_model.predict(observations)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _safe_log_event(
        "anomaly detection completed",
        include_pii=False,
    )
    return {
        "model_ready": anomaly_model.ready,
        "model_version": anomaly_model.metadata.get("version")
        if anomaly_model.metadata
        else None,
        "results": [
            _strip_pii_from_result({
                "timestamp": obs.timestamp,
                "blood_group": obs.blood_group,
                "component": obs.component,
                "units": obs.units,
                "storage_temp_c": obs.storage_temp_c,
                "label": label,
                "score": score,
            })
            for obs, label, score in zip(
                observations,
                labels.labels,
                labels.scores,
            )
        ],
    }


@app.post("/v1/anomaly/train", dependencies=[Depends(require_token)])
def train_anomaly(request: AnomalyTrainRequest) -> dict:
    try:
        samples = [
            LabeledObservation(
                timestamp=sample.timestamp,
                blood_group=sample.blood_group,
                component=sample.component,
                units=sample.units,
                storage_temp_c=(sample.storage_temp_c if sample.storage_temp_c is not None else None),
                label=bool(sample.label),
                is_synthetic=sample.is_synthetic,
            )
            for sample in request.observations
        ]
        metadata = anomaly_model.train(
            samples,
            dataset_label=request.dataset_label,
            source=request.source,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _safe_log_event(
        "anomaly model trained",
        include_pii=False,
    )
    return {
        "trained": True,
        "minimum_observations": anomaly_model.min observations,
        **metadata,
    }



@app.get("/v1/models", dependencies=[Depends(require_token)])
def models() -> dict:
    return {
        "models": [
            _model_summary(demand_model, "demand_forecast"),
            _model_summary(donor_model, "donor_response"),
            _model_summary(anomaly_model, "inventory_anomaly"),
        ],
        "artifacts_dir": str(ARTIFACTS_DIR),
    }


@app.post("/v1/train/demand", dependencies=[Depends(require_token)])
def train_demand(request: DemandTrainRequest) -> dict:
    try:
        metadata = demand_model.train(
            _demand_records(request),
            dataset_label=request.dataset_label,
            source=request.source,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "trained": True,
        "minimum_days_per_series": MIN_TRAINING_DAYS,
        **metadata,
    }


@app.post("/v1/predict/demand", dependencies=[Depends(require_token)])
def predict_demand(request: DemandPredictRequest) -> dict:
    try:
        series = normalize_points(
            _points(request.points), request.blood_group, request.component
        )
        return demand_model.predict(series, horizon_days=request.horizon_days)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/predict/demand/batch", dependencies=[Depends(require_token)])
def predict_demand_batch(request: DemandBatchPredictRequest) -> dict:
    results = []
    for item in request.series:
        try:
            series = normalize_points(
                _points(item.points), item.blood_group, item.component
            )
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


@app.post("/v1/train/donor", dependencies=[Depends(require_token)])
def train_donor(request: DonorTrainRequest) -> dict:
    try:
        metadata = donor_model.train(
            [
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
            ],
            dataset_label=request.dataset_label,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"trained": True, **metadata}


@app.post("/v1/predict/donor", dependencies=[Depends(require_token)])
def predict_donor(request: DonorPredictRequest) -> dict:
    try:
        return donor_model.predict(
            DonorSample(
                distance_km=request.distance_km,
                days_since_donation=request.days_since_donation,
                previous_donations=request.previous_donations,
                prior_response_rate=request.prior_response_rate,
                consented=request.consented,
                responded=False,
                is_synthetic=False,
            )
        )
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error


@app.post("/v1/predict/donor/batch", dependencies=[Depends(require_token)])
def predict_donor_batch(request: DonorBatchPredictRequest) -> dict:
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
                "status": "consent_required",
                "response_probability": None,
                "explanation": str(error),
            }
        results.append({"donor_id": donor.donor_id, **result})
    metadata = donor_model.metadata or {}
    return {
        "model_ready": donor_model.ready,
        "model_version": metadata.get("version"),
        "synthetic_training_data": bool(metadata.get("synthetic")),
        "results": results,
    }


@app.post("/v1/detect/anomalies", dependencies=[Depends(require_token)])
def detect_anomalies(request: AnomalyDetectRequest) -> dict:
    try:
        return anomaly_model.detect(
            [Observation(date=item.date, units=item.units) for item in request.observations]
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/train/anomalies", dependencies=[Depends(require_token)])
def train_anomalies(request: AnomalyTrainRequest) -> dict:
    try:
        metadata = anomaly_model.train(
            [
                LabeledObservation(
                    date=item.date,
                    units=item.units,
                    is_anomaly=item.is_anomaly,
                    is_synthetic=item.is_synthetic,
                )
                for item in request.observations
            ]
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"trained": True, "dataset_label": request.dataset_label, **metadata}
