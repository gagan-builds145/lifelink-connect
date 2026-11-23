from __future__ import annotations

import math

from pydantic import BaseModel, Field, field_validator


class DemandRecordIn(BaseModel):
    date: str
    blood_group: str
    component: str
    units: float = Field(ge=0)
    is_synthetic: bool = False


class DemandTrainRequest(BaseModel):
    records: list[DemandRecordIn] = Field(min_length=1)
    dataset_label: str = "unspecified dataset"
    source: str = "convex"


class DemandPointIn(BaseModel):
    date: str
    units: float = Field(ge=0)


class DemandPredictRequest(BaseModel):
    blood_group: str
    component: str
    points: list[DemandPointIn] = Field(min_length=1)
    horizon_days: int = Field(default=30, ge=1, le=90)


class DemandSeriesIn(BaseModel):
    blood_group: str
    component: str
    points: list[DemandPointIn] = Field(min_length=1)


class DemandBatchPredictRequest(BaseModel):
    series: list[DemandSeriesIn] = Field(min_length=1, max_length=32)
    horizon_days: int = Field(default=30, ge=1, le=90)


class DonorSampleIn(BaseModel):
    distance_km: float = Field(ge=0)
    days_since_donation: int = Field(ge=0)
    previous_donations: int = Field(ge=0)
    prior_response_rate: float = Field(ge=0, le=1)
    consented: bool
    responded: bool | None = None
    is_synthetic: bool = False


class DonorTrainRequest(BaseModel):
    samples: list[DonorSampleIn] = Field(min_length=1)
    dataset_label: str = "unspecified dataset"

    @field_validator("samples")
    @classmethod
    def require_outcome(cls, samples: list[DonorSampleIn]) -> list[DonorSampleIn]:
        if any(sample.responded is None for sample in samples):
            raise ValueError("Training samples must include the responded outcome.")
        if any(not sample.consented for sample in samples):
            raise ValueError("Only explicitly consented donor samples may be used.")
        return samples


class DonorPredictRequest(BaseModel):
    distance_km: float = Field(ge=0)
    days_since_donation: int = Field(ge=0)
    previous_donations: int = Field(ge=0)
    prior_response_rate: float = Field(ge=0, le=1)
    consented: bool


class DonorBatchItem(DonorPredictRequest):
    donor_id: str = Field(min_length=1, max_length=128)


class DonorBatchPredictRequest(BaseModel):
    donors: list[DonorBatchItem] = Field(min_length=1, max_length=50)


class ObservationIn(BaseModel):
    date: str
    units: float = Field(ge=0)


class AnomalyDetectRequest(BaseModel):
    observations: list[ObservationIn] = Field(min_length=1)


class AnnPredictRequest(BaseModel):
    distance_km: float = Field(ge=0)
    days_since_donation: int = Field(ge=0)
    previous_donations: int = Field(ge=0)
    prior_response_rate: float = Field(ge=0, le=1)
    consented: bool


class LstmPredictRequest(BaseModel):
    units: list[float] = Field(min_length=28, max_length=28)

    @field_validator("units")
    @classmethod
    def finite_non_negative(cls, units: list[float]) -> list[float]:
        if any(not math.isfinite(value) or value < 0 for value in units):
            raise ValueError("Units must be finite and non-negative.")
        return units


class AutoencoderDetectRequest(BaseModel):
    units: list[float] = Field(min_length=29, max_length=365)

    @field_validator("units")
    @classmethod
    def finite_non_negative(cls, units: list[float]) -> list[float]:
        if any(not math.isfinite(value) or value < 0 for value in units):
            raise ValueError("Units must be finite and non-negative.")
        return units


class LabeledObservationIn(ObservationIn):
    is_anomaly: bool
    is_synthetic: bool = False


class AnomalyTrainRequest(BaseModel):
    observations: list[LabeledObservationIn] = Field(min_length=1)
    dataset_label: str = "unspecified dataset"
