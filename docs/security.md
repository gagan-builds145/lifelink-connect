# Security checklist

LifeLink handles donor contact data, facility inventory and request metadata. It
is not certified medical software. This checklist separates controls present in
the repository from work that must be completed at the deployment edge.

## Secrets

- [x] Server secrets are read from Convex deployment variables, never `VITE_*`.
- [x] The ML service uses a bearer token between Convex and FastAPI.
- [x] `ML_SERVICE_TOKEN` is not imported by any frontend module.
- [x] The production Docker image rejects startup without a token when
  `ML_REQUIRE_AUTH=true` (the Dockerfile defaults to this).
- [ ] Store secrets in a managed secret manager with access audit and rotation.
- [ ] Rotate Convex, ML, Resend, Twilio and hospital credentials on a documented
  schedule and immediately after suspected exposure.
- [ ] Add secret scanning to CI before production.

## Authentication and authorization

- [x] Convex Auth email OTP for staff, donor and requestor accounts.
- [x] Server-side role checks on allocation, donor, drone, admin and integration
  mutations/actions.
- [x] Protected React routes use the existing `RequireAuth` wrapper.
- [x] Donor eligibility, compatibility and consent are deterministic backend
  rules; ML cannot grant access or eligibility.
- [ ] Add automated RBAC and session-expiry tests.
- [ ] Add organisation-level tenant isolation tests against a seeded deployment.
- [ ] Configure production auth issuer, redirect URLs and key rotation.

## Network and service hardening

- [x] ML prediction/health requests have per-attempt timeouts and retries for
  idempotent calls; training is single-attempt.
- [x] ML `/health` is authenticated when a token is configured; `/livez` exposes
  only liveness/version.
- [x] No wildcard CORS is configured by default.
- [ ] Put the ML container behind TLS, a private network or authenticated gateway.
- [ ] Add WAF/rate limiting at the edge for auth, request, contact and upload
  endpoints.
- [ ] Restrict container egress to required providers and Convex.
- [ ] Set CPU/memory limits and a non-root container user.
- [ ] Add dependency and container image scanning.

## Data protection

- [x] Donor location is city-level and requires active, revocable consent.
- [x] Donor contact details are revealed to a facility only after acceptance.
- [x] Public queries mask patient/donor contact data.
- [x] ML donor scoring rejects `consented: false`.
- [x] Invitation records store model provenance and a synthetic-data flag.
- [ ] Complete a DPIA/privacy review for donor and patient data.
- [ ] Define retention, deletion and subject-access procedures.
- [ ] Restrict and audit Convex dashboard access.
- [ ] Encrypt exports and prohibit patient data in model-training datasets.

## Auditing and incident response

- [x] Sensitive operations write `auditLogs`.
- [x] ML failures do not fabricate predictions; donor fallback explicitly records
  distance-only ordering.
- [x] Notification providers are optional and record `skipped_no_provider`
  instead of claiming delivery.
- [ ] Ship audit/application logs to a tamper-resistant retention store.
- [ ] Alert on repeated auth failures, integration failures, critical anomalies,
  ML outages and mission holds.
- [ ] Maintain an incident runbook covering wrong-unit release, data exposure,
  credential compromise and drone-safety events.

## Deployment gates

Do not describe this project as production-ready until the unchecked items,
clinical sign-off, privacy approval, hospital credential validation and aviation
approvals applicable to the deployment are complete.
