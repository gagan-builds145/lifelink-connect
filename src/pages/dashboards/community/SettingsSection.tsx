import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { SectionHeading } from "@/components/lifelink/community/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  LogoutDialog,
  useLogoutConfirmation,
} from "@/components/lifelink/LogoutConfirmation";
import { formatDateTime } from "@/lib/blood";
import { friendlyError } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  BellRing,
  CheckCheck,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { SectionKey } from "../CommunityDashboard";

type Me = NonNullable<FunctionReturnType<typeof api.profiles.me>>;

export function SettingsSection({ me, onNavigate }: { me: Me; onNavigate: (section: SectionKey) => void }) {
  const logout = useLogoutConfirmation();
  const donor = me.donor;
  const consent = useQuery(api.donorFallback.myConsent);
  const updateDonor = useMutation(api.profiles.updateDonorProfile);
  const setLocationConsent = useMutation(api.donorFallback.setLocationConsent);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const [busy, setBusy] = useState<string | null>(null);

  const toggleContactSharing = async (value: boolean) => {
    if (!donor) return;
    setBusy("contact");
    try {
      await updateDonor({ shareContact: value });
      toast.success(value ? "Coordinators can see your phone" : "Phone hidden from coordinators");
    } catch (error) {
      toast.error("Could not update sharing", { description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  const toggleLocation = async (value: boolean) => {
    setBusy("location");
    try {
      await setLocationConsent({ shareLocation: value, hours: 24 });
      toast.success(value ? "Location sharing enabled for 24 hours" : "Location sharing revoked");
    } catch (error) {
      toast.error("Could not update consent", { description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleMarkAll = async () => {
    setBusy("notifications");
    try {
      const result = await markAllRead({});
      toast.success(
        result.updated > 0 ? `${result.updated} notification(s) marked read` : "Nothing to mark",
      );
    } catch (error) {
      toast.error("Could not update notifications", { description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Settings"
        title="Account, privacy and notifications"
        description="Shared settings for donor and requestor functionality. Server-side checks still enforce every rule."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
            <UserRound className="size-4 text-primary" /> Account & sign-in
          </h2>
          <dl className="mt-3 space-y-2.5 text-[11.5px]">
            {[
              ["Name", me.user.name ?? "Not set"],
              ["Email", me.user.email ?? "Verified account"],
              ["City", me.user.city ?? "Not set"],
              ["Role", "Community — donor and requestor capable"],
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
          <div className="mt-3 rounded-xl border border-border bg-muted/25 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              <KeyRound className="size-3.5 text-primary" /> Passwordless by design
            </p>
            <p className="mt-1 text-[10.5px] leading-5 text-muted-foreground">
              Sign-in uses a short-lived email code. There is no password to leak, and codes are
              rate limited per address and per endpoint.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 h-9 gap-1.5 text-[11px]"
            disabled={logout.pending}
            onClick={logout.requestLogout}
          >
            {logout.pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <LogOut className="size-3.5" />
            )}
            Sign out of this device
          </Button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
            <BellRing className="size-4 text-primary" /> Notifications
          </h2>
          <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
            One inbox covers invitations, request updates, allocations, transfers, receipts and
            account alerts. Duplicate events are suppressed by a dedupe key, so retries do not
            create extra rows.
          </p>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/25 p-3">
            <div>
              <p className="text-[11.5px] font-semibold">Unread notifications</p>
              <p className="text-[10px] text-muted-foreground">
                {unread > 0 ? `${unread} waiting in the centre` : "You are up to date"}
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              {unread}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[10.5px]"
              disabled={busy === "notifications" || unread === 0}
              onClick={() => void handleMarkAll()}
            >
              {busy === "notifications" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <CheckCheck className="size-3" />
              )}
              Mark all read
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-[10.5px]"
              onClick={() => onNavigate("notifications")}
            >
              Open notification centre
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
            <Lock className="size-4 text-primary" /> Privacy controls
          </h2>
          {donor ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/25 p-3">
                <div>
                  <p className="text-[11.5px] font-semibold">Share phone with Red Cross</p>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Hospitals and requestors never receive it.
                  </p>
                </div>
                <Switch
                  checked={donor.shareContact}
                  disabled={busy === "contact"}
                  onCheckedChange={(value) => void toggleContactSharing(value)}
                  aria-label="Share phone with authorized Red Cross coordinators"
                />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/25 p-3">
                <div>
                  <p className="text-[11.5px] font-semibold">Temporary location sharing</p>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    {consent?.shareLocation
                      ? `Active until ${formatDateTime(consent.expiresAt)}`
                      : "Off — no distance is used for invitations"}
                  </p>
                </div>
                <Switch
                  checked={consent?.shareLocation ?? false}
                  disabled={busy === "location" || consent === undefined}
                  onCheckedChange={(value) => void toggleLocation(value)}
                  aria-label="Temporarily share location for donor invitations"
                />
              </div>
              <p className="text-[10px] leading-5 text-muted-foreground">
                Availability is managed in Donate blood. Consent expires automatically and can
                be revoked at any time.
              </p>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/20 p-4">
              <p className="text-[11.5px] leading-5 text-muted-foreground">
                Privacy controls for donor location and contact sharing appear once donor
                functionality is active.
              </p>
              <Button size="sm" className="mt-2 gap-1.5" onClick={() => onNavigate("donate")}>
                Activate donor functionality
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
            <ShieldCheck className="size-4 text-primary" /> Security & data
          </h2>
          <ul className="mt-3 space-y-2 text-[11px] leading-5 text-muted-foreground">
            {[
              "Every community action is authorized on the server against your own user ID.",
              "Hospital, Red Cross, admin and drone-operator surfaces stay separate.",
              "Guest access is removed; every session belongs to a registered account.",
              "Donation, request, consent and receipt records are retained unchanged.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-[10.5px]">
              <Link to="/privacy">
                <ExternalLink className="size-3" /> Privacy policy
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-[10.5px]">
              <Link to="/terms">
                <SlidersHorizontal className="size-3" /> Terms of use
              </Link>
            </Button>
          </div>
        </section>
      </div>

      <LogoutDialog
        open={logout.open}
        onOpenChange={logout.onOpenChange}
        pending={logout.pending}
        onConfirm={() => void logout.confirmLogout()}
      />
    </div>
  );
}
