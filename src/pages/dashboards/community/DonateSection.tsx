import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DonorMedicalRecordsSection } from "./DonorMedicalRecordsSection";
import type { FunctionReturnType } from "convex/server";
import { ActivateDonorPanel } from "@/components/lifelink/community/Activations";
import { SectionHeading, SkeletonPanel } from "@/components/lifelink/community/shared";
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
import {
  COMPONENT_LABELS,
  CITIES,
  formatDate,
  formatDateTime,
  formatRelative,
  type Component,
} from "@/lib/blood";
import { friendlyError } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CalendarHeart,
  CheckCircle2,
  Clock3,
  Droplets,
  HeartHandshake,

  History,
  Loader2,
  MapPin,
  Phone,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,


import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { SectionKey } from "../CommunityDashboard";

type DonorProfile = NonNullable<FunctionReturnType<typeof api.profiles.me>>["donor"];

type DonateTab = "home" | "invitations" | "matches" | "camps" | "history" | "profile" | "medical-records";

const TABS: { key: DonateTab; label: string }[] = [
  { key: "home", label: "Donor home" },
  { key: "invitations", label: "Invitations" },
  { key: "matches", label: "Matching requests" },
  { key: "camps", label: "Camps" },
  { key: "history", label: "History" },
  { key: "profile", label: "Donor profile" },
  { key: "medical-records", label: "Medical records" },
];

