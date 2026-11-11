# Test Execution Report

**Project:** LifeLink — AI-assisted autonomous blood supply chain and simulated drone delivery  
**Date of final run:** 11 November 2026  
**Environment:** Freebuff browser-runtime workspace, Bun 1.4.2, TypeScript 5.9, Python 3.13.15 and 3.10.12  
**Commands:**

```bash
bun test --reporter=junit --reporter-outfile=docs/test-results.xml
bun run lint
bun run build -- --minify false
```

**Raw evidence:** [`docs/test-results.xml`](test-results.xml)

## 1. Summary

| Metric | Result |
| --- | --- |
| TypeScript test files | 3 (`tests/supply.test.ts`, `tests/donorRanking.test.ts`, `tests/integration.test.ts`) |
| TypeScript tests | **41 passed, 0 failed, 0 skipped** |
| TypeScript assertions | **228** |
| Python test files | 3 (`ml_service/tests`, `drone_bridge/tests`) |
| Python tests | **22 passed, 0 failed, 0 skipped on Python 3.13.15** |
| Python tests | **22 passed, 0 failed, 0 skipped on Python 3.10.12** |
| Total automated tests executed | **63 per Python interpreter run** |
| ESLint | **Passed with 0 errors**; 14 Fast Refresh export warnings in vendored UI/platform files |
| Frontend production build | **Passed with minification disabled** (the runner timed out during the minify chunk-rendering phase) |
| Code coverage | **Not measured** (no coverage tool configured) |
| Typecheck | **Passed**: `bun tsc -b --noEmit` |
| Convex push/codegen | **Passed**: `bun convex dev --once` |
| Python interpreter | **3.13.15 and 3.10.12**, both executed |

Raw evidence: [TypeScript JUnit](test-results.xml), [Python 3.10 JUnit](python-test-results.xml) and [Python 3.13 JUnit](python-3.13-test-results.xml). The 13 integration tests run the real Convex function modules through `convex-test`; they are not mocks of the business logic. The Python suite exercised the FastAPI app in-process with `TestClient`, and a separate real HTTP probe covered `/livez`, authenticated `/health`, `/v1/models`, demand batch, donor batch and anomaly detection. It did **not** verify a Cloud Convex action → HTTPS ML service call. Browser, live provider, live hospital, load, security and live SITL tests were **not executed**; see §7.

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

### Donor ML ranking

| ID | Test / preconditions | Input | Expected | Actual | Status | Time (ms) | Error / bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UT-027 | Model-probability ordering | Four consented candidates with probabilities and distances | Probability descending, distance tie-break | Matched | PASS | 0.50 | — |
| UT-028 | Missing-score fallback | One scored, two unscored candidates | Scored first; unscored ordered by distance; no invented probability | Matched | PASS | 0.10 | — |

## 3. Convex integration workflow

The new `tests/integration.test.ts` suite uses the official `convex-test` in-memory backend and registers the real request, allocation, donor, notification and drone modules. It verifies transactions and persisted rows, not just pure helpers.

| ID | Workflow | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| IT-001 | Hospital request → Red Cross verification → reservation → dispatch → hospital receipt | Stock 10 → 7, reservation consumed, reserve/dispatch/receipt rows, audit history | All matched | PASS |
| IT-002 | Request 20 units from a 10-unit batch with a 1-unit protected reserve | Reject without changing reserved units | Rejected with 9-unit availability; `unitsReserved=0` | PASS |
| IT-003 | Expired and ABO-incompatible batches plus automatic allocation | Both blocked; zero allocation and zero transfer | Matched; blockers name expiry and ABO/Rh rules | PASS |
| IT-004 | Two requests concurrently reserving the same two units | Exactly one succeeds; final reserved count is 2 | Matched; second transaction rejected | PASS |
| IT-005 | Reservation cancellation | Two units released; reservation marked released | Matched | PASS |
| IT-006 | Duplicate submit with the same client retry key | Same request ID returned; only one row created | Matched; `duplicate=true` on retry | PASS |
| IT-007 | Auto-allocation with one free unit and a consented donor | Reserve first, transfer created, donor invited once, no fabricated probability | 1 allocated, 2 shortfall, 1 distance-only invitation | PASS |
| IT-008 | Auto-allocation retry | No second reservation or invitation | Matched | PASS |
| IT-009 | Donor accepts invitation | Status accepted, appointment set; stock unchanged | Matched; donor is not counted as inventory | PASS |
| IT-010 | Revoked consent | No donor invitation created | Matched | PASS |
| IT-011 | Notification outbox without a provider | Job marked `skipped_no_provider`, no false delivery claim, no retry storm | Matched; second dispatch processes zero | PASS |
| IT-012 | Simulated mission preflight, dispatch and abort | Preflight passes, simulated state transitions, no hardware path | Matched; mission `ABORTED` | PASS |
| IT-013 | Unauthorized route | Preflight holds and dispatch is rejected | Matched | PASS |
| IT-014 | Donor, hospital and Red Cross role boundaries | Donor cannot submit a hospital request or search allocation; hospital cannot approve as Red Cross | Rejected with explicit authorization errors | PASS |
| IT-015 | Mock connector idempotency and live connector without credentials | Mock sync applies once and does not duplicate rows; live sync records `failed`, sets `error`, persists one sync-failure anomaly | Matched; no inventory invented | PASS |

