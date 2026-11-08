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
| Test files | 1 (`tests/supply.test.ts`) |
| Total tests | **26** |
| Passed | **26** |
| Failed | **0** |
| Skipped | **0** |
| Assertions | **145** |
| Total wall time reported by Bun | **48 ms** |
| Test-file execution time | **40.71 ms** (JUnit XML) |
| Code coverage | **Not measured** (no coverage tool configured) |
| Typecheck | **Passed**: `bun tsc -b --noEmit` |
| Convex push/codegen | **Passed**: `bun convex dev --once` |

This suite covers the deterministic domain engine only. API, database, real-time, security, load, end-to-end and PX4/ArduPilot SITL tests were **not executed**; see §5.

## 2. Detailed test cases

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

## 3. Bugs found during this test cycle

| Bug | Symptom | Cause | Fix | Verification |
| --- | --- | --- | --- | --- |
| **BUG-001** | Recursive 30-day projection could read one index past the demand series. | `historyFeatureRow(extended, extended.length)` was called before the target day existed. | Append the target day as a zero placeholder before extracting features, then replace it with the prediction. | UT-020 executes all 30 recursive steps. |
| **BUG-002** | Forecast always returned `insufficient_data`; ridge system was singular. | The intercept column (all ones) was standardized, becoming all zeros, so the first normal-equation row was zero. | Preserve column 0 during standardization and in donor-model inference. | UT-020, UT-025 and UT-026 pass; a 90-day series now fits and reports genuine holdout metrics. |

Both are fixed in `src/lib/supply.ts`. The final run has no failures.

## 4. Performance measurements

Measured (single development machine, unit-test process):

- Full suite: **40.71 ms** test-file time, **48 ms** total time reported by the JUnit XML.
- Slowest test in the final run: donor-model training **11.97 ms** (400 gradient iterations, 40 samples).
- Forecast evaluation in the final run: **2.49 ms** for 90 days.

No blood-search latency, database query latency, WebSocket throughput, notification throughput or concurrent-request benchmark was executed. The requested sub-500 ms search target is therefore **unverified**, not claimed. No load generator (Locust/k6) is included.

## 5. Test categories not executed

| Required category | Status | Reason / next step |
| --- | --- | --- |
| Unit tests | **Executed** (26 pass) | Domain engine. |
| API tests | Not executed | Needs authenticated test users and a Convex test harness. |
| Database tests (atomic reservation, rollback, concurrent requests) | Not executed | Convex serializable semantics are implemented, but no multi-client automated test exists. |
| Integration with 3 hospitals / 5 blood banks / multiple drones / donors | Partially seeded demo data; **not automated** | Add a seeded test deployment and scripted flow. |
| Real-time propagation / WebSocket tests | Not executed | Convex subscriptions are used; no automated propagation test. |
| Geospatial API tests | Domain functions executed; **API-level tests not executed** | Add seeded coordinates and query assertions. |
| Security tests | Not executed | No auth/RBAC/rate-limit/penetration suite. |
| AI/ML tests | Domain training/inference executed | No real-data accuracy, drift or versioning test. |
| Performance/load | Not executed | Add k6/Locust and a production-like dataset. |
| Drone SITL tests | Not executed | **No PX4/ArduPilot SITL process exists**; the mission engine is simulated only. |
| End-to-end browser tests | Not executed | No Playwright suite. |

## 6. Honest completion statement

The deterministic supply, allocation, routing, preflight, mission-state, consent, forecast and anomaly logic is covered by 26 passing unit tests. The application typechecks and Convex accepts the schema/functions. This does **not** establish production readiness, clinical safety, real drone capability or the required full test matrix. See [limitations.md](limitations.md).
