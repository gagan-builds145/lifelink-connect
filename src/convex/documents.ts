import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  enforceRateLimit,
  requireRole,
  requireUser,
  roleOf,
} from "./lib/helpers";

const ALLOWED = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 5 * 1024 * 1024;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await enforceRateLimit(ctx, `upload:${user._id}`, 20);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Records metadata only after checking the real uploaded file. */
export const attachDocument = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const stored = await ctx.db.system.get(args.storageId);
    if (!stored) throw new Error("The uploaded file could not be found.");
    if (!ALLOWED.includes(args.contentType)) {
      throw new Error("Only PDF, JPEG and PNG documents are accepted.");
    }
    if (args.size <= 0 || args.size > MAX_BYTES) {
      throw new Error("Documents must be under 5 MB.");
    }
    if (stored.size !== args.size) {
      throw new Error("Uploaded file size did not match. Please try again.");
    }
    await enforceRateLimit(ctx, `doc-meta:${user._id}`, 20);
    const documentId = await ctx.db.insert("documentMetadata", {
      storageId: args.storageId,
      uploadedByUserId: user._id,
      fileName: args.fileName.slice(0, 160),
      contentType: args.contentType,
      size: args.size,
      createdAt: Date.now(),
    });
    return { documentId };
  },
});

export const getUrl = query({
  args: { documentId: v.id("documentMetadata") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const meta = await ctx.db.get(args.documentId);
    if (!meta) throw new Error("Document not found.");
    const role = roleOf(user);
    let allowed = meta.uploadedByUserId === user._id || role === "admin" || role === "red_cross";
    if (!allowed && meta.requestId) {
      const request = await ctx.db.get(meta.requestId);
      if (
        request &&
        role === "hospital" &&
        user.organizationId &&
        (request.hospitalOrgId === user.organizationId ||
          request.assignedOrgId === user.organizationId)
      ) {
        allowed = true;
      }
    }
    if (!allowed) throw new Error("You are not authorized to open this document.");
    return await ctx.storage.getUrl(meta.storageId);
  },
});

export const remove = mutation({
  args: { documentId: v.id("documentMetadata") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["requestor", "hospital", "donor", "red_cross", "admin"]);
    const meta = await ctx.db.get(args.documentId);
    if (!meta) throw new Error("Document not found.");
    if (meta.uploadedByUserId !== user._id) {
      throw new Error("Only the uploader can remove this document.");
    }
    if (meta.requestId) {
      throw new Error("Documents attached to a request cannot be removed.");
    }
    await ctx.storage.delete(meta.storageId);
    await ctx.db.delete(meta._id);
    return { ok: true };
  },
});
