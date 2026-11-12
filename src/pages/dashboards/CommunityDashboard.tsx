import { api } from "@/convex/_generated/api";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import {
  BloodGroupChip,
  EmptyState,
  StatCard,
  StatusBadge,
  UrgencyBadge,
} from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import {
  COMPONENT_LABELS,
  formatDate,
  formatDateTime,
  type Component,
} from "@/lib/blood";
import { useQuery } from "convex/react";
import {
  ClipboardList,
  Droplets,
  HeartHandshake,
  HeartPulse,
  Loader2,
  MapPin,
  Plus,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

type Tab = "overview" | "donor" | "requests";

const ACTIVE_STATUSES = ["pending", "under_verification", "approved", "dispatched"];

export default function CommunityDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const me = useQuery(api.profiles.me);
  const summary = useQuery(api.donors.summary);
  const requests = useQuery(api.requests.mine);
  const invitations = useQuery(api.donorFallback.myInvitations);

  const donor = me?.donor;
  const requestor = me?.requestor;
  const pendingInvitations = (invitations ?? []).filter((i) => i.status === "sent").length;

  const stats = useMemo(() => {
    const rows = requests ?? [];
    return {
      active: rows.filter((r) => ACTIVE_STATUSES.includes(r.status)).length,
      fulfilled: rows.filter((r) => r.status === "fulfilled" || r.status === "received").length,
    };
  }, [requests]);

  const navItems = [
    { key: "overview", label: "Overview", icon: HeartPulse },
    {
      key: "donor",
      label: "Donor profile",
      icon: HeartHandshake,
      badge: pendingInvitations || undefined,
    },
    {
      key: "requests",
      label: "Blood requests",
      icon: ClipboardList,
      badge: stats.active || undefined,
    },
  ];

  const loading = me === undefined;

  return (
    <DashboardShell
      roleLabel="Donor & Blood Requestor"
      roleKey="Community workspace"
      title="Your community dashboard"
      subtitle="Give blood and request blood from the same verified account. Each profile stays under your control."
      items={navItems}
      active={tab}
      onSelect={(key) => setTab(key as Tab)}
      quickLinks={[
        { label: "Donor workspace", href: "/donor/dashboard", icon: HeartHandshake },
        { label: "Request workspace", href: "/requestor/dashboard", icon: Droplets },
        { label: "Verified blood search", href: "/blood-search", icon: Sparkles },
      ]}
      accentIcon={HeartHandshake}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[12px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your community account…
        </div>
      ) : (
        <>
          {tab === "overview" && (
            <div className="mt-4 space-y-5">
              <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6">
                <div aria-hidden className="absolute -right-16 -top-16 size-56 rounded-full bg-primary/[0.055]" />
                <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                      Donor & Blood Requestor
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-extrabold leading-tight">
                      Welcome{me?.user.name ? `, ${me.user.name}` : ""}
                    </h2>
                    <p className="mt-1.5 max-w-xl text-[12px] leading-6 text-muted-foreground">
                      One account now covers both sides of the network. Add either profile,
                      switch between workspaces, and keep every verification and privacy
                      setting in one place.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button asChild className="gap-1.5">
                      <Link to="/requestor/dashboard">
                        <Plus className="size-4" /> New blood request
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="gap-1.5">
                      <Link to="/donor/dashboard">
                        <HeartHandshake className="size-4" /> Donor workspace
                      </Link>
                    </Button>
                  </div>
                </div>
              </section>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Donor profile"
                  value={donor ? donor.bloodGroup : "Not added"}
                  hint={donor ? donor.donorId : "Add a donor profile to give blood"}
                  icon={HeartHandshake}
                  tone="primary"
                />
                <StatCard
                  label="Requestor profile"
                  value={requestor ? "Active" : "Not added"}
                  hint={requestor ? requestor.requestorId : "Add requestor access to request blood"}
                  icon={UserRound}
                  tone="teal"
                />
                <StatCard
                  label="Active requests"
                  value={stats.active}
                  hint={`${stats.fulfilled} fulfilled or received`}
                  icon={ClipboardList}
                  tone="amber"
                />
                <StatCard
                  label="Donations recorded"
                  value={summary?.donationCount ?? 0}
                  hint={`${summary?.totalUnits ?? 0} unit(s) given`}
                  icon={Droplets}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[14px] font-bold">Donor profile</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Availability and contact sharing stay under your control.
                      </p>
                    </div>
                    <HeartHandshake className="size-4 text-primary" />
                  </div>
                  {donor ? (
                    <>
                      <div className="mt-4 flex items-center gap-3">
                        <BloodGroupChip group={donor.bloodGroup} />
                        <div>
                          <p className="text-[12.5px] font-semibold">{donor.donorId}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                            <MapPin className="size-3" /> {donor.city}
                          </p>
                        </div>
                      </div>
                      <dl className="mt-4 space-y-2 text-[11px]">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <dt className="text-muted-foreground">Matching availability</dt>
                          <dd className="font-semibold">{donor.available ? "Available" : "Paused"}</dd>
                        </div>
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <dt className="text-muted-foreground">Last donation</dt>
                          <dd className="font-semibold">{formatDate(summary?.lastDonationDate)}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                          <dt className="text-muted-foreground">Pending invitations</dt>
                          <dd className="font-semibold">{pendingInvitations}</dd>
                        </div>
                      </dl>
                      <Button asChild variant="outline" size="sm" className="mt-4 w-full gap-1.5">
                        <Link to="/donor/dashboard">Open donor workspace</Link>
                      </Button>
                    </>
                  ) : (
                    <EmptyState
                      icon={HeartHandshake}
                      title="No donor profile yet"
                      description="Add your blood group and availability so verified requests can reach you."
                      className="mt-4 border-0 bg-transparent px-2 py-6"
                      action={
                        <Button asChild size="sm">
                          <Link to="/signup/donor">Register as a donor</Link>
                        </Button>
                      }
                    />
                  )}
                </section>

                <section className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[14px] font-bold">Requestor profile</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Submit a request and follow every verification step.
                      </p>
                    </div>
                    <Droplets className="size-4 text-primary" />
                  </div>
                  {requestor ? (
                    <>
                      <div className="mt-4">
                        <p className="text-[12.5px] font-semibold">{requestor.requestorId}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {requestor.fullName} · {requestor.city}
                        </p>
                      </div>
                      <dl className="mt-4 space-y-2 text-[11px]">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <dt className="text-muted-foreground">Active requests</dt>
                          <dd className="font-semibold">{stats.active}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                          <dt className="text-muted-foreground">Fulfilled or received</dt>
                          <dd className="font-semibold">{stats.fulfilled}</dd>
                        </div>
                      </dl>
                      <Button asChild variant="outline" size="sm" className="mt-4 w-full gap-1.5">
                        <Link to="/requestor/dashboard">Open request workspace</Link>
                      </Button>
                    </>
                  ) : (
                    <EmptyState
                      icon={Droplets}
                      title="No requestor profile yet"
                      description="Add requestor access to submit a verified blood request for a patient."
                      className="mt-4 border-0 bg-transparent px-2 py-6"
                      action={
                        <Button asChild size="sm">
                          <Link to="/signup/requestor">Add requestor profile</Link>
                        </Button>
                      }
                    />
                  )}
                </section>
              </div>

              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[14px] font-bold">Recent blood requests</h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Status updates from the shared request ledger.
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="gap-1 text-[11px]" onClick={() => setTab("requests")}>
                    View all
                  </Button>
                </div>
                {requests === undefined ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Loading requests…
                  </div>
                ) : requests.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-[11px] text-muted-foreground">
                    No blood requests yet. Open the request workspace to create one.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {requests.slice(0, 3).map((request) => (
                      <div key={request._id} className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2.5">
                          <BloodGroupChip group={request.bloodGroup} size="sm" />
                          <div>
                            <p className="text-[11.5px] font-semibold">
                              {request.requestId} · {COMPONENT_LABELS[request.component as Component]}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {request.hospitalName} · needed {formatDateTime(request.requiredBy)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <UrgencyBadge urgency={request.urgency} />
                          <StatusBadge status={request.status} />
                          <Button asChild size="sm" variant="ghost" className="h-7 text-[10px]">
                            <Link to={`/requests/${request._id}`}>Details</Link>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === "donor" && (
            <div className="mt-4 space-y-4">
              {donor ? (
                <>
                  <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <BloodGroupChip group={donor.bloodGroup} size="lg" />
                        <div>
                          <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-primary">
                            {donor.donorId}
                          </p>
                          <h2 className="mt-0.5 font-display text-xl font-extrabold">{donor.fullName}</h2>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {donor.city} · {donor.available ? "Available for matching" : "Availability paused"}
                          </p>
                        </div>
                      </div>
                      <Button asChild className="w-fit gap-1.5">
                        <Link to="/donor/dashboard">Open donor workspace</Link>
                      </Button>
                    </div>
                  </section>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatCard label="Donations" value={summary?.donationCount ?? 0} icon={Droplets} tone="primary" />
                    <StatCard label="Units given" value={summary?.totalUnits ?? 0} icon={HeartHandshake} tone="teal" />
                    <StatCard label="Pending invitations" value={pendingInvitations} icon={Sparkles} tone="amber" />
                  </div>
                  <section className="rounded-2xl border border-border bg-card p-5">
                    <h2 className="text-[14px] font-bold">Donor privacy</h2>
                    <div className="mt-3 space-y-2.5 text-[11.5px] leading-5 text-muted-foreground">
                      <p className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                        Your address is never shown to requestors or the public.
                      </p>
                      <p className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                        Hospitals never receive your phone number.
                      </p>
                      <p className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                        Contact sharing with Red Cross coordinators is optional and can be changed in the donor workspace.
                      </p>
                    </div>
                  </section>
                </>
              ) : (
                <EmptyState
                  icon={HeartHandshake}
                  title="Add a donor profile"
                  description="Your account already supports blood requests. Add donor details to also give blood."
                  action={
                    <Button asChild>
                      <Link to="/signup/donor">Register as a donor</Link>
                    </Button>
                  }
                />
              )}
            </div>
          )}

          {tab === "requests" && (
            <div className="mt-4 space-y-4">
              {requestor ? (
                <>
                  <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-[14px] font-bold">Your blood requests</h2>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        Requests are verified by authorized Red Cross staff before stock is reserved.
                      </p>
                    </div>
                    <Button asChild size="sm" className="w-fit gap-1.5">
                      <Link to="/requestor/dashboard">
                        <Plus className="size-3.5" /> Open request workspace
                      </Link>
                    </Button>
                  </div>
                  {requests && requests.length > 0 ? (
                    <div className="space-y-2">
                      {requests.map((request) => (
                        <div key={request._id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-3">
                            <BloodGroupChip group={request.bloodGroup} />
                            <div>
                              <p className="text-[12px] font-semibold">
                                {request.requestId} · {COMPONENT_LABELS[request.component as Component]} · {request.units} unit(s)
                              </p>
                              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                                {request.hospitalName} · {request.city} · needed {formatDateTime(request.requiredBy)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <UrgencyBadge urgency={request.urgency} />
                            <StatusBadge status={request.status} />
                            <Button asChild size="sm" variant="outline" className="h-8 text-[10.5px]">
                              <Link to={`/requests/${request._id}`}>Details</Link>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={ClipboardList}
                      title="No requests yet"
                      description="Open the request workspace to submit your first verified blood request."
                      action={
                        <Button asChild>
                          <Link to="/requestor/dashboard">Create a request</Link>
                        </Button>
                      }
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  icon={Droplets}
                  title="Add requestor access"
                  description="Your account already supports donations. Add requestor access to request blood for a patient."
                  action={
                    <Button asChild>
                      <Link to="/signup/requestor">Add requestor profile</Link>
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
