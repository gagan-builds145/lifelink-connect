# Test Execution Report

**Project:** LifeLink — AI-assisted autonomous blood supply chain and simulated drone delivery  
**Date of final run:** 8 November 2026  
**Environment:** Freebuff browser-runtime workspace, Bun 1.4.2, TypeScript 5.9  
**Command:**

```bash
bun test --reporter=junit --reporter-outfile=docs/test-results.xml
```

**Raw evidence:** [`docs/test-results.xml`](test-results.xml)

## 1. Summary

| Metric | Result |
| --- | --- |
| TypeScript test files | 1 (`tests/supply.test.ts`) |
| TypeScript tests | **26 passed, 0 failed, 0 skipped** |
| TypeScript assertions | **145** |
| Python test files | 3 (`ml_service/tests`, `drone_bridge/tests`) |
| Python tests | **21 passed, 0 failed, 0 skipped** |
| Total automated tests executed | **47** |
| Code coverage | **Not measured** (no coverage tool configured) |
| Typecheck | **Passed**: `bun tsc -b --noEmit` |
| Convex push/codegen | **Passed**: `bun convex dev --once` |
| Python interpreter | **3.10.12** (3.13 not available in this workspace) |

Raw evidence: [TypeScript JUnit](test-results.xml) and [Python JUnit](python-test-results.xml). The Python suite exercised the FastAPI app in-process with `TestClient`. It did **not** verify the Cloud Convex action → HTTPS ML service path. Browser, database-concurrency, security, load, live SITL and full API/HTTP tests were **not executed**; see §6.

## 2. Detailed test cases

UT-019–UT-021 exercise the retained legacy ridge reference implementation in `src/lib/supply.ts` for regression history. The **active** demand-forecasting path is the Python XGBoost service tested in §3; no Convex query or UI calls the ridge function.

### Supply eligibility primitives

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-001 | Date maths; fixed today `2026-11-08` | Expiry dates 0, +10, −7 days and invalid text | 0, 10, −7, null | Matched all four | PASS | 0.665 | — |
| UT-002 | Deterministic component compatibility | O−→O+, AB+→O+, B+→A+, O−→A+, AB+→A+ plasma, A+→B+ plasma, empty group | True, false, false, true, true, false, false | Matched all six compatibility directions | PASS | 0.840 | — |
| UT-003 | Search-scope policy; Pune need, Mumbai source | Routine city search; emergency district 150 km; emergency district 25 km | City-only refusal; district allowed ~120 km; radius refusal | Matched; blockers named city and 25 km radius | PASS | 0.723 | — |
| UT-004 | Cross-state emergency scope | Delhi source, Pune need, state vs country scope | State rejected; country allowed tier 4 | Matched | PASS | 0.068 | — |

### Candidate eligibility and ranking

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-005 | Protected reserve excluded | 6 available, 0 reserved, 2 protected, need 6 | Eligible, 4 usable units | Eligible, `usableUnits=4` | PASS | 0.247 | — |
| UT-006 | Safety filters | Expired, `released:false`, `screened:false`, incompatible AB+ | Each blocked with specific reason | Each blocked; messages matched | PASS | 0.088 | — |
| UT-007 | Fully protected batch | 4 available, 4 protected | Ineligible, 0 usable | Matched | PASS | 0.020 | — |
| UT-008 | Ranking filters before scoring | Near Pune, far Mumbai, expired batch; emergency state | Near first; expired score 0/ineligible; far eligible | Matched | PASS | 0.398 | — |

### Allocation planning

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-009 | Shortage maths | 10/4; 5/8; negative inputs | Shortage 6/40%; covered 100%; clamp to 0 | Matched | PASS | 0.123 | — |
| UT-010 | Partial multi-facility allocation | Three suppliers with 2 allocatable units each; need 5 | 4 allocated, shortfall 1, 2+2 | Matched; donor-fallback note present | PASS | 1.271 | — |
| UT-011 | Facility cap | Six 2-unit suppliers; need 10; cap 3 | 3 allocations, 6 allocated, shortfall 4 | Matched; cap note present | PASS | 0.390 | — |

