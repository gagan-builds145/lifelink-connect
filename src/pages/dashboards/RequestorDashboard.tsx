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
  COMPONENT_LABELS,
  CITIES,
  REQUESTOR_TYPES,
  REQUESTOR_TYPE_LABELS,
  formatDateTime,
  type Component,
  type RequestorType,
} from "@/lib/blood";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Droplets,
  FileCheck2,
  HeartPulse,
  Info,
  Loader2,
  MapPin,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Siren,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Tab = "overview" | "requests" | "new" | "profile";

export default function RequestorDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const me = useQuery(api.profiles.me);
  const requests = useQuery(api.requests.mine);
  const updateStatus = useMutation(api.requests.updateStatus);
  const updateProfile = useMutation(api.profiles.updateRequestorProfile);

  const [cancelBusy, setCancelBusy] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    phone: "",
    city: "Pune",
    requestorType: "family" as RequestorType,
  });

  const requestor = me?.requestor;
  const demoPresent = (requests ?? []).some((r) => r.isDemo);

  useEffect(() => {
    if (!requestor) return;
    setProfileForm({
      phone: requestor.phone,
      city: requestor.city,
      requestorType: requestor.requestorType,
    });
  }, [requestor?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const rows = requests ?? [];
    return {
      active: rows.filter((r) => ["pending", "under_verification", "approved", "dispatched"].includes(r.status)).length,
      pending: rows.filter((r) => r.status === "pending" || r.status === "under_verification").length,
      fulfilled: rows.filter((r) => r.status === "fulfilled" || r.status === "received").length,
      emergency: rows.filter((r) => r.urgency === "emergency" && !["fulfilled", "rejected", "cancelled"].includes(r.status)).length,
    };
  }, [requests]);

  const cancel = async (id: Id<"bloodRequests">, requestId: string) => {
    setCancelBusy(id);
    try {
      await updateStatus({
        id,
        status: "cancelled",
        note: "Cancelled by requestor from the dashboard.",
      });
      toast("Request cancelled", { description: `${requestId} is closed. No stock will be reserved.` });
    } catch (err) {
      toast.error("Could not cancel request", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setCancelBusy(null);
    }
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileError(null);
    setProfileBusy(true);
    try {
      await updateProfile({
        phone: profileForm.phone,
        city: profileForm.city,
        requestorType: profileForm.requestorType,
      });
      toast.success("Requestor profile updated");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setProfileBusy(false);
    }
  };

  const navItems = [
    { key: "overview", label: "Overview", icon: HeartPulse },
    { key: "requests", label: "My requests", icon: ClipboardList, badge: stats.active },
    { key: "new", label: "New request", icon: Plus },
    { key: "profile", label: "Profile", icon: Settings2 },
  ];

  return (
    <DashboardShell
      roleLabel="Blood requestor"
      roleKey="Requestor workspace"
      title="Requestor dashboard"
      subtitle="Raise a structured request, upload a prescription, and follow every verification and fulfilment step with real timestamps."
      items={navItems}
      active={tab}
      onSelect={(key) => setTab(key as Tab)}
      demoData={demoPresent}
      accentIcon={Droplets}
      quickLinks={[
        { label: "Verified blood search", href: "/blood-search", icon: Search },
        { label: "Donation camps", href: "/donation-camps", icon: CalendarPlus },
        { label: "How verification works", href: "/#how-it-works", icon: Info },
      ]}
    >
      {demoPresent && <DemoDataBanner />}

      {tab === "overview" && (
        <div className="mt-4 space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div aria-hidden className="absolute -right-10 -top-10 size-48 rounded-full bg-primary/[0.06]" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                  {requestor?.requestorId ?? "Requestor profile"}
                </p>
                <h2 className="mt-1.5 font-display text-2xl font-extrabold">
                  Welcome{requestor ? `, ${requestor.fullName}` : ""}
                </h2>
                <p className="mt-1.5 max-w-xl text-[12.5px] leading-6 text-muted-foreground">
                  Requests are verified by authorized Red Cross staff. A verified request
                  can be approved, reserved, dispatched and received — and you see each
                  update here.
                </p>
              </div>
              <Button className="w-fit gap-2" onClick={() => setTab("new")}>
                <Siren className="size-4" />
                New blood request
              </Button>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Active requests" value={stats.active} hint="In progress across the network" icon={ClipboardList} tone="primary" />
            <StatCard label="Awaiting verification" value={stats.pending} hint="Red Cross review pending" icon={Clock3} tone="amber" />
            <StatCard label="Fulfilled" value={stats.fulfilled} hint="Received or completed" icon={CheckCircle2} tone="teal" />
            <StatCard label="Emergencies active" value={stats.emergency} hint="Use only for genuine emergencies" icon={Siren} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[14px] font-bold">Recent requests</h2>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">The latest status from the shared database.</p>
                </div>
                <Button variant="ghost" size="sm" className="gap-1 text-[11px]" onClick={() => setTab("requests")}>
                  View all <ArrowRight className="size-3" />
                </Button>
              </div>
              <div className="mt-3 space-y-2.5">
                {requests === undefined ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading requests…
                  </div>
                ) : requests.length === 0 ? (
                  <EmptyState
                    icon={Droplets}
                    title="No requests yet"
                    description="When you submit a request it appears here with a server-generated request ID and a status timeline."
                    action={<Button size="sm" onClick={() => setTab("new")}><Plus className="mr-1.5 size-3.5" />Create your first request</Button>}
                  />
                ) : (
                  requests.slice(0, 3).map((request) => (
                    <div key={request._id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <BloodGroupChip group={request.bloodGroup} size="sm" />
                        <div>
                          <p className="text-[12px] font-semibold">
                            {request.requestId} · {COMPONENT_LABELS[request.component as Component]}
                          </p>
                          <p className="text-[10.5px] text-muted-foreground">
                            {request.hospitalName} · {request.units} unit(s) · needed {formatDateTime(request.requiredBy)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <UrgencyBadge urgency={request.urgency} />
                        <StatusBadge status={request.status} />
                        <Button asChild size="sm" variant="outline" className="h-8 text-[11px]">
                          <Link to={`/requests/${request._id}`}>Open</Link>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
                  <FileCheck2 className="size-4 text-primary" />
                  What happens next
                </h2>
                <ol className="mt-3 space-y-3">
                  {[
                    "Request is stored with a unique ID and queued for review.",
                    "Authorized Red Cross staff verify the hospital and document.",
                    "Compatible verified stock is reserved; final issue needs medical confirmation.",
                    "You get a notification for every status change.",
                  ].map((step, i) => (
                    <li key={step} className="flex gap-2.5">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{i + 1}</span>
                      <p className="text-[11.5px] leading-5 text-muted-foreground">{step}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-amber-800">
                  <ShieldCheck className="size-3.5" /> Verification protects everyone
                </p>
                <p className="mt-1.5 text-[11px] leading-5 text-amber-900/80">
                  Requests are never auto-approved. Availability is reported, not guaranteed.
                  For an immediate emergency, contact the hospital directly as well.
                </p>
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[14px] font-bold">All my requests</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Previous and active requests, newest first. Patient details stay private.
              </p>
            </div>
            <Button size="sm" className="w-fit gap-1.5" onClick={() => setTab("new")}>
              <Plus className="size-3.5" /> New request
            </Button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {requests === undefined ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading your requests…
              </div>
            ) : requests.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No requests submitted"
                description="Create a request with the patient reference, hospital, component and units. You can upload a prescription during submission."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request</TableHead>
                      <TableHead>Requirement</TableHead>
                      <TableHead>Hospital / city</TableHead>
                      <TableHead>Needed by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((request) => (
                      <TableRow key={request._id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <BloodGroupChip group={request.bloodGroup} size="sm" />
                            <div>
                              <p className="text-[11.5px] font-semibold">{request.requestId}</p>
                              <p className="text-[10px] text-muted-foreground">{formatDateTime(request.createdAt)}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-[11.5px] font-medium">{COMPONENT_LABELS[request.component as Component]}</p>
                          <p className="text-[10px] text-muted-foreground">{request.units} unit(s)</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-[11.5px]">{request.hospitalName}</p>
                          <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><MapPin className="size-2.5" />{request.city}</p>
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">{formatDateTime(request.requiredBy)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <StatusBadge status={request.status} />
                            <UrgencyBadge urgency={request.urgency} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button asChild size="sm" variant="outline" className="h-8 text-[10.5px]">
                              <Link to={`/requests/${request._id}`}>Details</Link>
                            </Button>
                            {["pending", "under_verification"].includes(request.status) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 gap-1 text-[10.5px] text-muted-foreground hover:text-primary"
                                disabled={cancelBusy === request._id}
                                onClick={() => void cancel(request._id as Id<"bloodRequests">, request.requestId)}
                              >
                                {cancelBusy === request._id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                                Cancel
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-extrabold">Submit a blood request</h2>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  Required fields are validated here and again on the server. You will get
                  a unique request ID immediately.
                </p>
              </div>
              <span className="hidden shrink-0 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-teal-800 sm:inline-flex">
                Shared request ledger
              </span>
            </div>
            <div className="mt-5">
              <RequestForm
                source="requestor"
                defaultRequestorName={requestor?.fullName ?? user?.name ?? ""}
                defaultPhone={requestor?.phone ?? ""}
                defaultCity={requestor?.city ?? user?.city ?? "Pune"}
                defaultEmail={user?.email ?? ""}
                onCreated={() => setTab("requests")}
              />
            </div>
          </section>

          <aside className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h3 className="text-[12.5px] font-bold">Before you submit</h3>
              <ul className="mt-3 space-y-2.5">
                {[
                  "Confirm the hospital can receive the component.",
                  "Use the exact patient reference from hospital records.",
                  "Attach a prescription if one is available.",
                  "Mark Emergency only when delay risks a life.",
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-teal-600" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                <AlertTriangle className="size-3.5 text-amber-600" /> Safety
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                LifeLink cannot guarantee stock. Blood group labels alone do not guarantee
                compatibility; screening and cross-matching are mandatory.
              </p>
            </div>
            <Button asChild variant="outline" className="w-full gap-1.5 text-[11.5px]">
              <Link to="/blood-search"><Search className="size-3.5" /> Check reported availability</Link>
            </Button>
          </aside>
        </div>
      )}

      {tab === "profile" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-[14px] font-bold">Requestor details</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              The requestor ID is generated by the server and cannot be edited.
            </p>
            {profileError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{profileError}</AlertDescription>
              </Alert>
            )}
            <form className="mt-4 space-y-4" onSubmit={(e) => void saveProfile(e)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Requestor ID</Label>
                  <Input value={requestor?.requestorId ?? "—"} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-prof-phone">Phone</Label>
                  <Input id="req-prof-phone" value={profileForm.phone} onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-prof-city">City</Label>
                  <Select value={profileForm.city} onValueChange={(v) => setProfileForm((p) => ({ ...p, city: v }))}>
                    <SelectTrigger id="req-prof-city" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{CITIES.map((city) => <SelectItem key={city} value={city}>{city}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-prof-type">Relationship</Label>
                  <Select value={profileForm.requestorType} onValueChange={(v) => setProfileForm((p) => ({ ...p, requestorType: v as RequestorType }))}>
                    <SelectTrigger id="req-prof-type" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REQUESTOR_TYPES.map((type) => <SelectItem key={type} value={type}>{REQUESTOR_TYPE_LABELS[type]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" className="h-10" disabled={profileBusy}>
                {profileBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save changes
              </Button>
            </form>
          </section>

          <section className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[14px] font-bold">Account & privacy</h2>
              <dl className="mt-3 space-y-2.5 text-[11.5px]">
                {[
                  ["Role", "Blood requestor (server verified)"],
                  ["Email", user?.email ?? "Guest session"],
                  ["Request ID format", "LL-REQ-####"],
                  ["Public exposure", "None — patient data is never public"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="max-w-[55%] truncate text-right font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
                <UserRound className="size-3.5" /> Need a donor account too?
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                Each account holds one primary role. Use a separate verified email to
                register as a donor so permissions stay clear.
              </p>
            </div>
          </section>
        </div>
      )}
    </DashboardShell>
  );
}
