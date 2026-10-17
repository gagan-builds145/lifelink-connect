import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  MapPin,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { BloodGroupChip, DemoBadge } from "./ui-bits";
import { formatDateTime } from "@/lib/blood";

export function MatchingPanel({ requestId }: { requestId: Id<"bloodRequests"> }) {
  const data = useQuery(api.matching.forRequest, { requestId });

  if (data === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-5 text-[12px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Ranking verified options…
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h2 className="text-[14px] font-bold">Smart matching</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Transparent rules-based baseline · advisory only
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          <Info className="size-3" />
          ML model not connected
        </span>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              <ShieldCheck className="size-3.5 text-teal-600" />
              Verified inventory
            </h3>
            <span className="text-[10px] text-muted-foreground">
              {data.inventoryMatches.length} option(s)
            </span>
          </div>
          {data.inventoryMatches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-[11.5px] leading-5 text-muted-foreground">
              No verified batch currently matches this group and component. Staff can
              still review manually; do not assume availability.
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.inventoryMatches.slice(0, 4).map((match) => (
                <div
                  key={match.id}
                  className="rounded-xl border border-border bg-background p-3"
                >
                  <div className="flex items-start gap-2.5">
                    <BloodGroupChip group={match.bloodGroup} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-[12px] font-semibold">{match.title}</p>
                        {match.isDemo && <DemoBadge />}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
                        <span>{match.subtitle}</span>
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="size-2.5" />
                          {match.city}
                          {match.distanceKm != null ? ` · ${match.distanceKm} km` : ""}
                        </span>
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[9.5px] font-bold text-teal-800">
                          {match.freeUnits} free unit(s)
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[9.5px] font-medium text-muted-foreground">
                          exp {match.expiryDate}
                        </span>
                        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 font-display text-[10.5px] font-bold text-primary">
                          {match.score}/100
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {match.reasons.slice(0, 2).map((reason) => (
                          <li
                            key={reason}
                            className="flex items-start gap-1 text-[10.5px] leading-4 text-muted-foreground"
                          >
                            <CheckCircle2 className="mt-0.5 size-2.5 shrink-0 text-teal-600" />
                            {reason}
                          </li>
                        ))}
                        {match.warnings.slice(0, 1).map((warning) => (
                          <li
                            key={warning}
                            className="flex items-start gap-1 text-[10.5px] leading-4 text-amber-700"
                          >
                            <AlertTriangle className="mt-0.5 size-2.5 shrink-0" />
                            {warning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              <Users className="size-3.5 text-primary" />
              Donor options
            </h3>
            <span className="text-[10px] text-muted-foreground">
              {data.donorMatches.length} donor(s)
            </span>
          </div>
          {data.donorMatches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-[11.5px] leading-5 text-muted-foreground">
              No available compatible donor profiles are registered for this request yet.
              Donor identities and contact details are never public.
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.donorMatches.slice(0, 4).map((match) => (
                <div
                  key={match.id}
                  className="rounded-xl border border-border bg-background p-3"
                >
                  <div className="flex items-start gap-2.5">
                    <BloodGroupChip group={match.bloodGroup} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[12px] font-semibold">{match.title}</p>
                        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 font-display text-[10.5px] font-bold text-primary">
                          {match.score}/100
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                        {match.donorId} · {match.city}
                        {match.distanceKm != null ? ` · ${match.distanceKm} km` : ""}
                      </p>
                      <p
                        className={cn(
                          "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-semibold",
                          match.eligible
                            ? "bg-teal-50 text-teal-800"
                            : "bg-amber-50 text-amber-800",
                        )}
                      >
                        {match.eligible
                          ? "Availability + interval guidance OK"
                          : "Interval check needs clinician review"}
                      </p>
                      <p className="mt-1.5 text-[10.5px] leading-4 text-muted-foreground">
                        {match.reasons[0]}
                        {match.phone ? ` · Contact: ${match.phone}` : " · Contact protected"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <p className="flex items-start gap-1.5 text-[10.5px] leading-4 text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0 text-primary" />
          {data.disclaimer}
        </p>
        <p className="mt-1.5 text-[10px] text-muted-foreground/70">
          Ranking updated from shared records at {formatDateTime(data.lastUpdated)}.{" "}
          {data.modelStatus.detail}
        </p>
      </div>
    </section>
  );
}