function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: DonateTab; label: string }[];
  active: DonateTab;
  onSelect: (key: DonateTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Donor functionality"
      className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          type="button"
          aria-selected={active === tab.key}
          onClick={() => onSelect(tab.key)}
          className={
            active === tab.key
              ? "whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-[11.5px] font-semibold text-background"
              : "whitespace-nowrap rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function DonateSection({
  donor,
  onNavigate,
}: {
  donor: DonorProfile;
  onNavigate: (section: SectionKey) => void;
}) {
  const [tab, setTab] = useState<DonateTab>("home");
  const [consentHours, setConsentHours] = useState(24);
  const [consentBusy, setConsentBusy] = useState(false);
  const [invitationBusy, setInvitationBusy] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [offerTarget, setOfferTarget] = useState<{ id: Id<"bloodRequests">; group: string } | null>(
    null,
  );
  const [offerNote, setOfferNote] = useState("");
  const [offerBusy, setOfferBusy] = useState(false);
  const [campBusy, setCampBusy] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<{
    phone: string;
    address: string;
    city: string;
    area: string;
    preferredCenter: string;
    shareContact: boolean;
  } | null>(null);

  const me = useQuery(api.profiles.me);
  const summary = useQuery(api.donors.summary);
  const nearby = useQuery(api.requests.donorNearby);
  const donationsData = useQuery(api.donors.myDonations);
  const camps = useQuery(api.camps.listPublic, {});
  const registrations = useQuery(api.camps.myRegistrations);
  const invitations = useQuery(api.donorFallback.myInvitations);
  const locationConsent = useQuery(api.donorFallback.myConsent);

  const setAvailability = useMutation(api.profiles.setAvailability);
  const updateProfile = useMutation(api.profiles.updateDonorProfile);
  const createOffer = useMutation(api.requests.createOffer);
  const registerCamp = useMutation(api.camps.register);
  const cancelCamp = useMutation(api.camps.cancelRegistration);
  const setLocationConsent = useMutation(api.donorFallback.setLocationConsent);
  const respondToInvitation = useMutation(api.donorFallback.respond);

  const profileForm = profileDraft ?? {
    phone: donor?.phone ?? "",
    address: donor?.address ?? "",
    city: donor?.city ?? "Pune",
    area: donor?.area ?? "",
    preferredCenter: donor?.preferredCenter ?? "",
    shareContact: donor?.shareContact ?? true,
  };
  const updateProfileForm = (patch: Partial<typeof profileForm>) =>
    setProfileDraft((current) => ({ ...(current ?? profileForm), ...patch }));

  const registrationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const registration of registrations ?? []) {
      map.set(String(registration.campId), registration.status);
    }
    return map;
  }, [registrations]);

  const pendingInvitations = (invitations ?? []).filter((invite) => invite.status === "sent").length;
  const demoPresent =
    (nearby ?? []).some((request) => request.isDemo) ||
    (camps ?? []).some((camp) => camp.isDemo) ||
    (donationsData?.donations ?? []).some((donation) => donation.isDemo);

  const guidance = summary?.guidance ?? donationsData?.guidance;
  const eligibilityPct = guidance?.status === "ok" ? 100 : guidance?.status === "wait" ? 55 : 30;

  if (!donor) {
    return (
      <div className="space-y-5">
        <SectionHeading
          eyebrow="Donate blood"
          title="Donor functionality is not active yet"
          description="Blood requests still work on this account. Add a donor profile whenever you are ready — it attaches to the same identity."
        />
        <ActivateDonorPanel />
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-display text-base font-bold">What you get</h3>
            <ul className="mt-3 space-y-2 text-[11.5px] leading-5 text-muted-foreground">
              {[
                "Availability controls and verified request matching in your city.",
                "Red Cross donation invitations with temporary location consent.",
                "Donation history, eligibility guidance and camp registration.",
                "Full control over whether coordinators can see your phone.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-5">
                          <HeartPulse="size-5 text-primary" />
            <h3 className="mt-2 font-display text-base font-bold">Requesting blood still works</h3>
            <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
              Your requestor profile is separate from donor access. Continue tracking requests
              while you decide.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => onNavigate("request")}
            >
              <Droplets className="size-3.5" /> Go to request blood
            </Button>
          </section>
        </div>
      </div>
    );
  }

  const handleConsent = async (shareLocation: boolean) => {
    setConsentBusy(true);
    try {
      await setLocationConsent({ shareLocation, hours: consentHours });
      toast.success(shareLocation ? "Temporary location sharing enabled" : "Location sharing revoked", {
        description: shareLocation
          ? `Only for the next ${consentHours} hour(s). You can revoke this at any time.`
          : "Your location is no longer shared with the donor fallback search.",
      });
    } catch (error) {
      toast.error("Could not update consent", { description: friendlyError(error) });
    } finally {
      setConsentBusy(false);
    }
  };

  const handleInvitation = async (
    invitationId: Id<"donorInvitations">,
    action: "accept" | "decline",
  ) => {
    setInvitationBusy(String(invitationId));
    try {
      const result = await respondToInvitation({ invitationId, action });
      if (action === "accept") {
        toast.success("Invitation accepted", {
          description: result.centerName
            ? `Appointment at ${result.centerName}. Final eligibility and screening happen there — blood is not stock until it is collected and released.`
            : "The coordinating team will confirm your appointment. Blood is not stock until it is collected and released.",
        });
      } else {
        toast("Invitation declined", {
          description: "The network will keep looking for other eligible donors.",
        });
      }
    } catch (error) {
      toast.error("Could not submit your response", { description: friendlyError(error) });
    } finally {
      setInvitationBusy(null);
    }
  };

  const handleToggleAvailability = async (value: boolean) => {
    setSwitching(true);
    try {
      await setAvailability({ available: value });
      toast.success(value ? "You are available for matching" : "Availability paused", {
        description: value
          ? "Compatible verified requests in your city can notify you."
          : "You will stop receiving new donor match notifications.",
      });
    } catch (error) {
      toast.error("Could not update availability", {
        description: friendlyError(error, "Please try again."),
      });
    } finally {
      setSwitching(false);
    }
  };

  const submitOffer = async () => {
    if (!offerTarget) return;
    setOfferBusy(true);
    try {
      await createOffer({ id: offerTarget.id, note: offerNote.trim() || undefined });
      toast.success("Offer sent to the coordinating team", {
        description:
          "The requestor's name, phone and location are now unlocked for you. Your own contact details stay protected unless staff accept the offer.",
      });
      setOfferTarget(null);
      setOfferNote("");
    } catch (error) {
      toast.error("Could not send offer", {
        description: friendlyError(error, "Please try again."),
      });
    } finally {
      setOfferBusy(false);
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
    } catch (error) {
      toast.error("Could not update registration", {
        description: friendlyError(error, "Please try again."),
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
      setProfileDraft(null);
      toast.success("Donor profile updated");
    } catch (error) {
      setProfileError(friendlyError(error, "Could not save profile."));
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Donate blood"
        title="Donor functionality"
        description="Availability, invitations, compatible requests, camps and history — all inside this account."
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTab("invitations")}>
            <HeartHandshake className="size-3.5" />
            {pendingInvitations > 0 ? `${pendingInvitations} invitation(s)` : "Invitations"}
          </Button>
        }
      />

      {demoPresent && <DemoDataBanner />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabBar tabs={TABS} active={tab} onSelect={setTab} />
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Matching availability
            </p>
            <p className="text-[11px] font-semibold">{donor.available ? "Available" : "Paused"}</p>
          </div>
          <Switch
            checked={donor.available}
            onCheckedChange={(value) => void handleToggleAvailability(value)}
            disabled={switching}
            aria-label="Toggle donor availability"
          />
        </div>
      </div>

      {tab === "home" && (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div aria-hidden className="absolute -right-16 -top-16 size-56 rounded-full bg-primary/[0.055]" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <BloodGroupChip group={donor.bloodGroup} size="lg" />
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-primary">
                    {donor.donorId}
                  </p>
                  <h2 className="mt-0.5 font-display text-xl font-extrabold">{donor.fullName}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" /> {donor.city}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3" /> Joined {formatDate(donor.createdAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="size-3 text-teal-600" /> Server verified
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTab("history")}>
                  <History className="size-3.5" /> Donation history
                </Button>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setTab("profile")}>
                  <Settings2 className="size-3.5" /> Edit details
                </Button>
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total units given"
              value={summary?.totalUnits ?? 0}
              hint={`${summary?.donationCount ?? 0} recorded donation(s)`}
              icon={Droplets}
              tone="primary"
            />
            <StatCard
              label="Active offers"
              value={summary?.activeOffers ?? 0}
              hint="Awaiting coordinator review"
              icon={HeartHandshake}
              tone="teal"
            />
            <StatCard
              label="Nearby matches"
              value={nearby?.length ?? 0}
              hint="Compatible verified requests"
              icon={Sparkles}
              tone="amber"
            />
            <StatCard
              label="Open invitations"
              value={pendingInvitations}
              hint={`${invitations?.length ?? 0} received in total`}
              icon={CalendarHeart}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[14px] font-bold">Donation interval guidance</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Advisory only — medical staff decide eligibility.
                  </p>
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
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Last donation</p>
                  <p className="mt-1 text-[11px] font-semibold">{formatDate(summary?.lastDonationDate)}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Preferred centre</p>
                  <p className="mt-1 truncate text-[11px] font-semibold">{donor.preferredCenter ?? "Not set"}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Blood group</p>
                  <p className="mt-1 text-[11px] font-semibold">{donor.bloodGroup}</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[14px] font-bold">Privacy by default</h2>
              <div className="mt-3 space-y-2.5">
                {[
                  { ok: true, text: "Your full address is never shown to requestors or the public." },
                  { ok: true, text: "Hospitals never receive your contact details." },
                  { ok: donor.shareContact, text: "Authorized Red Cross coordinators can see your phone when you opt in." },
                  { ok: false, text: "Matching is advisory; donation eligibility is confirmed at the centre." },
                ].map((item) => (
                  <div key={item.text} className="flex items-start gap-2">
                    <span className={item.ok ? "text-teal-600" : "text-amber-600"}>
                      {item.ok ? (
                        <CheckCircle2 className="mt-0.5 size-3.5" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-3.5" />
                      )}
                    </span>
                    <p className="text-[11px] leading-5 text-muted-foreground">{item.text}</p>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full gap-1.5 text-[11px]"
                onClick={() => setTab("medical-records")}
              >
                <FileMedical className="size-3.5" /> View medical records
              </Button>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-bold">Latest compatible requests</h2>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[10.5px]" onClick={() => setTab("matches")}>
                  View all
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {(nearby ?? []).slice(0, 3).map((request) => (
                  <div
                    key={request._id}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <BloodGroupChip group={request.bloodGroup} size="sm" />
                      <div>
                        <p className="text-[11.5px] font-semibold">
                          {COMPONENT_LABELS[request.component as Component]} · {request.units} unit(s)
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {request.hospitalName} · {request.city}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <UrgencyBadge urgency={request.urgency} />
                      <Button asChild size="sm" variant="ghost" className="h-7 text-[10px]">
                        <Link to={`/requests/${request._id}`}>View</Link>
                      </Button>
                    </div>
                  </div>
                ))}
                {nearby && nearby.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-[11px] text-muted-foreground">
                    No compatible requests right now. Keep availability on so verified requests can reach you.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-bold">Upcoming invitations</h2>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[10.5px]" onClick={() => setTab("invitations")}>
                  Open
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {(invitations ?? []).slice(0, 3).map((invite) => (
                  <div key={invite._id} className="rounded-xl border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11.5px] font-semibold">
                        {invite.bloodGroup} · {COMPONENT_LABELS[invite.component]} · {invite.units} unit(s)
                      </p>
                      <StatusBadge status={invite.status} />
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {invite.facilityName} · invited {formatRelative(invite.createdAt)}
                    </p>
                  </div>
                ))}
                {invitations && invitations.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-[11px] text-muted-foreground">
                    No donor invitations yet. They appear only after institutional stock cannot cover a verified need.
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === "invitations" && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <h2 className="flex items-center gap-2 text-[14px] font-bold">
                  <MapPin className="size-4 text-primary" /> Temporary location sharing
                </h2>
                <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                  When institutional supply cannot cover a verified request, LifeLink may invite
                  compatible donors near the hospital. Your approximate distance is used only
                  while this consent is active. It expires automatically and is never shown to
                  hospitals or requestors.
                </p>
                {locationConsent?.expiresAt && locationConsent.shareLocation && (
                  <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50/70 px-2.5 py-1.5 text-[10.5px] font-medium text-teal-800">
                    Active until {formatDateTime(locationConsent.expiresAt)}. You can revoke it immediately.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:min-w-[240px]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11.5px] font-semibold">Share while available</p>
                    <p className="text-[9.5px] text-muted-foreground">
                      {locationConsent?.shareLocation ? "Consent active" : "Consent off"}
                    </p>
                  </div>
                  <Switch
                    checked={locationConsent?.shareLocation ?? false}
                    disabled={consentBusy || locationConsent === undefined}
                    onCheckedChange={(value) => void handleConsent(value)}
                    aria-label="Temporarily share location for donor invitations"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="community-consent-hours" className="text-[10px] text-muted-foreground">
                    Duration
                  </Label>
                  <select
                    id="community-consent-hours"
                    value={consentHours}
                    onChange={(event) => setConsentHours(Number(event.target.value))}
                    className="h-7 flex-1 rounded-md border border-border bg-background px-1.5 text-[10px]"
                  >
                    <option value={6}>6 hours</option>
                    <option value={24}>24 hours</option>
                    <option value={72}>3 days</option>
                    <option value={168}>7 days</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionHeading
                eyebrow="Donor invitations"
                title="Respond to a request"
                description="Sent only after the institutional network cannot meet a verified need."
              />
              <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[9.5px] font-semibold text-muted-foreground">
                {pendingInvitations} awaiting your reply
              </span>
            </div>

            {invitations === undefined ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading invitations…
              </div>
            ) : invitations.length === 0 ? (
              <EmptyState
                icon={HeartHandshake}
                title="No donor invitations yet"
                description="Invitations appear here only when compatible hospital requests cannot be covered by institutional stock."
              />
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {invitations.map((invite) => {
                  const awaiting = invite.status === "sent";
                  return (
                    <div key={invite._id} className="rounded-xl border border-border bg-background p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <BloodGroupChip group={invite.bloodGroup} size="sm" />
                          <div>
                            <p className="text-[11.5px] font-semibold leading-4">
                              {COMPONENT_LABELS[invite.component]} · {invite.units} unit(s)
                            </p>
                            <p className="text-[9.5px] text-muted-foreground">
                              {invite.facilityName}
                              {invite.facilityCity ? ` · ${invite.facilityCity}` : ""}
                            </p>
                          </div>
                        </div>
                        <StatusBadge status={invite.status} />
                      </div>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-muted-foreground">
                        <span>Invited {formatRelative(invite.createdAt)}</span>
                        {invite.distanceKm != null && <span>~{invite.distanceKm} km away</span>}
                        {invite.responseProbability != null && (
                          <span
                            title={invite.responseExplanation ?? undefined}
                            className="inline-flex items-center gap-1"
                          >
                            <Sparkles className="size-2.5 text-teal-600" />
                            Response estimate {Math.round(invite.responseProbability * 100)}%
                            {invite.responseModelVersion ? ` · ${invite.responseModelVersion}` : ""}
                          </span>
                        )}
                        {invite.responseProbability == null && invite.responseModel && (
                          <span title={invite.responseExplanation ?? undefined}>Distance-ranked</span>
                        )}
                        {invite.responseModelSynthetic && invite.responseProbability != null && (
                          <span className="text-amber-700">synthetic model</span>
                        )}
                      </p>
                      {invite.appointmentAt && (
                        <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50/60 px-2.5 py-1.5 text-[10px] leading-4 text-teal-900">
                          <strong>Appointment:</strong> {formatDateTime(invite.appointmentAt)}
                          {invite.centerName ? ` · ${invite.centerName}` : " · centre to be confirmed"}
                          {invite.centerAddress ? `, ${invite.centerAddress}` : ""}
                          {invite.centerPhone ? ` · ${invite.centerPhone}` : ""}
                        </p>
                      )}
                      {invite.status === "accepted" && invite.facilityPhone && (
                        <p className="mt-1 text-[9px] text-muted-foreground">
                          Facility contact: {invite.facilityPhone}
                        </p>
                      )}
                      <p className="mt-2 text-[8.5px] leading-3.5 text-muted-foreground">
                        Responding does not make blood available. A licensed centre must collect,
                        screen, test, process and release any units.
                      </p>
                      {awaiting && (
                        <div className="mt-2.5 flex gap-2 border-t border-border pt-2.5">
                          <Button
                            size="sm"
                            className="h-8 flex-1 gap-1.5 text-[10.5px]"
                            disabled={invitationBusy === String(invite._id)}
                            onClick={() => void handleInvitation(invite._id, "accept")}
                          >
                            {invitationBusy === String(invite._id) ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="size-3" />
                            )}
                            I can donate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1 text-[10.5px]"
                            disabled={invitationBusy === String(invite._id)}
                            onClick={() => void handleInvitation(invite._id, "decline")}
                          >
                            Decline
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "matches" && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[14px] font-bold">Compatible verified requests</h2>
                <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
                  Blood group, state and country must match. Routine requests stay in your city;
                  only emergencies reach you from elsewhere in the state. Patient identities are withheld.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <ShieldCheck className="size-3.5 text-teal-600" />
                {nearby?.filter((request) => request.nearby).length ?? 0} in your city
              </div>
            </div>
          </section>

          {nearby === undefined ? (
            <SkeletonPanel />
          ) : nearby.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No matching requests in the network"
              description="LifeLink only surfaces compatible, verified requests. Keep availability on and check back after staff verify new requests."
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
                        <p className="text-[12.5px] font-bold">
                          {COMPONENT_LABELS[request.component as Component]}
                        </p>
                        <p className="text-[10.5px] text-muted-foreground">{request.requestId}</p>
                      </div>
                    </div>
                    <UrgencyBadge urgency={request.urgency} />
                  </div>
                  <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
                    <p className="flex items-center gap-1.5">
                      <MapPin className="size-3" /> {request.city} · {request.hospitalName}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Droplets className="size-3" /> {request.units} unit(s) requested
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Clock3 className="size-3" /> Needed by {formatDateTime(request.requiredBy)}
                    </p>
                  </div>
                  {request.contactUnlocked ? (
                    <div className="mt-2.5 rounded-xl border border-teal-200 bg-teal-50/70 p-2.5 text-[10.5px] leading-5 text-teal-900">
                      <p className="font-semibold">Contact: {request.requestorName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" />
                          {request.requesterPhone ? (
                            <a className="hover:underline" href={`tel:${request.requesterPhone}`}>
                              {request.requesterPhone}
                            </a>
                          ) : (
                            "Phone not provided"
                          )}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {request.city}
                          {request.area ? ` · ${request.area}` : ""}
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
                          onClick={() =>
                            setOfferTarget({
                              id: request._id as Id<"bloodRequests">,
                              group: request.bloodGroup,
                            })
                          }
                        >
                          <HeartHandshake className="size-3" /> Offer to help
                        </Button>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/25 px-4 py-2.5 text-[10.5px] text-muted-foreground">
            <span>Looking for stock instead of a matching request?</span>
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[10.5px]">
              <Link to="/blood-search">
                <Search className="size-3" /> Verified blood search
              </Link>
            </Button>
          </div>
        </div>
      )}

      {tab === "camps" && (
        <div className="space-y-4">
          <SectionHeading
            eyebrow="Donation camps"
            title="Upcoming verified camps"
            description="Registrations are stored once. An actual donation is recorded by staff after screening."
          />
          {camps === undefined ? (
            <SkeletonPanel />
          ) : camps.length === 0 ? (
            <EmptyState
              icon={CalendarHeart}
              title="No published camps yet"
              description="Verified organizations publish camps here."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link to="/donation-camps">Open public camps page</Link>
                </Button>
              }
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
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                          {camp.organizationName}
                        </p>
                      </div>
                      <span className="rounded-full border border-border bg-muted/50 px-2 py-1 text-[9.5px] font-bold uppercase text-muted-foreground">
                        {camp.status}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
                      <p className="flex items-center gap-1.5">
                        <CalendarHeart className="size-3" /> {formatDate(camp.date)} · {camp.startTime}–{camp.endTime}
                      </p>
                      <p className="flex items-center gap-1.5">
                        <MapPin className="size-3" /> {camp.venue}, {camp.city}
                      </p>
                      <p className="flex items-center gap-1.5">
                        <Users className="size-3" /> {camp.registered}/{camp.capacity} registered
                      </p>
                    </div>
                    <Progress value={(camp.registered / camp.capacity) * 100} className="mt-2 h-1.5" />
                    <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                      <Button asChild size="sm" variant="ghost" className="h-8 text-[11px]">
                        <Link to="/donation-camps">Details</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant={registered ? "outline" : "default"}
                        className="ml-auto h-8 text-[11px]"
                        disabled={campBusy === camp._id || (!registered && full) || regStatus === "donated"}
                        onClick={() => void handleCamp(camp._id, registered)}
                      >
                        {campBusy === camp._id ? <Loader2 className="size-3 animate-spin" /> : null}
                        {regStatus === "donated"
                          ? "Donation recorded"
                          : registered
                            ? "Cancel registration"
                            : full
                              ? "Camp full"
                              : "Register"}
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
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Recorded donations" value={summary?.donationCount ?? 0} icon={History} />
            <StatCard label="Total units" value={summary?.totalUnits ?? 0} icon={Droplets} tone="primary" />
            <StatCard label="Last donation" value={formatDate(summary?.lastDonationDate)} icon={Clock3} tone="teal" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border p-4">
              <h2 className="text-[14px] font-bold">Donation history</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Recorded only by authorized staff after a verified donation.
              </p>
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
                    {donationsData.donations.map((donation) => (
                      <TableRow key={donation._id}>
                        <TableCell className="font-medium">{formatDate(donation.donationDate)}</TableCell>
                        <TableCell>{COMPONENT_LABELS[donation.component as Component]}</TableCell>
                        <TableCell>{donation.units}</TableCell>
                        <TableCell className="text-muted-foreground">{donation.organizationName}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-muted-foreground">
                          {donation.note ?? "—"}
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

      {tab === "profile" && (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
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
            <form className="mt-4 space-y-4" onSubmit={(event) => void saveProfile(event)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="community-profile-phone">Phone</Label>
                  <Input
                    id="community-profile-phone"
                    value={profileForm.phone}
                    onChange={(event) => updateProfileForm({ phone: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <Select value={profileForm.city} onValueChange={(value) => updateProfileForm({ city: value })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
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
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="community-profile-address">Address / locality</Label>
                  <Input
                    id="community-profile-address"
                    value={profileForm.address}
                    onChange={(event) => updateProfileForm({ address: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="community-profile-area">Area</Label>
                  <Input
                    id="community-profile-area"
                    value={profileForm.area}
                    onChange={(event) => updateProfileForm({ area: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="community-profile-center">Preferred centre</Label>
                  <Input
                    id="community-profile-center"
                    value={profileForm.preferredCenter}
                    onChange={(event) => updateProfileForm({ preferredCenter: event.target.value })}
                  />
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
                  onCheckedChange={(value) => updateProfileForm({ shareContact: value })}
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
                  ["Donor ID", donor.donorId],
                  ["Blood group", donor.bloodGroup],
                  ["Date of birth", formatDate(donor.dateOfBirth)],
                  ["Role", "Community · server verified"],
                  ["Contact sharing", donor.shareContact ? "Coordinator-only" : "Protected"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
                  >
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
                Donation interval guidance is advisory. Haemoglobin, screening, medication and
                clinical factors determine eligibility. The donation centre has final say.
              </p>
            </div>
                          <Button variant="outline" size="sm" className="w-full gap-1.5 text-[11px]" onClick={() => setTab("medical-records")}>
              <FileMedical className="size-3.5" /> Medical records
            </Button>
          </section>
        </div>
      )}

      {tab === "medical-records" && (
        <DonorMedicalRecordsSection
          lifeLinkId={me?.lifeLinkId ?? donor.donorId}
        />
      )}

      <Dialog open={offerTarget != null} onOpenChange={(open) => !open && setOfferTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offer to help</DialogTitle>
            <DialogDescription>
              This notifies the coordinating team for a compatible {offerTarget?.group} request.
              Your contact details stay protected and are only shared with authorized Red Cross staff when needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="community-offer-note">Message (optional)</Label>
            <Textarea
              id="community-offer-note"
              rows={3}
              value={offerNote}
              onChange={(event) => setOfferNote(event.target.value)}
              placeholder="Availability window or preferred centre — do not include patient details."
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOfferTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitOffer()} disabled={offerBusy} className="gap-2">
              {offerBusy ? <Loader2 className="size-4 animate-spin" /> : <HeartHandshake className="size-4" />}
              Send offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
