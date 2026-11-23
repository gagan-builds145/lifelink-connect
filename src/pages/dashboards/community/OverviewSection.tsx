import { api } from "@/convex/_generated/api";
import {
  ActivityBadge,
  SectionHeading,
  SkeletonCards,
  SkeletonPanel,
  activityMeta,
  type ActivityItem,
} from "@/components/lifelink/community/shared";
import { BloodGroupChip, EmptyState, StatCard, StatusBadge } from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatRelative } from "@/lib/blood";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Droplets,
  HeartHandshake,
  HeartPulse,
  Loader2,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router";
import type { SectionKey } from "../CommunityDashboard";

const CRIMSON = "#b02a3c";

export function OverviewSection({ onNavigate }: { onNavigate: (section: SectionKey) => void }) {
  const overview = useQuery(api.community.overview);
  const notifications = useQuery(api.notifications.listMine);

  if (overview === undefined) {
    return (
      <div className="space-y-5">
        <SkeletonPanel className="h-44" />
        <SkeletonCards count={8} />
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonPanel />
          <SkeletonPanel />
        </div>
      </div>
    );
  }

  const donor = overview.donor;
  const requestor = overview.requestor;
  const hasAnyProfile = Boolean(donor || requestor);
  const recentNotifications = (notifications ?? []).slice(0, 4);
  const trend = overview.donations.monthly;
  const hasTrend = trend.some((point) => point.count > 0);
  const statusRows = overview.requests.byStatus;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-foreground px-5 py-6 text-background sm:px-7 sm:py-8">
        <div
          aria-hidden
          className="absolute -right-24 -top-24 size-72 rounded-full bg-primary/25 blur-[2px]"
        />
        <div
          aria-hidden
          className="absolute -bottom-28 right-24 size-56 rounded-full border border-white/10"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary-foreground/70">
Donor dashboard
            </p>
            <h1 className="mt-2 font-display text-2xl font-extrabold leading-tight sm:text-3xl">
              Welcome back{overview.user.name ? `, ${overview.user.name.split(" ")[0]}` : ""}
            </h1>
            <p className="mt-2 text-[12.5px] leading-6 text-background/70">
              One verified account for both sides of the network. Give blood, request blood,
              and follow every update without changing workspace.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold">
                <HeartHandshake className="size-3 text-primary-foreground" />
                {donor ? `Donor · ${donor.bloodGroup}` : "Donor not activated"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold">
                <Droplets className="size-3 text-primary-foreground" />
                {requestor ? "Requestor active" : "Requestor not activated"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold">
                <CheckCircle2 className="size-3 text-emerald-300" />
                Email verified
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
            <Button
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => onNavigate("request")}
            >
              <Plus className="size-4" /> New blood request
            </Button>
            <Button
              variant="outline"
              className="gap-2 border-white/25 bg-transparent text-background hover:bg-white/10 hover:text-background"
              onClick={() => onNavigate("donate")}
            >
              <HeartHandshake className="size-4" /> Donate blood
            </Button>
          </div>
        </div>
      </section>

      {!hasAnyProfile && (
        <section className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                Finish setting up
              </p>
              <h2 className="mt-1 font-display text-lg font-bold">
                Activate donor, requestor, or both
              </h2>
              <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">
                Your account exists but neither profile is active yet. Choose a capability —
                it is added to this same login, and you can add the other later.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="gap-1.5" onClick={() => onNavigate("donate")}>
                <HeartHandshake className="size-4" /> Become a donor
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => onNavigate("request")}>
                <Droplets className="size-4" /> Request blood
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Donation activities"
          value={overview.donations.count}
          hint={`${overview.donations.totalUnits} unit(s) recorded`}
          icon={Droplets}
          tone="primary"
        />
        <StatCard
          label="Blood requests"
          value={overview.requests.total}
          hint={`${overview.requests.active} active right now`}
          icon={ClipboardList}
        />
        <StatCard
          label="Active donor invitations"
          value={overview.invitations.awaiting}
          hint={`${overview.invitations.accepted} accepted in total`}
          icon={HeartHandshake}
          tone="amber"
        />
        <StatCard
          label="Unread notifications"
          value={overview.unreadNotifications}
          hint="Request, invitation and stock updates"
          icon={BellRing}
          tone="teal"
        />
        <StatCard
          label="Pending requests"
          value={overview.requests.pending}
          hint="Awaiting or under verification"
          icon={Clock3}
          tone="amber"
        />
        <StatCard
          label="Partially fulfilled"
          value={overview.requests.partiallyFulfilled}
          hint="Units still outstanding"
          icon={HeartPulse}
        />
        <StatCard
          label="Fulfilled requests"
          value={overview.requests.fulfilled}
          hint="Received or completed"
          icon={CheckCircle2}
          tone="teal"
        />
        <StatCard
          label="Active requests"
          value={overview.requests.active}
          hint={`${overview.requests.cancelled} cancelled · ${overview.requests.rejected} rejected`}
          icon={Sparkles}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <SectionHeading
            eyebrow="Your ledger"
            title="Donation activity"
            description="Recorded donations only, from the last six months."
          />
          <div className="mt-4 h-[200px]">
            {hasTrend ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="community-donation-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CRIMSON} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={CRIMSON} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                    formatter={(value: number, name: string) => [
                      value,
                      name === "units" ? "Units" : "Donations",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="units"
                    stroke={CRIMSON}
                    strokeWidth={2}
                    fill="url(#community-donation-fill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 text-center">
                <Droplets className="size-5 text-muted-foreground/60" />
                <p className="mt-2 text-[12px] font-semibold">No donations recorded yet</p>
                <p className="mt-1 max-w-xs text-[11px] leading-5 text-muted-foreground">
                  A donation is recorded by authorized staff after collection and screening,
                  then appears here.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <SectionHeading
            eyebrow="Request pipeline"
            title="Where your requests stand"
            description="Live status counts across your request history."
          />
          <div className="mt-4 h-[200px]">
            {statusRows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={statusRows}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={92}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={16}>
                    {statusRows.map((row) => (
                      <Cell
                        key={row.status}
                        fill={
                          row.status === "cancelled" || row.status === "rejected"
                            ? "#94a3b8"
                            : row.status === "fulfilled" || row.status === "received"
                              ? "#0f766e"
                              : CRIMSON
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 text-center">
                <ClipboardList className="size-5 text-muted-foreground/60" />
                <p className="mt-2 text-[12px] font-semibold">No blood requests yet</p>
                <p className="mt-1 max-w-xs text-[11px] leading-5 text-muted-foreground">
                  Create a request and its verification, allocation and receipt steps will
                  appear here.
                </p>
                {requestor ? (
                  <Button size="sm" className="mt-3 gap-1.5" onClick={() => onNavigate("request")}>
                    <Plus className="size-3.5" /> Create a request
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Profiles + activity */}
      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-2xl border border-border bg-card p-5">
          <SectionHeading
            eyebrow="Account capabilities"
            title="Profile status"
            description="Both profiles share this identity and stay under your control."
          />
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-border bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <BloodGroupChip group={donor?.bloodGroup ?? "—"} size="sm" />
                  <div>
                    <p className="text-[12px] font-bold">Donor profile</p>
                    <p className="text-[10.5px] text-muted-foreground">
                      {donor
                        ? `${donor.donorId} · ${donor.city} · ${donor.available ? "available" : "paused"}`
                        : "Not activated on this account"}
                    </p>
                  </div>
                </div>
                <span
                  className={
                    donor
                      ? "rounded-full bg-teal-50 px-2 py-0.5 text-[9px] font-bold uppercase text-teal-700"
                      : "rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground"
                  }
                >
                  {donor ? "Active" : "Inactive"}
                </span>
              </div>
              {donor && (
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      Last donation
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold">
                      {formatDate(donor.lastDonationDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      Eligibility
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold">
                      {overview.donations.guidance.status === "ok"
                        ? "Interval met"
                        : overview.donations.guidance.status === "wait"
                          ? "Interval pending"
                          : "Check with staff"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      Invitations
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold">
                      {overview.invitations.awaiting} open
                    </p>
                  </div>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 gap-1 px-0 text-[10.5px] text-primary"
                onClick={() => onNavigate("donate")}
              >
                <HeartHandshake className="size-3" />
                {donor ? "Manage donor functionality" : "Activate donor functionality"}
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/8 text-primary">
                    <Droplets className="size-4" />
                  </span>
                  <div>
                    <p className="text-[12px] font-bold">Requestor profile</p>
                    <p className="text-[10.5px] text-muted-foreground">
                      {requestor
                        ? `${requestor.requestorId} · ${requestor.city}`
                        : "Not activated on this account"}
                    </p>
                  </div>
                </div>
                <span
                  className={
                    requestor
                      ? "rounded-full bg-teal-50 px-2 py-0.5 text-[9px] font-bold uppercase text-teal-700"
                      : "rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground"
                  }
                >
                  {requestor ? "Active" : "Inactive"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 gap-1 px-0 text-[10.5px] text-primary"
                onClick={() => onNavigate("request")}
              >
                <Droplets className="size-3" />
                {requestor ? "Manage blood requests" : "Activate requestor functionality"}
              </Button>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-border bg-muted/25 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Donation guidance
            </p>
            <p className="mt-1 text-[11.5px] font-semibold">
              {overview.donations.guidance.label}
            </p>
            <p className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">
              {overview.donations.guidance.detail}
            </p>
            <Progress
              className="mt-2 h-1.5"
              value={
                overview.donations.guidance.status === "ok"
                  ? 100
                  : overview.donations.guidance.status === "wait"
                    ? 55
                    : 30
              }
            />
            <p className="mt-1.5 text-[9px] text-muted-foreground">
              Advisory only — medical staff decide eligibility.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <SectionHeading
              eyebrow="Everything, in order"
              title="Recent activity"
              description="Real events from your own records."
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[10.5px]"
              onClick={() => onNavigate("activities")}
            >
              All activity <ArrowRight className="size-3" />
            </Button>
          </div>
          <div className="mt-4">
            {overview.recentActivity.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Nothing has happened yet"
                description="Your first donation, request or invitation will appear here with its real timestamp."
                className="border-0 bg-transparent px-2 py-6"
              />
            ) : (
              <ol className="relative space-y-3 border-l border-border pl-4">
                {overview.recentActivity.map((item: ActivityItem) => {
                  const meta = activityMeta(item.kind);
                  return (
                    <li key={item.id} className="relative">
                      <span className="absolute -left-[25px] flex size-5 items-center justify-center rounded-full border border-border bg-card">
                        <meta.icon className="size-2.5 text-primary" />
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[11.5px] font-semibold leading-5">{item.title}</p>
                        {item.status && <StatusBadge status={item.status} />}
                      </div>
                      {item.detail && (
                        <p className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">
                          {item.detail}
                        </p>
                      )}
                      <p className="mt-0.5 flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/70">
                        <ActivityBadge kind={item.kind} />
                        {formatRelative(item.at)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
      </div>

      {/* Notifications */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <SectionHeading
            eyebrow="One inbox"
            title="Recent notifications"
            description="Invitations, request stages, allocations, transfers and account alerts."
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[10.5px]"
            onClick={() => onNavigate("notifications")}
          >
            Open centre <ArrowRight className="size-3" />
          </Button>
        </div>
        <div className="mt-4">
          {notifications === undefined ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading notifications…
            </div>
          ) : recentNotifications.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title="No notifications yet"
              description="Updates arrive here when a request changes, an invitation is sent, or stock is allocated."
              className="border-0 bg-transparent px-2 py-6"
            />
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {recentNotifications.map((notification) => (
                <div
                  key={notification._id}
                  className={
                    notification.read
                      ? "rounded-xl border border-border bg-background p-3"
                      : "rounded-xl border border-primary/20 bg-primary/[0.035] p-3"
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11.5px] font-semibold leading-5">{notification.title}</p>
                    {!notification.read && (
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-5 text-muted-foreground">
                    {notification.body}
                  </p>
                  <p className="mt-1 text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/70">
                    {formatRelative(notification.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-muted/25 px-4 py-3 text-[10.5px] text-muted-foreground">
        <UserRound className="size-3.5 text-primary" />
        <span>
          Patient identities stay private. Blood group labels do not replace cross-matching,
          and donor responses never count as stock.
        </span>
        <Link to="/privacy" className="ml-auto font-semibold text-primary hover:underline">
          Privacy
        </Link>
      </div>
    </div>
  );
}
