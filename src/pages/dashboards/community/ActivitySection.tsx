import { api } from "@/convex/_generated/api";
import {
  ActivityBadge,
  SectionHeading,
  SkeletonPanel,
  activityMeta,
  type ActivityItem,
} from "@/components/lifelink/community/shared";
import { EmptyState, StatusBadge } from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime, formatRelative } from "@/lib/blood";
import { useQuery } from "convex/react";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Filter,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { SectionKey } from "../CommunityDashboard";

const FILTERS = [
  { value: "all", label: "Everything" },
  { value: "donation", label: "Donations" },
  { value: "invitation", label: "Invitations" },
  { value: "offer", label: "Offers" },
  { value: "request", label: "Requests" },
  { value: "allocation", label: "Allocations" },
  { value: "transfer", label: "Transfers" },
  { value: "receipt", label: "Receipts" },
  { value: "profile", label: "Profile & consent" },
];

function groupLabel(at: number) {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function ActivitySection({ onNavigate }: { onNavigate: (section: SectionKey) => void }) {
  const feed = useQuery(api.community.activity);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const items = useMemo(() => {
    const rows = feed?.items ?? [];
    const query = search.trim().toLowerCase();
    return rows.filter((item) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "profile"
            ? ["availability", "consent", "donor_profile", "requestor_profile"].includes(item.kind)
            : filter === "request"
              ? item.kind === "request"
              : item.kind === filter;
      if (!matchesFilter) return false;
      if (!query) return true;
      return [item.title, item.detail ?? "", item.requestCode ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [feed, filter, search]);

  const groups = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const item of items) {
      const label = groupLabel(item.at);
      const list = map.get(label) ?? [];
      list.push(item);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [items]);

  if (feed === undefined) {
    return (
      <div className="space-y-4">
        <SkeletonPanel className="h-24" />
        <SkeletonPanel className="h-96" />
      </div>
    );
  }

  const counts = feed.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="My activities"
        title="One combined activity centre"
        description="Donations, invitations, offers, requests, allocations, transfers and verified receipts — merged from real records with their own timestamps."
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total events", value: feed.items.length, icon: Activity },
          { label: "Donations", value: counts.donation ?? 0, icon: Sparkles },
          { label: "Request updates", value: counts.request ?? 0, icon: CalendarDays },
          {
            label: "Supply & receipts",
            value: (counts.allocation ?? 0) + (counts.transfer ?? 0) + (counts.receipt ?? 0),
            icon: Filter,
          },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {card.label}
              </p>
              <card.icon className="size-3.5 text-primary" />
            </div>
            <p className="mt-1 font-display text-2xl font-extrabold">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search activity, request ID or hospital"
            aria-label="Search activity"
            className="h-9 pl-8 text-[11.5px]"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-9 w-full text-[11.5px] sm:w-48" aria-label="Filter activity type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {feed.items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Records appear here as you donate, receive invitations, create requests and confirm receipts. Nothing is generated artificially."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => onNavigate("donate")}>
                Donate blood
              </Button>
              <Button size="sm" variant="outline" onClick={() => onNavigate("request")}>
                Request blood
              </Button>
            </div>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No activity matches this filter"
          description="Try a different type or clear the search term."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFilter("all");
                setSearch("");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map(([label, rows]) => (
            <section key={label}>
              <h3 className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                <CalendarDays className="size-3.5 text-primary" />
                {label}
              </h3>
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <ul className="divide-y divide-border">
                  {rows.map((item) => {
                    const meta = activityMeta(item.kind);
                    return (
                      <li key={item.id} className="flex gap-3 p-3.5 transition-colors hover:bg-muted/30">
                        <span
                          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${meta.tone}`}
                        >
                          <meta.icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[12px] font-semibold leading-5">{item.title}</p>
                            {item.status && <StatusBadge status={item.status} />}
                            <ActivityBadge kind={item.kind} />
                          </div>
                          {item.detail && (
                            <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                              {item.detail}
                            </p>
                          )}
                          <p className="mt-0.5 text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/70">
                            {formatDateTime(item.at)} · {formatRelative(item.at)}
                          </p>
                        </div>
                        {item.href && (
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 gap-1 px-2 text-[10.5px]"
                          >
                            <Link to={item.href}>
                              Open <ArrowUpRight className="size-3" />
                            </Link>
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/25 px-4 py-2.5 text-[10.5px] text-muted-foreground">
            <span>{items.length} event(s) shown from your own records.</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[10.5px]"
              onClick={() => onNavigate("notifications")}
            >
              Notifications <ChevronRight className="size-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