## 4. Python ML verification

Command (Windows equivalent uses `;` in `PYTHONPATH`):

```bash
PYTHONPATH=ml_service:drone_bridge python -m pytest ml_service/tests drone_bridge/tests -q --junitxml=docs/python-test-results.xml
```

Result: **22 passed, 0 failed** on both Python 3.13.15 and 3.10.12.

```bash
# Fresh isolated environments created for this run
/dev/shm/lifelink-verify-313/bin/python -m pytest -q --junitxml=docs/python-3.13-test-results.xml
/dev/shm/lifelink-verify-310/bin/python -m pytest -q --junitxml=docs/python-test-results.xml
```

| Area | What was actually executed |
| --- | --- |
| Artifact loading | Health endpoint confirms all three saved artifacts load. |
| Model training | XGBoost, Random Forest and Isolation Forest train into temporary artifact directories, write files and reload successfully. |
| XGBoost prediction | 70-day input yields 30 daily predictions and h24/h7/h30 values. |
| Insufficient data | 8-day input returns `insufficient_data` with null horizons, no invented value. |
| Batch prediction | Two group/component series preserve their labels and return results. |
| Donor consent | `consented: false` receives HTTP 403. |
| Donor probability | Values are bounded to 0–1 for varied inputs. |
| Donor batch + explainability | Two donors return probabilities, model-wide top factors and a non-causal explanation. |
| Health auth | `/livez` stays public; `/health` and `/v1/models` reject a missing token when configured. |
| Production startup guard | Manual command with `ML_REQUIRE_AUTH=true` and no token exited with the explicit refusal message; with a token, the app loaded. |
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

## 5. Bugs found during this test cycle

| Bug | Symptom | Cause | Fix | Verification |
| --- | --- | --- | --- | --- |
| **BUG-001** | Recursive 30-day projection could read one index past the demand series. | `historyFeatureRow(extended, extended.length)` was called before the target day existed. | Append the target day as a zero placeholder before extracting features, then replace it with the prediction. | UT-020 executes all 30 recursive steps. |
| **BUG-002** | Forecast always returned `insufficient_data`; ridge system was singular. | The intercept column (all ones) was standardized, becoming all zeros, so the first normal-equation row was zero. | Preserve column 0 during standardization and in donor-model inference. | UT-020, UT-025 and UT-026 pass; a 90-day series now fits and reports genuine holdout metrics. |
| **BUG-003** | The synthetic anomaly dataset escalated from a mean near 18 to hundreds, making injected anomalies non-anomalous. | Feedback update multiplied the level by the weekly factor every day. | Replaced with a stationary mean plus weekly effect and noise; re-ran the Isolation Forest evaluation. | Metadata now reports precision 0.3333 / recall 1.0 on the synthetic labelled set. |
| **BUG-004** | Manual Red Cross reservations could consume units held in a facility's protected emergency reserve. | `reserveStock` subtracted only `unitsReserved`, while automatic allocation also subtracted `protectedReserve`. | Manual reservation now uses the same protected-reserve calculation and names the remaining free units in the error. | IT-002 now rejects 20 units against a 10-unit batch with a 1-unit reserve and leaves `unitsReserved=0`. |
| **BUG-005** | A double submit or network retry could create two identical blood requests. | Request creation had no client idempotency key. | Added a per-form `clientRequestId`, a `by_client_request` index and a server-side lookup that returns the existing request. | IT-006 returns the same ID and leaves one `bloodRequests` row. |

