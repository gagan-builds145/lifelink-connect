import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { useMutation } from "convex/react";
import { FileText, Loader2, Paperclip, ShieldCheck, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

export type UploadedDoc = {
  documentId: Id<"documentMetadata">;
  fileName: string;
  size: number;
  contentType: string;
};

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentUpload({
  value,
  onChange,
  disabled,
}: {
  value: UploadedDoc | null;
  onChange: (doc: UploadedDoc | null) => void;
  disabled?: boolean;
}) {
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const attachDocument = useMutation(api.documents.attachDocument);
  const removeDocument = useMutation(api.documents.remove);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
      toast.error("Unsupported document", {
        description: "Attach a PDF, JPEG or PNG file.",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Document is too large", { description: "Maximum size is 5 MB." });
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("The file upload was rejected.");
      const result = (await response.json()) as { storageId: string };
      const attached = await attachDocument({
        storageId: result.storageId as Id<"_storage">,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      onChange({
        documentId: attached.documentId,
        fileName: file.name,
        size: file.size,
        contentType: file.type,
      });
      toast.success("Document attached", {
        description: "Metadata is validated by the backend before the request is saved.",
      });
    } catch (err) {
      toast.error("Could not attach document", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clear = async () => {
    if (value) {
      try {
        await removeDocument({ documentId: value.documentId });
      } catch {
        // The metadata may already be attached; keep the UI honest but quiet.
      }
    }
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-[12.5px] font-semibold">
        Prescription / hospital document
        <span className="ml-1.5 text-[10.5px] font-normal text-muted-foreground">
          optional · PDF, JPEG or PNG · max 5 MB
        </span>
      </p>

      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-card text-primary">
            <FileText className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold">{value.fileName}</p>
            <p className="text-[10.5px] text-muted-foreground">
              {prettySize(value.size)} · stored privately
            </p>
          </div>
          <button
            type="button"
            onClick={() => void clear()}
            disabled={disabled || uploading}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-primary"
            aria-label="Remove attached document"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-3.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.03] disabled:opacity-60"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-card text-primary">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-semibold">
              {uploading ? "Uploading securely…" : "Attach a document"}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <ShieldCheck className="size-3" />
              Visible only to you and authorized staff
            </span>
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {!value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10.5px]"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
        >
          No document? You can still submit for verification.
        </Button>
      )}
    </div>
  );
}
