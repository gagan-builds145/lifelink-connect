import { internalMutation } from "./_generated/server";
import { queueNotification } from "./lib/messaging";

const DEFAULT_REMINDER_DAYS = [30, 14, 7, 1];

function utcDay(value: string | number): string {
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10);
}

export function daysUntil(date: string, today: string): number {
  return Math.floor(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

/** Configurable comma-separated reminder intervals, for example "30,14,7,1". */
export function reminderThresholds(raw = process.env.GUARDIAN_DOC_EXPIRY_REMINDER_DAYS): number[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 365)
    .map((value) => Math.round(value));
  return parsed.length > 0
    ? Array.from(new Set(parsed)).sort((a, b) => a - b)
    : DEFAULT_REMINDER_DAYS;
}

export function chosenThreshold(days: number, thresholds: number[]): number | null {
  if (days <= 0) return null;
  return thresholds.find((threshold) => days <= threshold) ?? null;
}

async function systemAudit(
  ctx: Parameters<typeof queueNotification>[0],
  input: {
    action: string;
    entityType: string;
    entityId: string;
    detail: string;
  },
) {
  await ctx.db.insert("auditLogs", {
    actorRole: "system",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    detail: input.detail,
    createdAt: Date.now(),
  });
}

async function alertAdmins(
  ctx: Parameters<typeof queueNotification>[0],
  input: {
    title: string;
    body: string;
    dedupeKey: string;
    link: string;
  },
) {
  const admins = (await ctx.db.query("users").collect()).filter(
    (user) => user.role === "admin" || user.roles?.includes("admin"),
  );
  for (const admin of admins) {
    await queueNotification(ctx, {
      userId: admin._id,
      title: input.title,
      body: input.body,
      kind: "ambulance",
      link: input.link,
      dedupeKey: `${input.dedupeKey}:admin:${admin._id}`,
      channels: ["email"],
    });
  }
}

/**
 * Daily sweep for Guardian document expiry.
 *
 * - Sends reminders at configurable thresholds with deterministic dedupe keys.
 * - Marks documents expired once the date has passed.
 * - Moves an approved Guardian to EXPIRED, takes them offline and releases no
 *   bookings; replacing a document and having an administrator approve it is
 *   the only path back to eligibility.
 */
export const expirySweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = utcDay(Date.now());
    const thresholds = reminderThresholds();
    const documents = await ctx.db.query("documentMetadata").collect();
    const profiles = await ctx.db.query("guardianProfiles").collect();
    const profileByUser = new Map(
      profiles.map((profile) => [String(profile.userId), profile]),
    );
    let reminders = 0;
    let expired = 0;
    let guardiansSuspended = 0;

    for (const document of documents) {
      if (document.purpose !== "guardian_onboarding" || !document.expiryDate) continue;
      if (document.status === "rejected") continue;
      const profile = profileByUser.get(String(document.guardianUserId));
      if (!profile) continue;
      const guardianUserId = profile.userId;
      const label = document.documentKind ?? document.fileName;
      const days = daysUntil(document.expiryDate, today);

      if (days <= 0) {
        if (document.status !== "expired") {
          await ctx.db.patch(document._id, {
            status: "expired",
            reviewNote: "Automatically expired by the document-expiry sweep.",
          });
          await systemAudit(ctx, {
            action: "guardian.document_expired",
            entityType: "documentMetadata",
            entityId: String(document._id),
            detail: `${label} expired on ${document.expiryDate}.`,
          });
          await queueNotification(ctx, {
            userId: guardianUserId,
            title: "Guardian document expired",
            body: `${label} expired on ${document.expiryDate}. Upload a valid replacement; eligibility is restored only after administrator approval.`,
            kind: "ambulance",
            link: "/guardian/onboarding",
            dedupeKey: `guardian-doc-expired:${document._id}:${document.expiryDate}`,
            channels: ["email"],
          });
          await alertAdmins(ctx, {
            title: "Guardian document expired",
            body: `${profile.companyName}: ${label} expired on ${document.expiryDate}. The Guardian has been taken offline.`,
            dedupeKey: `guardian-doc-expired:${document._id}:${document.expiryDate}`,
            link: "/admin/dashboard",
          });
          expired += 1;
        }

        if (profile.status === "APPROVED") {
          const now = Date.now();
          await ctx.db.patch(profile._id, {
            status: "EXPIRED",
            documentsStatus: "pending",
            online: false,
            reviewNote: `Mandatory document expired: ${label}.`,
            updatedAt: now,
          });
          await systemAudit(ctx, {
            action: "guardian.expired_for_document",
            entityType: "guardianProfile",
            entityId: String(profile._id),
            detail: `${profile.companyName} was taken offline because ${label} expired.`,
          });
          const vehicles = await ctx.db
            .query("ambulances")
            .withIndex("by_guardian", (q) => q.eq("guardianUserId", guardianUserId))
            .collect();
          for (const vehicle of vehicles) {
            if (vehicle.available) {
              await ctx.db.patch(vehicle._id, { available: false, updatedAt: now });
            }
          }
          guardiansSuspended += 1;
        }
        continue;
      }

      const threshold = chosenThreshold(days, thresholds);
      if (threshold == null) continue;
      const dedupeKey = `guardian-doc-reminder:${document._id}:${document.expiryDate}:${threshold}`;
      const result = await queueNotification(ctx, {
        userId: guardianUserId,
        title: `Guardian document expires in ${days} day${days === 1 ? "" : "s"}`,
        body: `${label} expires on ${document.expiryDate}. Upload a valid replacement before then to avoid losing online eligibility.`,
        kind: "ambulance",
        link: "/guardian/onboarding",
        dedupeKey,
        channels: ["email"],
      });
      if (!result.deduped) reminders += 1;
      await alertAdmins(ctx, {
        title: "Guardian document approaching expiry",
        body: `${profile.companyName}: ${label} expires on ${document.expiryDate}.`,
        dedupeKey,
        link: "/admin/dashboard",
      });
    }

    return { reminders, expired, guardiansSuspended, thresholds };
  },
});

