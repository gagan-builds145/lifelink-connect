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
  ClipboardList,
  HeartHandshake,
  HeartPulse,
  Search,
  Settings2,
  CalendarHeart,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { COMMUNITY_SIDEBAR_KEYS } from "@/lib/communityNavigation";
import { ActivitySection } from "./community/ActivitySection";
import { DonateSection } from "./community/DonateSection";
import { OverviewSection } from "./community/OverviewSection";
import { RequestSection } from "./community/RequestSection";
import { SettingsSection } from "./community/SettingsSection";

export type SectionKey =
  | "overview"
  | "donate"
  | "request"
  | "activities"
  | "settings";

const SECTION_KEYS: SectionKey[] = [
  "overview",
  "donate",
  "request",
  "activities",
  "settings",
];

const SECTION_LABELS: Record<SectionKey, string> = {
  overview: "Overview",
  donate: "Donate Blood",
  request: "Request Blood",
  activities: "My Activities",
  settings: "Settings",
};

const SIDEBAR_META = {
  overview: { label: SECTION_LABELS.overview, icon: HeartPulse },
  activities: { label: SECTION_LABELS.activities, icon: Activity },
  settings: { label: SECTION_LABELS.settings, icon: Settings2 },
} as const;

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

  const go = (next: SectionKey) => {
    const nextParams = new URLSearchParams(params);
    if (next === "overview") nextParams.delete("section");
    else nextParams.set("section", next);
    setParams(nextParams);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const navItems = COMMUNITY_SIDEBAR_KEYS.map((key) => ({
    key,
    label: SIDEBAR_META[key].label,
    icon: SIDEBAR_META[key].icon,
    badge:
      key === "overview"
        ? (overview?.invitations.awaiting || undefined)
        : undefined,
  }));

  const loading = me === undefined;
  const hasDonor = Boolean(me?.donor);
  const hasRequestor = Boolean(me?.requestor);
  const roleLabel =
    hasDonor && hasRequestor
      ? "Donor & Requestor"
      : hasDonor
        ? "Donor"
        : hasRequestor
          ? "Requestor"
          : "Community";
  const roleKey =
    hasDonor && hasRequestor
      ? "Donor & blood requestor"
      : hasDonor
        ? "Blood donor"
        : hasRequestor
          ? "Blood requestor"
          : "Community account";
  const dashboardTitle = hasDonor
    ? "Donor dashboard"
    : hasRequestor
      ? "Requestor dashboard"
      : "Community dashboard";

  return (
    <DashboardShell
      roleLabel={roleLabel}
      roleKey={roleKey}
      title={dashboardTitle}
      items={navItems}
      active={section}
      onSelect={(key) => go(key as SectionKey)}
      onProfile={() => go("settings")}
      profileLabel="Profile & settings"
      accentIcon={HeartHandshake}
      quickLinks={[
        { label: "Book an ambulance", href: "/ambulance?auto=1", icon: Ambulance },
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
            {section === "settings" && me && <SettingsSection me={me} onNavigate={go} />}
          </SectionErrorBoundary>
        </section>
      )}
    </DashboardShell>
  );
}
