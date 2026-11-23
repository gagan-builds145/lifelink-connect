# LifeLink Connect 2.0 — Phase 3 implementation report

Date: 2026-11-23
Scope: production-readiness hardening, identity verification, Guardian onboarding, multi-role accounts, ambulance lifecycle and regression testing — built on the existing Phase 2 project without rebuilding it.

## 1. What is preserved

- Donor, Hospital, Blood Bank and Administrator roles, existing email-OTP authentication and Convex backend.
- Donation, request, inventory, allocation, transfer, drone, notification and AI flows.
- Guardian remains the exact role name. “Ambulance partner”, “driver” and “vehicle” are labels only; no new role was created.
- Existing accounts and records: new fields are optional and `role` keeps its old meaning.
- Existing AI endpoints and artifacts; no model was retrained or replaced as part of Phase 3 UI work.

## 2. Multi-role accounts and Donor → Guardian upgrade

- `users.roles` now records every granted role; `users.role` remains the active workspace for backward compatibility.
- `requireRole` accepts any granted role. `RequireRole` in the UI does the same.
- `guardian.registerExistingDonor({ donorId })`:
  - requires a signed-in non-staff account;
  - normalises the ID and looks it up with the `by_donor_id` index;
  - verifies the donor profile belongs to the authenticated user;
  - returns the **same generic error** for “not found” and “belongs to someone else”;
  - creates the Guardian profile linked to `linkedDonorId`, adds `guardian` to `roles`, and keeps the donor workspace primary where one exists.
- `profiles.switchRole` only accepts roles already granted; attempting an ungranted role (including `admin`) fails.
- `RoleSwitcher` appears when an account has two or more workspaces.
- Donor dashboard has “Register as Guardian” and the onboarding page accepts the existing Donor ID.

## 3. Aadhaar identity verification (provider-independent, sandbox only)

Implemented in `src/convex/aadhaar.ts`, `src/convex/lib/aadhaarProvider.ts`, `src/convex/http.ts` and `src/pages/dashboards/community/IdentitySection.tsx`.

- Explicit, versioned consent; checkbox never preselected.
- Statuses: `NOT_STARTED`, `PENDING`, `VERIFIED`, `FAILED`, `EXPIRED`, `REVOKED`, `REQUIRES_REVIEW`.
- Signed provider callback `POST /aadhaar/callback` with HMAC-SHA256, 5-minute replay window, payload cap, idempotency and expiry handling.
- Administrators can review/flag but can never set `VERIFIED`.
- Withdrawal stops new operations, erases the permitted identity copy and keeps the lifecycle audit record.
- Sandbox results are labelled everywhere and are not UIDAI verifications.
- No Aadhaar number, OTP, biometric or raw response is stored.
- Email sign-in was **not** removed. Live verification and Aadhaar-based authentication remain disabled.
- Details and the live-enable checklist: `docs/identity-verification.md`.

## 4. Donor-declared blood group

- Eight groups supported; selection is manual and never derived from identity data.
- The required label **“Donor-Declared Blood Group — Not Medically Verified”** appears on the identity page.
- `donors.setBloodGroup` records `bloodGroupSource`, a history row and an audit entry.
- A medically verified group is locked against donor edits.
- Existing profiles are read as `self_declared`.

## 5. Guardian onboarding

Implemented in `src/convex/guardian.ts`, `src/convex/documents.ts`, `src/pages/GuardianOnboarding.tsx` and the admin console.

Collected and validated:

- Guardian personal/contact details, date of birth (18+), residential address, emergency contacts, preferred language, masked identification.
- Driver: name, phone, licence number/category, issue/expiry, issuing authority, experience, availability.
- Service: BLS/ALS declarations, oxygen, stretcher, wheelchair accessibility, first aid, equipment, operating area/hours, emergency contact.
- Payout: account holder, bank, IFSC and **last four digits only** — full account numbers are deliberately not stored.
- Vehicles: registration, make/model/year/colour/type/capacity, driver, insurance/fitness/PUC/permit/authorization expiry. Multiple vehicles per Guardian.
- Documents: profile/identity, licence front/back, vehicle photos, RC, insurance, fitness, PUC, permit, ambulance authorization, bank proof, other.

Security and workflow:

- PDF/JPEG/PNG only, 5 MB limit, server-side real file-signature check, filename sanitisation, ownership checks, rate limits.
- Configurable per-vehicle-type document requirements in `src/lib/guardian.ts`.
- Lifecycle: `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED | RESUBMISSION_REQUIRED | SUSPENDED | EXPIRED`.
- Legal transitions enforced; reasons required for rejection/resubmission/suspension/expiry.
- Every decision writes a `guardianReviewEvents` row and an audit log with actor, previous/new status, reason and timestamp.
- Going online requires approval, a valid licence, at least one vehicle, and no missing/expired required document.
- Only approved, online Guardians with available vehicles appear in nearby searches.
- Existing `documentsStatus` values remain supported for legacy profiles.

## 6. Ambulance booking lifecycle

