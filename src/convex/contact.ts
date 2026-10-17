import { v } from "convex/values";
import { mutation } from "./_generated/server";
import {
  enforceRateLimit,
  normalizeEmail,
  requireText,
} from "./lib/helpers";

export const submit = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const name = requireText(args.name, "Name");
    const email = normalizeEmail(args.email);
    const subject = requireText(args.subject, "Subject", 3, 140);
    const message = requireText(args.message, "Message", 10, 2000);
    await enforceRateLimit(ctx, `contact:${email}`, 3);

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
