# Donor identity verification (Aadhaar) — architecture and compliance notes

## Status in this deployment

- **Live UIDAI/Aadhaar verification: DISABLED.** No live provider contract, credentials, legal approval or certification is present in this repository.
- **Sandbox provider: ENABLED by default** (`AADHAAR_SANDBOX_MODE` not set to `false`). Sandbox sessions are explicitly labelled and stored with `sandbox: true`. A sandbox result is **not** a UIDAI Aadhaar verification and must never be presented as one.
- No Aadhaar number, OTP, biometric, raw provider payload or identity-document image is stored by this feature.

## Legal review required before enabling live verification

Before setting `AADHAAR_VERIFICATION_ENABLED=true`, the operator must, at minimum:

1. Contract a legally authorised provider (AUA/KUA or an authorised sub-KUA/ASP) and confirm the exact permitted data fields.
2. Complete UIDAI and applicable Aadhaar Act/regulations/directions review.
3. Complete applicable Indian data-protection review (purpose limitation, notice, consent, retention, breach handling, data-principal rights).
4. Obtain written approval to run the verification flow and the callback endpoint.
5. Confirm the provider's authentication method. **Identity verification is not authentication.** Sign-in without email is only permitted after a separate, authorised authentication method is implemented, tested and approved.

This repository does not assert that any of the above has happened.

## Provider adapter

`src/convex/lib/aadhaarProvider.ts` defines the provider boundary:

```ts
type AadhaarVerificationProvider = {
  name: string;
  isSandbox: boolean;
  createVerificationSession(input): Promise<CreatedVerificationSession>;
  getVerificationStatus(reference: string): Promise<ProviderVerificationStatus>;
  cancelVerificationSession(reference: string): Promise<void>;
};
```

- `sandboxProvider` creates a local, expiring session. It never contacts a provider.
- `unconfiguredLiveProvider` refuses to operate. It is returned when live flags are set but no real adapter exists, so configuration mistakes fail closed.
- `verifyProviderCallbackSignature` performs HMAC-SHA256 over `${timestamp}.${rawBody}` with constant-time comparison.

A real provider adapter must be added as a separate implementation; business logic in `src/convex/aadhaar.ts` does not change.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `AADHAAR_PROVIDER` | Provider identifier. |
| `AADHAAR_PROVIDER_BASE_URL` | Authorised provider base URL. |
| `AADHAAR_CLIENT_ID` | Provider client id. |
| `AADHAAR_CLIENT_SECRET` | Provider secret. Convex environment only, never the frontend. |
| `AADHAAR_CALLBACK_SECRET` | HMAC secret for the callback route. Required by the route. |
| `AADHAAR_SANDBOX_MODE` | `true` (default) uses the labelled sandbox; `false` disables it. |
| `AADHAAR_VERIFICATION_ENABLED` | Must be `true` (with all credentials) to leave sandbox mode. |
| `AADHAAR_SESSION_TTL_MINUTES` | Session lifetime, clamped to 5–60 minutes. |

Never put these values in `VITE_*` variables or frontend code.

## Data model

`donorIdentityVerifications` stores:

- donor user/profile references
- provider and opaque verification reference
- status (`NOT_STARTED`, `PENDING`, `VERIFIED`, `FAILED`, `EXPIRED`, `REVOKED`, `REQUIRES_REVIEW`)
- sandbox flag
- consent version and timestamps (including withdrawal)
- session expiry, verification timestamp
- optional permitted masked reference and provider transaction reference
- optional permitted verified name/address
- failure/review notes and reviewer id

It intentionally has no field for an Aadhaar number, OTP, biometric or raw response.

## Consent

- The UI checkbox starts unchecked and is never preselected.
- Consent version is pinned (`2026-11-donor-identity-v1`) and must match the server constant.
- Starting a session without explicit consent fails.
- Withdrawal sets `REVOKED`, records `consentWithdrawnAt` and erases the permitted identity copy. The minimal lifecycle record remains for audit.
- Aadhaar consent is separate from donation, request and ambulance consent.
- Identity verification is optional and does not gate blood donation or ambulance use.

## Callback contract

`POST /aadhaar/callback`

Headers:

- `x-aadhaar-timestamp`: epoch milliseconds
- `x-aadhaar-signature`: lowercase hex HMAC-SHA256 of `${timestamp}.${rawBody}`

Body (small, allow-listed):

```json
{
  "reference": "llv_...",
  "status": "VERIFIED",
  "transactionRef": "provider-transaction-id",
  "verifiedName": "Permitted name",
  "verifiedAddress": "Permitted address",
  "maskedReference": "XXXX-XXXX-1234",
  "failureReason": "Only for non-success statuses"
}
```

Rules enforced by the route:

- missing `AADHAAR_CALLBACK_SECRET` → 503
- timestamp missing or older/newer than 5 minutes → 401
- body larger than 8 KB → 413
- invalid signature → 401
- unknown reference → `ok: false`
- already-terminal session → idempotent duplicate response
- callback after expiry → session becomes `EXPIRED`

## Administrator access

- Admins see status, provider, consent timestamps, sandbox flag and a permitted masked reference only.
- Admins may set `REQUIRES_REVIEW`, `FAILED` or `REVOKED` with a reason.
- Admins **cannot** set `VERIFIED`; only the signed provider callback (or the clearly-labelled sandbox switch) can.
- Manual review is separate from provider verification.

## Blood group

Blood group is never derived from Aadhaar. The donor selects it manually from A+, A−, B+, B−, AB+, AB−, O+, O−. The UI must always show **“Donor-Declared Blood Group — Not Medically Verified”**. Changes are written to `donorBloodGroupHistory` and audited. A profile marked `medical_verified` cannot be changed by the donor.

## Removing email sign-in

**Not done.** Email OTP remains the only authentication method. Aadhaar identity verification alone is not authentication. Email remains required for registration, profile, communications and account recovery until a separately authorised and tested authentication method exists.
