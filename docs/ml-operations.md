# ML model operations

## Serving model

- XGBoost demand model: `ml_service/artifacts/demand_model.json`
- Random Forest donor ranker: `ml_service/artifacts/donor_response.joblib`
- Isolation Forest anomaly model: `ml_service/artifacts/inventory_anomaly.joblib`
- Metadata and versions: matching `*_metadata.json`, `versions/`, and
  `training-summary.json`.

The checked-in artifacts are trained on deterministic **synthetic** data. Their
metrics demonstrate the pipeline, not hospital performance.

## Retraining

### Demand model

- Convex admin action: `ml.trainDemandModel` → `POST /v1/train/demand`.
- Uses recorded issue/dispatch transactions and marks demo rows.
- Requires at least 60 continuous days for a retained series.
- Only administrators can trigger it.
- A successful run becomes the active `mlModels` row and is audited.

### Donor model

- Convex admin action: `ml.trainDonorModel` → `POST /v1/train/donor`.
- Uses answered invitations from donors with active location-sharing consent.
- Requires at least 40 samples and at least 8 accepted plus 8 declined outcomes.
- The response probability only orders eligible invitations. It never decides
  ABO/Rh compatibility, deferral or release.
- If the ML service is unavailable, invitations use distance ordering and no
  probability is stored.

### Anomaly model

`POST /v1/train/anomalies` refits the Isolation Forest. The endpoint is
available; there is no admin UI for this retraining path yet.

## Promotion and rollback

1. Run the full Python suite on the target interpreter.
2. Verify metrics, synthetic-data flags and feature names.
3. Copy the artifact directory and metadata to the ML host.
4. Restart the service and call authenticated `/health`.
5. Store the approved version in `mlModels` and record the deploy commit.
6. Keep the previous artifact directory for rollback.

Never hand-edit generated metadata or claim metrics that were not produced by the
recorded evaluation run.

## Monitoring

- Poll public `/livez` for process liveness.
- Poll authenticated `/health` for artifact readiness and version.
- Alert on repeated Convex ML client failures, 401 responses, model-unready
  responses and an increase in `distance_only_fallback` invitations.
- Monitor forecast drift and holdout metrics over time. No automatic drift
  detection is implemented; this is an operational responsibility.
- Review anomaly alerts with human context; they are not proof of theft, wastage
  or clinical error.

## Security

- `/health` and `/v1/*` require `ML_SERVICE_TOKEN` in production.
- Set `ML_REQUIRE_AUTH=true` so the service refuses to start without a token.
- The token is never exposed to the Vite frontend.
- Keep the service on a private network or behind an authenticated TLS gateway.
- Do not train on patient data or non-consented donor records.

## Known limits

- No production drift detection, approval workflow, automated rollback or model
  registry service beyond the Convex `mlModels` table.
- No multi-step backtest beyond the implemented recursive forecast path.
- No independent clinical validation of any model.
