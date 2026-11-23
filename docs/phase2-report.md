# LifeLink Connect 2.0 — Phase 2 implementation report

Date: 2026-11-23

## 1. Scope inspected

- React/Vite/TypeScript frontend, Tailwind and shadcn-style UI.
- Convex schema, auth, role guards, blood inventory, requests, supply command, maps, drones, Guardian/ambulance and admin console.
- FastAPI ML service, existing XGBoost, Random Forest and Isolation Forest artifacts.
- Synthetic datasets, deep-training scripts, storage/registry layer and documentation.
- Existing TypeScript and Python test suites.

No working feature was deleted or replaced. Existing internal role keys remain
for backward compatibility; user-facing labels remain Donor, Hospital, Blood
Bank, Guardian and Administrator.

## 2. Browser and UI testing

**Status: NOT EXECUTED.**

Facts:

- Playwright CLI is installed (`1.65.0`).
- No Chromium/Chrome executable is installed.
- `playwright install --dry-run chromium` identifies the required Chrome for
  Testing download.
- The host has **1 CPU, 1.9 GiB RAM and ~115 MB free disk**.
- Installing Chromium would exceed the remaining disk. Browser automation was
  therefore not run.

No dashboard, form, map, file upload, notification, responsive layout or
ambulance workflow is claimed as browser-tested. Alternative coverage is the
Convex integration suite, Python API tests and production build. Static route
wiring was inspected, not driven in a browser.

The following remain explicitly unverified in a real browser: GPS permission
denial, live tracking rendering, Leaflet tiles, file uploads, responsive
breakpoints, modals, dropdowns and every ambulance UI transition.

## 3. Errors discovered and repaired

### Concurrent XGBoost prediction race

The bounded concurrent API test exposed:

```text
AttributeError: module 'pandas' has no attribute 'Series'
```

Root cause: this host has a broken partial pandas installation, and concurrent
first XGBoost calls raced through its optional pandas detection. This is an
environment-specific race but also demonstrates that model objects were not
protected from concurrent calls.

Repair:

- Added a per-model execution lock in `ml_service/app/main.py`.
- Requests still run off the event loop; different model kinds can proceed
  independently.
- Added a 12-request concurrency regression test.
- Re-ran the API load test: 40 requests, concurrency 4, 0 errors.

### Previous Phase-1 issues retained/fixed

- Driver names are not exposed in nearby ambulance results before acceptance.
- Competing pending bookings are cancelled when one request is accepted.
- Destination markers are not fabricated when coordinates are missing.
- PHI datasets, duplicate checksums and unsafe AI object keys are refused.
- TensorFlow models cannot be silently marked trained.

## 4. AI dataset audit

Command: `python scripts/audit_datasets.py`

| Dataset | Rows | Duplicates | Missing | PHI columns | Key finding |
| --- | ---: | ---: | ---: | --- | --- |
| Demand | 11,680 | 0 | 0 | none | 32 series × 365 dates |
| Donor response | 900 | 0 | 0 | none | 747 positive / 153 negative |
| Inventory anomaly | 240 | 0 | 0 | none | 235 normal / 5 labelled anomalies |

Demand chronological audit:

- date range ends 2026-09-30;
- audit cutoff 2026-07-20;
- 9,344 train rows, 2,336 test rows;
- train max date 2026-07-19, test min date 2026-07-20;
- no date overlap and no future held-out date in training.

Donor class imbalance:

- positive ratio 0.83;
- Random Forest uses `class_weight="balanced"`;
- Brier score added to evaluate probability calibration quality;
- probabilities remain uncalibrated advisory scores.

Anomaly evaluation:

- normal-only fitting is used for the Isolation Forest;
- labelled anomalies are held out for evaluation;
- false-positive rate and confusion matrix are now recorded.

All checked-in data is deterministic **synthetic development data**.

## 5. Actual training executed

Command: `python scripts/train_all.py`

- Exit code: 0
- Elapsed: **3.132 s**
- Maximum RSS: **147,772 KB (~144 MiB)**
- Environment: Python 3.10.12, 1 CPU, 1.9 GiB RAM

### XGBoost demand

- Version: `xgboost-demand-2026-09-30-58530099a9`
- Training rows: 8,608
- Chronological holdout rows: 2,176
- MAE: **0.2998**
- RMSE: **0.4500**
- Rolling baseline MAE: **0.7652**
- Rolling baseline RMSE: **1.1816**
- MAE improvement: **60.83%**
- Actual-vs-predicted SVG: `ml_service/artifacts/demand-actual-vs-predicted.svg`

These are synthetic-data one-step holdout results, not future or real-world
hospital performance.

### Random Forest donor response

- Version: `rf-donor-2026-11-23-f8337253ac`
- Accuracy: **0.7056**
- Precision: **0.8288**
- Recall: **0.8121**
- F1: **0.8203**
- ROC-AUC: **0.6066**
- Brier score: **0.1809**
- Confusion matrix: `[[6, 25], [28, 121]]`
- Base rate: 0.83
- Class handling: balanced class weights
- Calibration: uncalibrated probabilities; Brier reported

The low specificity (6 true negatives, 25 false positives) is a real weakness in
the synthetic evaluation and must not be hidden.

### Isolation Forest inventory anomaly

- Version: `isolation-forest-2026-11-23-240`
- Precision: **0.3333**
- Recall: **1.0000**
- F1: **0.5000**
- False-positive rate: **0.0452**
- Confusion matrix: `[[211, 10], [0, 5]]`
- 235 normal, 5 labelled anomalies

