# Identity verification and blood-group provenance

## Live Aadhaar Verification is not part of LifeLink

LifeLink **does not** perform Aadhaar identity verification. The Phase 4 hardening
release removed the former provider integration completely:

- no UIDAI connection or external Aadhaar verification service;
- no Aadhaar provider credentials, base URL, client id/secret or callback secret;
- no `/aadhaar/callback` endpoint or HMAC callback handling;
- no Aadhaar verification table, session, consent flow or administrator review;
- no sandbox mode that could be mistaken for genuine identity verification;
- no storage of Aadhaar numbers, OTPs, biometrics, identity documents or provider
  payloads.

The deleted implementation is not available through an environment flag. Adding
identity verification later would require a new, separately authorised and
reviewed design; it must not be represented as Aadhaar verification without the
required legal agreements and UIDAI authorisation.

## Authentication

Email OTP through Convex Auth is the only sign-in method. Removing Aadhaar did
**not** change email sign-in, session handling, logout, role setup or protected
route behaviour.

There is no Aadhaar-based authentication, and identity verification of any kind
is not a substitute for authentication.

## Blood-group provenance

Blood group is **donor-declared**, not derived from Aadhaar or any identity
provider. Donors select A+, A−, B+, B−, AB+, AB−, O+ or O− manually. The UI
labels the value as donor-declared and not medically verified.

- Changes are recorded in `donorBloodGroupHistory` and audited.
- A profile marked `medical_verified` cannot be changed by the donor.
- Deterministic ABO/Rh compatibility remains the only basis for matching and
  allocation. ML never decides compatibility or eligibility.

## Consent and records preserved

Removing Aadhaar did not delete unrelated donor profiles, requestor profiles,
blood-group history, donation/request consent records, ambulance consent or
business audit records. Aadhaar-specific records cannot be retained because the
feature and its table were removed; no unrelated table was purged.

## Administrator access

The Admin Console no longer has an identity-verification tab. Administrators can
review Guardian applications, individual Guardian documents, malware-scan status
and document expiry state, but cannot mark an Aadhaar identity as verified
because that feature no longer exists.

## Verification status

| Claim | Status |
| --- | --- |
| Live Aadhaar calls removed | Implemented; source/module/endpoint scan test passes |
| Aadhaar data storage removed | Implemented; schema has no identity table |
| Email OTP unchanged | Implemented; existing auth tests pass |
| Genuine Aadhaar verification | **Not implemented and not claimed** |
| Alternative government-ID verification | **Not implemented** |
