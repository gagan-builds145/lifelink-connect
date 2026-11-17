import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  Activity,
  CalendarHeart,
  CheckCircle2,
  Droplets,
  HeartHandshake,
  MapPin,
  PackageCheck,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import React, { type ReactNode } from "react";
import { Button as ErrorButton } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export type ActivityItem = FunctionReturnType<typeof api.community.activity>["items"][number];

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {eyebrow && (
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-1 font-display text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[12px] leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const ACTIVITY_META: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  donation: { icon: Droplets, tone: "bg-rose-50 text-rose-700", label: "Donation" },
  invitation: { icon: HeartHandshake, tone: "bg-amber-50 text-amber-700", label: "Invitation" },
  offer: { icon: Sparkles, tone: "bg-teal-50 text-teal-700", label: "Offer" },
  request: { icon: Activity, tone: "bg-sky-50 text-sky-700", label: "Request" },
  allocation: { icon: PackageCheck, tone: "bg-indigo-50 text-indigo-700", label: "Allocation" },
  transfer: { icon: Truck, tone: "bg-cyan-50 text-cyan-700", label: "Transfer" },
  receipt: { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700", label: "Receipt" },
  availability: { icon: Settings2, tone: "bg-slate-100 text-slate-700", label: "Availability" },
  consent: { icon: ShieldCheck, tone: "bg-slate-100 text-slate-700", label: "Consent" },
  donor_profile: { icon: UserRound, tone: "bg-slate-100 text-slate-700", label: "Donor profile" },
  requestor_profile: {
    icon: UserRound,
    tone: "bg-slate-100 text-slate-700",
    label: "Requestor profile",
  },
  camp: { icon: CalendarHeart, tone: "bg-amber-50 text-amber-700", label: "Camp" },
  location: { icon: MapPin, tone: "bg-slate-100 text-slate-700", label: "Location" },
};

export function activityMeta(kind: string) {
  return (
    ACTIVITY_META[kind] ?? {
      icon: Activity,
      tone: "bg-muted text-muted-foreground",
      label: kind.replace(/_/g, " "),
    }
  );
}

export function ActivityBadge({ kind }: { kind: string }) {
  const meta = activityMeta(kind);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em]",
        meta.tone,
      )}
    >
      <meta.icon className="size-2.5" />
      {meta.label}
    </span>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-[104px] animate-pulse rounded-2xl border border-border bg-card"
        >
          <div className="m-4 h-2.5 w-20 rounded bg-muted" />
          <div className="mx-4 mt-3 h-6 w-14 rounded bg-muted" />
          <div className="mx-4 mt-3 h-2 w-28 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

/**
 * Keeps one failing section from blanking the whole dashboard. The error text
 * is intentionally generic; details stay in the browser console for support.
 */
export class SectionErrorBoundary extends React.Component<
  { children: ReactNode; label: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[CommunityDashboard:${this.props.label}]`, error.message);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <AlertTriangle className="mx-auto size-6 text-amber-600" />
        <h2 className="mt-3 font-display text-lg font-bold">This section could not load</h2>
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
          Your records are safe. Try again, or open another section while the connection
          recovers.
        </p>
        <ErrorButton
          className="mt-4"
          size="sm"
          onClick={() => this.setState({ failed: false })}
        >
          Try again
        </ErrorButton>
      </div>
    );
  }
}

export function SkeletonPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-64 animate-pulse rounded-2xl border border-border bg-card",
        className,
      )}
      aria-hidden
    />
  );
}
