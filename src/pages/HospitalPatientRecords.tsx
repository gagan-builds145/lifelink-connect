import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/lifelink/ui-bits";
import { BloodGroupChip } from "@/components/lifelink/ui-bits";
import { useAuth } from "@/hooks/use-auth";
import { friendlyError } from "@/lib/utils";
import {
  Building2,
  Calendar,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  FolderOpen,
  History,
  Info,
  Loader2,
  Paperclip,
  Search,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

type HospitalRecordsResult = ReturnType<typeof api.medicalRecords.donorMedicalRecordsForHospital>;
type DonorProfileResult = ReturnType<typeof api.medicalRecords.lookupDonorByLifeLinkId>;

type MedicalDocumentKind =
  | "discharge_summary"
  | "blood_test_report"
  | "laboratory_report"
  | "blood_group_report"
  | "diagnosis_report"
  | "treatment_report"
  | "prescription"
  | "operation_surgery_report"
  | "medical_certificate"
  | "other_medical";

const DOC_KINDS: { value: MedicalDocumentKind; label: string }[] = [
  { value: "discharge_summary", label: "Discharge Summary" },
  { value: "blood_test_report", label: "Blood Test Report" },
  { value: "laboratory_report", label: "Laboratory Report" },
  { value: "blood_group_report", label: "Blood Group Report" },
  { value: "diagnosis_report", label: "Diagnosis Report" },
  { value: "treatment_report", label: "Treatment Report" },
  { value: "prescription", label: "Prescription" },
  { value: "operation_surgery_report", label: "Operation / Surgery Report" },
  { value: "medical_certificate", label: "Medical Certificate" },
  { value: "other_medical", label: "Other Medical Documents" },
];

const DOC_KIND_LABELS: Record<MedicalDocumentKind, string> = {
  discharge_summary: "Discharge Summary",
  blood_test_report: "Blood Test Report",
  laboratory_report: "Laboratory Report",
  blood_group_report: "Blood Group Report",
  diagnosis_report: "Diagnosis Report",
  treatment_report: "Treatment Report",
  prescription: "Prescription",
  operation_surgery_report: "Operation / Surgery Report",
  medical_certificate: "Medical Certificate",
  other_medical: "Other Medical Documents",
};

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

interface UploadedFileState {
  file: File;
  storageId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export default function HospitalPatientRecords() {
  const { user } = useAuth();
  const me = useQuery(api.profiles.me);
  const org = me?.organization;

  const [searchId, setSearchId] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Upload state
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadKind, setUploadKind] = useState<MedicalDocumentKind>("other_medical");
  const [uploadDate, setUploadDate] = useState("");
  const [uploadDoctor, setUploadDoctor] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadedFile, setUploadedFile] = useState<UploadedFileState | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current donor session
  const [currentDonorId, setCurrentDonorId] = useState<string | null>(null);
  const [currentDonorProfile, setCurrentDonorProfile] = useState<DonorProfileResult | null>(null);

  const recordsResult = useQuery(
    api.medicalRecords.donorMedicalRecordsForHospital,
    currentDonorId ? { lifeLinkId: currentDonorId } : "skip",
  );

  // Mutations
  const lookupDonor = useMutation(api.medicalRecords.lookupDonorByLifeLinkId);
  const uploadRecord = useMutation(api.medicalRecords.uploadDonorMedicalRecord);
  const getUrl = useMutation(api.medicalRecords.getMedicalRecordUrl);
  const grantConsent = useMutation(api.medicalRecords.grantHospitalMedicalConsent);
  const revokeConsent = useMutation(api.medicalRecords.revokeMedicalConsent);
  const recordAccess = useMutation(api.medicalRecords.recordMedicalAccess);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);

  const demoPresent = org?.isDemo;

  const handleSearch = async () => {
    const id = searchId.trim();
    if (!id) {
      setSearchError("Enter a donor LifeLink ID to search.");
      return;
    }
    setSearchBusy(true);
    setSearchError(null);
    try {
      const result = await lookupDonor({ lifeLinkId: id });
      setCurrentDonorId(result.lifeLinkId);
      setCurrentDonorProfile(result);
      toast.success("Donor found", {
        description: `Verified donor: ${result.donorId}`,
      });
    } catch (err) {
      const msg = friendlyError(err, "Could not find donor.");
      setSearchError(msg);
      toast.error("Search failed", { description: msg });
    } finally {
      setSearchBusy(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
      toast.error("Unsupported file", { description: "Attach a PDF, JPEG or PNG file." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large", { description: "Maximum size is 5 MB." });
      return;
    }
    setUploadBusy(true);
    setUploadError(null);
    try {
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Upload rejected.");
      const result = (await response.json()) as { storageId: string };
      setUploadedFile({
        file,
        storageId: result.storageId,
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
      });
    } catch (err) {
      toast.error("Upload failed", { description: err instanceof Error ? err.message : "Please try again." });
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!currentDonorId) return;
    if (!uploadTitle.trim()) {
      setUploadError("Enter a document title.");
      return;
    }
    if (!uploadedFile) {
      setUploadError("Select a file to upload first.");
      return;
    }
    setUploadBusy(true);
    setUploadError(null);
    try {
      await uploadRecord({
        lifeLinkId: currentDonorId,
        title: uploadTitle.trim(),
        documentKind: uploadKind,
        documentDate: uploadDate || undefined,
        doctorName: uploadDoctor.trim() || undefined,
        notes: uploadNotes.trim() || undefined,
        storageId: uploadedFile.storageId as Id<"_storage">,
        fileName: uploadedFile.fileName,
        contentType: uploadedFile.contentType,
        size: uploadedFile.fileSize,
      });
      toast.success("Medical record uploaded", {
        description: "Queued for malware scanning. Available once cleared.",
      });
      setUploadTitle("");
      setUploadKind("other_medical");
      setUploadDate("");
      setUploadDoctor("");
      setUploadNotes("");
      setUploadedFile(null);
    } catch (err) {
      const msg = friendlyError(err, "Could not upload record.");
      setUploadError(msg);
      toast.error("Upload failed", { description: msg });
    } finally {
      setUploadBusy(false);
    }
  };

  const handleView = useCallback(async (documentId: Id<"documentMetadata">) => {
    try {
      const url = await getUrl({ documentId });
      if (url) window.open(url, "_blank", "noopener");
      if (recordsResult?._accessLogHint) {
        await recordAccess({
          actorUserId: recordsResult._accessLogHint.actorUserId,
          actorRole: recordsResult._accessLogHint.actorRole,
          hospitalOrgId: recordsResult._accessLogHint.hospitalOrgId,
          donorUserId: recordsResult._accessLogHint.donorUserId,
          donorProfileId: recordsResult._accessLogHint.donorProfileId,
          action: "view",
          recordId: documentId,
          detail: `Viewed document ${documentId}`,
        }).catch(() => {});
      }
    } catch (err) {
      toast.error("View failed", { description: err instanceof Error ? err.message : "Could not open document." });
    }
  }, [getUrl, recordsResult]);

  const handleDownload = useCallback(async (documentId: Id<"documentMetadata">) => {
    try {
      const url = await getUrl({ documentId });
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Download started");
    } catch (err) {
      toast.error("Download failed", { description: err instanceof Error ? err.message : "Could not download document." });
    }
  }, [getUrl]);

  const clearUpload = () => {
    setUploadTitle("");
    setUploadedFile(null);
    setUploadError(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
            <FolderOpen className="size-4.5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold">Patient medical records</h1>
            <p className="text-[11.5px] text-muted-foreground">
              Search for a donor by LifeLink ID, upload medical records, and manage cross-hospital access.
            </p>
          </div>
        </div>
        {demoPresent && org && (
          <div className="flex items-center gap-2 rounded-full border border-amber-300/70 bg-amber-50 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-amber-800">
            <Info className="size-3.5" />
            Demo hospital · {org.name} · {org.orgId}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-[13px] font-bold">
          <Search className="size-4 text-primary" />
          Find donor by LifeLink ID
        </h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Enter the donor's permanent LifeLink ID to verify their profile and upload records.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
              placeholder="LL-D-12345"
              className="pl-9 font-mono text-[13px]"
              disabled={searchBusy || !org}
            />
          </div>
          <Button onClick={() => void handleSearch()} disabled={searchBusy || !org} className="gap-2">
            {searchBusy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Verify donor
          </Button>
        </div>
        {searchError && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{searchError}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Donor profile */}
      {currentDonorProfile && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[13px] font-bold">
              <User className="size-4 text-primary" />
              Verified donor profile
            </h2>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7"
              onClick={() => {
                navigator.clipboard.writeText(currentDonorProfile.lifeLinkId);
                toast.success("LifeLink ID copied");
              }}
            >
              <Copy className="size-3.5" />
              Copy ID
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 rounded-xl border border-border bg-muted/30 p-3">
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">LifeLink ID</p>
              <p className="font-mono text-[13px] font-semibold">{currentDonorProfile.lifeLinkId}</p>
            </div>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Donor ID</p>
              <p className="text-[13px] font-semibold">{currentDonorProfile.donorId}</p>
            </div>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Name</p>
              <p className="text-[13px] font-semibold">{currentDonorProfile.fullName}</p>
            </div>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Blood group</p>
              <BloodGroupChip group={currentDonorProfile.bloodGroup} size="sm" />
            </div>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">City</p>
              <p className="text-[13px] font-semibold">{currentDonorProfile.city}</p>
            </div>
          </div>
          {currentDonorProfile.phone && (
            <p className="mt-2 text-[10.5px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="size-3" />
              Contact details visible to this hospital.
            </p>
          )}
        </div>
      )}

      {/* Upload panel */}
      {currentDonorId && org && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-[13px] font-bold">
            <FileText className="size-4 text-primary" />
            Upload medical record
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Attach a document for this donor. Files are scanned for malware before becoming available.
          </p>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="doc-title">Document title *</Label>
              <Input
                id="doc-title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="e.g. Discharge Summary — Jane Doe"
                disabled={uploadBusy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Document category</Label>
              <Select value={uploadKind as string} onValueChange={(v) => setUploadKind(v as MedicalDocumentKind)} disabled={uploadBusy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_KINDS.map((k) => (
                    <SelectItem key={k.value as string} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-date">Document date (YYYY-MM-DD)</Label>
              <Input
                id="doc-date"
                type="date"
                value={uploadDate}
                onChange={(e) => setUploadDate(e.target.value)}
                disabled={uploadBusy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-doctor">Doctor name (optional)</Label>
              <Input
                id="doc-doctor"
                value={uploadDoctor}
                onChange={(e) => setUploadDoctor(e.target.value)}
                placeholder="Dr. Smith"
                disabled={uploadBusy}
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="doc-notes">Notes (optional)</Label>
              <Textarea
                id="doc-notes"
                value={uploadNotes}
                onChange={(e) => setUploadNotes(e.target.value)}
                placeholder="Clinical notes, context for other hospitals…"
                rows={2}
                disabled={uploadBusy}
              />
            </div>
          </div>

          <div className="mt-3">
            <Label className="text-[12px] font-semibold">File attachment</Label>
            {uploadedFile ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-card text-primary">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold">{uploadedFile.fileName}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {prettySize(uploadedFile.fileSize)} · ready to upload
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearUpload}
                  disabled={uploadBusy}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-primary"
                  aria-label="Remove attached file"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadBusy}
                className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-3.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.03] disabled:opacity-60"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-card text-primary">
                  {uploadBusy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] font-semibold">
                    {uploadBusy ? "Uploading securely…" : "Attach a document"}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                    PDF, JPEG or PNG · max 5 MB
                  </span>
                </span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              tabIndex={-1}
              onChange={handleFileChange}
            />
          </div>

          {uploadError && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void handleUpload()} disabled={uploadBusy || !org || !uploadedFile} className="gap-2">
              {uploadBusy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {uploadBusy ? "Uploading…" : "Upload medical record"}
            </Button>
            <Button variant="ghost" onClick={clearUpload} disabled={uploadBusy}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Records table */}
      {currentDonorId && recordsResult && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[13px] font-bold">
              <FolderOpen className="size-4 text-primary" />
              Medical records
            </h2>
            <span className="text-[10.5px] text-muted-foreground">
              {recordsResult.records.length} document(s)
            </span>
          </div>
          {recordsResult.records.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No medical records yet"
              description="Upload a document above to attach it to this donor's record."
            />
          ) : (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Uploaded by</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordsResult.records.map((rec: HospitalRecordsResult["records"][number]) => (
                    <TableRow key={rec._id}>
                      <TableCell>
                        <p className="max-w-[160px] truncate font-medium text-[12px]">{rec.title}</p>
                        <p className="text-[10px] text-muted-foreground">{prettySize(rec.size)}</p>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {DOC_KIND_LABELS[rec.documentKind as MedicalDocumentKind] ?? rec.documentKind as string}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {rec.documentDate ? (
                          <span className="flex items-center gap-1">
                            <Calendar className="size-3" />
                            {rec.documentDate}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <span className="truncate max-w-[120px] block">{rec.uploadedBy}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={
                            rec.status === "available"
                              ? "inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-800"
                              : rec.status === "quarantined"
                                ? "inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800"
                                : "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800"
                          }>
                            {rec.status === "available" ? (
                              <CheckCircle2 className="size-3" />
                            ) : rec.status === "quarantined" ? (
                              <ShieldCheck className="size-3" />
                            ) : (
                              <Loader2 className="size-3 animate-spin" />
                            )}
                            {rec.status === "available" ? "Available" : rec.status === "quarantined" ? "Quarantined" : "Scanning"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {rec.canDownload ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10.5px] gap-1"
                                onClick={() => void handleView(rec._id)}
                              >
                                <FileText className="size-3" />
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10.5px] gap-1"
                                onClick={() => void handleDownload(rec._id)}
                              >
                                <Download className="size-3" />
                                Download
                              </Button>
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Pending scan</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Consent info */}
      {currentDonorId && org && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-[13px] font-bold">
            <ShieldCheck className="size-4 text-primary" />
            Cross-hospital access
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Donors control which hospitals can view their records. This hospital's uploads are automatically accessible to staff here. Other hospitals need the donor's consent.
          </p>
          <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <Info className="size-3" />
              Donor consent management is available from the donor's own Medical Records section.
            </p>
          </div>
        </div>
      )}

      {/* Access log placeholder */}
      {currentDonorId && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[13px] font-bold">
              <History className="size-4 text-primary" />
              Access log
            </h2>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Every search, view, download, and consent change is recorded.
          </p>
          <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/20 p-3 text-[11px] text-muted-foreground flex items-center gap-2">
            <Info className="size-3" />
            Access logging is recorded server-side. Contact your administrator for the full audit trail.
          </div>
        </div>
      )}
    </div>
  );
}
