# LifeLink ML service

AI datasets and model artifacts are designed for S3-compatible object storage;
Convex stores versions, checksums, lineage and model references. See
[`docs/ai-storage.md`](../docs/ai-storage.md) for the bucket layout, capacity
plan, retention and the bounded local scalability results. Bulk storage requires
`requirements-storage.txt`; it is separate from the inference service.

Python 3.10+/3.13 FastAPI service for:

- **XGBoost blood-demand forecasting** (24-hour, 7-day and 30-day horizons;
  blood-group/component series; chronological holdout; rolling-average baseline).
- **Random Forest donor-response ranking** for consented donors. It never
  determines medical eligibility, compatibility or release.
- **Isolation Forest anomaly detection** with an explanatory trailing z-score.
- Optional **ANN donor**, **LSTM demand** and **Autoencoder inventory** inference, only after verified TensorFlow artifacts are installed.

Clinical compatibility, reservation and allocation remain deterministic in
LifeLink's shared rules engine. No model in this service decides whether blood
can be issued.

## Verified environment

The checked-in classical artifacts and the **64-test suite** pass on Python
3.10.12 in this workspace (the earlier 22-test run also passed on 3.13.15). The
Dockerfile targets 3.13; the image was not built here because Docker is
unavailable. `requirements.txt` selects the NumPy/SciPy wheels appropriate to
each interpreter. Deep models are **not trained in this workspace** because
TensorFlow is absent; see [Deep training](#deep-training-colab) below.

## Install and run (Windows PowerShell)

```powershell
cd ml_service
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python scripts/train_all.py
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

If Python 3.13 is unavailable, use Python 3.10+; state which interpreter is
actually running rather than claiming 3.13.

Liveness check (public, minimal):

```powershell
Invoke-RestMethod http://127.0.0.1:8000/livez | ConvertTo-Json -Depth 4
```

Authenticated readiness check:

```powershell
$headers = @{ Authorization = "Bearer $env:ML_SERVICE_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8000/health -Headers $headers | ConvertTo-Json -Depth 8
```

For a production process set `ML_REQUIRE_AUTH=true`; startup then fails rather
than serving protected model endpoints without a token. The Dockerfile sets this
by default.

## Connect Convex

Convex Cloud cannot reach `127.0.0.1`. For local development, expose the service
through an HTTPS tunnel, or deploy the service. Set the deployment variables:

```powershell
bunx convex env set ML_SERVICE_URL "https://your-ml-service.example.org"
bunx convex env set ML_SERVICE_TOKEN "a-long-random-secret"
```

The same `ML_SERVICE_TOKEN` must be set in the ML process environment. Without
it, protected endpoints are unauthenticated and must not be exposed publicly.

The app uses:

- `ml.refreshDemandForecasts` → `POST /v1/predict/demand/batch`
- `ml.trainDemandModel` (admin) → `POST /v1/train/demand`
- `ml.runAnomalyScan` → `POST /v1/detect/anomalies`
- `ml.trainDonorModel` (admin) → `POST /v1/train/donor`
- donor invitation action → `POST /v1/predict/donor/batch`
- `ml.mlServiceStatus` → `GET /health` (bearer token required when configured)

## AI endpoints

Authenticated aliases for application integration:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/ai/demand/predict` | XGBoost demand forecast |
| POST | `/ai/donor-response/predict` | Consent-gated Random Forest response score |
| POST | `/ai/inventory/anomaly-detect` | Isolation Forest + z-score review prompt |
| GET | `/ai/models` | Trained and missing model status |
| GET | `/ai/models/{name}/status` | One model's readiness |
| GET | `/ai/models/{name}/metrics` | Stored evaluation metrics |
| GET | `/ai/health` | AI service and model health |
| POST | `/ai/ann/predict` | ANN consented donor-response probability |
| POST | `/ai/lstm/predict` | LSTM next-day demand forecast from 28 units |
| POST | `/ai/autoencoder/detect` | Autoencoder reconstruction-error review prompt |

Deep models report `not_trained` until a TensorFlow environment produces and
registers `.keras` artifacts. The three deep endpoints return **503** when the
artifact or TensorFlow runtime is absent; they never fall back to another model.
ANN scoring also rejects `consented: false` with 403. No metrics are fabricated.

## Deep training (Colab)

The reproducible workflow is
[`notebooks/LifeLink_Deep_Training_Colab.ipynb`](notebooks/LifeLink_Deep_Training_Colab.ipynb).
It installs the pinned dependencies, reports the actual CPU/GPU device, runs the
existing `scripts/train_all_deep.py`, reports stored metrics, then loads each
model and runs a one-row inference with
`scripts/verify_deep_artifacts.py --package lifelink-deep-artifacts.zip`.

The verifier writes SHA-256 checksums, TensorFlow/Keras versions and a manifest
inside `artifacts/deep/`. It exits 2 if any model, scaler, history, metadata
field or inference check is missing. Extract the package into
`ml_service/artifacts/deep/`, then run the verifier and pytest again; do not
integrate a package that fails.

Current status: **ANN, LSTM and Autoencoder are NOT TRAINED here.**
`train_all_deep.py` and `evaluate_all.py` exit 2 because TensorFlow is not
installed. No `.keras` placeholder or invented metric exists. The classical
XGBoost, Random Forest and Isolation Forest artifacts are unchanged.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/livez` | Minimal unauthenticated liveness response for container probes. |
| GET | `/health` | Authenticated artifact readiness, model metadata and version. |
| GET | `/v1/models` | Versioned artifact summaries. |
| POST | `/v1/train/demand` | Train XGBoost from `{date, blood_group, component, units, is_synthetic}` records. Requires ≥60 continuous days per retained series. |
| POST | `/v1/predict/demand` | One group/component forecast. Requires ≥29 continuous days. |
| POST | `/v1/predict/demand/batch` | Up to 32 group/component series in one call. |
| POST | `/v1/train/donor` | Train Random Forest from consented labelled responses. Requires ≥40 samples with both classes. |
| POST | `/v1/predict/donor` | Response probability; rejects `consented: false`. |
| POST | `/v1/predict/donor/batch` | Up to 50 consented donors; returns probabilities, model versions, top model-wide factors and explicit non-causal explanation. |
| POST | `/v1/detect/anomalies` | Isolation Forest + trailing z-score findings. Requires ≥15 observations. |
| POST | `/v1/train/anomalies` | Refit Isolation Forest from labelled synthetic/normal observations. |

OpenAPI docs are served at `/docs` while the service is running.

## Artifacts and sample data

- `artifacts/demand_model.json` — XGBoost booster.
- `artifacts/demand_metadata.json` — version, chronological split, metrics.
- `artifacts/donor_response.joblib` and metadata.
- `artifacts/inventory_anomaly.joblib` and metadata.
- `artifacts/training-summary.json` — actual run summary.
- `artifacts/deep/` — optional TensorFlow artifacts, history, scaler, metadata,
  manifest and checksums. **Empty of models in this workspace.**
- `data/*.csv` — deterministic, explicitly synthetic sample datasets.

The bundled metrics were measured on synthetic data. They are **not evidence of
hospital performance** and must not be presented as real-world accuracy.

## Tests

```powershell
$env:PYTHONPATH="ml_service;drone_bridge"
python -m pytest ml_service/tests drone_bridge/tests -q
```

The **64-test suite** covers artifact loading, real holdout metrics shape,
prediction horizons, insufficient-history refusal, consent rejection, batch
donor scoring with explainability, anomaly detection, authenticated
health/readiness, service-token enforcement, deep endpoints failing closed,
chronological split integrity, deep artifact verification failing closed, SITL
export validation and dry-run-only safety.

```powershell
# Python 3.13
py -3.13 -m pytest -q --junitxml=..\docs\python-3.13-test-results.xml
```

## Docker

```powershell
docker build -t lifelink-ml ml_service
docker run --rm -p 8000:8000 `
  -e ML_SERVICE_TOKEN="a-long-random-secret" `
  lifelink-ml
```

The image sets `ML_REQUIRE_AUTH=true`, so the token is mandatory. Its health
check uses `/livez`, which does not expose model metadata.

The image includes the checked-in artifacts. Set a persistent volume or retrain
from Convex after deployment if you want deployment-specific models.
