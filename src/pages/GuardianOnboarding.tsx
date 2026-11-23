import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireRole } from "@/components/lifelink/RequireRole";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import { Badge } from "@/components/ui/badge";
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
import {
  AMBULANCE_TYPE_LABELS,
  AMBULANCE_TYPES,
  type AmbulanceType,
} from "@/lib/ambulance";
import { formatDate } from "@/lib/blood";
import {
  GUARDIAN_DOCUMENT_KINDS,
  GUARDIAN_DOCUMENT_LABELS,
  GUARDIAN_STATUS_LABELS,
  type GuardianDocumentKind,
  type GuardianStatus,
} from "@/lib/guardian";
import { friendlyError } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Ambulance,
  FileText,
  Fingerprint,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Truck,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type AppData = NonNullable<ReturnType<typeof useAppQuery>>;
function useAppQuery() {
  return useQuery(api.guardian.myGuardianApplication);
}

export default function GuardianOnboarding() {
  return (
    <RequireAuth redirectImmediately title="Sign in to register as Guardian">
      <RequireRole roles={["community", "donor", "requestor", "guardian"]}>
        <Onboarding />
      </RequireRole>
    </RequireAuth>
  );
}

function Onboarding() {
  const app = useAppQuery();
  const me = useQuery(api.profiles.me);
  const linkDonor = useMutation(api.guardian.registerExistingDonor);
  const registerGuardian = useMutation(api.ambulances.registerGuardian);
  const [donorId, setDonorId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newService, setNewService] = useState({
    companyName: "",
    contactPerson: me?.user.name ?? "",
    phone: me?.user.phone ?? "",
    city: me?.user.city ?? "Pune",
    address: "",
  });

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      toast.success(success);
    } catch (err) {
      setError(friendlyError(err, "That action could not be completed."));
    } finally {
      setBusy(null);
    }
  };

  const navItems = [
    { key: "application", label: "Guardian onboarding", icon: Ambulance },
    { key: "dashboard", label: "Guardian dashboard", icon: Truck },
  ];

  return (
    <DashboardShell
      roleLabel="Donor / Guardian"
      roleKey={me?.user.name ?? "Onboarding"}
      title="Register as a Guardian ambulance partner"
      subtitle="One account can be a donor and a Guardian. Guardian access stays pending until an administrator approves the application and the required documents are valid."
      items={navItems}
      active="application"
      onSelect={(key) => {
        if (key === "dashboard") window.location.assign("/guardian/dashboard");
      }}
      accentIcon={ShieldCheck}
      quickLinks={[
        { label: "Guardian dashboard", href: "/guardian/dashboard", icon: Truck },
        { label: "Donor dashboard", href: "/community/dashboard", icon: Ambulance },
      ]}
    >
      <div className="mt-4 space-y-4">
        {error && (
          <p className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-[11.5px] text-rose-900">
            {error}
          </p>
        )}

        {app === undefined ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your Guardian application…
          </div>
        ) : app === null ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 font-display text-base font-bold">
                <Fingerprint className="size-4 text-primary" /> Already a LifeLink donor?
              </h2>
              <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                Register as a Guardian from your existing donor account. Your donor ID is
                verified on the server and must belong to the signed-in account. No second
                account, no lost donation history.
              </p>
              {me?.donor && (
                <p className="mt-2 rounded-lg border border-border bg-muted/20 px-2.5 py-1.5 text-[11px]">
                  Your donor ID: <span className="font-bold">{me.donor.donorId}</span>
                </p>
              )}
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="guardian-donor-id">Existing LifeLink Donor ID</Label>
                <Input
                  id="guardian-donor-id"
                  value={donorId}
                  onChange={(event) => setDonorId(event.target.value)}
                  placeholder="LL-D-0001"
                />
              </div>
              <Button
                className="mt-3 gap-1.5"
                disabled={busy != null || donorId.trim().length < 4}
                onClick={() =>
                  void run(
                    "link",
                    () => linkDonor({ donorId }),
                    "Guardian onboarding added to your existing account.",
                  )
                }
              >
                {busy === "link" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Register as Guardian with Donor ID
              </Button>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-display text-base font-bold">New ambulance partner</h2>
              <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                Not a donor yet? Create a Guardian profile for this account, then complete
                driver, vehicle and document details.
              </p>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Ambulance service name</Label>
                  <Input
                    value={newService.companyName}
                    onChange={(event) =>
                      setNewService((prev) => ({ ...prev, companyName: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact person</Label>
                  <Input
                    value={newService.contactPerson}
                    onChange={(event) =>
                      setNewService((prev) => ({ ...prev, contactPerson: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    value={newService.phone}
                    onChange={(event) =>
                      setNewService((prev) => ({ ...prev, phone: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <Input
                    value={newService.city}
                    onChange={(event) =>
                      setNewService((prev) => ({ ...prev, city: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Registered address</Label>
                  <Input
                    value={newService.address}
                    onChange={(event) =>
                      setNewService((prev) => ({ ...prev, address: event.target.value }))
                    }
                  />
                </div>
              </div>
              <Button
                className="mt-3 gap-1.5"
                variant="outline"
                disabled={busy != null}
                onClick={() =>
                  void run(
                    "create",
                    () => registerGuardian(newService),
                    "Guardian profile created. Complete the application below.",
                  )
                }
              >
                {busy === "create" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Create Guardian profile
              </Button>
            </section>
          </div>
        ) : (
          <ApplicationView app={app} run={run} busy={busy} />
        )}
      </div>
    </DashboardShell>
  );
}

type RunFn = (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;

function ApplicationView({
  app,
  run,
  busy,
}: {
  app: AppData;
  run: RunFn;
  busy: string | null;
}) {
  const status = app.profile.status as GuardianStatus;
  const editable = ["DRAFT", "REJECTED", "RESUBMISSION_REQUIRED"].includes(status);
  const submitApplication = useMutation(api.guardian.submitApplication);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              Application status
            </p>
            <h2 className="mt-1 font-display text-xl font-extrabold">
              {GUARDIAN_STATUS_LABELS[status]}
            </h2>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {app.profile.companyName} · {app.profile.city}
              {app.profile.linkedDonorId ? ` · linked donor ${app.profile.linkedDonorId}` : ""}
            </p>
          </div>
          <Badge variant={status === "APPROVED" ? "default" : "outline"}>{status}</Badge>
        </div>
        {app.profile.reviewNote && (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50/70 p-2.5 text-[11px] leading-5 text-amber-950">
            <span className="font-bold">Administrator note:</span> {app.profile.reviewNote}
          </p>
        )}
        {app.issues.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-950">
              <AlertTriangle className="size-3.5" /> Before you can go online
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10.5px] leading-5 text-amber-950/90">
              {app.issues.slice(0, 6).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {editable && (
          <Button
            className="mt-3 gap-1.5"
            disabled={busy != null}
            onClick={() =>
              void run(
                "submit",
                () => submitApplication({}),
                "Application submitted for administrator review.",
              )
            }
          >
            {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Submit application for review
          </Button>
        )}
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Submission is blocked until every mandatory section, vehicle and required document
          is present. Approval is an administrative verification, not a medical endorsement.
        </p>
      </section>

      <PersonalSection app={app} run={run} busy={busy} editable={editable} />
      <DriverSection app={app} run={run} busy={busy} editable={editable} />
      <ServiceSection app={app} run={run} busy={busy} editable={editable} />
      <PayoutSection app={app} run={run} busy={busy} editable={editable} />
      <VehicleSection app={app} run={run} busy={busy} />
      <DocumentSection app={app} busy={busy} />
    </div>
  );
}

function PersonalSection({ app, run, busy, editable }: SectionProps) {
  const save = useMutation(api.guardian.saveApplication);
  const p = app.profile;
  const [form, setForm] = useState({
    companyName: p.companyName,
    contactPerson: p.contactPerson,
    phone: p.phone,
    email: p.email ?? "",
    dateOfBirth: p.dateOfBirth ?? "",
    residentialAddress: p.residentialAddress ?? p.address,
    emergencyContactName: p.emergencyContactName ?? "",
    emergencyContactPhone: p.emergencyContactPhone ?? "",
    preferredLanguage: p.preferredLanguage ?? "English",
    identityType: p.identityType ?? "Aadhaar (last 4 only)",
    identityLast4: p.identityLast4 ?? "",
  });
  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Section title="1. Guardian & personal details" icon={ShieldCheck}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ambulance service name">
          <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Contact person">
          <Input value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Mobile number">
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Email address">
          <Input value={form.email} onChange={(e) => set("email", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Date of birth">
          <Input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Preferred language">
          <Input value={form.preferredLanguage} onChange={(e) => set("preferredLanguage", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Residential address" className="sm:col-span-2">
          <Input value={form.residentialAddress} onChange={(e) => set("residentialAddress", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Emergency contact name">
          <Input value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Emergency contact number">
          <Input value={form.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Identification type">
          <Input value={form.identityType} onChange={(e) => set("identityType", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Identification last 4 characters">
          <Input maxLength={4} value={form.identityLast4} onChange={(e) => set("identityLast4", e.target.value)} disabled={!editable} />
        </Field>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        Never enter a full identity number here. Only the last four characters are stored;
        scan copies belong in the document section.
      </p>
      {editable && (
        <Button
          size="sm"
          className="mt-3 h-8"
          disabled={busy != null}
          onClick={() => void run("personal", () => save(form), "Personal details saved.")}
        >
          {busy === "personal" && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          Save personal details
        </Button>
      )}
    </Section>
  );
}

function DriverSection({ app, run, busy, editable }: SectionProps) {
  const save = useMutation(api.guardian.saveApplication);
  const d = app.profile.driver;
  const [form, setForm] = useState({
    fullName: d?.fullName ?? "",
    phone: d?.phone ?? "",
    licenceNumber: d?.licenceNumber ?? "",
    licenceCategory: d?.licenceCategory ?? "LMV",
    licenceExpiryDate: d?.licenceExpiryDate ?? "",
    licenceIssueDate: d?.licenceIssueDate ?? "",
    issuingAuthority: d?.issuingAuthority ?? "",
    experienceYears: String(d?.experienceYears ?? ""),
    available: d?.available ?? true,
  });
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Section title="2. Driver information" icon={Truck}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Driver full name">
          <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Driver mobile number">
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Driving licence number">
          <Input value={form.licenceNumber} onChange={(e) => set("licenceNumber", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Licence category">
          <Input value={form.licenceCategory} onChange={(e) => set("licenceCategory", e.target.value)} disabled={!editable} placeholder="LMV, TRANS" />
        </Field>
        <Field label="Licence issue date">
          <Input type="date" value={form.licenceIssueDate} onChange={(e) => set("licenceIssueDate", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Licence expiry date">
          <Input type="date" value={form.licenceExpiryDate} onChange={(e) => set("licenceExpiryDate", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Issuing authority">
          <Input value={form.issuingAuthority} onChange={(e) => set("issuingAuthority", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Driving experience (years)">
          <Input inputMode="numeric" value={form.experienceYears} onChange={(e) => set("experienceYears", e.target.value)} disabled={!editable} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[11px]">
        <Checkbox checked={form.available} onCheckedChange={(v) => set("available", v === true)} disabled={!editable} />
        Driver is available for duty
      </label>
      {editable && (
        <Button
          size="sm"
          className="mt-3 h-8"
          disabled={busy != null}
          onClick={() =>
            void run(
              "driver",
              () =>
                save({
                  driver: {
                    fullName: form.fullName,
                    phone: form.phone,
                    licenceNumber: form.licenceNumber,
                    licenceCategory: form.licenceCategory,
                    licenceIssueDate: form.licenceIssueDate || undefined,
                    licenceExpiryDate: form.licenceExpiryDate,
                    issuingAuthority: form.issuingAuthority || undefined,
                    experienceYears: form.experienceYears ? Number(form.experienceYears) : undefined,
                    available: form.available,
                  },
                }),
              "Driver details saved.",
            )
          }
        >
          {busy === "driver" && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          Save driver details
        </Button>
      )}
    </Section>
  );
}

function ServiceSection({ app, run, busy, editable }: SectionProps) {
  const save = useMutation(api.guardian.saveApplication);
  const s = app.profile.service;
  const [form, setForm] = useState({
    bls: s?.bls ?? false,
    als: s?.als ?? false,
    oxygen: s?.oxygen ?? false,
    stretcher: s?.stretcher ?? false,
    wheelchairAccessible: s?.wheelchairAccessible ?? false,
    firstAid: s?.firstAid ?? false,
    emergencyEquipment: s?.emergencyEquipment ?? "",
    operatingArea: s?.operatingArea ?? app.profile.city,
    operatingHours: s?.operatingHours ?? "24x7",
    emergencyContact: s?.emergencyContact ?? app.profile.phone,
    notes: s?.notes ?? "",
  });
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Section title="3. Ambulance equipment & service" icon={Ambulance}>
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["bls", "Basic Life Support (BLS)"],
            ["als", "Advanced Life Support (ALS)"],
            ["oxygen", "Oxygen available"],
            ["stretcher", "Stretcher available"],
            ["wheelchairAccessible", "Wheelchair accessible"],
            ["firstAid", "First-aid equipment"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[10.5px]">
            <Checkbox
              checked={form[key]}
              onCheckedChange={(v) => set(key, v === true)}
              disabled={!editable}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
        Declared capabilities are not independently verified. Do not claim medical capability
        your vehicle and crew do not have.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Emergency equipment">
          <Input value={form.emergencyEquipment} onChange={(e) => set("emergencyEquipment", e.target.value)} disabled={!editable} placeholder="Defibrillator, suction, oxygen cylinders" />
        </Field>
        <Field label="Service operating area">
          <Input value={form.operatingArea} onChange={(e) => set("operatingArea", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Operating hours">
          <Input value={form.operatingHours} onChange={(e) => set("operatingHours", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Emergency contact">
          <Input value={form.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} disabled={!editable} />
        </Field>
      </div>
      {editable && (
        <Button
          size="sm"
          className="mt-3 h-8"
          disabled={busy != null}
          onClick={() =>
            void run("service", () => save({ service: form }), "Service details saved.")
          }
        >
          {busy === "service" && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          Save service details
        </Button>
      )}
    </Section>
  );
}

function PayoutSection({ app, run, busy, editable }: SectionProps) {
  const save = useMutation(api.guardian.saveApplication);
  const payout = app.profile.payout;
  const [form, setForm] = useState({
    accountHolderName: payout?.accountHolderName ?? "",
    bankName: payout?.bankName ?? "",
    accountNumberLast4: payout?.accountNumberLast4 ?? "",
    ifsc: payout?.ifsc ?? "",
  });

  return (
    <Section title="4. Payout details" icon={FileText}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account holder name">
          <Input value={form.accountHolderName} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} disabled={!editable} />
        </Field>
        <Field label="Bank name">
          <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} disabled={!editable} />
        </Field>
        <Field label="Account number — last 4 digits">
          <Input maxLength={4} value={form.accountNumberLast4} onChange={(e) => setForm({ ...form, accountNumberLast4: e.target.value })} disabled={!editable} />
        </Field>
        <Field label="IFSC">
          <Input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} disabled={!editable} />
        </Field>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        Only the last four digits are stored in the application record. Full account details
        must go through the operator's payment-provider onboarding, never a plain database
        field.
      </p>
      {editable && (
        <Button
          size="sm"
          className="mt-3 h-8"
          disabled={busy != null}
          onClick={() => void run("payout", () => save({ payout: form }), "Payout details saved.")}
        >
          {busy === "payout" && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          Save payout details
        </Button>
      )}
    </Section>
  );
}

function VehicleSection({ app, run, busy }: Omit<SectionProps, "editable">) {
  const upsert = useMutation(api.ambulances.upsertAmbulance);
  const [form, setForm] = useState({
    registrationNumber: "",
    model: "",
    make: "",
    manufacturingYear: "",
    colour: "",
    type: "bls" as AmbulanceType,
    capacity: "2",
    driverName: app.profile.driver?.fullName ?? "",
    driverPhone: app.profile.driver?.phone ?? "",
    insuranceExpiryDate: "",
    fitnessExpiryDate: "",
    pucExpiryDate: "",
    permitExpiryDate: "",
    ambulanceAuthorizationExpiryDate: "",
  });

  return (
    <Section title="5. Ambulance vehicles" icon={Truck}>
      {(app.vehicles ?? []).length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No vehicles registered yet.</p>
      ) : (
        <ul className="space-y-2">
          {app.vehicles.map((vehicle) => (
            <li key={vehicle.id} className="rounded-xl border border-border p-3">
              <p className="text-[12px] font-bold">
                {vehicle.registrationNumber} · {AMBULANCE_TYPE_LABELS[vehicle.type as AmbulanceType] ?? vehicle.type}
              </p>
              <p className="text-[10.5px] text-muted-foreground">
                {[vehicle.make, vehicle.model, vehicle.manufacturingYear, vehicle.colour]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Insurance {vehicle.insuranceExpiryDate ? formatDate(vehicle.insuranceExpiryDate) : "missing"} ·
                Fitness {vehicle.fitnessExpiryDate ? formatDate(vehicle.fitnessExpiryDate) : "missing"}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-[11px] font-semibold">Add another vehicle</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Registration number">
            <Input value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} />
          </Field>
          <Field label="Ambulance category">
            <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value as AmbulanceType })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AMBULANCE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>{AMBULANCE_TYPE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Make">
            <Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field label="Manufacturing year">
            <Input inputMode="numeric" value={form.manufacturingYear} onChange={(e) => setForm({ ...form, manufacturingYear: e.target.value })} />
          </Field>
          <Field label="Colour">
            <Input value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })} />
          </Field>
          <Field label="Seating capacity">
            <Input inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          </Field>
          <Field label="Driver name">
            <Input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} />
          </Field>
          <Field label="Driver phone">
            <Input value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} />
          </Field>
          <Field label="Insurance expiry">
            <Input type="date" value={form.insuranceExpiryDate} onChange={(e) => setForm({ ...form, insuranceExpiryDate: e.target.value })} />
          </Field>
          <Field label="Fitness certificate expiry">
            <Input type="date" value={form.fitnessExpiryDate} onChange={(e) => setForm({ ...form, fitnessExpiryDate: e.target.value })} />
          </Field>
          <Field label="PUC expiry">
            <Input type="date" value={form.pucExpiryDate} onChange={(e) => setForm({ ...form, pucExpiryDate: e.target.value })} />
          </Field>
          <Field label="Commercial permit expiry">
            <Input type="date" value={form.permitExpiryDate} onChange={(e) => setForm({ ...form, permitExpiryDate: e.target.value })} />
          </Field>
          <Field label="Ambulance authorization expiry">
            <Input type="date" value={form.ambulanceAuthorizationExpiryDate} onChange={(e) => setForm({ ...form, ambulanceAuthorizationExpiryDate: e.target.value })} />
          </Field>
        </div>
        <Button
          size="sm"
          className="mt-3 h-8 gap-1.5"
          disabled={busy != null}
          onClick={() =>
            void run(
              "vehicle",
              () =>
                upsert({
                  registrationNumber: form.registrationNumber,
                  model: form.model,
                  make: form.make || undefined,
                  manufacturingYear: form.manufacturingYear ? Number(form.manufacturingYear) : undefined,
                  colour: form.colour || undefined,
                  type: form.type,
                  capacity: Number(form.capacity),
                  driverName: form.driverName,
                  driverPhone: form.driverPhone,
                  insuranceExpiryDate: form.insuranceExpiryDate || undefined,
                  fitnessExpiryDate: form.fitnessExpiryDate || undefined,
                  pucExpiryDate: form.pucExpiryDate || undefined,
                  permitExpiryDate: form.permitExpiryDate || undefined,
                  ambulanceAuthorizationExpiryDate: form.ambulanceAuthorizationExpiryDate || undefined,
                }),
              "Vehicle saved. Upload its documents next.",
            )
          }
        >
          {busy === "vehicle" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Save vehicle
        </Button>
      </div>
    </Section>
  );
}

function DocumentSection({ app, busy }: { app: AppData; busy: string | null }) {
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const attach = useMutation(api.documents.attachDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<GuardianDocumentKind>("registration_certificate");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [expiryDate, setExpiryDate] = useState("");
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("The file upload was rejected.");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      await attach({
        storageId,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
        purpose: "guardian_onboarding",
        documentKind: kind,
        expiryDate: expiryDate || undefined,
        ambulanceId: vehicleId ? (vehicleId as Id<"ambulances">) : undefined,
      });
      toast.success("Document uploaded for review");
    } catch (error) {
      toast.error(friendlyError(error, "Could not upload the document."));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Section title="6. Documents" icon={Upload}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Document type">
          <Select value={kind} onValueChange={(value) => setKind(value as GuardianDocumentKind)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GUARDIAN_DOCUMENT_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {GUARDIAN_DOCUMENT_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Linked vehicle (optional)">
          <Select value={vehicleId || "none"} onValueChange={(value) => setVehicleId(value === "none" ? "" : value)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Not vehicle-specific" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not vehicle-specific</SelectItem>
              {app.vehicles.map((vehicle) => (
                <SelectItem key={vehicle.id} value={vehicle.id}>
                  {vehicle.registrationNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Expiry date (if applicable)">
          <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </Field>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button
        size="sm"
        className="mt-3 h-8 gap-1.5"
        variant="outline"
        disabled={uploading || busy != null}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        Upload PDF / JPEG / PNG (max 5 MB)
      </Button>
      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
        The backend re-checks size, MIME type and the real file signature. Files are private
        and visible only to you and authorised administrators.
      </p>

      <ul className="mt-4 space-y-2 border-t border-border pt-3">
        {app.documents.length === 0 ? (
          <li className="text-[11px] text-muted-foreground">No documents uploaded yet.</li>
        ) : (
          app.documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5">
              <div>
                <p className="text-[11px] font-semibold">{doc.kindLabel ?? doc.fileName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {doc.fileName}
                  {doc.expiryDate ? ` · expires ${formatDate(doc.expiryDate)}` : ""}
                  {doc.reviewNote ? ` · ${doc.reviewNote}` : ""}
                </p>
              </div>
              <Badge variant={doc.status === "approved" ? "default" : doc.status === "rejected" ? "destructive" : "outline"} className="text-[9px]">
                {doc.status}
              </Badge>
            </li>
          ))
        )}
      </ul>
    </Section>
  );
}

type SectionProps = {
  app: AppData;
  run: RunFn;
  busy: string | null;
  editable: boolean;
};

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof ShieldCheck;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-3.5" />
        </span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  );
}