During the same pass, ESLint exposed React correctness defects rather than test failures: render-time `Date.now()` calls in `SupplyCommand` and `AdminConsole`, effect-driven prop-to-state synchronization in the header, stock panels, dashboards, search, drone and request-detail views, a random initial sidebar width, a carousel callback that fired during render, and eagerly evaluated mobile-media state. These were replaced with derived values, lazy initializers or stable defaults. They are not assigned separate BUG numbers because they were found by static analysis, not reproduced as runtime incidents.

All are fixed. The final runs have no failures.

## 6. Performance measurements

Measured (single development machine, unit-test processes):

- TypeScript suite: **285 ms** total time reported by the final JUnit XML across three test files (28 domain tests + 13 Convex integration tests).
- Python ML + bridge suite: **3.75 s** on Python 3.13.15 and **4.21 s** on Python 3.10.12, including fresh training, artifact reload and FastAPI `TestClient` calls.
- Frontend production build: **12.00 s** with `--minify false`; the standard minified build exceeded the runner's 120-second limit during chunk rendering.
- No deployed request latency, load or concurrent-request benchmark was executed.

No blood-search latency, database query latency, WebSocket throughput, notification throughput or concurrent-request benchmark was executed. The requested sub-500 ms search target is therefore **unverified**, not claimed. No load generator (Locust/k6) is included.

## 7. Test categories not executed

| Required category | Status | Reason / next step |
| --- | --- | --- |
| TypeScript unit tests | **Executed** (41 pass) | 28 deterministic domain/ranking tests plus 13 real Convex integration tests. |
| Python ML unit/API tests | **Executed in-process and over HTTP** (22 pass on 3.13.15 and 3.10.12) | Fresh training, donor batch/explainability, FastAPI `TestClient`, plus authenticated real-socket HTTP checks. |
| Convex action → ML HTTPS integration | Not executed | Requires a reachable service URL, token and deployment; Convex Cloud cannot call `localhost`. |
| API tests against the in-memory Convex backend | **Executed** | Real modules, auth identities and transactions via `convex-test`; not a deployed API test. |
| Database tests (atomic reservation, rollback, concurrent requests) | **Executed locally** | `convex-test` serializes transactions and verified that one of two competing reservations wins; production multi-client behavior remains unverified. |
| Integration with 3 hospitals / 5 blood banks / multiple drones / donors | Partially seeded demo data; **not automated** | Add a seeded test deployment and scripted flow. |
| Real-time propagation / WebSocket tests | Not executed | Convex subscriptions are used; no automated propagation test. |
| Geospatial API tests | Domain functions executed; **API-level tests not executed** | Add seeded coordinates and query assertions. |
| Security tests | **RBAC workflow checks executed**; no rate-limit or penetration suite | Role guards are exercised through real authenticated Convex calls; no load, abuse or external penetration test was run. |
| Real-data model accuracy / drift | Not executed | Bundled artifacts and metrics are synthetic only. XGBoost one-step holdout is not a multi-step backtest guarantee. |
| Performance/load | Not executed | Add k6/Locust and a production-like dataset. |
| Donor invitation end-to-end | **Executed locally**; not against Cloud | Auto-allocation, donor invitation, acceptance and revoked-consent paths pass in `convex-test`; no live Convex-to-HTTPS run was possible. |
| Drone SITL execution | **Not executed** | Bridge/export code and dry-run tests exist, but no PX4/ArduPilot or MAVSDK runtime is installed. |
| End-to-end browser tests | Not executed | No Playwright suite or browser session. |
| Minified production bundle | Not completed | Vite completed transformation but exceeded the 120-second runner limit during minified chunk rendering. The unminified production build passed. |

## 8. Honest completion statement

63 automated tests passed per interpreter: 41 TypeScript domain/integration tests and 22 Python model/training/bridge tests, with the Python suite executed on both 3.13.15 and 3.10.12. The application typechecks, Convex accepts the schema/functions, the unminified production bundle builds, and the FastAPI service loads real trained artifacts and returns predictions over authenticated HTTP. The checked-in model metrics are synthetic-data evidence only. This does **not** establish production readiness, clinical safety, live Convex-to-ML connectivity, real drone capability or the required full browser/security/load test matrix. See [limitations.md](limitations.md).
