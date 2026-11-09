# LifeLink ML service

Python 3.10+/3.13 FastAPI service for:

- **XGBoost blood-demand forecasting** (24-hour, 7-day and 30-day horizons;
  blood-group/component series; chronological holdout; rolling-average baseline).
- **Random Forest donor-response ranking** for consented donors. It never
  determines medical eligibility, compatibility or release.
- **Isolation Forest anomaly detection** with an explanatory trailing z-score.

Clinical compatibility, reservation and allocation remain deterministic in
LifeLink's shared rules engine. No model in this service decides whether blood
can be issued.

## Verified environment

The checked-in artifacts and tests were executed on **Python 3.10.12**, because
that is the interpreter available in the current workspace. The code is written
for 3.10+ and the Dockerfile targets 3.13; Python 3.13 was **not executed here**.
`requirements.txt` selects NumPy/SciPy builds appropriate to each interpreter.

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

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health | ConvertTo-Json -Depth 8
```

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
- `ml.mlServiceStatus` → `GET /health`

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Artifact readiness and model metadata. Public by design; contains no patient data. |
| GET | `/v1/models` | Versioned artifact summaries. |
| POST | `/v1/train/demand` | Train XGBoost from `{date, blood_group, component, units, is_synthetic}` records. Requires ≥60 continuous days per retained series. |
| POST | `/v1/predict/demand` | One group/component forecast. Requires ≥29 continuous days. |
| POST | `/v1/predict/demand/batch` | Up to 32 group/component series in one call. |
| POST | `/v1/train/donor` | Train Random Forest from consented labelled responses. Requires ≥40 samples with both classes. |
| POST | `/v1/predict/donor` | Response probability; rejects `consented: false`. |
| POST | `/v1/detect/anomalies` | Isolation Forest + trailing z-score findings. Requires ≥15 observations. |
| POST | `/v1/train/anomalies` | Refit Isolation Forest from labelled synthetic/normal observations. |

OpenAPI docs are served at `/docs` while the service is running.

## Artifacts and sample data

- `artifacts/demand_model.json` — XGBoost booster.
- `artifacts/demand_metadata.json` — version, chronological split, metrics.
- `artifacts/donor_response.joblib` and metadata.
- `artifacts/inventory_anomaly.joblib` and metadata.
- `artifacts/training-summary.json` — actual run summary.
- `data/*.csv` — deterministic, explicitly synthetic sample datasets.

The bundled metrics were measured on synthetic data. They are **not evidence of
hospital performance** and must not be presented as real-world accuracy.

## Tests

```powershell
$env:PYTHONPATH="ml_service;drone_bridge"
python -m pytest ml_service/tests drone_bridge/tests -q
```

The suite covers artifact loading, real holdout metrics shape, prediction
horizons, insufficient-history refusal, consent rejection, anomaly detection,
service-token enforcement, SITL export validation and dry-run-only safety.

## Docker

```powershell
docker build -t lifelink-ml ml_service
docker run --rm -p 8000:8000 `
  -e ML_SERVICE_TOKEN="a-long-random-secret" `
  lifelink-ml
```

The image includes the checked-in artifacts. Set a persistent volume or retrain
from Convex after deployment if you want deployment-specific models.
