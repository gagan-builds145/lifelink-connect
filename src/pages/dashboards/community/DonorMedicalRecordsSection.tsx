import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { EmptyState } from "@/components/lifelink/ui-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery } from "convex/react";
import {
  Calendar,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  History,
  Info,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

type MedicalRecord = FunctionReturnType<typeof api.medicalRecords.myMedicalRecords>["records"][number];
type MyMedicalRecordsResult = FunctionReturnType<typeof api.medicalRecords.myMedicalRecords>;

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DocStatusBadge({ status }: { status: string }) {
  if (status === "available") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-800">
        <CheckCircle2 className="size-3" />
        Available
      </span>
    );
  }
  if (status === "quarantined") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">
        <ShieldCheck className="size-3" />
        Quarantined
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
      <Loader2 className="size-3 animate-spin" />
      Scanning
    </span>
  );
}

interface DonorMedicalRecordsSectionProps {
  lifeLinkId: string;
}

export function DonorMedicalRecordsSection({ lifeLinkId }: DonorMedicalRecordsSectionProps) {
  const records = useQuery(api.medicalRecords.myMedicalRecords, { skip: !lifeLinkId }) || ({ records: [], total: 0, lifeLinkId } as const);
  const getUrl = useMutation(api.medicalRecords.getMedicalRecordUrl);



  const [downloadingId, setDownloadingId] = useState<Id<"documentMetadata"> | null>(null);
  const fileInputRef = useRef<HTMLAnchorElement>(null);

  const handleView = useCallback(async (record: MedicalRecord) => {
    if (!record.canDownload) {
      toast.error("Document not available", {
        description: "This document is still being scanned. It will be available once cleared.",
      });
      return;
    }
    try {
      const url = await getUrl({ documentId: record._id });
      if (url) window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error("Could not open document", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
  }, [getUrl]);

  const handleDownload = useCallback(async (record: MedicalRecord) => {
    if (!record.canDownload) {
      toast.error("Document not available", {
        description: "This document is still being scanned.",
      });
      return;
    }
    setDownloadingId(record._id);
    try {
      const url = await getUrl({ documentId: record._id });
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
      document.body.appendChild(a);
      a.click();
        document.body.removeChild(a);
      }
      toast.success("Download started", {
        description: `${record.fileName} is being downloaded.`,
      });
    } catch (err) {
      toast.error("Could not download document", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setDownloadingId(null);
    }
  }, [getUrl]);

  if (records === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-4 text-[12px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin shrink-0" />
        Loading your medical records…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
          <FolderOpen className="size-4.5" />
        </div>
        <div>
          <h2 className="font-display text-base font-bold">Your medical records</h2>
          <p className="text-[11.5px] text-muted-foreground">
            Documents uploaded by hospitals and blood banks, linked to your LifeLink ID.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
          <Info className="size-3" />
          Your records are private. Only you and hospitals that you have granted consent to can view them.
        </div>

        {records.records.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No medical records yet"
            description="When a hospital uploads a document for you, it will appear here."
          />
        ) : (
          <div className="mt-3 space-y-2">
            {records.records.map((rec) => (
              <div
                key={rec._id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold">{rec.title}</p>
                      <p className="text-[10.5px] text-muted-foreground">
                        {rec.contentType} · {prettySize(rec.size)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" />
                      {rec.documentDate ? formatDateTime(new Date(rec.documentDate).getTime()) : "No date"}
                    </span>
                    <span className="flex items-center gap-1">
                      <History className="size-3" />
                      Uploaded {formatDateTime(rec.uploadedAt)}
                    </span>
                    <span>{rec.uploadedBy}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <DocStatusBadge status={rec.status} />
                  <div className="flex items-center gap-1.5">
                    {rec.canDownload ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10.5px] gap-1"
                          onClick={() => void handleView(rec)}
                        >
                          <FileText className="size-3" />
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10.5px] gap-1"
                          onClick={() => void handleDownload(rec)}
                          disabled={downloadingId === rec._id}
                        >
                          {downloadingId === rec._id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Download className="size-3" />
                          )}
                          Download
                        </Button>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Pending scan</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {records.lifeLinkId && (
        <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
            <ShieldCheck className="size-3.5" />
            Your LifeLink ID
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Hospitals use this ID to find your profile and upload medical records for you.
            Share it with your healthcare providers when needed.
          </p>
          <p className="mt-2 font-mono text-[13px] font-semibold text-primary">{lifeLinkId}</p>
        </div>
      )}
    </div>
  );
}