- Statuses now include `rejected`, `expired` and `failed` alongside the documented journey.
- Guardian decline records `REJECTED` (not `CANCELLED`).
- Open requests expire after 15 minutes via the `expire stale ambulance requests` cron; requester is notified and no vehicle is held.
- Completed/cancelled/failed trips release the vehicle.
- Acceptance requires an approved Guardian; creation requires an approved, online provider.
- Illegal transitions and cross-Guardian actions are refused.
- Double submissions remain idempotent through `clientRequestId`; one active booking per requester remains enforced.

## 7. Admin console

- “Guardian applications” tab now lists the full application: contact, linked Donor ID, driver/licence, every vehicle with expiry dates, every document with per-document approve/reject, a reason field, and lifecycle buttons.
- “Identity verification” tab lists sessions with provider, sandbox flag, consent version/timestamps and review actions. `VERIFIED` cannot be set manually.
- Existing network, integrations, AI, safety, security and audit tabs are unchanged.

## 8. Verification actually run

| Check | Command | Result |
| --- | --- | --- |
| Convex codegen + typecheck | `bunx convex dev --once && bunx tsc -b --noEmit` | Convex ready, TypeScript clean |
| TypeScript/Convex tests | `bun test` | **146 passed, 0 failed**, 694 assertions, 10 files |
| New Phase 3 tests | `bun test tests/phase3.test.ts` | **13 passed, 0 failed** |
| Lint | `bunx eslint .` | 0 errors, 16 pre-existing warnings |
| Python tests | not rerun in Phase 3 (no Python changes) | Phase 2 baseline: 45 passed |

Phase 3 test coverage includes: consent required and version pinned; sandbox labelling; consent withdrawal erases the copy; admin cannot verify; donor cannot review; blood-group history and medical lock; cross-account Donor-ID refusal; Donor → Guardian role retention and switching; refusal to switch to an ungranted role; blocked incomplete submission; full approval and go-online flow; illegal review transition; backend file-signature rejection; rejection lifecycle; stale-request expiry; illegal booking transition.

## 9. Explicit limitations (not hidden)

1. **No browser/E2E run.** Chromium is still absent and disk is ~110 MB free. The new screens were typechecked and compiled, not visually driven. Do not treat them as visually verified.
2. **Live Aadhaar is disabled.** No authorised provider contract or legal approval exists. Only the labelled sandbox is available.
3. **No Aadhaar-based sign-in.** Email OTP remains the only authentication method, as required until a separate authorised method is approved.
4. **Deep models remain untrained.** TensorFlow is unavailable; ANN/LSTM/Autoencoder scripts still fail closed. No `.keras` artifact was added or loaded.
5. **S3/Parquet remain unexecuted.** No credentials and no `boto3`/`pyarrow`.
6. **No 1M/10M capacity claim.** Only bounded in-process load tests exist.
7. Account numbers are deliberately not stored in full; a payment provider is required for real payouts.
8. Administrators reviewing documents do so by metadata/status; an inline document viewer was not added.
9. There is no automated expiry-notification cron for Guardian documents yet; gate checks and status labels are implemented, but proactive reminders before expiry are not.

## 10. Browser test checklist for a Chromium-capable environment

1. Sign in as a donor; open Identity & Blood Group; confirm the consent box is unchecked; start a session; complete sandbox verification; confirm the “not UIDAI” labels; withdraw consent; confirm the identity copy disappears.
2. Change blood group twice; confirm history and the “not medically verified” label.
3. As the same donor, enter the wrong Donor ID and then the right one on `/guardian/onboarding`; confirm no second account and the role switcher appears.
4. Complete Guardian personal/driver/service/payout/vehicle sections; upload a valid PDF and a renamed non-PDF; confirm only the valid one is accepted.
5. Submit, sign in as admin, review documents and the application, approve, then confirm the Guardian can go online and appears in nearby searches.
6. Book as a donor, decline as the Guardian, confirm `REJECTED`; book again and let it expire; confirm no vehicle remains busy.
7. Test GPS permission denial on the ambulance/Guardian screens and confirm a clear error rather than a fake location.
8. Confirm Hospital/Blood Bank/Guardian/Admin routes reject the wrong role.

## 11. Files changed in Phase 3

Backend: `src/convex/schema.ts`, `src/convex/validators.ts`, `src/convex/lib/helpers.ts`, `src/convex/lib/aadhaarProvider.ts`, `src/convex/aadhaar.ts`, `src/convex/guardian.ts`, `src/convex/documents.ts`, `src/convex/ambulances.ts`, `src/convex/profiles.ts`, `src/convex/donors.ts`, `src/convex/http.ts`, `src/convex/crons.ts`.

Frontend: `src/lib/guardian.ts`, `src/lib/ambulance.ts`, `src/components/lifelink/RequireRole.tsx`, `src/components/lifelink/RoleSwitcher.tsx`, `src/pages/GuardianOnboarding.tsx`, `src/pages/GuardianDashboard.tsx`, `src/pages/AdminConsole.tsx`, `src/pages/dashboards/CommunityDashboard.tsx`, `src/pages/dashboards/community/IdentitySection.tsx`, `src/pages/dashboards/community/ProfileSection.tsx`, `src/pages/signup/SignupGuardian.tsx`, `src/main.tsx`.

Tests/docs: `tests/phase3.test.ts`, `tests/ambulance.test.ts`, `docs/phase3-audit-report.md`, `docs/phase3-report.md`, `docs/identity-verification.md`.
