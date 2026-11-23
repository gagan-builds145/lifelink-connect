# LifeLink — Phase 4 implementation report

Date: 2026-11-23
Scope: one-tap GPS ambulance booking, global heading-only UI cleanup, removal of the donor Identity & Blood Group dashboard section, and a full attempt at all six ML models.

## A. One-tap ambulance booking

### Behaviour implemented

`Book Ambulance` now sits in the donor Overview hero directly below `New Blood Request`, with `Donate blood` after it. It navigates to `/ambulance?auto=1`, which renders the one-tap flow on the existing ambulance route (no duplicate route, table or booking backend).

The one-tap flow:

1. Checks for an existing active booking first; if one exists it opens tracking instead of creating a duplicate.
2. Requests live browser GPS with `enableHighAccuracy`, `timeout: 15000`, `maximumAge: 0`.
3. Validates latitude/longitude ranges and rejects a fix with accuracy worse than 2 km.
4. Automatically calls `ambulances.createEmergencyBooking` with the coordinates and a stable per-attempt idempotency key. No form, destination, hospital, patient or contact question is shown.
5. The server selects the nearest **approved, online, non-busy, available** ambulance within 100 km. If none exists, the booking is created in the real `searching` state; no ambulance or driver is invented.
6. Tracking uses live Convex subscriptions (`bookingDetail`) to show the booking reference, pickup coordinates, real status, assignment, driver details only after assignment, last reported ambulance coordinates only when they exist, and ETA only when the backend has distance data.
7. Destination remains “to be coordinated by the assigned ambulance provider”. No hospital is guessed.

### Backend

- New `ambulances.createEmergencyBooking` mutation.
- Reuses `ambulanceBookings`, `ambulanceBookingEvents`, `clientRequestId` idempotency and the existing accept/decline/status lifecycle.
- Rejects invalid coordinates, refuses staff/non-booking roles, returns the existing booking for a repeated request ID, and returns an active booking instead of creating a second one.
- Sends a real notification only when a target ambulance is selected.
- Approves only `status = APPROVED` providers (legacy verified profiles remain compatible through the existing status helper).

### GPS and failure handling

- Permission denied, unavailable GPS, timeout, unsupported browser, invalid coordinates and weak accuracy each have a distinct message and Retry.
- A failed confirmation keeps the same request ID on retry, so a lost response cannot create a duplicate.
- Terminal bookings show the real closed status and offer a new request; no fake dispatch state.

### Animation and accessibility

- Animated ambulance, alternating red/blue emergency lights, radar rings, moving speed lines, floating vehicle, pulsing live dot and progress timeline, implemented with CSS in `src/index.css`.
- All animation is disabled by the existing global `prefers-reduced-motion` rule.
- Status is always expressed in text as well as animation; the live dot has a text label beside it.

### Files

`src/convex/ambulances.ts`, `src/pages/AmbulanceOneTap.tsx`, `src/pages/AmbulanceBooking.tsx`, `src/pages/dashboards/community/OverviewSection.tsx`, `src/index.css`, `tests/oneTapAmbulance.test.ts`.

### Browser testing

**Not run.** Chromium is still unavailable on this host. The flow compiles, passes its backend tests and was inspected in code, but no claim is made that animations or mobile layout were visually verified.

## B. Global heading-only UI

Removed the shared dashboard subtitle rendering (`DashboardShell`), so every dashboard page now shows its title without an explanatory paragraph. Also removed page-level descriptions under the main headings on:

- Donor dashboard hero (welcome/introduction removed; heading is now “Donor dashboard”).
- Community, Hospital, Blood Bank, Guardian, Guardian onboarding, Ambulance, Admin, Supply Command and Drone Operations dashboards.
- Blood Search hero.
- Donation Camps hero.
- Signup role picker.
- Landing hero tagline.
- Generic dashboard page (`Welcome` → `Dashboard`).
- All `SignupFrame` pages (description under the heading removed).

Preserved: form labels, validation/error messages, GPS explanations, safety/warning banners, booking status messages, legal page content, accessibility labels, and operational instructions. `subtitle=` usages are now 0.

## C. Identity & Blood Group dashboard section

Removed:

- `src/pages/dashboards/community/IdentitySection.tsx` (deleted).
- Community section key, label, sidebar item, navigation icon and conditional render.
- All imports and references to the removed component.

Preserved deliberately:

- `donorProfiles.bloodGroup` and all matching/compatibility/allocation logic.
- Blood group in registration and profile workflows.
- `donorBloodGroupHistory` and `donorIdentityVerifications` backend tables, Aadhaar consent/callback/review backend and the admin identity audit tab.
- Historical verification data.

