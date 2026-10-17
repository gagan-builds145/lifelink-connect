import { api } from "@/convex/_generated/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BLOOD_GROUPS,
  CITIES,
  COMPONENTS,
  COMPONENT_LABELS,
  URGENCIES,
  URGENCY_LABELS,
  type Component,
  type Urgency,
} from "@/lib/blood";
import { useMutation } from "convex/react";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DocumentUpload, type UploadedDoc } from "./DocumentUpload";

type Source = "requestor" | "hospital";

export type CreatedRequest = { id: string; requestId: string };

function defaultRequiredBy() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

export function RequestForm({
  source,
  defaultHospitalName = "",
  defaultCity = "",
  defaultRequestorName = "",
  defaultPhone = "",
  defaultEmail = "",
  onCreated,
}: {
  source: Source;
  defaultHospitalName?: string;
  defaultCity?: string;
  defaultRequestorName?: string;
  defaultPhone?: string;
  defaultEmail?: string;
  onCreated?: (created: CreatedRequest) => void;
}) {
  const createRequest = useMutation(api.requests.create);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<UploadedDoc | null>(null);
  const [consent, setConsent] = useState(false);
  const [form, setForm] = useState({
    requestorName: defaultRequestorName,
    requestorType: source === "hospital" ? "representative" : "family",
    requesterPhone: defaultPhone,
    requesterEmail: defaultEmail,
    patientName: "",
    patientRef: "",
    patientAge: "",
    hospitalName: defaultHospitalName,
    city: defaultCity || "Pune",
    area: "",
    bloodGroup: "O+",
    component: "red_cells" as Component,
    units: "2",
    requiredBy: defaultRequiredBy(),
    urgency: "urgent" as Urgency,
    reason: "",
    doctorName: "",
    doctorContact: "",
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const units = Number(form.units);
    if (!form.patientName.trim() || !form.patientRef.trim()) {
      setError("Patient name and patient ID/reference are required.");
      return;
    }
    if (!/^\+?\d{10,15}$/.test(form.requesterPhone.replace(/[\s()-]/g, ""))) {
      setError("Enter a valid requestor phone number (10–15 digits).");
      return;
    }
    if (!Number.isFinite(units) || units < 1 || units > 20) {
      setError("Units required must be between 1 and 20.");
      return;
    }
    if (form.reason.trim().length < 10) {
      setError("Please provide at least 10 characters explaining the clinical reason.");
      return;
    }
    const requiredBy = new Date(form.requiredBy).getTime();
    if (!Number.isFinite(requiredBy) || requiredBy <= Date.now()) {
      setError("Choose a required date and time in the future.");
      return;
    }
    if (!consent) {
      setError("Confirm the declaration before submitting.");
      return;
    }

    setBusy(true);
    try {
      const created = await createRequest({
        source,
        requestorName: form.requestorName.trim() || defaultRequestorName || "Requestor",
        requestorType: form.requestorType as "patient" | "family" | "representative",
        requesterPhone: form.requesterPhone,
        requesterEmail: form.requesterEmail.trim() || undefined,
        patientName: form.patientName.trim(),
        patientRef: form.patientRef.trim(),
        patientAge: form.patientAge ? Number(form.patientAge) : undefined,
        hospitalName: form.hospitalName.trim(),
        city: form.city,
        area: form.area.trim() || undefined,
        bloodGroup: form.bloodGroup as (typeof BLOOD_GROUPS)[number],
        component: form.component,
        units,
        requiredBy,
        urgency: form.urgency,
        reason: form.reason.trim(),
        doctorName: form.doctorName.trim() || undefined,
        doctorContact: form.doctorContact.trim() || undefined,
        documentId: document?.documentId,
        consent: true,
      });
      toast.success(`Request ${created.requestId} submitted`, {
        description:
          "It is queued for verification. Status changes will appear in your dashboard and notifications.",
      });
      setForm((prev) => ({
        ...prev,
        patientName: "",
        patientRef: "",
        patientAge: "",
        reason: "",
        doctorName: "",
        doctorContact: "",
      }));
      setDocument(null);
      setConsent(false);
      onCreated?.(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5" noValidate>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border border-border bg-muted/25 p-3 text-[11.5px] leading-5 text-muted-foreground">
        <strong className="text-foreground">Privacy:</strong> Patient details and
        documents are visible only to you and authorized verification staff. Public
        search never exposes patient identity or prescriptions.
      </div>

      <fieldset className="space-y-4">
        <legend className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Requestor details
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="req-name">Requestor name</Label>
            <Input
              id="req-name"
              value={form.requestorName}
              onChange={(e) => set("requestorName", e.target.value)}
              placeholder="Full name"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-phone">Contact phone</Label>
            <Input
              id="req-phone"
              type="tel"
              value={form.requesterPhone}
              onChange={(e) => set("requesterPhone", e.target.value)}
              placeholder="+91 98765 43210"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-type">Relationship to patient</Label>
            <Select value={form.requestorType} onValueChange={(v) => set("requestorType", v)}>
              <SelectTrigger id="req-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="patient">Patient</SelectItem>
                <SelectItem value="family">Family member</SelectItem>
                <SelectItem value="representative">Authorized representative</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-email">Email (optional)</Label>
            <Input
              id="req-email"
              type="email"
              value={form.requesterEmail}
              onChange={(e) => set("requesterEmail", e.target.value)}
              placeholder="you@example.com"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Patient &amp; hospital
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="patient-name">Patient name</Label>
            <Input
              id="patient-name"
              value={form.patientName}
              onChange={(e) => set("patientName", e.target.value)}
              placeholder="Patient full name"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="patient-ref">Patient ID / hospital reference</Label>
            <Input
              id="patient-ref"
              value={form.patientRef}
              onChange={(e) => set("patientRef", e.target.value)}
              placeholder="e.g. IPD-1042"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="patient-age">Patient age (optional)</Label>
            <Input
              id="patient-age"
              type="number"
              min={0}
              max={120}
              value={form.patientAge}
              onChange={(e) => set("patientAge", e.target.value)}
              placeholder="e.g. 46"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hospital-name">Hospital name</Label>
            <Input
              id="hospital-name"
              value={form.hospitalName}
              onChange={(e) => set("hospitalName", e.target.value)}
              placeholder="Verified hospital"
              disabled={source === "hospital"}
              required
            />
            {source === "hospital" && (
              <p className="text-[10.5px] text-muted-foreground">
                Filled from your verified hospital profile.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="request-city">City</Label>
            <Select value={form.city} onValueChange={(v) => set("city", v)}>
              <SelectTrigger id="request-city" className="w-full">
                <SelectValue placeholder="Choose city" />
              </SelectTrigger>
              <SelectContent>
                {CITIES.map((city) => (
                  <SelectItem key={city} value={city}>
                    {city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="request-area">Area / locality (optional)</Label>
            <Input
              id="request-area"
              value={form.area}
              onChange={(e) => set("area", e.target.value)}
              placeholder="e.g. Camp"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Blood requirement
        </legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="blood-group">Blood group</Label>
            <Select value={form.bloodGroup} onValueChange={(v) => set("bloodGroup", v)}>
              <SelectTrigger id="blood-group" className="w-full font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BLOOD_GROUPS.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-1 lg:col-span-2">
            <Label htmlFor="component">Component</Label>
            <Select
              value={form.component}
              onValueChange={(v) => set("component", v as Component)}
            >
              <SelectTrigger id="component" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPONENTS.map((component) => (
                  <SelectItem key={component} value={component}>
                    {COMPONENT_LABELS[component]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="units">Units required</Label>
            <Input
              id="units"
              type="number"
              min={1}
              max={20}
              value={form.units}
              onChange={(e) => set("units", e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="required-by" className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5 text-primary" />
              Required date &amp; time
            </Label>
            <Input
              id="required-by"
              type="datetime-local"
              value={form.requiredBy}
              onChange={(e) => set("requiredBy", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Urgency</Label>
            <div className="grid grid-cols-3 gap-2">
              {URGENCIES.map((urgency) => (
                <button
                  key={urgency}
                  type="button"
                  onClick={() => set("urgency", urgency)}
                  aria-pressed={form.urgency === urgency}
                  className={
                    form.urgency === urgency
                      ? "rounded-xl border border-primary bg-primary/10 px-2 py-2.5 text-[11.5px] font-bold text-primary"
                      : "rounded-xl border border-border bg-card px-2 py-2.5 text-[11.5px] font-medium text-muted-foreground hover:border-primary/30"
                  }
                >
                  {URGENCY_LABELS[urgency]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason for request</Label>
          <Textarea
            id="reason"
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="Clinical context for the verification team. Do not include unnecessary sensitive information."
            rows={3}
            required
            minLength={10}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="doctor-name">Doctor name (optional)</Label>
            <Input
              id="doctor-name"
              value={form.doctorName}
              onChange={(e) => set("doctorName", e.target.value)}
              placeholder="Treating doctor"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doctor-contact">Doctor / ward contact (optional)</Label>
            <Input
              id="doctor-contact"
              value={form.doctorContact}
              onChange={(e) => set("doctorContact", e.target.value)}
              placeholder="Extension or phone"
            />
          </div>
        </div>
      </fieldset>

      <DocumentUpload value={document} onChange={setDocument} disabled={busy} />

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/20 p-3.5">
        <Checkbox
          checked={consent}
          onCheckedChange={(v) => setConsent(v === true)}
          className="mt-0.5"
          aria-describedby="request-consent-text"
        />
        <span id="request-consent-text" className="text-[11.5px] leading-5 text-muted-foreground">
          I confirm this request is genuine and submitted on behalf of the patient or
          with their authorization. I understand LifeLink coordinates verification and
          that final compatibility, testing and issue are decided by qualified medical
          staff.
        </span>
      </label>

      <Button type="submit" className="h-11 w-full gap-2 sm:w-auto" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {busy ? "Submitting securely…" : "Submit request for verification"}
      </Button>
      <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <CheckCircle2 className="size-3 text-teal-600" />
        You will receive a request ID immediately; stock is never promised before
        verification.
      </p>
    </form>
  );
}
