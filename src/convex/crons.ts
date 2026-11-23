import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Storage deadlines are enforced even when nobody opens a dashboard: once a
 * day every verified organization's batches are re-checked, and any group
 * whose deadline has passed raises the same automatic network request as a
 * manual low-stock update (hospitals -> nearby hospitals, Red Cross sources
 * and donors; Red Cross branches -> donors only).
 */
const crons = cronJobs();

crons.daily(
  "blood storage deadline sweep",
  { hourUTC: 1, minuteUTC: 30 },
  internal.inventory.expirySweep,
);

// Software-in-the-loop drone telemetry only. No real aircraft is commanded.
crons.interval(
  "drone telemetry simulation",
  { seconds: 30 },
  internal.drones.simulateTelemetry,
);

// Retention: drains queued email/SMS/push attempts and records provider status.
crons.interval(
  "notification outbox dispatch",
  { seconds: 120 },
  internal.notificationsQueue.dispatchPending,
);

// Fallback synchronisation for integrations marked periodic (mock adapters
// only; live sync requires an operator-triggered credentialed action).
crons.interval(
  "periodic facility sync",
  { hours: 6 },
  internal.integrations.runPeriodicSyncs,
);

// XGBoost forecast refresh. If ML_SERVICE_URL is absent the internal action
// skips rather than inventing a forecast.
crons.daily(
  "demand forecast refresh",
  { hourUTC: 2, minuteUTC: 10 },
  internal.ml.refreshScheduledForecasts,
);

crons.daily(
  "demand anomaly sweep",
  { hourUTC: 2, minuteUTC: 30 },
  internal.forecasting.anomalySweep,
);

// Identity-verification sessions expire even if the donor never returns.
crons.interval(
  "expire pending identity verifications",
  { minutes: 15 },
  internal.aadhaar.expirePendingSessions,
);

// Searching emergency bookings re-check the live network on a bounded schedule.
// Each booking carries its own next-attempt time and attempt cap, so this job is
// idempotent and cannot schedule unlimited retries.
crons.interval(
  "re-match searching ambulance bookings",
  { minutes: 1 },
  internal.ambulances.rematchSearchingBookings,
);

// Ambulance requests that nobody accepts must not stay open forever.
crons.interval(
  "expire stale ambulance requests",
  { minutes: 10 },
  internal.ambulances.expireStaleBookings,
);

export default crons;
