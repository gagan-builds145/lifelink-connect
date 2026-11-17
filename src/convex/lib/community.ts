import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Records a community-facing activity row for events that leave no other
 * durable trace (availability toggles, profile edits, consent changes).
 *
 * Request, donation, invitation, allocation and transfer activity is derived
 * from its own tables, never duplicated here.
 */
export async function logCommunityActivity(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: {
    kind: "availability" | "consent" | "donor_profile" | "requestor_profile";
    title: string;
    detail?: string;
  },
) {
  await ctx.db.insert("communityActivity", {
    userId,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    createdAt: Date.now(),
  });
}
