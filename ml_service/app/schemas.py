from __future__ import annotations

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


class ObservationIn(BaseModel):
    date: str
    units: float = Field(ge=0)


class AnomalyDetectRequest(BaseModel):
    observations: list[ObservationIn] = Field(min_length=1)


class LabeledObservationIn(ObservationIn):
    is_anomaly: bool
    is_synthetic: bool = False


class AnomalyTrainRequest(BaseModel):
    observations: list[LabeledObservationIn] = Field(min_length=1)
    dataset_label: str = "unspecified dataset"
