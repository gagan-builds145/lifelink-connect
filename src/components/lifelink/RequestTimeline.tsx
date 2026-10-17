import { STATUS_LABELS, formatDateTime, type RequestStatus } from "@/lib/blood";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Clock3 } from "lucide-react";
import { StatusBadge } from "./ui-bits";

export type TimelineEntry = {
  _id: string;
  status: RequestStatus | string;
  actorRole: string;
  note: string | null;
  createdAt: number;
};

export function RequestTimeline({
  entries,
  currentStatus,
}: {
  entries: TimelineEntry[];
  currentStatus?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-[12px] text-muted-foreground">
        No status history has been recorded yet.
      </p>
    );
  }

  const latest = entries[entries.length - 1];
  return (
    <ol className="space-y-0">
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const active = entry._id === latest._id;
        return (
          <li key={entry._id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {active ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-2.5" />}
              </span>
              {!isLast && <span className="my-1 w-px flex-1 bg-border" />}
            </div>
            <div className={cn("min-w-0 pb-6", isLast && "pb-0")}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={entry.status} />
                <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                  <Clock3 className="size-3" />
                  {formatDateTime(entry.createdAt)}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                  {entry.actorRole}
                </span>
              </div>
              {entry.note && (
                <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
                  {entry.note}
                </p>
              )}
              {entry.status !== currentStatus && isLast && (
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  This is the latest recorded status.
                </p>
              )}
            </div>
          </li>
        );
      })}
      <li className="ml-9 mt-2 text-[10.5px] text-muted-foreground">
        Current status: {STATUS_LABELS[currentStatus as RequestStatus] ?? currentStatus ?? "Unknown"}
      </li>
    </ol>
  );
}
