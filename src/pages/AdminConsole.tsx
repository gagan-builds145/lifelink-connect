import { api } from "@/convex/_generated/api";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import { DemoBadge, StatCard } from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { COMPONENT_LABELS, formatDateTime, formatRelative } from "@/lib/blood";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  BrainCircuit,
  Building2,
  CheckCircle2,
  Database,
  Gauge,
  GitBranch,
  Hospital,
  Loader2,
  Radio,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Siren,
  Truck,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          {eyebrow && (
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
          )}
          <h2 className="mt-0.5 text-[13px] font-bold">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatusRow({
  label,
  value,
  tone = "ok",
  detail,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  detail?: string;
}) {
  const colors = {
    ok: "bg-teal-500",
    warn: "bg-amber-500",
    bad: "bg-rose-500",
    neutral: "bg-slate-400",
  };
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
      <div>
        <p className="text-[10px] font-semibold">{label}</p>
        {detail && <p className="text-[8.5px] leading-3.5 text-muted-foreground">{detail}</p>}
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", colors[tone])} /> {value}
      </span>
    </div>
  );
}

function Distribution({ data, labels }: { data: Record<string, number>; labels?: Record<string, string> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return (
    <div className="space-y-1.5">
      {entries.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No records.</p>
      ) : (
        entries.map(([key, value]) => (
          <div key={key}>
            <div className="flex items-center justify-between text-[9px]">
              <span className="font-medium capitalize">{labels?.[key] ?? key.replace(/_/g, " ")}</span>
              <span className="text-muted-foreground">{value}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${Math.max(4, (value / max) * 100)}%` }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function AdminConsole() {
  const { user } = useAuth();
  const overview = useQuery(api.admin.overview);
  const runs = useQuery(api.admin.recentSyncRuns);
  const queue = useQuery(api.admin.notificationQueue);
  const facilities = useQuery(api.allocation.networkFacilities);
  const agreements = useQuery(api.allocation.agreementsForMe);
  const integrations = useQuery(api.integrations.listIntegrations);
  const modelStatus = useQuery(api.forecasting.modelStatus);
  const anomalies = useQuery(api.forecasting.anomalyReport, {});
  const missions = useQuery(api.drones.missions);

  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [requestingOrg, setRequestingOrg] = useState("");
  const [supplyingOrg, setSupplyingOrg] = useState("");
  const [agreementUnits, setAgreementUnits] = useState("6");
  const [agreementAuto, setAgreementAuto] = useState(true);
  const [policyOrg, setPolicyOrg] = useState("");
  const [policyTransfer, setPolicyTransfer] = useState(true);
  const [policyAuto, setPolicyAuto] = useState(true);
  const [policyReserve, setPolicyReserve] = useState("2");
  const [policyRadius, setPolicyRadius] = useState("75");

  const acknowledge = useMutation(api.admin.acknowledgeAnomaly);
  const createAgreement = useMutation(api.allocation.createAgreement);
  const setPolicy = useMutation(api.allocation.setTransferPolicy);
  const grantDroneOps = useMutation(api.allocation.grantDroneOps);
  const trainDonorModel = useAction(api.ml.trainDonorModel);
  const trainDemandModel = useAction(api.ml.trainDemandModel);
  const checkMlService = useAction(api.ml.mlServiceStatus);

  const verified = facilities ?? [];

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
    } catch (error) {
      toast.error("Action failed", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const applyPolicy = async () => {
    const facility = verified.find((f) => String(f._id) === policyOrg);
    if (!facility) {
      toast.error("Choose a verified facility.");
      return;
    }
    await run(
      "policy",
      () =>
        setPolicy({
          organizationId: facility._id,
          transferAuthorized: policyTransfer,
          autoAllocate: policyAuto,
          protectedReserveDefault: Math.max(0, Number(policyReserve) || 0),
          searchRadiusKm: Math.max(5, Number(policyRadius) || 75),
        }),
      "Facility transfer policy updated.",
    );
  };

  const addAgreement = async () => {
    const requester = verified.find((f) => String(f._id) === requestingOrg);
    const supplier = verified.find((f) => String(f._id) === supplyingOrg);
    if (!requester || !supplier) {
      toast.error("Choose both facilities.");
      return;
    }
    await run(
      "agreement",
      () =>
        createAgreement({
          requestingOrgId: requester._id,
          supplyingOrgId: supplier._id,
          autoAllocate: agreementAuto,
          maxUnitsPerRequest: Math.max(1, Math.min(50, Number(agreementUnits) || 1)),
          note: "Created from the administrator console.",
        }),
      "Transfer agreement saved and audited.",
    );
  };

  const navItems = [
    { key: "overview", label: "Network overview", icon: Gauge },
    { key: "network", label: "Institutions & policy", icon: Building2 },
    { key: "integrations", label: "Integrations & sync", icon: Database, badge: overview?.integrations.failing },
    { key: "safety", label: "Safety & notifications", icon: Siren, badge: overview?.anomalies.critical },
    { key: "ml", label: "AI / ML registry", icon: BrainCircuit },
    { key: "audit", label: "Audit trail", icon: ScrollText },
  ];

  return (
    <DashboardShell
      roleLabel="System administrator"
      roleKey={user?.name ?? "Network control"}
      title="Network control room"
      subtitle="Every number below is derived from the live LifeLink ledger, transaction log and mission table. Demo records stay labelled wherever they appear."
      items={navItems}
      active={tab}
      onSelect={setTab}
      demoData={overview?.demoPresent}
      accentIcon={ServerCog}
      quickLinks={[
        { label: "Supply command", href: "/supply", icon: Zap },
        { label: "Drone operations", href: "/drones", icon: Radio },
        { label: "Public search", href: "/blood-search", icon: Hospital },
      ]}
    >
      {overview === undefined ? (
        <div className="flex items-center justify-center gap-2 py-20 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the network ledger…
        </div>
      ) : (
        <>
          {tab === "overview" && (
            <div className="space-y-4">
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Verified institutions"
                  value={overview.organizations.verified}
                  hint={`${overview.organizations.hospitals} hospitals · ${overview.organizations.bloodBanks} blood banks`}
                  icon={Building2}
                />
                <StatCard
                  label="Free units"
                  value={overview.inventory.freeUnits}
                  hint={`${overview.inventory.batches} batches · ${overview.inventory.heldForRequests} held`}
                  icon={Activity}
                  tone="teal"
                />
                <StatCard
                  label="Transfers in custody"
                  value={overview.transfers.unitsInTransit}
                  hint={`${overview.transfers.auto} automatic · ${overview.transfers.total} total`}
                  icon={Truck}
                  tone="primary"
                />
                <StatCard
                  label="Genuine ML runs"
                  value={overview.ml.forecastRuns}
                  hint={`${overview.ml.insufficientDataRuns} refused for insufficient data`}
                  icon={BrainCircuit}
                  tone="amber"
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <Panel eyebrow="System health" title="Operational signals">
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <StatusRow
                      label="Facility integrations"
                      value={overview.integrations.total === 0 ? "none" : `${overview.integrations.live} live / ${overview.integrations.mock} mock`}
                      tone={overview.integrations.failing > 0 ? "bad" : "ok"}
                      detail={`${overview.integrations.failedRuns24h} failed run(s) in 24h`}
                    />
                    <StatusRow
                      label="Notification delivery"
                      value={`${overview.notifications.failed} failed`}
                      tone={overview.notifications.failed > 0 ? "bad" : "ok"}
                      detail={`${overview.notifications.queued} queued · ${overview.notifications.total} total`}
                    />
                    <StatusRow
                      label="Critical anomalies"
                      value={String(overview.anomalies.critical)}
                      tone={overview.anomalies.critical > 0 ? "bad" : "ok"}
                      detail={`${overview.anomalies.unacknowledged} unacknowledged`}
                    />
                    <StatusRow
                      label="Expired stock"
                      value={`${overview.inventory.expiredUnits} u`}
                      tone={overview.inventory.expiredUnits > 0 ? "warn" : "ok"}
                      detail={`${overview.inventory.expiringSoonBatches} batch(es) expiring ≤3d`}
                    />
                    <StatusRow
                      label="Mission holds"
                      value={String(overview.drones.holds)}
                      tone={overview.drones.holds > 0 ? "warn" : "ok"}
                      detail={`${overview.drones.emergencies} emergency landing(s)`}
                    />
                    <StatusRow
                      label="Released/batches"
                      value={`${overview.inventory.releasedBatches}/${overview.inventory.batches}`}
                      tone="neutral"
                      detail="Release status enforced before allocation"
                    />
                  </div>
                  <div className="mt-3 rounded-xl border border-border bg-muted/25 p-2.5 text-[9px] leading-4 text-muted-foreground">
                    Last sync{" "}
                    {overview.integrations.lastSyncAt
                      ? formatRelative(overview.integrations.lastSyncAt)
                      : "never"}{" "}
                    · last forecast{" "}
                    {overview.ml.lastForecastAt
                      ? formatRelative(overview.ml.lastForecastAt)
                      : "not run"}{" "}
                    · snapshot {formatDateTime(overview.generatedAt)}.
                  </div>
                </Panel>

                <Panel eyebrow="Demand ledger" title="Requests and transfers">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Requests · {overview.requests.total}
                      </p>
                      <Distribution data={overview.requests.byStatus} />
                      <p className="mt-2 text-[9px] text-muted-foreground">
                        {overview.requests.open} open · {overview.requests.demo} labelled demo
                      </p>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Transfers · {overview.transfers.total}
                      </p>
                      <Distribution data={overview.transfers.byStatus} />
                      <p className="mt-2 text-[9px] text-muted-foreground">
                        {overview.agreements.active} active agreement(s) ·{" "}
                        {overview.agreements.auto} pre-authorised
                      </p>
                    </div>
                  </div>
                </Panel>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Panel eyebrow="Donor fallback" title="Invitation funnel">
                  <Distribution data={overview.donors.byStatus} />
                  <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                    {overview.donors.invitations} invitation(s). {overview.donors.consentModel}
                  </p>
                </Panel>
                <Panel eyebrow="Uncrewed logistics" title="Mission states">
                  <Distribution
                    data={overview.drones.byState}
                    labels={{
                      PLANNED: "Planned",
                      PREFLIGHT_CHECKING: "Preflight",
                      PREFLIGHT_PASSED: "Cleared",
                      DISPATCHED_TO_PICKUP: "To pickup",
                      AT_PICKUP: "At pickup",
                      PAYLOAD_LOADING: "Loading",
                      PAYLOAD_LOADED: "Loaded",
                      IN_TRANSIT_TO_DESTINATION: "In transit",
                      AT_DESTINATION: "At destination",
                      DELIVERED: "Delivered",
                      RETURNING_TO_BASE: "Returning",
                      COMPLETED: "Completed",
                      HOLD: "Hold",
                      ABORTED: "Aborted",
                      EMERGENCY_LANDING: "Emergency landing",
                    }}
                  />
                  <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                    {overview.drones.active} active · {overview.drones.completed} completed ·{" "}
                    <strong>all simulated</strong>.
                  </p>
                </Panel>
                <Panel eyebrow="Notifications" title="Delivery pipeline">
                  <Distribution data={overview.notifications.byStatus} />
                  <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                    In-app is delivered immediately; email/SMS require provider keys. Push is not
                    implemented. Duplicate sends are blocked by an idempotency key.
                  </p>
                </Panel>
              </div>
            </div>
          )}

          {tab === "network" && (
            <div className="space-y-4">
              <Panel
                eyebrow="Onboarding"
                title="Verified facilities and transfer authority"
                action={<span className="text-[10px] text-muted-foreground">{verified.length} facilities</span>}
              >
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">
                        <th className="py-1.5 pr-2 font-bold">Facility</th>
                        <th className="py-1.5 pr-2 font-bold">Type</th>
                        <th className="py-1.5 pr-2 font-bold">City</th>
                        <th className="py-1.5 pr-2 font-bold">Transfer</th>
                        <th className="py-1.5 pr-2 font-bold">Auto</th>
                        <th className="py-1.5 pr-2 font-bold">Reserve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {verified.map((facility) => (
                        <tr key={facility._id} className="border-b border-border/60 text-[10px]">
                          <td className="py-1.5 pr-2">
                            <span className="font-semibold">{facility.name}</span>
                            {facility.isDemo && (
                              <span className="ml-1 inline-block align-middle">
                                <DemoBadge />
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 capitalize text-muted-foreground">
                            {facility.type.replace("_", " ")}
                          </td>
                          <td className="py-1.5 pr-2 text-muted-foreground">{facility.city}</td>
                          <td className="py-1.5 pr-2">
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[8.5px] font-bold",
                                facility.transferAuthorized
                                  ? "bg-teal-50 text-teal-700"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {facility.transferAuthorized ? "authorised" : "disabled"}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-muted-foreground">
                            {facility.autoAllocate ? "yes" : "no"}
                          </td>
                          <td className="py-1.5 pr-2 text-muted-foreground">
                            {facility.protectedReserveDefault} u
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel eyebrow="Policy" title="Facility transfer settings">
                  <div className="space-y-2">
                    <select
                      value={policyOrg}
                      onChange={(event) => {
                        setPolicyOrg(event.target.value);
                        const facility = verified.find((f) => String(f._id) === event.target.value);
                        if (facility) {
                          setPolicyTransfer(facility.transferAuthorized);
                          setPolicyAuto(facility.autoAllocate);
                          setPolicyReserve(String(facility.protectedReserveDefault));
                        }
                      }}
                      className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[10px]"
                    >
                      <option value="">Verified facility…</option>
                      {verified.map((f) => (
                        <option key={f._id} value={String(f._id)}>
                          {f.name} · {f.city}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-3 text-[10px]">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={policyTransfer}
                          onChange={(event) => setPolicyTransfer(event.target.checked)}
                        />
                        Transfer authorised
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={policyAuto}
                          onChange={(event) => setPolicyAuto(event.target.checked)}
                        />
                        Automatic allocation
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          Protected reserve (u)
                        </label>
                        <Input
                          value={policyReserve}
                          onChange={(event) => setPolicyReserve(event.target.value)}
                          className="mt-0.5 h-8 text-[10.5px]"
                        />
                      </div>
                      <div>
                        <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          Search radius (km)
                        </label>
                        <Input
                          value={policyRadius}
                          onChange={(event) => setPolicyRadius(event.target.value)}
                          className="mt-0.5 h-8 text-[10.5px]"
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="w-full gap-1.5 text-[10px]"
                      disabled={busy === "policy" || !policyOrg}
                      onClick={() => void applyPolicy()}
                    >
                      {busy === "policy" ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <ShieldCheck className="size-3" />
                      )}
                      Save policy
                    </Button>
                    <p className="text-[9px] leading-4 text-muted-foreground">
                      The reserve is subtracted from allocatable stock for that facility. Disabling
                      transfer authority removes it from every automatic search.
                    </p>
                  </div>
                </Panel>

                <Panel eyebrow="Pre-authorisation" title="Create or update an agreement">
                  <div className="space-y-2">
                    <select
                      value={requestingOrg}
                      onChange={(event) => setRequestingOrg(event.target.value)}
                      className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[10px]"
                    >
                      <option value="">Requesting facility…</option>
                      {verified.map((f) => (
                        <option key={f._id} value={String(f._id)}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={supplyingOrg}
                      onChange={(event) => setSupplyingOrg(event.target.value)}
                      className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[10px]"
                    >
                      <option value="">Supplying facility…</option>
                      {verified.map((f) => (
                        <option key={f._id} value={String(f._id)}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <Input
                        value={agreementUnits}
                        onChange={(event) => setAgreementUnits(event.target.value)}
                        placeholder="Max units/request"
                        className="h-8 flex-1 text-[10.5px]"
                      />
                      <label className="flex items-center gap-1.5 text-[10px]">
                        <input
                          type="checkbox"
                          checked={agreementAuto}
                          onChange={(event) => setAgreementAuto(event.target.checked)}
                        />
                        Auto-reserve
                      </label>
                    </div>
                    <Button
                      size="sm"
                      className="w-full gap-1.5 text-[10px]"
                      disabled={busy === "agreement"}
                      onClick={() => void addAgreement()}
                    >
                      {busy === "agreement" ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <GitBranch className="size-3" />
                      )}
                      Save agreement
                    </Button>
                    <div className="mt-2 space-y-1">
                      {(agreements ?? []).slice(0, 5).map((agreement) => (
                        <p
                          key={agreement._id}
                          className="rounded-lg bg-muted/30 px-2 py-1.5 text-[9px] leading-4 text-muted-foreground"
                        >
                          <strong className="text-foreground">{agreement.requestingName}</strong> ←{" "}
                          {agreement.supplyingName} · max {agreement.maxUnitsPerRequest} u ·{" "}
                          {agreement.autoAllocate ? "auto" : "manual"} · {agreement.status}
                        </p>
                      ))}
                    </div>
                  </div>
                </Panel>
              </div>

              <Panel eyebrow="Drone operations role" title="Grant flight operations access">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Existing staff email
                    </label>
                    <Input
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="ops@example.org"
                      className="mt-0.5 h-8 text-[10.5px]"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-[10px]"
                    disabled={busy === "grant" || !email.includes("@")}
                    onClick={() =>
                      void run(
                        "grant",
                        () => grantDroneOps({ email }),
                        "Drone operations role granted and audited.",
                      )
                    }
                  >
                    <PlaneIcon /> Grant drone ops
                  </Button>
                </div>
                <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                  Donors and requestors cannot be converted. The account must already exist.
                </p>
              </Panel>
            </div>
          )}

          {tab === "integrations" && (
            <div className="space-y-4">
              <Panel
                eyebrow="Adapter registry"
                title="Hospital and blood-bank feeds"
                action={
                  <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-[9.5px]">
                    <a href="/supply">
                      <Zap className="size-3" /> Open sync controls
                    </a>
                  </Button>
                }
              >
                {(integrations ?? []).length === 0 ? (
                  <p className="py-6 text-center text-[10.5px] text-muted-foreground">
                    No adapters registered. Live adapters require credentials configured in the
                    deployment environment; mock adapters are available for development.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {(integrations ?? []).map((integration) => (
                      <div
                        key={integration._id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-2.5"
                      >
                        <div>
                          <p className="text-[10.5px] font-semibold">
                            {integration.label}{" "}
                            {integration.isMock && (
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[8px] font-bold uppercase text-amber-800">
                                mock
                              </span>
                            )}
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            {integration.organizationName} · {integration.kind} ·{" "}
                            {integration.credentialEnvVar ?? "no key required"}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[8.5px] font-bold uppercase",
                            integration.status === "connected"
                              ? "bg-teal-50 text-teal-700"
                              : integration.status === "error"
                                ? "bg-rose-50 text-rose-700"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {integration.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel eyebrow="Sync audit" title="Recent runs">
                {runs === undefined ? (
                  <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading runs…
                  </div>
                ) : runs.length === 0 ? (
                  <p className="py-6 text-center text-[10.5px] text-muted-foreground">
                    No synchronisation has run yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-border text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">
                          <th className="py-1.5 pr-2 font-bold">Adapter</th>
                          <th className="py-1.5 pr-2 font-bold">Facility</th>
                          <th className="py-1.5 pr-2 font-bold">Started</th>
                          <th className="py-1.5 pr-2 font-bold">Status</th>
                          <th className="py-1.5 pr-2 font-bold">Read/Applied</th>
                          <th className="py-1.5 pr-2 font-bold">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map((syncRun) => (
                          <tr key={syncRun._id} className="border-b border-border/60 text-[9.5px]">
                            <td className="py-1.5 pr-2">
                              {syncRun.integrationLabel}{" "}
                              {syncRun.isMock && (
                                <span className="text-[8px] font-bold uppercase text-amber-700">
                                  mock
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {syncRun.organizationName}
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {formatRelative(syncRun.startedAt)}
                            </td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={cn(
                                  "font-semibold capitalize",
                                  syncRun.status === "success"
                                    ? "text-teal-700"
                                    : syncRun.status === "failed"
                                      ? "text-rose-700"
                                      : "text-muted-foreground",
                                )}
                              >
                                {syncRun.status}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {syncRun.recordsRead}/{syncRun.recordsApplied}
                            </td>
                            <td className="max-w-[220px] truncate py-1.5 pr-2 text-rose-700">
                              {syncRun.error ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === "safety" && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <Panel
                  eyebrow="Anomaly detection"
                  title="Recorded safety and data events"
                  action={
                    <span className="text-[10px] text-muted-foreground">
                      {overview.anomalies.unacknowledged} open
                    </span>
                  }
                >
                  <div className="space-y-1.5">
                    {(anomalies?.persisted ?? []).length === 0 ? (
                      <p className="py-6 text-center text-[10.5px] text-muted-foreground">
                        No persisted anomaly has been raised.
                      </p>
                    ) : (
                      anomalies!.persisted.map((event) => (
                        <div
                          key={event._id}
                          className={cn(
                            "rounded-xl border p-2.5",
                            event.severity === "critical"
                              ? "border-rose-200 bg-rose-50/50"
                              : "border-border bg-background",
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-[10px] font-bold capitalize">
                                {event.kind.replace(/_/g, " ")} · {event.severity}
                              </p>
                              <p className="text-[9px] leading-4 text-muted-foreground">
                                {event.note}
                              </p>
                              <p className="text-[8.5px] text-muted-foreground">
                                {formatDateTime(event.at)}
                                {event.zScore != null ? ` · z=${event.zScore}` : ""}
                              </p>
                            </div>
                            {event.acknowledged ? (
                              <span className="flex items-center gap-1 text-[8.5px] font-semibold text-teal-700">
                                <CheckCircle2 className="size-3" /> acknowledged
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[9px]"
                                disabled={busy === `ack-${event._id}`}
                                onClick={() =>
                                  void run(
                                    `ack-${event._id}`,
                                    () => acknowledge({ anomalyId: event._id }),
                                    "Anomaly acknowledged.",
                                  )
                                }
                              >
                                Acknowledge
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>

                <Panel eyebrow="Demand anomalies" title="Trailing 28-day z-score">
                  <div className="space-y-1.5">
                    {(anomalies?.demandFindings ?? []).length === 0 ? (
                      <p className="py-6 text-center text-[10.5px] text-muted-foreground">
                        No demand deviation crossed the threshold.
                      </p>
                    ) : (
                      anomalies!.demandFindings.map((finding) => (
                        <div
                          key={`${finding.date}-${finding.bloodGroup}`}
                          className="rounded-xl border border-amber-200 bg-amber-50/60 p-2.5 text-[9.5px] leading-4 text-amber-900"
                        >
                          <strong>
                            {finding.bloodGroup} · {finding.direction}
                          </strong>{" "}
                          on {finding.date}: observed {finding.observed}, expected{" "}
                          {finding.expected}, z {finding.zScore}.
                        </div>
                      ))
                    )}
                  </div>
                  <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                    {anomalies?.method}
                  </p>
                </Panel>
              </div>

              <Panel
                eyebrow="Notification outbox"
                title="Delivery status and idempotency"
                action={
                  <span className="text-[10px] text-muted-foreground">
                    {overview.notifications.failed} failed / {overview.notifications.total}
                  </span>
                }
              >
                {queue === undefined ? (
                  <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading outbox…
                  </div>
                ) : queue.length === 0 ? (
                  <p className="py-6 text-center text-[10.5px] text-muted-foreground">
                    No notification jobs have been queued.
                  </p>
                ) : (
                  <div className="max-h-[360px] overflow-y-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-border text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">
                          <th className="py-1.5 pr-2 font-bold">Channel</th>
                          <th className="py-1.5 pr-2 font-bold">Subject</th>
                          <th className="py-1.5 pr-2 font-bold">Status</th>
                          <th className="py-1.5 pr-2 font-bold">Attempts</th>
                          <th className="py-1.5 pr-2 font-bold">Next retry</th>
                          <th className="py-1.5 pr-2 font-bold">Created</th>
                          <th className="py-1.5 pr-2 font-bold">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queue.map((job) => (
                          <tr key={job._id} className="border-b border-border/60 text-[9.5px]">
                            <td className="py-1.5 pr-2 capitalize">{job.channel}</td>
                            <td className="max-w-[240px] truncate py-1.5 pr-2">{job.subject}</td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={cn(
                                  "font-semibold capitalize",
                                  job.status === "failed"
                                    ? "text-rose-700"
                                    : job.status === "sent"
                                      ? "text-teal-700"
                                      : "text-muted-foreground",
                                )}
                              >
                                {job.status}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">{job.attempts}</td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {job.nextAttemptAt ? formatRelative(job.nextAttemptAt) : "—"}
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {formatRelative(job.createdAt)}
                            </td>
                            <td className="max-w-[180px] truncate py-1.5 pr-2 text-rose-700">
                              {job.lastError ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                  Push notifications are not implemented. Missing email/SMS credentials mark jobs{" "}
                  <code className="rounded bg-muted px-1">skipped_no_provider</code> rather than
                  pretending they were delivered.
                </p>
              </Panel>
            </div>
          )}

          {tab === "ml" && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel eyebrow="Demand model" title="Python XGBoost service">
                  <p className="text-[10.5px] leading-5 text-muted-foreground">
                    {modelStatus?.demandModel.type}. {modelStatus?.demandModel.validation}. The
                    bundled artifacts were trained on labelled synthetic data; retraining here uses
                    this deployment's recorded issue/dispatch transactions.
                  </p>
                  <p className="mt-2 rounded-lg border border-border bg-background px-2 py-1.5 text-[9px] leading-4 text-muted-foreground">
                    {modelStatus?.demandModel.active
                      ? `${modelStatus.demandModel.version} · trained ${formatRelative(modelStatus.demandModel.trainedAt ?? Date.now())} · ${modelStatus.demandModel.sampleSize} rows`
                      : "No Convex-retrained XGBoost model is registered yet. Forecast refresh still uses the bundled labelled-synthetic artifact."}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                    <div className="rounded-lg bg-muted/30 p-2">
                      <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                        Stored runs
                      </p>
                      <p className="text-[14px] font-extrabold">{modelStatus?.demandForecasts.length ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-2">
                      <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                        Insufficient
                      </p>
                      <p className="text-[14px] font-extrabold">
                        {modelStatus?.demandForecasts.filter((f) => f.status === "insufficient_data").length ?? 0}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-2">
                      <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                        Latest
                      </p>
                      <p className="mt-1 text-[10px] font-bold">
                        {modelStatus?.demandForecasts.length
                          ? formatRelative(
                              modelStatus.demandForecasts[modelStatus.demandForecasts.length - 1].runAt,
                            )
                          : "none"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 gap-1 text-[9.5px]"
                      disabled={busy === "train-demand"}
                      onClick={() =>
                        void run(
                          "train-demand",
                          async () => {
                            const result = await trainDemandModel();
                            toast.success(`XGBoost ${result.version} trained`, {
                              description: `${result.sampleSize} rows · MAE ${String(result.metrics.mae ?? "—")} · baseline ${String(result.metrics.baseline_mae ?? "—")}`,
                            });
                            return result;
                          },
                          "XGBoost retraining completed.",
                        )
                      }
                    >
                      {busy === "train-demand" ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <BrainCircuit className="size-3" />
                      )}
                      Retrain from Convex history
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-[9.5px]"
                      disabled={busy === "check-ml"}
                      onClick={() =>
                        void run(
                          "check-ml",
                          async () => {
                            const result = await checkMlService();
                            if (!result.reachable) {
                              toast.error("ML service unreachable", {
                                description: result.error,
                              });
                            } else {
                              toast.success("ML service reachable", {
                                description: `${result.status} · ${result.version}`,
                              });
                            }
                            return result;
                          },
                          "ML service check completed.",
                        )
                      }
                    >
                      {busy === "check-ml" ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <ServerCog className="size-3" />
                      )}
                      Check service
                    </Button>
                  </div>
                  <div className="mt-3 max-h-[220px] space-y-1 overflow-y-auto">
                    {(modelStatus?.demandForecasts ?? [])
                      .slice()
                      .reverse()
                      .slice(0, 8)
                      .map((forecast) => (
                        <p
                          key={forecast._id}
                          className="rounded-lg border border-border bg-background px-2 py-1.5 text-[9px] text-muted-foreground"
                        >
                          <strong className="text-foreground">
                            {forecast.bloodGroup} {COMPONENT_LABELS[forecast.component]}
                          </strong>{" "}
                          · {forecast.scope} · {forecast.status} ·{" "}
                          {forecast.metrics
                            ? `MAE ${forecast.metrics.mae}, RMSE ${forecast.metrics.rmse}, baseline ${forecast.metrics.baselineMae}`
                            : "no metrics"}
                        </p>
                      ))}
                  </div>
                </Panel>

                <Panel eyebrow="Responder model" title="Donor response classifier">
                  {modelStatus?.donorModel?.active ? (
                    <>
                      <p className="text-[11px] font-semibold">{modelStatus.donorModel.version}</p>
                      <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                        Trained on {modelStatus.donorModel.sampleSize} consented invitation
                        outcome(s) at {formatDateTime(modelStatus.donorModel.trainedAt ?? Date.now())}.
                        {typeof modelStatus.donorModel.metrics?.roc_auc === "number"
                          ? ` Holdout ROC-AUC ${modelStatus.donorModel.metrics.roc_auc}.`
                          : " No holdout metric is available for this historical model."}
                      </p>
                    </>
                  ) : (
                    <p className="text-[10.5px] leading-5 text-muted-foreground">
                      {modelStatus?.donorModel?.note ??
                        "No Convex-retrained donor model is registered. The bundled Python Random Forest artifact is used when ML_SERVICE_URL is configured; otherwise invitations use an explicit distance-only fallback."}
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="mt-3 gap-1.5 text-[10px]"
                    disabled={busy === "train" || overview.organizations.total === 0}
                    onClick={() =>
                      void run(
                        "train",
                        async () => {
                          const result = await trainDonorModel();
                          toast.success(`Random Forest ${result.version} trained`, {
                            description: `${result.sampleSize} consented outcomes · ROC-AUC ${String(result.metrics.roc_auc ?? "—")}`,
                          });
                          return result;
                        },
                        "Donor model retraining completed.",
                      )
                    }
                  >
                    {busy === "train" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <BrainCircuit className="size-3" />
                    )}
                    Retrain donor model
                  </Button>
                  <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                    Predictions only order already-eligible, consented invitations. ABO/Rh
                    eligibility, deferrals and collection release remain deterministic clinical
                    rules. If the service is unreachable, invitations use distance only and no
                    probability is stored.
                  </p>
                </Panel>
              </div>

              <Panel eyebrow="Evaluation" title="What the metrics mean">
                <ul className="grid gap-2 text-[10px] leading-4 text-muted-foreground sm:grid-cols-2">
                  <li className="rounded-lg border border-border bg-background p-2">
                    <strong className="text-foreground">Chronological split.</strong> The last 20% of
                    days is held out; the model never trains on held-out future days. Bundled
                    metrics are synthetic-data evidence only.
                  </li>
                  <li className="rounded-lg border border-border bg-background p-2">
                    <strong className="text-foreground">Baseline comparison.</strong> Every forecast
                    reports MAE/RMSE against a 7-day rolling-mean baseline.
                  </li>
                  <li className="rounded-lg border border-border bg-background p-2">
                    <strong className="text-foreground">Model versioning.</strong> Every stored run
                    records its model id, sample size, metrics and confidence.
                  </li>
                  <li className="rounded-lg border border-border bg-background p-2">
                    <strong className="text-foreground">Data freshness.</strong>{" "}
                    {overview.ml.lastForecastAt
                      ? `Last forecast ${formatRelative(overview.ml.lastForecastAt)}.`
                      : "No forecast has been stored yet."}{" "}
                    Demo transactions are labelled separately.
                  </li>
                </ul>
              </Panel>
            </div>
          )}

          {tab === "audit" && (
            <div className="space-y-4">
              <Panel eyebrow="Immutable append-only log" title="Recent administrative actions">
                {overview.audit.length === 0 ? (
                  <p className="py-6 text-center text-[10.5px] text-muted-foreground">
                    No audit entries yet.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {overview.audit.map((entry) => (
                      <div
                        key={entry._id}
                        className="rounded-xl border border-border bg-background p-2.5"
                      >
                        <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
                          {entry.action}
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[8px] font-bold uppercase text-muted-foreground">
                            {entry.actorRole}
                          </span>
                          {entry.isDemo && <DemoBadge />}
                        </p>
                        <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
                          {entry.detail}
                        </p>
                        <p className="text-[8.5px] text-muted-foreground">
                          {formatDateTime(entry.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
              <Panel eyebrow="Security posture" title="Controls in force">
                <div className="grid gap-2 text-[10px] leading-4 text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Authentication", "Convex Auth sessions; every mutation resolves the caller from context."],
                    ["Role gates", "Admin, staff, drone ops and donor operations check roles server-side."],
                    ["Donor privacy", "Consent row required; no location without active, unexpired consent."],
                    ["Atomic reservations", "Serializable Convex mutations re-check free stock before every write."],
                    ["Clinical safety", "Compatibility and release checks are deterministic and separate from ML."],
                    ["Secrets", "API credentials stay in deployment env vars, never in the database or browser."],
                    ["Audit", "Administrative and safety actions append to the audit log."],
                    ["Rate limiting", "Not implemented at the platform edge — documented limitation."],
                    ["Backups", "Deployment-level Convex backups; recovery plan documented."],
                  ].map(([title, detail]) => (
                    <p key={title} className="rounded-lg border border-border bg-background p-2">
                      <strong className="text-foreground">{title}.</strong> {detail}
                    </p>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}

function PlaneIcon() {
  return <Radio className="size-3" />;
}
