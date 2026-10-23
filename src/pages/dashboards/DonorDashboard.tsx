import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import { RequestTimeline } from "@/components/lifelink/RequestTimeline";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  COMPONENT_LABELS,
  CITIES,
  formatDate,
  formatDateTime,
  formatRelative,
  type Component,
} from "@/lib/blood";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CalendarHeart,
  CheckCircle2,
  Clock3,
  Droplets,
  HeartHandshake,
  HeartPulse,
  History,
  Info,
  Loader2,
  MapPin,
  Phone,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Tab = "overview" | "matches" | "camps" | "history" | "profile";

export default function DonorDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const me = useQuery(api.profiles.me);
  const summary = useQuery(api.donors.summary);
  const nearby = useQuery(api.requests.donorNearby);
  const donationsData = useQuery(api.donors.myDonations);
  const camps = useQuery(api.camps.listPublic, {});
  const registrations = useQuery(api.camps.myRegistrations);

  const setAvailability = useMutation(api.profiles.setAvailability);
  const updateProfile = useMutation(api.profiles.updateDonorProfile);
  const createOffer = useMutation(api.requests.createOffer);
  const withdrawOffer = useMutation(api.requests.withdrawOffer);
  const registerCamp = useMutation(api.camps.register);
  const cancelCamp = useMutation(api.camps.cancelRegistration);

  const [switching, setSwitching] = useState(false);
  const [offerTarget, setOfferTarget] = useState<{ id: Id<"bloodRequests">; group: string } | null>(null);
  const [offerNote, setOfferNote] = useState("");
  const [offerBusy, setOfferBusy] = useState(false);
  const [campBusy, setCampBusy] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    phone: "",
    address: "",
    city: "Pune",
    area: "",
    preferredCenter: "",
    shareContact: true,
  });

  const donor = me?.donor;
  const registrationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const reg of registrations ?? []) map.set(String(reg.campId), reg.status);
    return map;
  }, [registrations]);

  useEffect(() => {
    if (!donor) return;
    setProfileForm({
      phone: donor.phone,
      address: donor.address,
      city: donor.city,
      area: donor.area ?? "",
      preferredCenter: donor.preferredCenter ?? "",
      shareContact: donor.shareContact,
    });
  }, [donor?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const demoPresent =
    (nearby ?? []).some((r) => r.isDemo) ||
    (camps ?? []).some((c) => c.isDemo) ||
    (donationsData?.donations ?? []).some((d) => d.isDemo);

  const handleToggleAvailability = async (value: boolean) => {
    setSwitching(true);
    try {
      await setAvailability({ available: value });
      toast.success(value ? "You are available for matching" : "Availability paused", {
        description: value
          ? "Compatible verified requests in your city can notify you."
          : "You will stop receiving new donor match notifications.",
      });
    } catch (err) {
      toast.error("Could not update availability", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSwitching(false);
    }
  };

  const submitOffer = async () => {
    if (!offerTarget) return;
    setOfferBusy(true);
    try {
      await createOffer({
        id: offerTarget.id,
        note: offerNote.trim() || undefined,
      });
      toast.success("Offer sent to the coordinating team", {
        description:
          "The requestor's name, phone and location are now unlocked for you. Your own contact details stay protected unless staff accept the offer.",
      });
      setOfferTarget(null);
      setOfferNote("");
    } catch (err) {
      toast.error("Could not send offer", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setOfferBusy(false);
    }
  };

  const withdrawn = async (id: Id<"bloodRequests">) => {
    try {
      await withdrawOffer({ id });
      toast("Offer withdrawn");
    } catch (err) {
      toast.error("Could not withdraw", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
  };

  const handleCamp = async (campId: Id<"bloodCamps">, registered: boolean) => {
    setCampBusy(campId);
    try {
      if (registered) {
        await cancelCamp({ campId });
        toast("Camp registration cancelled");
      } else {
        await registerCamp({ campId });
        toast.success("Camp registration confirmed", {
          description: "Bring a photo ID. Final eligibility is assessed on site.",
        });
      }
    } catch (err) {
      toast.error("Could not update registration", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setCampBusy(null);
    }
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileError(null);
    setProfileBusy(true);
    try {
      await updateProfile({
        phone: profileForm.phone,
        address: profileForm.address,
        city: profileForm.city,
        area: profileForm.area,
        preferredCenter: profileForm.preferredCenter,
        shareContact: profileForm.shareContact,
      });
      toast.success("Profile updated", { description: "Your shared donor record is up to date." });
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setProfileBusy(false);
    }
  };

  const navItems = [
    { key: "overview", label: "Overview", icon: HeartPulse },
    { key: "matches", label: "Matching requests", icon: Sparkles, badge: nearby?.length },
    { key: "camps", label: "Donation camps", icon: CalendarHeart },
    { key: "history", label: "Donation history", icon: History },
  ];

  const guidance = summary?.guidance ?? donationsData?.guidance;
  const eligibilityPct =
    guidance?.status === "ok" ? 100 : guidance?.status === "wait" ? 55 : 30;

  return (
    <DashboardShell
      roleLabel="Blood donor"
      roleKey="Donor workspace"
      title="Donor dashboard"
      subtitle="Keep your availability current, review compatible verified requests and control exactly what contact information coordinators can see."
      items={navItems}
      active={tab}
      onSelect={(key) => setTab(key as Tab)}
      onProfile={() => setTab("profile")}
      demoData={demoPresent}
      accentIcon={HeartHandshake}
      quickLinks={[
        { label: "Blood availability search", href: "/blood-search", icon: Droplets },
        { label: "Public donation camps", href: "/donation-camps", icon: CalendarHeart },
        { label: "Donation guidance", href: "/#awareness", icon: Info },
      ]}
    >
      {demoPresent && <DemoDataBanner />}

      {tab === "overview" && (
        <div className="mt-4 space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div aria-hidden className="absolute -right-16 -top-16 size-56 rounded-full bg-primary/[0.055]" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="relative">
                  <BloodGroupChip group={donor?.bloodGroup ?? "—"} size="lg" />
                  <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-card bg-teal-500">
                    <CheckCircle2 className="size-2.5 text-white" />
                  </span>
                </div>
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-primary">
                    {donor?.donorId ?? "Donor profile pending"}
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-extrabold leading-tight">
                    {donor?.fullName ?? user?.name ?? "Welcome"}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {donor?.city ?? "City not set"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3" />
                      Joined {donor ? formatDate(donor.createdAt) : "—"}
                    </span>
                    <VerifiedBadge />
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3 lg:min-w-[280px]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
                    Matching availability
                  </p>
                  <p className="mt-0.5 text-[12.5px] font-semibold">
                    {donor?.available ? "Available to help" : "Paused"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">You can withdraw anytime.</p>
                </div>
                <Switch
                  checked={donor?.available ?? false}
                  onCheckedChange={(v) => void handleToggleAvailability(v)}
                  disabled={switching || !donor}
                  aria-label="Toggle donor availability"
                />
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Donor ID" value={summary?.donorId ?? "—"} hint="Generated on the server" icon={UserRound} />
            <StatCard label="Total units given" value={summary?.totalUnits ?? 0} hint={`${summary?.donationCount ?? 0} recorded donation(s)`} icon={Droplets} tone="primary" />
            <StatCard label="Active offers" value={summary?.activeOffers ?? 0} hint="Awaiting coordinator review" icon={HeartHandshake} tone="teal" />
            <StatCard label="Nearby matches" value={nearby?.length ?? 0} hint="Compatible requests in the network" icon={Sparkles} tone="amber" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[14px] font-bold">Donation interval guidance</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Advisory only — medical staff decide eligibility.</p>
                </div>
                <ShieldCheck className="size-4 text-teal-600" />
              </div>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/8 font-display text-lg font-extrabold text-primary">
                  {summary?.donationCount ?? 0}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold">{guidance?.label ?? "No donation recorded"}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{guidance?.detail}</p>
                  <Progress value={eligibilityPct} className="mt-2 h-1.5" />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Last donation</p>
                  <p className="mt-1 text-[11.5px] font-semibold">{formatDate(summary?.lastDonationDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Preferred center</p>
                  <p className="mt-1 truncate text-[11.5px] font-semibold">{donor?.preferredCenter ?? "Not set"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Blood group</p>
                  <p className="mt-1 text-[11.5px] font-semibold">{donor?.bloodGroup ?? "—"}</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[14px] font-bold">Privacy by default</h2>
              <div className="mt-3 space-y-3">
                {[
                  { ok: true, text: "Your full address is never shown to requestors or the public." },
                  { ok: true, text: "Hospitals never receive your contact details." },
                  { ok: donor?.shareContact ?? false, text: "Authorized Red Cross coordinators can see your phone when you opt in." },
                  { ok: false, text: "Matching is advisory; donation eligibility is confirmed at the center." },
                ].map((item) => (
                  <div key={item.text} className="flex items-start gap-2">
                    <span className={item.ok ? "text-teal-600" : "text-amber-600"}>
                      {item.ok ? <CheckCircle2 className="mt-0.5 size-3.5" /> : <AlertTriangle className="mt-0.5 size-3.5" />}
                    </span>
                    <p className="text-[11.5px] leading-5 text-muted-foreground">{item.text}</p>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-4 w-full gap-1.5 text-[11.5px]" onClick={() => setTab("profile")}>
                <Settings2 className="size-3.5" />
                Manage privacy settings
              </Button>
            </section>
          </div>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-bold">Latest compatible requests</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Masked until an authorized coordinator coordinates a donation.</p>
              </div>
              <Button variant="ghost" size="sm" className="gap-1 text-[11px]" onClick={() => setTab("matches")}>
                View all
              </Button>
            </div>
            <div className="mt-3 space-y-2.5">
              {(nearby ?? []).slice(0, 2).map((request) => (
                <div key={request._id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <BloodGroupChip group={request.bloodGroup} size="sm" />
                    <div>
                      <p className="text-[12px] font-semibold">
                        {COMPONENT_LABELS[request.component as Component]} · {request.units} unit(s)
                      </p>
                      <p className="text-[10.5px] text-muted-foreground">
                        {request.hospitalName} · {request.city} · needed {formatDateTime(request.requiredBy)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={request.status} />
                    <UrgencyBadge urgency={request.urgency} />
                    <Button asChild size="sm" variant="outline" className="h-8 text-[11px]">
                      <Link to={`/requests/${request._id}`}>View</Link>
                    </Button>
                  </div>
                </div>
              ))}
              {nearby && nearby.length === 0 && (
                <EmptyState
                  icon={HeartPulse}
                  title="No compatible requests right now"
                  description="That can change quickly. Keep availability on so verified emergency requests can reach you."
                />
              )}
            </div>
          </section>
        </div>
      )}

      {tab === "matches" && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[14px] font-bold">Compatible verified requests</h2>                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    Blood group, state and country must match your profile. Routine requests stay inside your city;
                    only emergency requests can reach you from elsewhere in the state. Patient identities are withheld.
                  </p>
              </div>
              <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <ShieldCheck className="size-3.5 text-teal-600" />
                {nearby?.filter((r) => r.nearby).length ?? 0} in your city
              </div>
            </div>
          </div>

          {nearby === undefined ? (
            <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading compatible requests…
            </div>
          ) : nearby.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No matching requests in the network"
              description="LifeLink only surfaces compatible, verified requests. If your blood group is rare, keep availability on and check back after staff verify new requests."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/blood-search">Browse reported stock</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {nearby.map((request) => (
                <div key={request._id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <BloodGroupChip group={request.bloodGroup} />
                      <div>
                        <p className="text-[12.5px] font-bold">{COMPONENT_LABELS[request.component as Component]}</p>
                        <p className="text-[10.5px] text-muted-foreground">{request.requestId}</p>
                      </div>
                    </div>
                    <UrgencyBadge urgency={request.urgency} />
                  </div>
                  <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
                    <p className="flex items-center gap-1.5"><MapPin className="size-3" /> {request.city} · {request.hospitalName}</p>
                    <p className="flex items-center gap-1.5"><Droplets className="size-3" /> {request.units} unit(s) requested</p>
                    <p className="flex items-center gap-1.5"><Clock3 className="size-3" /> Needed by {formatDateTime(request.requiredBy)}</p>
                  </div>
                  {request.contactUnlocked ? (
                    <div className="mt-2.5 rounded-xl border border-teal-200 bg-teal-50/70 p-2.5 text-[10.5px] leading-5 text-teal-900">
                      <p className="font-semibold">Contact: {request.requestorName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" />
                          {request.requesterPhone ? (
                            <a className="hover:underline" href={`tel:${request.requesterPhone}`}>{request.requesterPhone}</a>
                          ) : (
                            "Phone not provided"
                          )}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {request.city}{request.area ? ` · ${request.area}` : ""}
                        </span>
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Requestor contact details unlock when you offer to help.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <StatusBadge status={request.status} />
                    {request.isDemo && <DemoBadge />}
                    <span className="ml-auto flex gap-1.5">
                      <Button asChild size="sm" variant="ghost" className="h-8 text-[11px]">
                        <Link to={`/requests/${request._id}`}>Details</Link>
                      </Button>
                      {request.myOfferStatus ? (
                        <span className="inline-flex h-8 items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2.5 text-[10.5px] font-semibold text-teal-800">
                          <CheckCircle2 className="size-3" /> Offer {request.myOfferStatus}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          className="h-8 gap-1 text-[11px]"
                          onClick={() => setOfferTarget({ id: request._id as Id<"bloodRequests">, group: request.bloodGroup })}
                        >
                          <HeartHandshake className="size-3" />
                          Offer to help
                        </Button>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "camps" && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-[14px] font-bold">Upcoming verified donation camps</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Registrations are stored once. Recording an actual donation is done by authorized staff after screening.
            </p>
          </div>
          {camps === undefined ? (
            <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading camps…
            </div>
          ) : camps.length === 0 ? (
            <EmptyState
              icon={CalendarHeart}
              title="No published camps yet"
              description="Verified organizations publish camps here. A demo network with sample camps can be loaded from the public search page."
              action={<Button asChild size="sm" variant="outline"><Link to="/donation-camps">Open public camps page</Link></Button>}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {camps.map((camp) => {
                const regStatus = registrationMap.get(String(camp._id));
                const registered = regStatus === "registered" || regStatus === "donated";
                const full = camp.registered >= camp.capacity;
                return (
                  <div key={camp._id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="text-[13px] font-bold">{camp.title}</h3>
                          {camp.isDemo && <DemoBadge />}
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">{camp.organizationName}</p>
                      </div>
                      <span className="rounded-full border border-border bg-muted/50 px-2 py-1 text-[9.5px] font-bold uppercase text-muted-foreground">
                        {camp.status}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
                      <p className="flex items-center gap-1.5"><CalendarHeart className="size-3" /> {formatDate(camp.date)} · {camp.startTime}–{camp.endTime}</p>
                      <p className="flex items-center gap-1.5"><MapPin className="size-3" /> {camp.venue}, {camp.city}</p>
                      <p className="flex items-center gap-1.5"><Users className="size-3" /> {camp.registered}/{camp.capacity} registered</p>
                    </div>
                    <Progress value={(camp.registered / camp.capacity) * 100} className="mt-2 h-1.5" />
                    <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                      <Button asChild size="sm" variant="ghost" className="h-8 text-[11px]"><Link to="/donation-camps">Details</Link></Button>
                      <Button
                        size="sm"
                        variant={registered ? "outline" : "default"}
                        className="ml-auto h-8 text-[11px]"
                        disabled={campBusy === camp._id || (!registered && full) || regStatus === "donated"}
                        onClick={() => void handleCamp(camp._id, registered)}
                      >
                        {campBusy === camp._id ? <Loader2 className="size-3 animate-spin" /> : null}
                        {regStatus === "donated" ? "Donation recorded" : registered ? "Cancel registration" : full ? "Camp full" : "Register"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Recorded donations" value={summary?.donationCount ?? 0} icon={History} />
            <StatCard label="Total units" value={summary?.totalUnits ?? 0} icon={Droplets} tone="primary" />
            <StatCard label="Last donation" value={formatDate(summary?.lastDonationDate)} icon={Clock3} tone="teal" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border p-4">
              <h2 className="text-[14px] font-bold">Donation history</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">Recorded only by authorized staff after a verified donation.</p>
            </div>
            {donationsData === undefined ? (
              <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading history…
              </div>
            ) : donationsData.donations.length === 0 ? (
              <EmptyState
                icon={History}
                title="No donations recorded yet"
                description="A donation appears here after an authorized organization records it. Self-reported donations are not accepted."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Component</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Recorded by</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {donationsData.donations.map((d) => (
                      <TableRow key={d._id}>
                        <TableCell className="font-medium">{formatDate(d.donationDate)}</TableCell>
                        <TableCell>{COMPONENT_LABELS[d.component as Component]}</TableCell>
                        <TableCell>{d.units}</TableCell>
                        <TableCell className="text-muted-foreground">{d.organizationName}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-muted-foreground">{d.note ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "profile" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-[14px] font-bold">Editable donor details</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Blood group and date of birth are identity-critical and require staff verification to change.
            </p>
            {profileError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{profileError}</AlertDescription>
              </Alert>
            )}
            <form className="mt-4 space-y-4" onSubmit={(e) => void saveProfile(e)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-phone">Phone</Label>
                  <Input id="profile-phone" value={profileForm.phone} onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-city">City</Label>
                  <Select value={profileForm.city} onValueChange={(v) => setProfileForm((p) => ({ ...p, city: v }))}>
                    <SelectTrigger id="profile-city" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{CITIES.map((city) => <SelectItem key={city} value={city}>{city}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="profile-address">Address / locality</Label>
                  <Input id="profile-address" value={profileForm.address} onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-area">Area</Label>
                  <Input id="profile-area" value={profileForm.area} onChange={(e) => setProfileForm((p) => ({ ...p, area: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-center">Preferred center</Label>
                  <Input id="profile-center" value={profileForm.preferredCenter} onChange={(e) => setProfileForm((p) => ({ ...p, preferredCenter: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/25 p-3">
                <div>
                  <p className="text-[12px] font-semibold">Share phone with Red Cross coordinators</p>
                  <p className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">
                    Only authorized Red Cross staff can see it. Hospitals and requestors cannot.
                  </p>
                </div>
                <Switch
                  checked={profileForm.shareContact}
                  onCheckedChange={(v) => setProfileForm((p) => ({ ...p, shareContact: v }))}
                  aria-label="Share phone with authorized coordinators"
                />
              </div>
              <Button type="submit" className="h-10" disabled={profileBusy}>
                {profileBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save permitted details
              </Button>
            </form>
          </section>

          <section className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[14px] font-bold">Identity & access</h2>
              <dl className="mt-3 space-y-2.5 text-[11.5px]">
                {[
                  ["Donor ID", summary?.donorId ?? "—"],
                  ["Blood group", donor?.bloodGroup ?? "—"],
                  ["Date of birth", formatDate(donor?.dateOfBirth)],
                  ["Role", "Donor (server verified)"],
                  ["Contact sharing", donor?.shareContact ? "Coordinator-only" : "Protected"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-amber-800">
                <AlertTriangle className="size-3.5" /> Medical safety
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-amber-900/80">
                Donation interval guidance is advisory. Haemoglobin, screening, medication
                and clinical factors determine eligibility. The donation center has final say.
              </p>
            </div>
          </section>
        </div>
      )}

      <Dialog open={offerTarget != null} onOpenChange={(open) => !open && setOfferTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offer to help</DialogTitle>
            <DialogDescription>
              This notifies the coordinating team for a compatible {offerTarget?.group} request.
              Your contact details are protected and only shared with authorized Red Cross
              staff when needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="offer-note">Message (optional)</Label>
            <Textarea
              id="offer-note"
              rows={3}
              value={offerNote}
              onChange={(e) => setOfferNote(e.target.value)}
              placeholder="Availability window or preferred center — do not include patient details."
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOfferTarget(null)}>Cancel</Button>
            <Button onClick={() => void submitOffer()} disabled={offerBusy} className="gap-2">
              {offerBusy ? <Loader2 className="size-4 animate-spin" /> : <HeartHandshake className="size-4" />}
              Send offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
