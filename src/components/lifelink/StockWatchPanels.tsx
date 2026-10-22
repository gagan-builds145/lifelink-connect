import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BLOOD_GROUPS, COMPONENT_LABELS, formatDate, type Component } from "@/lib/blood";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Droplets,
  Loader2,
  TimerOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BloodGroupChip } from "./ui-bits";

export type BloodTypeCoverageData = {
  bloodGroupCount: number;
  groupsInStock: number;
  componentCount: number;
  componentsInStock: number;
  totalFree: number;
  byGroup: {
    bloodGroup: string;
    free: number;
    components: string[];
    inStock: boolean;
    batches: number;
  }[];
  nextDeadline: string | null;
  dueSoonBatches: number;
  expiredBatches: number;
  expiredUnits: number;
};

/**
 * How many blood types are on the shelf right now. Counted from usable,
 * unexpired, unreserved units only, so a passed storage deadline immediately
 * drops a group out of "available".
 */
export function BloodTypeCoverage({
  coverage,
  city,
  roleLabel,
}: {
  coverage: BloodTypeCoverageData | null | undefined;
  city?: string | null;
  roleLabel: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
            <Droplets className="size-4 text-primary" /> Blood types available
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
            {roleLabel} storage in {city ?? "this city"}, counted from usable units only
            (verified, unexpired, unreserved).
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="w-fit rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[10px] font-bold text-primary">
            {coverage ? `${coverage.groupsInStock} / ${coverage.bloodGroupCount} blood groups` : "— / 8 blood groups"}
          </span>
          <span className="w-fit rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
            {coverage ? `${coverage.componentsInStock} / ${coverage.componentCount} components` : "— / 4 components"}
          </span>
        </div>
      </div>

      {coverage === undefined ? (
        <div className="flex items-center gap-2 py-6 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Counting available blood types…
        </div>
      ) : coverage === null ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Link a verified organization to see its blood-type coverage.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
            {BLOOD_GROUPS.map((group) => {
              const row = coverage.byGroup.find((g) => g.bloodGroup === group);
              const free = row?.free ?? 0;
              return (
                <div
                  key={group}
                  className={cn(
                    "rounded-xl border p-2 text-center",
                    free > 0
                      ? "border-teal-200 bg-teal-50/60"
                      : "border-border bg-muted/30",
                  )}
                >
                  <p
                    className={cn(
                      "font-display text-[12px] font-extrabold",
                      free > 0 ? "text-teal-800" : "text-muted-foreground",
                    )}
                  >
                    {group}
                  </p>
                  <p className="mt-0.5 text-[15px] font-bold leading-none">{free}</p>
                  <p className="mt-0.5 text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">
                    {free > 0 ? (free === 1 ? "unit" : "units") : "none"}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Droplets className="size-3 text-primary" />
              <strong className="text-foreground">{coverage.totalFree}</strong> usable units on hand
            </span>
            {coverage.nextDeadline && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-3 text-primary" /> Next deadline{" "}
                <strong className="text-foreground">{formatDate(coverage.nextDeadline)}</strong>
              </span>
            )}
            {coverage.dueSoonBatches > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-800">
                <AlertTriangle className="size-3" /> {coverage.dueSoonBatches} batch(es) due within 7 days
              </span>
            )}
            {coverage.expiredBatches > 0 && (
              <span className="inline-flex items-center gap-1.5 text-rose-800">
                <TimerOff className="size-3" /> {coverage.expiredBatches} batch(es) past deadline ·{" "}
                {coverage.expiredUnits} unit(s) unusable
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export type DeadlineBatch = {
  _id: Id<"inventory">;
  bloodGroup: string;
  component: string;
  batchRef: string;
  unitsAvailable: number;
  unitsReserved: number;
  free: number;
  expiryDate: string;
  expiryDays: number;
  isExpired: boolean;
  isExpiring: boolean;
  storageLocation: string;
};

/**
 * Every batch carries its own storage deadline, which covers all units in that
 * batch. Changing it re-checks the group immediately; once a deadline passes,
 * those units stop counting as usable stock and the replacement request is
 * raised automatically (also once a day, even without staff activity).
 */
export function BatchDeadlineEditor({
  batches,
  roleLabel,
}: {
  batches: DeadlineBatch[] | undefined;
  roleLabel: string;
}) {
  const updateStock = useMutation(api.inventory.updateStock);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const batch of batches ?? []) {
        if (!(batch._id in next)) {
          next[batch._id] = batch.expiryDate;
          changed = true;
        }
      }
      // Keep the same object when nothing is new so a fresh query reference
      // never turns into a render loop.
      return changed ? next : prev;
    });
  }, [batches]);

  const save = async (batch: DeadlineBatch) => {
    const value = drafts[batch._id] ?? batch.expiryDate;
    if (value === batch.expiryDate) {
      toast("Deadline unchanged", {
        description: "Pick a different date to update this batch.",
      });
      return;
    }
    setBusy(batch._id);
    try {
      await updateStock({
        inventoryId: batch._id,
        expiryDate: value,
        note: "Storage deadline updated by staff",
      });
      toast.success("Storage deadline updated", {
        description: `${batch.batchRef}: ${batch.bloodGroup} ${COMPONENT_LABELS[batch.component as Component]} now expires ${formatDate(value)}.`,
      });
    } catch (err) {
      toast.error("Could not update the deadline", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
        <CalendarClock className="size-4 text-primary" /> Batch storage deadlines
      </h2>
      <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
        {roleLabel} staff set the deadline for every batch, and it applies to all units in
        that batch. When a deadline passes, those units can no longer be issued and a
        replacement request is raised automatically for the nearby network.
      </p>

      {batches === undefined ? (
        <div className="flex items-center gap-2 py-5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading batches…
        </div>
      ) : batches.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-3 text-[11px] text-muted-foreground">
          No batches recorded yet, so there is no deadline to set. Record received units first.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {batches.map((batch) => {
            const draft = drafts[batch._id] ?? batch.expiryDate;
            const changed = draft !== batch.expiryDate;
            return (
              <li
                key={batch._id}
                className="flex flex-col gap-2.5 py-3 first:pt-2 last:pb-1 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <BloodGroupChip group={batch.bloodGroup} size="sm" />
                  <div>
                    <p className="text-[11.5px] font-semibold">
                      {COMPONENT_LABELS[batch.component as Component]} · {batch.batchRef}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {batch.free} free of {batch.unitsAvailable} unit(s) · {batch.storageLocation}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {batch.isExpired ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-rose-900">
                      <TimerOff className="size-2.5" /> Past deadline
                    </span>
                  ) : batch.isExpiring ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-amber-800">
                      <AlertTriangle className="size-2.5" /> {Math.max(0, batch.expiryDays)} day(s)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-teal-800">
                      <CheckCircle2 className="size-2.5" /> {batch.expiryDays} day(s)
                    </span>
                  )}
                  <Input
                    type="date"
                    aria-label={`Storage deadline for batch ${batch.batchRef}`}
                    value={draft}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [batch._id]: e.target.value }))
                    }
                    className="h-8 w-[152px] text-[11px]"
                  />
                  <Button
                    size="sm"
                    variant={changed ? "default" : "outline"}
                    className="h-8 text-[10.5px]"
                    disabled={busy === batch._id || !changed}
                    onClick={() => void save(batch)}
                  >
                    {busy === batch._id ? <Loader2 className="size-3 animate-spin" /> : "Save deadline"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
