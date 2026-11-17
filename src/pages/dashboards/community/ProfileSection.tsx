import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
  ActivateDonorPanel,
  ActivateRequestorPanel,
} from "@/components/lifelink/community/Activations";
import { SectionHeading } from "@/components/lifelink/community/shared";
import { BloodGroupChip } from "@/components/lifelink/ui-bits";
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
import { Switch } from "@/components/ui/switch";
import {
  CITIES,
  REQUESTOR_TYPES,
  REQUESTOR_TYPE_LABELS,
  formatDate,
  type RequestorType,
} from "@/lib/blood";
import { friendlyError } from "@/lib/utils";
import { useMutation } from "convex/react";
import {
  BadgeCheck,
  CalendarHeart,
  Droplets,
  HeartHandshake,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { SectionKey } from "../CommunityDashboard";

type Me = NonNullable<FunctionReturnType<typeof api.profiles.me>>;

export function ProfileSection({
  me,
  onNavigate,
}: {
  me: Me;
  onNavigate: (section: SectionKey) => void;
}) {
  const donor = me.donor;
  const requestor = me.requestor;

  const updateDonor = useMutation(api.profiles.updateDonorProfile);
  const updateRequestor = useMutation(api.profiles.updateRequestorProfile);

  const [donorBusy, setDonorBusy] = useState(false);
  const [donorError, setDonorError] = useState<string | null>(null);
  const [donorDraft, setDonorDraft] = useState<{
    phone: string;
    address: string;
    city: string;
    area: string;
    preferredCenter: string;
    shareContact: boolean;
  } | null>(null);

  const [requestorBusy, setRequestorBusy] = useState(false);
  const [requestorError, setRequestorError] = useState<string | null>(null);
  const [requestorDraft, setRequestorDraft] = useState<{
    phone: string;
    city: string;
    requestorType: RequestorType;
  } | null>(null);

  const donorForm = donorDraft ?? {
    phone: donor?.phone ?? "",
    address: donor?.address ?? "",
    city: donor?.city ?? "Pune",
    area: donor?.area ?? "",
    preferredCenter: donor?.preferredCenter ?? "",
    shareContact: donor?.shareContact ?? true,
  };
  const requestorForm = requestorDraft ?? {
    phone: requestor?.phone ?? "",
    city: requestor?.city ?? "Pune",
    requestorType: (requestor?.requestorType ?? "family") as RequestorType,
  };

  const saveDonor = async (event: React.FormEvent) => {
    event.preventDefault();
    setDonorError(null);
    setDonorBusy(true);
    try {
      await updateDonor({
        phone: donorForm.phone,
        address: donorForm.address,
        city: donorForm.city,
        area: donorForm.area,
        preferredCenter: donorForm.preferredCenter,
        shareContact: donorForm.shareContact,
      });
      setDonorDraft(null);
      toast.success("Donor profile updated");
    } catch (error) {
      setDonorError(friendlyError(error, "Could not save donor profile."));
    } finally {
      setDonorBusy(false);
    }
  };

  const saveRequestor = async (event: React.FormEvent) => {
    event.preventDefault();
    setRequestorError(null);
    setRequestorBusy(true);
    try {
      await updateRequestor({
        phone: requestorForm.phone,
        city: requestorForm.city,
        requestorType: requestorForm.requestorType,
      });
      setRequestorDraft(null);
      toast.success("Requestor profile updated");
    } catch (error) {
      setRequestorError(friendlyError(error, "Could not save requestor profile."));
    } finally {
      setRequestorBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="My profile"
        title="One identity, two capabilities"
        description="Both profiles belong to this verified account. Identity-critical fields stay locked and require staff verification to change."
      />

      {(!donor || !requestor) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {!donor && <ActivateDonorPanel />}
          {!requestor && <ActivateRequestorPanel />}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Donor card */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <HeartHandshake className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold">Donor profile</h2>
                <p className="text-[10.5px] text-muted-foreground">
                  {donor ? donor.donorId : "Not activated"}
                </p>
              </div>
            </div>
            {donor && <BloodGroupChip group={donor.bloodGroup} size="sm" />}
          </div>

          {!donor ? (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/20 p-4">
              <p className="text-[11.5px] leading-5 text-muted-foreground">
                Add donor details to give blood from this same dashboard. Your requestor
                profile is unaffected.
              </p>
              <Button size="sm" className="mt-2 gap-1.5" onClick={() => onNavigate("donate")}>
                <HeartHandshake className="size-3.5" /> Open donate blood
              </Button>
            </div>
          ) : (
            <>
              {donorError && (
                <Alert variant="destructive" className="mt-3">
                  <AlertDescription>{donorError}</AlertDescription>
                </Alert>
              )}
              <form className="mt-4 space-y-3.5" onSubmit={(event) => void saveDonor(event)}>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-donor-phone">Phone</Label>
                    <Input
                      id="profile-donor-phone"
                      value={donorForm.phone}
                      onChange={(event) =>
                        setDonorDraft({ ...donorForm, phone: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>City</Label>
                    <Select
                      value={donorForm.city}
                      onValueChange={(value) => setDonorDraft({ ...donorForm, city: value })}
                    >
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
                    <Label htmlFor="profile-donor-address">Address / locality</Label>
                    <Input
                      id="profile-donor-address"
                      value={donorForm.address}
                      onChange={(event) =>
                        setDonorDraft({ ...donorForm, address: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-donor-area">Area</Label>
                    <Input
                      id="profile-donor-area"
                      value={donorForm.area}
                      onChange={(event) => setDonorDraft({ ...donorForm, area: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-donor-center">Preferred centre</Label>
                    <Input
                      id="profile-donor-center"
                      value={donorForm.preferredCenter}
                      onChange={(event) =>
                        setDonorDraft({ ...donorForm, preferredCenter: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/25 p-3">
                  <div>
                    <p className="text-[11.5px] font-semibold">Share phone with coordinators</p>
                    <p className="text-[10px] leading-4 text-muted-foreground">
                      Red Cross staff only. Hospitals and requestors never see it.
                    </p>
                  </div>
                  <Switch
                    checked={donorForm.shareContact}
                    onCheckedChange={(value) =>
                      setDonorDraft({ ...donorForm, shareContact: value })
                    }
                    aria-label="Share phone with authorized coordinators"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" size="sm" disabled={donorBusy} className="h-9">
                    {donorBusy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    Save donor details
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 gap-1.5"
                    onClick={() => onNavigate("donate")}
                  >
                    <CalendarHeart className="size-3.5" /> Invitations & availability
                  </Button>
                </div>
              </form>
              <dl className="mt-4 space-y-2 border-t border-border pt-3 text-[11px]">
                {[
                  ["Blood group", donor.bloodGroup],
                  ["Date of birth", formatDate(donor.dateOfBirth)],
                  ["Availability", donor.available ? "Available" : "Paused"],
                  ["Joined", formatDate(donor.createdAt)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>

        {/* Requestor card */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Droplets className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold">Requestor profile</h2>
                <p className="text-[10.5px] text-muted-foreground">
                  {requestor ? requestor.requestorId : "Not activated"}
                </p>
              </div>
            </div>
            {requestor && <BadgeCheck className="size-4 text-teal-600" />}
          </div>

          {!requestor ? (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/20 p-4">
              <p className="text-[11.5px] leading-5 text-muted-foreground">
                Add requestor access to submit and track requests. Your donor profile is
                unaffected.
              </p>
              <Button size="sm" className="mt-2 gap-1.5" onClick={() => onNavigate("request")}>
                <Droplets className="size-3.5" /> Open request blood
              </Button>
            </div>
          ) : (
            <>
              {requestorError && (
                <Alert variant="destructive" className="mt-3">
                  <AlertDescription>{requestorError}</AlertDescription>
                </Alert>
              )}
              <form className="mt-4 space-y-3.5" onSubmit={(event) => void saveRequestor(event)}>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-requestor-phone">Phone</Label>
                    <Input
                      id="profile-requestor-phone"
                      value={requestorForm.phone}
                      onChange={(event) =>
                        setRequestorDraft({ ...requestorForm, phone: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>City</Label>
                    <Select
                      value={requestorForm.city}
                      onValueChange={(value) => setRequestorDraft({ ...requestorForm, city: value })}
                    >
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
                    <Label>Relationship to patient</Label>
                    <Select
                      value={requestorForm.requestorType}
                      onValueChange={(value) =>
                        setRequestorDraft({
                          ...requestorForm,
                          requestorType: value as RequestorType,
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REQUESTOR_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {REQUESTOR_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" size="sm" disabled={requestorBusy} className="h-9">
                    {requestorBusy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    Save requestor details
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 gap-1.5"
                    onClick={() => onNavigate("request")}
                  >
                    <Droplets className="size-3.5" /> My requests
                  </Button>
                </div>
              </form>
              <dl className="mt-4 space-y-2 border-t border-border pt-3 text-[11px]">
                {[
                  ["Full name", requestor.fullName],
                  ["Relationship", REQUESTOR_TYPE_LABELS[requestor.requestorType]],
                  ["City", requestor.city],
                  ["Joined", formatDate(requestor.createdAt)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
            <UserRound className="size-4 text-primary" /> Account identity
          </h2>
          <dl className="mt-3 space-y-2.5 text-[11.5px]">
            {[
              ["Name", me.user.name ?? "Not set"],
              ["Email", me.user.email ?? "Verified account"],
              ["Role", "Community (server verified)"],
              ["Sign-in", "Email one-time code — no password"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="max-w-[60%] truncate text-right font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-[10.5px]">
              <Link to="/privacy">
                <Lock className="size-3" /> Privacy
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-[10.5px]">
              <Link to="/terms">
                <ShieldCheck className="size-3" /> Terms
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-[10.5px]"
              onClick={() => onNavigate("settings")}
            >
              <Settings2 className="size-3" /> Settings
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-[14px] font-bold">What stays private</h2>
          <div className="mt-3 space-y-2.5 text-[11px] leading-5 text-muted-foreground">
            {[
              { icon: MapPin, text: "Your full address is never shown to requestors or the public." },
              { icon: Mail, text: "Your email is used for sign-in codes and account alerts only." },
              { icon: ShieldCheck, text: "Hospitals never receive donor contact details." },
              { icon: Lock, text: "Patient identities stay restricted to authorized staff." },
            ].map((row) => (
              <p key={row.text} className="flex items-start gap-2">
                <row.icon className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                {row.text}
              </p>
            ))}
          </div>
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5 text-[10px] leading-5 text-amber-900/80">
            Blood group labels do not replace screening or cross-matching. Donor responses are
            never counted as available stock.
          </p>
        </section>
      </div>
    </div>
  );
}
