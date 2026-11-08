import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const BATCH = 20;

export const pendingJobs = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("notificationJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(Math.max(1, Math.min(BATCH, args.limit)));
    return jobs;
  },
});

export const markJob = internalMutation({
  args: {
    jobId: v.id("notificationJobs"),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped_no_provider"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;
    await ctx.db.patch(job._id, {
      status: args.status,
      attempts: job.attempts + 1,
      lastError: args.error,
      sentAt: args.status === "sent" ? Date.now() : undefined,
    });
  },
});

type SendResult = { status: "sent" | "failed" | "skipped_no_provider"; error?: string };

async function sendEmail(job: { recipient: string; subject: string; body: string }): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return {
      status: "skipped_no_provider",
      error:
        "Email provider not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL in Keys/API keys to deliver this message.",
    };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [job.recipient],
        subject: job.subject,
        text: job.body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { status: "failed", error: `Email provider returned HTTP ${response.status}.` };
    }
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Email delivery failed.",
    };
  }
}

async function sendSms(job: { recipient: string; body: string }): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return {
      status: "skipped_no_provider",
      error:
        "SMS provider not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER to deliver SMS.",
    };
  }
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: job.recipient, From: from, Body: job.body }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      return { status: "failed", error: `SMS provider returned HTTP ${response.status}.` };
    }
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "SMS delivery failed.",
    };
  }
}

/**
 * Drains the notification outbox. Providers are optional: when no credentials
 * exist the job is recorded as skipped with the exact env vars needed, so the
 * UI never claims a message was delivered.
 */
export const dispatchPending = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number; sent: number; failed: number; skipped: number }> => {
    const jobs = await ctx.runQuery(internal.notificationsQueue.pendingJobs, { limit: BATCH });
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const job of jobs) {
      let result: SendResult;
      if (job.channel === "email") result = await sendEmail(job);
      else if (job.channel === "sms") result = await sendSms(job);
      else
        result = {
          status: "skipped_no_provider",
          error:
            "Push delivery requires Firebase Cloud Messaging credentials and a registered device token; neither is configured.",
        };
      await ctx.runMutation(internal.notificationsQueue.markJob, {
        jobId: job._id,
        status: result.status,
        error: result.error,
      });
      if (result.status === "sent") sent += 1;
      else if (result.status === "failed") failed += 1;
      else skipped += 1;
    }
    return { processed: jobs.length, sent, failed, skipped };
  },
});
