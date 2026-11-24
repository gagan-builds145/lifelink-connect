"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

type ScanResponse = {
  status?: string;
  engine?: string;
  signature?: string;
};

/**
 * Server-side malware scan with fail-closed quarantine.
 *
 * The scanner is a separate ClamAV-backed HTTP service. If the service is not
 * configured, unreachable or returns an invalid response, the document remains
 * quarantined (`scanStatus: error`) and cannot be opened or reviewed. File
 * signatures and MIME checks in `attachDocument` are format validation only and
 * are never treated as malware scanning.
 */
export const scanDocument = action({
  args: { documentId: v.id("documentMetadata") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in to scan a document.");

    const document = await ctx.runQuery(internal.documents.getScanContext, {
      documentId: args.documentId,
    });
    if (!document) throw new Error("Document not found.");
    if (document.uploadedByUserId !== userId && document.uploaderRole !== "admin") {
      throw new Error("You are not authorized to scan this document.");
    }
    if (document.scanStatus === "clean") {
      return { status: "clean" as const, reused: true };
    }
    if (document.scanStatus === "infected") {
      return { status: "infected" as const, reused: true };
    }
    if (document.scanStatus === "error" && (document.scanAttempts ?? 0) >= 5) {
      throw new Error("This upload reached the scan retry limit. Remove it and upload again.");
    }

    const scannerUrl = process.env.MALWARE_SCANNER_URL;
    const token = process.env.MALWARE_SCANNER_TOKEN;
    if (!scannerUrl || !token) {
      await ctx.runMutation(internal.documents.recordScanResult, {
        documentId: args.documentId,
        status: "error",
        error: "Malware scanner is not configured; the document remains quarantined.",
      });
      throw new Error(
        "Malware scanning is unavailable. The upload is quarantined and cannot be reviewed.",
      );
    }

    await ctx.runMutation(internal.documents.beginScan, {
      documentId: args.documentId,
    });

    try {
      const blob = await ctx.storage.get(document.storageId);
      if (!blob) throw new Error("Stored file not found.");
      const response = await fetch(`${scannerUrl.replace(/\/+$/, "")}/scan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "X-File-Name": document.fileName.slice(0, 160),
        },
        body: await blob.arrayBuffer(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`Scanner returned HTTP ${response.status}.`);
      }
      const payload = (await response.json()) as ScanResponse;
      if (payload.status === "clean") {
        await ctx.runMutation(internal.documents.recordScanResult, {
          documentId: args.documentId,
          status: "clean",
          engine: payload.engine ?? "clamav",
        });
        return { status: "clean" as const, reused: false };
      }
      if (payload.status === "infected") {
        await ctx.runMutation(internal.documents.recordScanResult, {
          documentId: args.documentId,
          status: "infected",
          engine: payload.engine ?? "clamav",
          signature: payload.signature ?? "malware detected",
        });
        return { status: "infected" as const, reused: false };
      }
      throw new Error("Scanner returned an invalid result.");
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "Malware scanner timed out; the document remains quarantined."
          : "Malware scanner was unavailable; the document remains quarantined.";
      await ctx.runMutation(internal.documents.recordScanResult, {
        documentId: args.documentId,
        status: "error",
        error: message,
      });
      throw new Error(message);
    }
  },
});
