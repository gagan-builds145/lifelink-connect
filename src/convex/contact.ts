import { v } from "convex/values";
import { mutation } from "./_generated/server";
import {
  enforceFwRateLimit,
  enforceRateLimit,
  normalizeClientRef,
  normalizeEmail,
  recordSecurityEvent,
  requireText,
  safeError,
} from "./lib/helpers";

const MAX_CONTACT_MESSAGE_BYTES = 5 * 1024; // 5 KB practical cap on free-form text

function isOverlyLongValue(value: string, bytes: number): boolean {
  return new TextEncoder().encode(value).length > bytes;
}

function looksLikeAutomatedSpam(value: string): boolean {
  // Heuristic-only. It must not block legitimate users and must not parse
  // secrets; it only looks for obvious junk patterns in free text.
  if (value.length > 2000) return true;
  const low = value.toLowerCase();
  return /<script|javascript:|on\w+=|data\s*:/i.test(low);
}

export const submit = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    // Request-firewall: prevent bizarrely large payloads at the boundary.
    for (const [label, value] of [
      ["name", args.name],
      ["email", args.email],
      ["subject", args.subject],
      ["message", args.message],
    ] as const) {
      if (isOverlyLongValue(value, 4000)) {
        await recordSecurityEvent(ctx, {
          kind: "oversized_request",
          severity: "medium",
          service: "web",
          reason: `${label} exceeds the acceptable length for a contact submission.`,
          summary: `Oversized ${label} in contact submission.`,
          clientRef: normalizeClientRef(args.email),
        });
        throw safeError("Your message is too large. Please shorten it and try again.");
      }
    }

    if (looksLikeAutomatedSpam(args.message) || looksLikeAutomatedSpam(args.subject)) {
      await recordSecurityEvent(ctx, {
        kind: "malformed_request",
        severity: "medium",
        service: "web",
        reason: "Contact submission contained a suspicious payload pattern.",
        summary: "Contact submission rejected for suspicious content.",
        clientRef: normalizeClientRef(args.email),
      });
      throw safeError("Your message could not be submitted. Please check the content and try again.");
    }

    const name = requireText(args.name, "Name");
    const email = normalizeEmail(args.email);
    const subject = requireText(args.subject, "Subject", 3, 140);
    const message = requireText(args.message, "Message", 10, 2000);
    if (message.length > MAX_CONTACT_MESSAGE_BYTES) {
      await recordSecurityEvent(ctx, {
        kind: "oversized_request",
        severity: "low",
        service: "web",
        reason: `Contact message exceeded the practical text cap of ${MAX_CONTACT_MESSAGE_BYTES} bytes.`,
        summary: "Contact message too long.",
        clientRef: normalizeClientRef(args.email),
      });
      throw safeError("Your message is too long. Please shorten it and try again.");
    }

    // Coarse abuse control on the endpoint overall, not just per email.
    const endpointAllowed = await enforceFwRateLimit(
      ctx,
      `contact:endpoint:${Math.floor(Date.now() / 60_000)}`,
      20,
      60_000,
      "medium",
    );
    if (!endpointAllowed) {
      return {
        saved: false,
        emailDeliveryConfigured: false,
        message: "Too many messages right now. Please wait a moment and try again.",
      };
    }
    try {
      await enforceRateLimit(ctx, `contact:${email}`, 3);
    } catch {
      // The generic limiter throws; record the refusal durably before
      // returning a normal denial so the request is not retried blindly.
      await recordSecurityEvent(ctx, {
        kind: "rate_limited",
        severity: "medium",
        service: "web",
        reason: "Per-email contact submission limit reached.",
        summary: "Contact submission rate limit exceeded for an address.",
        clientRef: normalizeClientRef(email),
      });
      return {
        saved: false,
        emailDeliveryConfigured: false,
        message: "You have sent several messages recently. Please try again later.",
      };
    }

    await ctx.db.insert("contactMessages", {
      name,
      email,
      subject,
      message,
      createdAt: Date.now(),
    });

    return {
      saved: true,
      emailDeliveryConfigured: false,
      message:
        "Your message is saved for the LifeLink team. Outbound email is not configured in this deployment, so no email copy was sent.",
    };
  },
});
