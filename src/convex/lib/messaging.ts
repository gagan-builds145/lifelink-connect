import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { roleOf, type AppRole } from "./helpers";

export type NotificationChannel = "email" | "sms" | "push";

type NotificationInput = {
  userId: Id<"users">;
  title: string;
  body: string;
  kind: Doc<"notifications">["kind"];
  requestId?: Id<"bloodRequests">;
  link?: string;
  /** Idempotency key: retries with the same key never duplicate a message. */
  dedupeKey?: string;
  /** In-app is always written; external channels are queued for the dispatcher. */
  channels?: NotificationChannel[];
  emailSubject?: string;
};

/**
 * Writes the in-app notification and queues external delivery attempts.
 *
 * External providers are optional. The queue records exactly what was
 * attempted and why it was skipped, so the UI never implies an email or SMS
 * was delivered when no provider is configured.
 */
export async function queueNotification(ctx: MutationCtx, input: NotificationInput) {
  if (input.dedupeKey) {
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", input.dedupeKey))
      .first();
    if (existing) return { notificationId: existing._id, deduped: true, queued: 0 };
  }

  const now = Date.now();
  const notificationId = await ctx.db.insert("notifications", {
    userId: input.userId,
    title: input.title,
    body: input.body,
    kind: input.kind,
    requestId: input.requestId,
    link: input.link,
    read: false,
    dedupeKey: input.dedupeKey,
    createdAt: now,
  });

  const user = await ctx.db.get(input.userId);
  if (!user) return { notificationId, deduped: false, queued: 0 };

  const channels = input.channels ?? ["email"];
  let queued = 0;
  for (const channel of channels) {
    const recipient =
      channel === "email" ? user.email : channel === "sms" ? user.phone : String(user._id);
    if (!recipient) continue;
    const idempotencyKey = `${input.dedupeKey ?? `notif:${notificationId}`}:${channel}`;
    const existingJob = await ctx.db
      .query("notificationJobs")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existingJob) continue;
    await ctx.db.insert("notificationJobs", {
      userId: input.userId,
      notificationId,
      channel,
      recipient,
      subject: input.emailSubject ?? input.title,
      body: input.body,
      idempotencyKey,
      status: "queued",
      attempts: 0,
      createdAt: now,
    });
    queued += 1;
  }

  return { notificationId, deduped: false, queued };
}

export async function queueForOrganization(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  input: Omit<NotificationInput, "userId">,
) {
  const members = await ctx.db
    .query("users")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect();
  const results = [];
  for (const member of members) {
    results.push(
      await queueNotification(ctx, {
        ...input,
        userId: member._id,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${member._id}` : undefined,
      }),
    );
  }
  return results;
}

export async function queueForRoles(
  ctx: MutationCtx,
  roles: AppRole[],
  input: Omit<NotificationInput, "userId">,
) {
  const users = await ctx.db.query("users").collect();
  const targets = users.filter((user) => roles.includes(roleOf(user)));
  for (const user of targets) {
    await queueNotification(ctx, {
      ...input,
      userId: user._id,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${user._id}` : undefined,
    });
  }
  return targets.length;
}

export async function queueForDonors(
  ctx: MutationCtx,
  donationCenterOrgId: Id<"organizations">,
  input: Omit<NotificationInput, "userId">,
) {
  const members = await ctx.db
    .query("users")
    .withIndex("by_organization", (q) => q.eq("organizationId", donationCenterOrgId))
    .collect();
  for (const member of members) {
    await queueNotification(ctx, {
      ...input,
      userId: member._id,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${member._id}` : undefined,
    });
  }
}
