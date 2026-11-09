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

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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


@app.get("/health")
def health() -> dict:
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