### Drone planning and preflight

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-012 | Corridor proxy and return leg | Pune pickup, nearby dropoff | 4 waypoints, outbound+return, never approved | Matched; `approvedForFlight=false` | PASS | 0.334 | — |
| UT-013 | Restricted-zone detection | 20 km zone at route midpoint; 1 km corridor zone | Intersects Z1, not Z2 (non-restricted) | Matched | PASS | 0.141 | — |
| UT-014 | Payload/storage rules | 4 units, 0 units; red cells, platelets, plasma | 2.8 kg, 1.4 kg; 2–6, 20–24, ≤−18 °C | Matched | PASS | 0.076 | — |
| UT-015 | Preflight safety gates | Safe mission; low battery, no GPS, offline link, overload, 15 °C, unauthorized, no landing zone, high wind, maintenance due/grounded | Safe passes; each critical failure blocks; due warns | Matched all 12 checks | PASS | 1.294 | — |
| UT-016 | Energy reserve | 20 km feasible; 200 km infeasible | Feasible/infeasible; 25% reserve | Matched | PASS | 0.035 | — |

### Mission state machine

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-017 | Happy path | 12 documented transitions | Every transition allowed | Matched | PASS | 0.034 | — |
| UT-018 | Unsafe transitions | PLANNED→DELIVERED, AT_PICKUP→COMPLETED, terminal exits, HOLD recovery | Invalid jumps rejected; HOLD→PREFLIGHT/ABORT allowed | Matched | PASS | 0.023 | — |

### Demand forecasting

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-019 | Short series refusal | 10 daily points | `insufficient_data`, null metrics/horizons | Matched | PASS | 0.504 | — |
| UT-020 | Chronological holdout | 90 days of weekly seasonality | `ok`, finite MAE/RMSE and baseline, all horizons, confidence label | Matched | PASS | 5.764 | **BUG-002** found and fixed |
| UT-021 | De-duplication and ordering | 40 days reversed + duplicate date | Sorted unique dates, `ok` | Matched, sample size 40 | PASS | 0.440 | — |

### Anomaly detection

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-022 | Demand spike | 35 stable days, last day 60 units | Critical spike, z > 2.5, explanation | Matched | PASS | 1.375 | — |
| UT-023 | Stable demand | 35 days at 10 units | No findings | Matched | PASS | 0.254 | — |

### Donor fallback

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-024 | Consent/eligibility gate | Available + consent; consent off; expired; 10-day interval; incompatible group; out-of-city | Eligible case passes; each blocker reported | Matched; `invitationOnly=true` | PASS | 0.180 | — |
| UT-025 | Donor-model refusal | 12 samples; 30 all-positive samples; 40 mixed samples | Null, null, trained model | Matched | PASS | 16.369 | — |
| UT-026 | Probability bounds | Untrained model; trained 40-sample model | Null score untrained; 0–1 trained | Matched; basis and note correct | PASS | 7.659 | — |

## 3. Python ML verification

Command (Windows equivalent uses `;` in `PYTHONPATH`):

```bash
PYTHONPATH=ml_service:drone_bridge python -m pytest ml_service/tests drone_bridge/tests -q --junitxml=docs/python-test-results.xml
```

Result: **21 passed, 0 failed**.

| Area | What was actually executed |
| --- | --- |
| Artifact loading | Health endpoint confirms all three saved artifacts load. |
| Model training | XGBoost, Random Forest and Isolation Forest train into temporary artifact directories, write files and reload successfully. |
| XGBoost prediction | 70-day input yields 30 daily predictions and h24/h7/h30 values. |
| Insufficient data | 8-day input returns `insufficient_data` with null horizons, no invented value. |
| Batch prediction | Two group/component series preserve their labels and return results. |
| Donor consent | `consented: false` receives HTTP 403. |
| Donor probability | Values are bounded to 0–1 for varied inputs. |
| Anomaly | Injected spike is found; five observations return `insufficient_data`. |
| Service auth | Configured bearer token rejects missing credentials and accepts the correct token. |
| SITL safety | Valid simulated loopback mission accepted; non-simulated, real-network, unauthorized and short routes rejected. |
| SITL dry run | Mission JSON validates and prints without importing MAVSDK. |

### Synthetic holdout metrics (actual run)

These are computed on deterministic synthetic data and must not be read as real hospital accuracy.

