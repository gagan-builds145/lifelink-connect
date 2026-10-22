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

export default crons;
