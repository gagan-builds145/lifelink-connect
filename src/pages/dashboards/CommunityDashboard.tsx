import { api } from "@/convex/_generated/api";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import {
  SectionErrorBoundary,
  SkeletonCards,
  SkeletonPanel,
} from "@/components/lifelink/community/shared";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "convex/react";
import {
  Activity,
  Ambulance,
  BellRing,
  ClipboardList,
  Droplets,
  HeartHandshake,
  HeartPulse,
  Search,
  Settings2,
  UserRound,
  CalendarHeart,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { ActivitySection } from "./community/ActivitySection";
import { DonateSection } from "./community/DonateSection";
import { NotificationsSection } from "./community/NotificationsSection";
import { OverviewSection } from "./community/OverviewSection";
import { ProfileSection } from "./community/ProfileSection";
import { RequestSection } from "./community/RequestSection";
import { SettingsSection } from "./community/SettingsSection";

export type SectionKey =
  | "overview"
  | "donate"
  | "request"
  | "activities"
  | "notifications"
  | "profile"
  | "settings";

const SECTION_KEYS: SectionKey[] = [
  "overview",
  "donate",
  "request",
  "activities",
  "notifications",
  "profile",
  "settings",
];

const SECTION_LABELS: Record<SectionKey, string> = {
  overview: "Overview",
  donate: "Donate Blood",
  request: "Request Blood",
  activities: "My Activities",
  notifications: "Notifications",
  profile: "My Profile",
  settings: "Settings",
};

/**
 * LifeLink — Unified Community Dashboard.
 *
 * One route, one identity, one sidebar. Donor and requestor capabilities are
 * sections of this page; the legacy `/donor/dashboard` and
 * `/requestor/dashboard` routes redirect into the matching section.
 */
export default function CommunityDashboard() {
  const [params, setParams] = useSearchParams();
  const rawSection = params.get("section") ?? "overview";
  const section: SectionKey = SECTION_KEYS.includes(rawSection as SectionKey)
    ? (rawSection as SectionKey)
    : "overview";

  const { user } = useAuth();
  const me = useQuery(api.profiles.me);
  const overview = useQuery(api.community.overview);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;

  const go = (next: SectionKey) => {
    const nextParams = new URLSearchParams(params);
    if (next === "overview") nextParams.delete("section");
    else nextParams.set("section", next);
    setParams(nextParams);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const navItems = [
    { key: "overview", label: SECTION_LABELS.overview, icon: HeartPulse },
    {
      key: "donate",
      label: SECTION_LABELS.donate,
      icon: HeartHandshake,
      badge: overview?.invitations.awaiting || undefined,
    },
    {
      key: "request",
      label: SECTION_LABELS.request,
      icon: Droplets,
      badge: overview?.requests.active || undefined,
    },
    { key: "activities", label: SECTION_LABELS.activities, icon: Activity },
    {
      key: "notifications",
      label: SECTION_LABELS.notifications,
      icon: BellRing,
      badge: unread || undefined,
    },
    { key: "profile", label: SECTION_LABELS.profile, icon: UserRound },
    { key: "settings", label: SECTION_LABELS.settings, icon: Settings2 },
  ];

  const loading = me === undefined;

  return (
    <DashboardShell
      roleLabel="Donor"
      roleKey="Donor & blood requestor"
      title="Donor dashboard"
      items={navItems}
      active={section}
      onSelect={(key) => go(key as SectionKey)}
      onProfile={() => go("profile")}
      profileLabel="My profile"
      accentIcon={HeartHandshake}
      quickLinks={[
        { label: "Book an ambulance", href: "/ambulance", icon: Ambulance },
        { label: "Register as Guardian", href: "/guardian/onboarding", icon: Ambulance },
        { label: "Verified blood search", href: "/blood-search", icon: Search },
        { label: "Public donation camps", href: "/donation-camps", icon: CalendarHeart },
        { label: "Request records", href: "/community/dashboard?section=request", icon: ClipboardList },
      ]}
    >
      {loading ? (
        <div className="space-y-5">
          <SkeletonPanel className="h-44" />
          <SkeletonCards count={8} />
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonPanel />
            <SkeletonPanel />
          </div>
        </div>
      ) : (
        <section role="region" aria-label={`${SECTION_LABELS[section]} section`}>
          <SectionErrorBoundary label={section}>
            {section === "overview" && <OverviewSection onNavigate={go} />}
            {section === "donate" && <DonateSection donor={me?.donor ?? null} onNavigate={go} />}
            {section === "request" && (
              <RequestSection
                requestor={me?.requestor ?? null}
                user={
                  me?.user ?? {
                    name: user?.name ?? null,
                    email: user?.email ?? null,
                    city: user?.city ?? null,
                  }
                }
                onNavigate={go}
              />
            )}
            {section === "activities" && <ActivitySection onNavigate={go} />}
            {section === "notifications" && <NotificationsSection onNavigate={go} />}
            {section === "profile" && me && <ProfileSection me={me} onNavigate={go} />}
            {section === "settings" && me && <SettingsSection me={me} onNavigate={go} />}
          </SectionErrorBoundary>
        </section>
      )}
    </DashboardShell>
  );
}
