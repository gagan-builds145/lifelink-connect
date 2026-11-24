# Guardian onboarding, documents and expiry

## Application flow

A Guardian can register directly or upgrade an existing donor account. The
server grants the Guardian role; staff accounts cannot convert themselves into
Guardians. The same account keeps its donor workspace and can switch roles.

Submission requires:

- personal and service details;
- driver and licence details;
- at least one vehicle with insurance, fitness, PUC, permit and ambulance
  authorization expiry dates;
- mandatory onboarding documents.

All checks are server-side. An incomplete application cannot be submitted, and
an administrator cannot skip the review lifecycle.

## Document review

Each Guardian document is reviewed individually. The administrator can approve
or reject with a reason; review events are append-only. An application cannot be
approved while a required document is unreviewed, and a document cannot be
approved after its expiry date.

Only documents with `scanStatus: clean` can be reviewed. See
[malware-scanning.md](malware-scanning.md).

## Expiry reminders

A daily Convex cron (`guardian document expiry sweep`) checks Guardian onboarding
documents and vehicle compliance dates.

Configuration:

```text
GUARDIAN_DOC_EXPIRY_REMINDER_DAYS=30,14,7,1
```

The value is a comma-separated list of whole days before expiry. Defaults are
30, 14, 7 and 1. Invalid or empty configuration falls back to the default; the
last reminder day is clamped to 0 so a same-day warning can still be sent.

For each document and threshold:

- the Guardian receives an in-app notification;
- authorized administrators receive an operational notification;
- a deterministic dedupe key prevents duplicate reminders for the same
  document, threshold and expiry date;
- an audit row records the reminder.

The sweep is idempotent and safe to rerun.

## Expiry enforcement

When a mandatory document passes its expiry date:

1. the document status becomes `expired`;
2. the Guardian profile becomes `EXPIRED` and is forced offline;
3. the Guardian's vehicles are marked unavailable;
4. the Guardian can no longer go online or receive new bookings.

Eligibility is restored only when a valid replacement document is uploaded,
scanned clean and **individually approved** by an administrator. Restoration
requires the whole compliance set to pass; it does not automatically put the
Guardian online.

New bookings already assigned are not silently deleted. Existing operational
state is preserved and surfaced to the provider/admin for handling.

## Verification status

- Focused Bun tests cover configurable thresholds, deduplicated reminders,
  document expiry, profile/vehicle suspension and restore-after-approval.
- The full scan/review path is tested with Convex test data.
- Real email/SMS delivery still depends on provider credentials; in-app
  notifications are delivered immediately.
- The sweep has not been observed against a production-sized document set.
