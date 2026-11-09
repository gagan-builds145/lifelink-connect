# Hospital and blood-bank API integration guide

The connector is a **pull** adapter. It is not a live integration until a real
sandbox/production endpoint has been credentialed and tested by both parties.

## Supported auth schemes

Registered in `facilityIntegrations`:

- `bearer`: `Authorization: Bearer <credential>`
- `api_key`: the credential is sent verbatim in `Authorization`
- `basic`: `Authorization: Basic <credential>` where the stored value is the
  already-encoded `username:password` string

Credentials are read server-side from the environment variable named by
`credentialEnvVar`. The value must be set on the Convex deployment, never in the
frontend or the integration record.

## Endpoint contract

```http
GET {baseUrl}/inventory
Accept: application/json
Authorization: <scheme-dependent>
```

Accepted response shape:

```json
{
  "records": [
    {
      "externalUnitRef": "HMS-BATCH-1042",
      "bloodGroup": "O+",
      "component": "red_cells",
      "units": 4,
      "collectedAt": "2026-10-01",
      "expiresAt": "2026-11-20",
      "storageLocation": "Cold room A",
      "screened": true,
      "released": true,
      "storageTempC": 4
    }
  ]
}
```

A bare array is also accepted. The adapter validates and applies records in a
Convex mutation. A failed request writes a failed `facilitySyncRuns` row and
does not create stock. The mock adapter is clearly marked and imports labelled
demo data only.

## Setup

1. Ask the facility for a sandbox base URL, auth scheme, credential and schema
   mapping.
2. Set the credential on the Convex deployment:
   `bunx convex env set --prod HOSPITAL_KEY "..."`.
3. As admin, register the integration with `baseUrl`, `credentialEnvVar`,
   `authScheme`, `syncMode` and `isMock: false`.
4. Run a sandbox sync and inspect `facilitySyncRuns` and imported batches.
5. Confirm released/screened flags, expiry dates, units and external references
   match the source system.
6. Verify that a forced 401/500/timeout produces a failed run and zero inventory
   changes.
7. Schedule only after both parties sign off on the schema and reconciliation
   process.

## Reservation consistency

Imported batches use the same Convex inventory ledger and reservation logic as
manually entered stock. External IDs are idempotent per integration. A sync must
not delete or overwrite audited ledger history; corrections should use audited
adjustment transactions. Cancelled, quarantined or recalled units must be
represented explicitly in the source contract before production use.

## Not implemented / required before live use

- Webhook receiver and event-driven sync (only scheduled/manual pull exists).
- Field-level bidirectional write-back.
- Recalls, cross-matching results and unit-level barcodes.
- FHIR/HL7 mapping; the current contract is JSON REST.
- Certified sandbox tests, penetration review and data-processing agreement.
