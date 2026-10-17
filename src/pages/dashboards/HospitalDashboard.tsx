import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import { RequestForm } from "@/components/lifelink/RequestForm";
import {
  BloodGroupChip,
  DemoBadge,
  DemoDataBanner,
  EmptyState,
  StatCard,
  StatusBadge,
  UrgencyBadge,
  VerifiedBadge,
} from "@/components/lifelink/ui-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useAuth } from "@/hooks/use-auth";
import {
  BLOOD_GROUPS,
  COMPONENTS,
  COMPONENT_LABELS,
  CITIES,
  formatDate,
  formatDateTime,
  type Component,
} from "@/lib/blood";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Building2,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Droplets,
  Hospital,
  Info,
  Loader2,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Siren,
  Stethoscope,
  Truck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Tab = "overview" | "requests" | "new" | "availability" | "profile";

export default function HospitalDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const me = useQuery(api.profiles.me);
  const requests = useQuery(api.requests.mine);
  const analytics = useQuery(api.stats.staffAnalytics, { windowDays: 30 });
  const stock = useQuery(api.inventory.publicStock, {});
  const updateStatus = useMutation(api.requests.updateStatus);
  const updateOrganization = useMutation(api.profiles.updateMyOrganization);

  const [cancelBusy, setCancelBusy] = useState<string | null>(null);
  const [stockGroup, setStockGroup] = useState("all");
  const [stockCity, setStockCity] = useState("all");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    contactPerson: "",
    phone: "",
    address: "",
    city: "Pune",
    area: "",
  });

  const org = me?.organization;
  const demoPresent = analytics?.demoDataPresent || (stock ?? []).some((s) => s.isDemo);

  useEffect(() => {
    if (!org) return;
    setProfileForm({
      contactPerson: org.contactPerson,
      phone: org.phone,
      address: org.address,
      city: org.city,
      area: org.area ?? "",
    });
  }, [org?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const rows = requests ?? [];
    return {
      current: rows.filter((r) => ["pending", "under_verification", "approved", "dispatched"].includes(r.status)).length,
      emergency: rows.filter((r) => r.urgency === "emergency" && !["received", "fulfilled", "rejected", "cancelled"].includes(r.status)).length,
      pending: rows.filter((r) => r.status === "pending" || r.status === "under_verification").length,
      approved: rows.filter((r) => r.status === "approved").length,
      dispatched: rows.filter((r) => r.status === "dispatched").length,
      received: rows.filter((r) => r.status === "received" || r.status === "fulfilled").length,
    };
  }, [requests]);

  const filteredStock = useMemo(
    () =>
      (stock ?? [])
        .filter((s) => (stockGroup === "all" ? true : s.bloodGroup === stockGroup))
        .filter((s) => (stockCity === "all" ? true : s.city === stockCity)),
    [stock, stockGroup, stockCity],
  );

  const cancel = async (id: Id<"bloodRequests">, requestId: string) => {
    setCancelBusy(id);
    try {
      await updateStatus({ id, status: "cancelled", note: "Cancelled by hospital staff." });
      toast("Hospital request cancelled", { description: `${requestId} is closed.` });
    } catch (err) {
      toast.error("Could not cancel request", { description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setCancelBusy(null);
    }
  };

  const navItems = [
    { key: "overview", label: "Overview", icon: Hospital },
    { key: "requests", label: "Hospital requests", icon: ClipboardList, badge: stats.current },
    { key: "new", label: "New request", icon: Plus },
    { key: "availability", label: "Partner availability", icon: Search },
    { key: "profile", label: "Hospital profile", icon: Settings2 },
  ];

  return (
    <DashboardShell
      roleLabel="Hospital"
      roleKey={org?.orgId ?? "Hospital workspace"}
      title="Hospital dashboard"
      subtitle={
        org
          ? `${org.name} · verified hospital. Requests, dispatch and receipt use the same inventory ledger as the Red Cross dashboard.`
          : "Your hospital profile is being prepared."
      }
      items={navItems}
      active={tab}
      onSelect={(key) => setTab(key as Tab)}
      demoData={demoPresent}
      accentIcon={Building2}
      quickLinks={[
        { label: "Public blood search", href: "/blood-search", icon: Droplets },
        { label: "Donation camps", href: "/donation-camps", icon: CalendarPlus },
        { label: "Verification workflow", href: "/#how-it-works", icon: Info },
      ]}
    >
      {demoPresent && <DemoDataBanner />}

      {tab === "overview" && (
        <div className="mt-4 space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/8 text-primary">
                  <Hospital className="size-5" />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Verified hospital</p>
                  <h2 className="mt-0.5 font-display text-xl font-extrabold">{org?.name ?? "Hospital profile"}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><MapPin className="size-3" />{org?.city ?? "—"}</span>
                    <span className="flex items-center gap-1"><ShieldCheck className="size-3 text-teal-600" />Verified organization</span>
                    <span className="flex items-center gap-1"><RefreshCw className="size-3" />Shared ledger</span>
                  </p>
                </div>
              </div>
              <Button className="w-fit gap-2" onClick={() => setTab("new")}>
                <Siren className="size-4" /> Submit hospital request
              </Button>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Current requests" value={stats.current} hint="Pending through dispatched" icon={ClipboardList} tone="primary" />
            <StatCard label="Emergencies" value={stats.emergency} hint="Active emergency requests" icon={Siren} />
            <StatCard label="Dispatched" value={stats.dispatched} hint="Awaiting your receipt confirmation" icon={Truck} tone="amber" />
            <StatCard label="Received / fulfilled" value={stats.received} hint="Closed in the shared ledger" icon={PackageCheck} tone="teal" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[14px] font-bold">Active hospital requests</h2>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">Only your hospital's requests and requests assigned to you.</p>
                </div>
                <Button variant="ghost" size="sm" className="gap-1 text-[11px]" onClick={() => setTab("requests")}>All requests <ArrowRight className="size-3" /></Button>
              </div>
              <div className="mt-3 space-y-2.5">
                {requests === undefined ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading requests…</div>
                ) : requests.length === 0 ? (
                  <EmptyState
                    icon={ClipboardList}
                    title="No hospital requests yet"
                    description="Submit a request with patient ID, component and units. Red Cross staff verify and reserve stock before dispatch."
                    action={<Button size="sm" onClick={() => setTab("new")}>Create hospital request</Button>}
                  />
                ) : (
                  requests.slice(0, 3).map((r) => (
                    <div key={r._id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <BloodGroupChip group={r.bloodGroup} size="sm" />
                        <div>
                          <p className="text-[12px] font-semibold">{r.requestId} · {COMPONENT_LABELS[r.component as Component]}</p>
                          <p className="text-[10.5px] text-muted-foreground">Patient ref {r.patientRef} · {r.units} unit(s) · needed {formatDateTime(r.requiredBy)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <UrgencyBadge urgency={r.urgency} />
                        <StatusBadge status={r.status} />
                        <Button asChild size="sm" variant="outline" className="h-8 text-[11px]"><Link to={`/requests/${r._id}`}>Open</Link></Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
                  <PackageCheck className="size-4 text-teal-600" />
                  Receipt workflow
                </h2>
                <ol className="mt-3 space-y-2.5">
                  {[
                    "Red Cross verifies and reserves compatible stock.",
                    "Dispatch is recorded; the batch leaves the branch ledger.",
                    "Only this hospital can confirm receipt.",
                    "Requestor and Red Cross are notified of each update.",
                  ].map((step, i) => (
                    <li key={step} className="flex gap-2.5">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{i + 1}</span>
                      <p className="text-[11px] leading-5 text-muted-foreground">{step}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-amber-800">
                  <ShieldCheck className="size-3.5" /> Clinical responsibility
                </p>
                <p className="mt-1.5 text-[11px] leading-5 text-amber-900/80">
                  Reported availability is advisory. Cross-matching, screening and final
                  transfusion decisions remain with your clinical team.
                </p>
              </div>
              <Button asChild variant="outline" className="w-full gap-1.5 text-[11.5px]">
                <Link to="/blood-search"><Search className="size-3.5" /> Search partner availability</Link>
              </Button>
            </section>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[14px] font-bold">Hospital request history</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Each status change is attributed to an authorized actor. Confirm receipt from the request page when dispatched.
              </p>
            </div>
            <Button size="sm" className="w-fit gap-1.5" onClick={() => setTab("new")}><Plus className="size-3.5" /> New request</Button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {requests === undefined ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading requests…</div>
            ) : requests.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No requests match your hospital" description="Submit a hospital request to start a verified workflow." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request</TableHead>
                      <TableHead>Patient ref</TableHead>
                      <TableHead>Requirement</TableHead>
                      <TableHead>Needed by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r._id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <BloodGroupChip group={r.bloodGroup} size="sm" />
                            <div>
                              <p className="text-[11.5px] font-semibold">{r.requestId}</p>
                              <p className="text-[9.5px] text-muted-foreground">{r.isDemo ? "Demo Data" : r.source}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-[10.5px] text-muted-foreground">{r.patientRef}</TableCell>
                        <TableCell>
                          <p className="text-[11px]">{COMPONENT_LABELS[r.component as Component]}</p>
                          <p className="text-[9.5px] text-muted-foreground">{r.units} unit(s)</p>
                        </TableCell>
                        <TableCell className="text-[10.5px] text-muted-foreground">{formatDateTime(r.requiredBy)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={r.status} />
                            <UrgencyBadge urgency={r.urgency} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button asChild size="sm" variant="outline" className="h-7 text-[10px]"><Link to={`/requests/${r._id}`}>Open</Link></Button>
                            {(r.status === "pending" || r.status === "under_verification") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] text-muted-foreground hover:text-primary"
                                disabled={cancelBusy === r._id}
                                onClick={() => void cancel(r._id as Id<"bloodRequests">, r.requestId)}
                              >
                                {cancelBusy === r._id ? <Loader2 className="size-3 animate-spin" /> : "Cancel"}
                              </Button>
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
        </div>
      )}

      {tab === "new" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <h2 className="font-display text-xl font-extrabold">Submit a hospital blood request</h2>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              The request is created against your verified hospital organization. It enters
              the common verification queue and can be tracked by the requestor and Red Cross.
            </p>
            {org ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-[11px] text-teal-900">
                <ShieldCheck className="size-4 shrink-0" />
                Submitting as <strong>{org.name}</strong> ({org.orgId}) · {org.city}
              </div>
            ) : (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>No verified hospital organization is linked. Finish hospital registration first.</AlertDescription>
              </Alert>
            )}
            <div className="mt-5">
              <RequestForm
                source="hospital"
                defaultHospitalName={org?.name ?? ""}
                defaultCity={org?.city ?? "Pune"}
                defaultRequestorName={org?.contactPerson ?? user?.name ?? ""}
                defaultPhone={org?.phone ?? ""}
                defaultEmail={org?.email ?? user?.email ?? ""}
                onCreated={() => setTab("requests")}
              />
            </div>
          </section>

          <aside className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h3 className="flex items-center gap-1.5 text-[12.5px] font-bold"><Stethoscope className="size-3.5 text-primary" /> Required before submission</h3>
              <ul className="mt-2.5 space-y-2">
                {[
                  "Patient ID / hospital reference",
                  "Requesting doctor and ward contact",
                  "Component, units and required time",
                  "Prescription or hospital request document if available",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-teal-600" />{item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <h3 className="text-[12.5px] font-bold">Statuses you will see</h3>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {["pending", "under_verification", "approved", "dispatched", "received", "rejected"].map((s) => (
                  <StatusBadge key={s} status={s} />
                ))}
              </div>
              <p className="mt-2.5 text-[10.5px] leading-5 text-muted-foreground">
                Receipt is only possible after Red Cross records dispatch to your hospital.
              </p>
            </div>
          </aside>
        </div>
      )}

      {tab === "availability" && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-[14px] font-bold">Reported partner availability</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Verified Red Cross branches and blood banks only. Stock is reported, not reserved for your hospital.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={stockGroup} onValueChange={setStockGroup}>
                <SelectTrigger className="h-9 w-[130px] text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All groups</SelectItem>
                  {BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={stockCity} onValueChange={setStockCity}>
                <SelectTrigger className="h-9 w-[140px] text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cities</SelectItem>
                  {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {stock === undefined ? (
            <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading reported availability…</div>
          ) : filteredStock.length === 0 ? (
            <EmptyState icon={Search} title="No reported stock matches" description="Try another city or blood group. Only verified, unexpired stock appears." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredStock.map((item) => (
                <div key={`${item.organizationId}-${item.bloodGroup}-${item.component}`} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <BloodGroupChip group={item.bloodGroup} size="md" />
                      <div>
                        <p className="text-[12px] font-semibold leading-4">{item.organizationName}</p>
                        <p className="mt-0.5 text-[9.5px] text-muted-foreground">{item.city} · {item.orgId}</p>
                      </div>
                    </div>
                    {item.isDemo && <DemoBadge />}
                  </div>
                  <p className="mt-3 text-[11px]">{COMPONENT_LABELS[item.component as Component]}</p>
                  <div className="mt-2 flex items-center justify-between text-[10.5px]">
                    <span className="font-semibold text-teal-700">{item.units} unit(s) reported</span>
                    <span className="text-muted-foreground">updated {formatDate(item.lastUpdated)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                    <VerifiedBadge />
                    <a href={`tel:${item.organizationId}`} className="hidden" aria-hidden />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-border bg-muted/30 p-3 text-[10.5px] leading-5 text-muted-foreground">
            <Info className="mr-1 inline size-3" />
            Contact partner organizations through official channels. LifeLink does not
            expose donor identity or promise that reported stock remains available.
          </div>
        </div>
      )}

      {tab === "profile" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-[14px] font-bold">Hospital profile</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Organization ID and verification status are server-controlled. Contact the
              LifeLink administrator to change legal identity details.
            </p>
            {profileError && <Alert variant="destructive" className="mt-3"><AlertDescription>{profileError}</AlertDescription></Alert>}
            <form
              className="mt-4 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setProfileError(null);
                setProfileBusy(true);
                try {
                  await updateOrganization(profileForm);
                  toast.success("Hospital profile updated");
                } catch (err) {
                  setProfileError(err instanceof Error ? err.message : "Could not save profile.");
                } finally {
                  setProfileBusy(false);
                }
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Hospital ID</Label>
                  <Input value={org?.orgId ?? "—"} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label>Verification</Label>
                  <Input value={org ? "Verified organization" : "Pending"} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hosp-contact">Contact person</Label>
                  <Input id="hosp-contact" value={profileForm.contactPerson} onChange={(e) => setProfileForm((p) => ({ ...p, contactPerson: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hosp-phone">Phone</Label>
                  <Input id="hosp-phone" value={profileForm.phone} onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="hosp-address">Address</Label>
                  <Input id="hosp-address" value={profileForm.address} onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hosp-city">City</Label>
                  <Select value={profileForm.city} onValueChange={(v) => setProfileForm((p) => ({ ...p, city: v }))}>
                    <SelectTrigger id="hosp-city" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hosp-area">Area</Label>
                  <Input id="hosp-area" value={profileForm.area} onChange={(e) => setProfileForm((p) => ({ ...p, area: e.target.value }))} />
                </div>
              </div>
              <Button type="submit" className="h-10" disabled={profileBusy}>
                {profileBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save profile
              </Button>
            </form>
          </section>

          <section className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[14px] font-bold">Account</h2>
              <dl className="mt-3 space-y-2.5 text-[11.5px]">
                {[
                  ["Hospital", org?.name ?? "—"],
                  ["Official email", org?.email ?? "—"],
                  ["Role", "Hospital (server verified)"],
                  ["Sign-in", user?.email ?? "Guest session"],
                  ["Data access", "Own + assigned requests only"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="max-w-[60%] truncate text-right font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-primary"><ShieldCheck className="size-3.5" /> Shared record</p>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                Your requests and receipt confirmations update the same request record used
                by Red Cross and the requestor. There is no separate hospital stock copy.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-muted-foreground"><Clock3 className="size-3.5" /> Demo records</p>
              <p className="mt-1.5 text-[10.5px] leading-5 text-muted-foreground">
                Public demo inventory is labelled. It never counts as this hospital's stock
                or as a confirmed reservation.
              </p>
            </div>
          </section>
        </div>
      )}
    </DashboardShell>
  );
}