| Model | Metric | Result |
| --- | --- | --- |
| XGBoost demand | MAE / baseline MAE | 0.2998 / 0.7652 |
| XGBoost demand | RMSE / baseline RMSE | 0.4500 / 1.1816 |
| XGBoost demand | Holdout rows | 2,176 (chronological 80/20 date split) |
| XGBoost demand | MAE improvement vs 7-day baseline | 60.83% |
| Random Forest donor | ROC-AUC / accuracy | 0.6066 / 0.7056 |
| Isolation Forest | Precision / recall / F1 | 0.3333 / 1.0 / 0.5 |

## 4. Bugs found during this test cycle

| Bug | Symptom | Cause | Fix | Verification |
| --- | --- | --- | --- | --- |
| **BUG-001** | Recursive 30-day projection could read one index past the demand series. | `historyFeatureRow(extended, extended.length)` was called before the target day existed. | Append the target day as a zero placeholder before extracting features, then replace it with the prediction. | UT-020 executes all 30 recursive steps. |
| **BUG-002** | Forecast always returned `insufficient_data`; ridge system was singular. | The intercept column (all ones) was standardized, becoming all zeros, so the first normal-equation row was zero. | Preserve column 0 during standardization and in donor-model inference. | UT-020, UT-025 and UT-026 pass; a 90-day series now fits and reports genuine holdout metrics. |
| **BUG-003** | The synthetic anomaly dataset escalated from a mean near 18 to hundreds, making injected anomalies non-anomalous. | Feedback update multiplied the level by the weekly factor every day. | Replaced with a stationary mean plus weekly effect and noise; re-ran the Isolation Forest evaluation. | Metadata now reports precision 0.3333 / recall 1.0 on the synthetic labelled set. |

All are fixed. The final runs have no failures.

## 5. Performance measurements

Measured (single development machine, unit-test processes):

- TypeScript suite: **40.39 ms** test-file time, **47.35 ms** total time reported by the final JUnit XML.
- Python ML + bridge suite: **2.49 s** wall time in the final pytest run, including fresh model training, artifact reload and FastAPI `TestClient` calls.
- No deployed request latency, Convex action latency, load or concurrent-request benchmark was executed.

No blood-search latency, database query latency, WebSocket throughput, notification throughput or concurrent-request benchmark was executed. The requested sub-500 ms search target is therefore **unverified**, not claimed. No load generator (Locust/k6) is included.

## 6. Test categories not executed

| Required category | Status | Reason / next step |
| --- | --- | --- |
| TypeScript unit tests | **Executed** (26 pass) | Deterministic domain engine. |
| Python ML unit/API tests | **Executed in-process** (21 pass) | Includes fresh training into temp dirs and FastAPI `TestClient`; no deployed HTTP path. |
| Convex action → ML HTTPS integration | Not executed | Requires a reachable service URL, token and deployment; Convex Cloud cannot call `localhost`. |
| API tests against deployed services | Not executed | Needs authenticated test users and a Convex test harness. |
| Database tests (atomic reservation, rollback, concurrent requests) | Not executed | Convex serializable semantics are implemented, but no multi-client automated test exists. |
| Integration with 3 hospitals / 5 blood banks / multiple drones / donors | Partially seeded demo data; **not automated** | Add a seeded test deployment and scripted flow. |
| Real-time propagation / WebSocket tests | Not executed | Convex subscriptions are used; no automated propagation test. |
| Geospatial API tests | Domain functions executed; **API-level tests not executed** | Add seeded coordinates and query assertions. |
| Security tests | Not executed | No auth/RBAC/rate-limit/penetration suite. |
| Real-data model accuracy / drift | Not executed | Bundled artifacts and metrics are synthetic only. XGBoost one-step holdout is not a multi-step backtest guarantee. |
| Performance/load | Not executed | Add k6/Locust and a production-like dataset. |
| Drone SITL execution | **Not executed** | Bridge/export code and dry-run tests exist, but no PX4/ArduPilot or MAVSDK runtime is installed. |
| End-to-end browser tests | Not executed | No Playwright suite. |

## 7. Honest completion statement

47 automated tests passed: 26 TypeScript domain tests and 21 Python model/training/bridge tests. The application typechecks, Convex accepts the schema/functions, and the FastAPI service loads real trained artifacts and returns predictions. The checked-in model metrics are synthetic-data evidence only. This does **not** establish production readiness, clinical safety, live Convex-to-ML connectivity, real drone capability or the required full test matrix. See [limitations.md](limitations.md).
