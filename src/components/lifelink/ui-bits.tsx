import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, URGENCY_LABELS, type RequestStatus, type Urgency } from "@/lib/blood";
import { cn } from "@/lib/utils";
import { AlertTriangle, FlaskConical, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const STATUS_TONES: Record<RequestStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  under_verification: "border-sky-200 bg-sky-50 text-sky-800",
  approved: "border-teal-200 bg-teal-50 text-teal-800",
  dispatched: "border-indigo-200 bg-indigo-50 text-indigo-800",
  received: "border-emerald-200 bg-emerald-50 text-emerald-800",
  fulfilled: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-rose-200 bg-rose-50 text-rose-800",
  cancelled: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({
  status,
  className,
}: {
  status: RequestStatus | string;
  className?: string;
}) {
  const tone = STATUS_TONES[status as RequestStatus] ?? "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold leading-none",
        tone,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {STATUS_LABELS[status as RequestStatus] ?? status}
    </span>
  );
}

export function UrgencyBadge({
  urgency,
  className,
}: {
  urgency: Urgency | string;
  className?: string;
}) {
  const tone =
    urgency === "emergency"
      ? "border-primary/25 bg-primary/10 text-primary"
      : urgency === "urgent"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-border bg-muted/60 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold leading-none",
        tone,
        className,
      )}
    >
      {urgency === "emergency" && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
      )}
      {URGENCY_LABELS[urgency as Urgency] ?? urgency}
    </span>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-amber-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-amber-800",
        className,
      )}
    >
      <FlaskConical className="size-2.5" />
      Demo Data
    </span>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-teal-800",
        className,
      )}
    >
      <ShieldCheck className="size-2.5" />
      Verified source
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "primary" | "teal" | "amber";
  className?: string;
}) {
  const tones = {
    default: "bg-foreground/[0.04] text-foreground",
    primary: "bg-primary/10 text-primary",
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <span className={cn("flex size-8 items-center justify-center rounded-xl", tones[tone])}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-3 font-display text-[26px] font-extrabold leading-none tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && (
        <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-primary">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-2.5 text-balance text-3xl font-bold leading-[1.12] tracking-tight sm:text-[38px]">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-pretty text-[14.5px] leading-7 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon = AlertTriangle,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-2xl bg-card text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="mt-4 text-[14px] font-semibold">{title}</p>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-6 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function DemoDataBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-amber-300/70 bg-amber-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-700" />
        <p className="text-[12px] leading-5 text-amber-900">
          <strong>Demo Data.</strong>{" "}
          {children ??
            "Sample organizations, requests, camps and stock are shown for demonstration. They are never presented as live verified inventory."}
        </p>
      </div>
      <Badge variant="outline" className="w-fit border-amber-300 bg-amber-100/60 text-[9.5px] font-bold uppercase tracking-[0.08em] text-amber-800">
        Not live
      </Badge>
    </div>
  );
}

export function BloodGroupChip({
  group,
  size = "md",
}: {
  group: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-primary/8 font-display font-extrabold tracking-tight text-primary ring-1 ring-inset ring-primary/15",
        size === "sm" && "size-8 text-[12px]",
        size === "md" && "size-10 text-[13px]",
        size === "lg" && "size-12 text-[16px]",
      )}
    >
      {group}
    </span>
  );
}