The low precision means most alerts are false positives on this small synthetic
set. Alerts remain review prompts only.

## 6. Deep models — actual status

| Model | Status | Evidence |
| --- | --- | --- |
| ANN donor response | **NOT TRAINED** | `train_ann.py` exits 2: TensorFlow missing |
| LSTM demand | **NOT TRAINED** | `train_lstm.py` exits 2: TensorFlow missing |
| Autoencoder inventory | **NOT TRAINED** | `train_autoencoder.py` exits 2: TensorFlow missing |
| CNN | **NOT IMPLEMENTED** | no validated image dataset/task |

No `.keras` artifacts or deep metrics exist. `evaluate_all.py` exits 2 and
reports the missing artifacts. The `/ai/models` API reports them as not ready.
Cloud/external training instructions are in `docs/deep-training-cloud.md`.

## 7. FastAPI AI integration

New authenticated endpoints:

| Method | Endpoint | Status |
| --- | --- | --- |
| POST | `/ai/demand/predict` | Working; XGBoost |
| POST | `/ai/donor-response/predict` | Working; Random Forest; consent required |
| POST | `/ai/inventory/anomaly-detect` | Working; Isolation Forest + z-score |
| GET | `/ai/models` | Working; reports trained and missing models honestly |
| GET | `/ai/models/{model_name}/status` | Working |
| GET | `/ai/models/{model_name}/metrics` | Working; 404 when no metrics |
| GET | `/ai/health` | Working |

Invalid input returns 422. Unknown models return 404. Donor prediction without
consent returns 403. AI remains advisory; no endpoint decides eligibility.

## 8. AI model-management dashboard

The administrator AI section now shows:

- storage usage/capacity and expansion state;
- dataset/model counts and PHI count;
- active approved models and candidate versions;
- approve and disable actions;
- recent training runs;
- FastAPI model health loaded from `/ai/models`;
- synthetic-data warning.

Rollback is supported by promoting a previous artifact version; the backend
records the prior active version as `rolled_back`. Training-start controls remain
limited to the existing XGBoost/RF retraining actions; deep training cannot run
in this environment.

## 9. Storage architecture and actual consumption

- Convex stores metadata only.
- S3-compatible object storage handles datasets, artifacts, checkpoints, logs
  and backups.
- Parquet is supported; `pyarrow` is not installed here, so conversion was not
  executed.
- `.keras` is enforced for TensorFlow artifacts in the Convex registry and CLI.
- Capacity plan: 500 GB initial, 5 TB target, 80% expansion threshold.
- Retention and backup/restore commands are implemented.

Measured local-dev (NOT cloud) storage test:

- 16 objects × 256 KiB = 4 MiB
- concurrency 4
- 0.021 s total
- listing 0.001 s
- backup + restore check 0.003 s
- 500 GB capacity, 4.25 MB used, no expansion required

No S3 bucket was available. No cloud object-storage throughput, lifecycle,
multi-region backup or 500 GB/5 TB test was executed.

## 10. Performance testing

In-process FastAPI/model load test:

- 40 requests to `/ai/demand/predict`
- concurrency 4
- 0 errors
- 0.265 s total
- 150.83 requests/second
- p50 26.16 ms, p95 32.85 ms, max 36.17 ms
- average response 876 bytes

This excludes network, ASGI server, Convex, S3 and real users. It is **not**
evidence of 1M or 10M supported users.

## 11. Test results

| Suite | Result |
| --- | --- |
| TypeScript/Convex (`bun test`) | **133 passed, 0 failed** |
| Python (`pytest`) | **45 passed, 0 failed** |
| Combined | **178 passed, 0 failed** |
| Typecheck | clean |
| Lint | 0 errors, 16 warnings |
| Production build | successful |
| Convex functions | ready |
| Browser tests | **not run** |
| TensorFlow training | **blocked** |
| S3/Parquet tests | **not run** |

Existing tests were not deleted or weakened.

## 12. Remaining limitations

1. No browser executable; no UI/browser test evidence.
2. TensorFlow cannot be installed with 115 MB free disk.
3. Deep models are untrained and have no metrics.
4. CNN intentionally has no dataset and no training.
5. FastAPI does not yet load an approved `.keras` model from object storage.
6. Python CLI does not automatically register datasets/models into Convex.
7. S3 integration is implemented but unexecuted; `boto3`/`pyarrow` absent.
8. Backup/restore was tested only on the local filesystem backend.
9. No million/ten-million-user load test exists.
10. No real hospital data; all AI evaluation uses labelled synthetic data.
11. Model probabilities are uncalibrated; calibration is measured, not applied.
12. Deep-training cloud guide is procedural; no external training was run.

## 13. Deployment notes

1. Set Convex `ML_SERVICE_URL` and `ML_SERVICE_TOKEN`.
2. Set the same `ML_SERVICE_TOKEN` and `ML_REQUIRE_AUTH=true` in the ML service.
3. Install `ml_service/requirements-storage.txt` in the training/storage worker,
   not necessarily the inference container.
4. Configure S3 bucket, region, prefix, SSE and explicit 500 GB allocation.
5. Enable bucket versioning/lifecycle rules and least-privilege IAM.
6. Register datasets and approved model artifacts through the admin registry.
7. Run `python scripts/evaluate_all.py` before approving a model.
8. Run the build, Convex codegen, TypeScript tests, Python tests and browser E2E
   suite in the deployment environment.
9. Do not advertise 1M/10M capacity until measured load tests support it.