No data was deleted. Backend identity verification remains available to administrators for audit, but there is no donor dashboard identity/blood-group section. Documentation now reflects that.

## D. AI/ML training — actual results

All three lightweight pipelines were retrained in this environment and all three deep pipelines were attempted.

| Model | Training status | Artifact | Validation | Test metrics | Integration status |
|---|---|---|---|---|---|
| XGBoost | **Trained (exit 0)** | `artifacts/demand_model.json` + `demand_metadata.json` | Chronological holdout | MAE **0.2998**, RMSE **0.4500**, baseline MAE 0.7652, baseline RMSE 1.1816, improvement **60.83%**, 8,608 train / 2,176 holdout | Existing `/ai/demand/predict`; verified by pytest |
| Random Forest | **Trained (exit 0)** | `artifacts/donor_response.joblib` + `donor_metadata.json` | Stratified 720 train / 180 holdout, balanced classes | Accuracy **0.7056**, precision **0.8288**, recall **0.8121**, F1 **0.8203**, ROC-AUC **0.6066**, Brier **0.1809**, confusion `[[6,25],[28,121]]` | Existing `/ai/donor-response/predict`; verified by pytest |
| Isolation Forest | **Trained (exit 0)** | `artifacts/inventory_anomaly.joblib` + `anomaly_metadata.json` | Normal-fit + labelled injected spikes/drops | Precision **0.3333**, recall **1.0**, F1 **0.5**, FPR **0.0452**, confusion `[[211,10],[0,5]]` | Existing `/ai/inventory/anomaly-detect`; verified by pytest |
| ANN | **Blocked / NOT TRAINED** | None produced | Not run | Not run | `not_trained`; no fake artifact |
| LSTM | **Blocked / NOT TRAINED** | None produced | Not run | Not run | `not_trained`; no fake artifact |
| Autoencoder | **Blocked / NOT TRAINED** | None produced | Not run | Not run | `not_trained`; no fake artifact |

Evidence:

```
$ python3 scripts/train_all.py
exit 0 — XGBoost, Random Forest and Isolation Forest artifacts + metadata rewritten

$ python3 scripts/train_all_deep.py
TensorFlow is not installed. Install ml_service/requirements-deep.txt ...
exit 2 — no artifacts or metrics produced

$ python3 scripts/evaluate_all.py
blood demand         LSTM         artifacts not present / not trained
donor response       ANN          artifacts not present / not trained
anomaly              Autoencoder  artifacts not present / not trained
exit 2
```

`tensorflow`, `torch` and `keras` are not installed; only NumPy, SciPy, scikit-learn, XGBoost and joblib are available. The host has ~80 MB free disk, well below a TensorFlow CPU installation. The existing TensorFlow scripts are intentionally fail-closed and were not replaced with fabricated `.keras` files or invented metrics.

These are **synthetic-data metrics**, not hospital performance. Deep-model comparison (Random Forest vs ANN, XGBoost vs LSTM, Isolation Forest vs Autoencoder) cannot be produced until the three deep artifacts exist.

## E. Quality verification

| Check | Command | Result |
|---|---|---|
| TypeScript / Convex | `bunx convex dev --once && bunx tsc -b --noEmit` | Convex ready, TypeScript clean |
| TypeScript tests | `bun test` | **151 passed, 0 failed**, 710 assertions, 11 files |
| New one-tap tests | `bun test tests/oneTapAmbulance.test.ts` | **5 passed, 0 failed** |
| Python tests | `python3 -m pytest -q` | **57 passed, 1 deprecation warning** |
| Lint | `bunx eslint .` | 0 errors, 16 pre-existing warnings |
| Production build | `bun run build` | **success, exit 0** (12.17 s) |
| Browser walkthrough | — | **not run**, Chromium absent |

One-tap tests cover: real assignment from live coordinates, idempotent retry, active-booking reuse, honest `searching` state when nobody is available, and invalid-coordinate rejection.

## F. Known limitations

1. No browser/GPS/mobile/animation verification; Chromium is unavailable.
2. GPS behaviour depends on browser permissions and device hardware. Denial/timeout code paths exist but were not exercised in a real browser.
3. One-tap assignment picks the nearest approved available vehicle within 100 km. If none exists, the request stays `searching`. **Phase 5 adds bounded automatic re-matching** — see `docs/phase5-report.md`.
4. Destination coordination is explicitly deferred to the assigned provider, as required.
5. ANN, LSTM and Autoencoder are not trained; TensorFlow is unavailable. No deep-model comparison or production-ready claim is made.
6. Metrics are synthetic and are not evidence of hospital performance.
7. AI remains advisory only: deterministic compatibility/allocation and human review continue to govern clinical and inventory decisions.
