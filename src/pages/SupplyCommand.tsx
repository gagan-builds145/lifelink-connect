import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import { NETWORK_MAP_NOTE, NetworkMap, type NetworkMapPoint } from "@/components/lifelink/NetworkMap";
import {
  BloodGroupChip,
  DemoBadge,
  EmptyState,
  StatCard,
  StatusBadge,
  UrgencyBadge,
} from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  COMPONENT_LABELS,
  formatDateTime,
  formatRelative,
  type BloodGroup,
  type Component,
} from "@/lib/blood";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import { cn, friendlyError } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ClipboardList,
  Database,
  Gauge,
  Loader2,
  PackageCheck,
  Radio,
  RefreshCcw,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  Undo2,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Scope = "city" | "district" | "state" | "country";

const receiptCode = () => `SUP-${Date.now().toString(36).slice(-5).toUpperCase()}`;

const RECEIPT_VERIFICATION = [
  {
    key: "labelVerified",
    label: "Label, blood group and component verified",
    hint: "The physical label matches this transfer and the linked request.",
  },
  {
    key: "screeningAndReleaseConfirmed",
    label: "Screening and release conditions confirmed",
    hint: "Only screened, released units are accepted into the ledger.",
  },
  {
    key: "temperatureOk",
    label: "Storage temperature and cold-chain check passed",
    hint: "Record any excursion instead of confirming receipt.",
  },
  {
    key: "packagingIntact",
    label: "Packaging intact and no leakage",
    hint: "Damaged units must be quarantined, not credited.",
  },
  {
    key: "crossMatchConfirmed",
    label: "Cross-match / laboratory confirmation recorded",
    hint: "ABO/Rh rules are advisory; qualified staff make the final release decision.",
  },
] as const;

type ReceiptVerificationKey = (typeof RECEIPT_VERIFICATION)[number]["key"];

type ReceiptTarget = {
  _id: Id<"transfers">;
  transferId: string;
  units: number;
  bloodGroup: BloodGroup;
  component: Component;
};

const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: "city", label: "This city" },
  { key: "district", label: "District · 75 km" },
  { key: "state", label: "Whole state" },
  { key: "country", label: "Country-wide" },
];

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/70 p-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-[15px] font-extrabold leading-none">{value}</p>
      {hint && <p className="mt-1 text-[9.5px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

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
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          {eyebrow && (
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
          )}
          <h2 className="mt-0.5 text-[13px] font-bold leading-5">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function SupplyCommand() {
  const { user } = useAuth();
  const org = useQuery(api.profiles.myOrganization);
  const requests = useQuery(api.requests.listForStaff, {});
  const facilities = useQuery(api.allocation.networkFacilities);
  const transfers = useQuery(api.allocation.transfersForMe);
  const integrations = useQuery(api.integrations.listIntegrations);
  const modelStatus = useQuery(api.forecasting.modelStatus);

  const [tab, setTab] = useState("allocation");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("city");
  const [component, setComponent] = useState<Component>("red_cells");
  const [busy, setBusy] = useState<string | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<ReceiptTarget | null>(null);
  const [receiptUnits, setReceiptUnits] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const [receiptChecks, setReceiptChecks] = useState<Record<ReceiptVerificationKey, boolean>>({
    labelVerified: false,
    screeningAndReleaseConfirmed: false,
    temperatureOk: false,
    packagingIntact: false,
    crossMatchConfirmed: false,
  });

  const autoAllocate = useAction(api.allocation.autoAllocate);
  const dispatchTransfer = useMutation(api.allocation.dispatchTransfer);
  const receiveTransfer = useMutation(api.allocation.receiveTransfer);
  const cancelTransfer = useMutation(api.allocation.cancelTransfer);
  const refreshForecasts = useAction(api.ml.refreshDemandForecasts);
  const scanAnomalies = useAction(api.ml.runAnomalyScan);
  const runMockSync = useMutation(api.integrations.runMockSync);
  const runLiveSync = useAction(api.integrations.runLiveSync);

  const canSuperviseTransfers = user?.role === "admin";
  const receiptVerificationComplete = RECEIPT_VERIFICATION.every(
    (check) => receiptChecks[check.key],
  );

  const openRequests = useMemo(
    () =>
      (requests ?? []).filter((r) =>
        [
          "pending",
          "under_verification",
          "approved",
          "dispatched",
          "partially_fulfilled",
        ].includes(r.status),
      ),
    [requests],
  );
  const effectiveSelectedId =
    selectedId ?? (openRequests[0] ? String(openRequests[0]._id) : null);
  const selected = useMemo(
    () => openRequests.find((r) => String(r._id) === effectiveSelectedId) ?? null,
    [openRequests, effectiveSelectedId],
  );

  const emergency = selected?.urgency === "emergency";
  const effectiveScope: Scope = emergency ? scope : "city";

  const search = useQuery(
    api.allocation.searchSupply,
    selected ? { requestId: selected._id, scope: effectiveScope } : "skip",
  );

  const forecast = useQuery(
    api.ml.latestDemandForecast,
    user?.role === "hospital" && org
      ? { organizationId: org._id, component }
      : user?.role === "hospital"
        ? "skip"
        : { component },
  );
  const anomalies = useQuery(
    api.forecasting.anomalyReport,
    org ? { organizationId: org._id } : {},
  );

  const role = (user?.role ?? "hospital") as AppRole;
  const orgPoints: NetworkMapPoint[] = useMemo(
    () =>
      (facilities ?? [])
        .filter((f) => f.latitude != null && f.longitude != null)
        .map((f) => ({
          id: String(f._id),
          lat: f.latitude!,
          lng: f.longitude!,
          label: f.name,
          kind: "facility" as const,
          detail: `${f.type.replace("_", " ")} · ${f.city}${f.autoAllocate ? " · auto-allocation enabled" : ""}`,
          active: false,
        })),
    [facilities],
  );
  const candidateMapPoints: NetworkMapPoint[] = useMemo(() => {
    const seen = new Set<string>();
    return (search?.candidates ?? [])
      .filter((c) => c.eligible && c.latitude != null && c.longitude != null)
      .filter((c) => {
        if (seen.has(c.organizationId)) return false;
        seen.add(c.organizationId);
        return true;
      })
      .map((c) => ({
        id: `candidate-${c.organizationId}`,
        lat: c.latitude!,
        lng: c.longitude!,
        label: c.organizationName,
        kind: "facility" as const,
        detail: `${c.usableUnits} free unit(s) · score ${c.score} · ${c.autoAuthorized ? "pre-authorised" : "agreement required"}`,
        active: true,
      }));
  }, [search]);

  const runAllocation = async () => {
    if (!selected) return;
    setBusy("allocate");
    try {
      const result = await autoAllocate({
        requestId: selected._id,
        scope: effectiveScope,
        note: "Automatic institutional allocation requested from the supply command centre.",
      });
      toast.success(
        result.allocated > 0
          ? `${result.allocated} unit(s) reserved`
          : "No institutional stock was available",
        {
          description:
            result.invitations && result.invitations.invited > 0
              ? `${result.invitations.invited} donor invitation(s) queued. Donors are not counted as stock.`
              : result.donorFallbackError
                ? `Donor fallback could not be queued: ${result.donorFallbackError}`
                : result.message,
        },
      );
    } catch (error) {
      toast.error("Automatic allocation failed", {
        description: friendlyError(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const openReceipt = (transfer: ReceiptTarget) => {
    setReceiptTarget(transfer);
    setReceiptUnits(String(transfer.units));
    setReceiptNote("");
    setReceiptChecks({
      labelVerified: false,
      screeningAndReleaseConfirmed: false,
      temperatureOk: false,
      packagingIntact: false,
      crossMatchConfirmed: false,
    });
  };

  const submitReceipt = async () => {
    if (!receiptTarget) return;
    const units = Number(receiptUnits);
    if (!Number.isInteger(units) || units < 1 || units > receiptTarget.units) {
      toast.error("Check the verified quantity", {
        description: `Enter a whole number between 1 and ${receiptTarget.units}.`,
      });
      return;
    }
    setBusy(`receive:${receiptTarget._id}`);
    try {
      const result = await receiveTransfer({
        transferId: receiptTarget._id,
        receivedUnits: units,
        verifiedBloodGroup: receiptTarget.bloodGroup,
        verifiedComponent: receiptTarget.component,
        verification: receiptChecks,
        note: receiptNote.trim() || undefined,
        evidenceCode: receiptCode(),
      });
      toast.success(result.duplicate ? "Receipt already recorded" : "Receipt verified", {
        description: result.duplicate
          ? "This retry was matched to the existing receipt. Inventory was not credited twice."
          : `${result.receivedUnits} unit(s) credited. Request status: ${String(result.requestStatus ?? "unchanged").replace(/_/g, " ")}.`,
      });
      setReceiptTarget(null);
    } catch (error) {
      toast.error("Could not verify receipt", {
        description: friendlyError(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const doTransferAction = async (
    action: "dispatch" | "cancel",
    transferId: Parameters<typeof dispatchTransfer>[0]["transferId"],
  ) => {
    setBusy(`${action}:${transferId}`);
    try {
      if (action === "dispatch") {
        const result = await dispatchTransfer({ transferId });
        toast.success(`Released ${result.units} unit(s)`, {
          description: "The receiving facility must verify and confirm receipt.",
        });
      } else {
        const result = await cancelTransfer({ transferId });
        toast("Transfer cancelled", {
          description: `${result.released} reserved unit(s) returned to stock.`,
        });
      }
    } catch (error) {
      toast.error(`Could not ${action} transfer`, {
        description: friendlyError(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const runIsolationForestScan = async () => {
    setBusy("anomaly-scan");
    try {
      const result = await scanAnomalies(
        user?.role === "hospital" && org ? { organizationId: org._id } : {},
      );
      toast.success(
        `${result.groupsScanned} series scanned · ${result.created} new alert(s)`,
        {
          description: `Isolation Forest ${result.modelVersion}${result.syntheticData ? " · synthetic training data" : ""}`,
        },
      );
    } catch (error) {
      toast.error("Isolation Forest scan failed", {
        description: friendlyError(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const syncIntegration = async (integrationId: string, isMock: boolean) => {
    setBusy(`sync:${integrationId}`);
    try {
      if (isMock) {
        const result = await runMockSync({ integrationId: integrationId as never });
        toast.success("Mock sync completed", {
          description: `${result.recordsApplied}/${result.recordsRead} demo record(s) applied. Imported stock is labelled Demo.`,
        });
      } else {
        const result = await runLiveSync({ integrationId: integrationId as never });
        if (result.failed) {
          toast.error("Live sync failed", {
            description: "The failure was recorded. No inventory was invented.",
          });
        } else {
          toast.success(`Live sync applied ${result.recordsApplied} record(s)`);
        }
      }
    } catch (error) {
      toast.error("Sync failed", {
        description: friendlyError(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const navItems = [
    { key: "allocation", label: "Autonomous allocation", icon: Zap, badge: openRequests.length },
    { key: "transfers", label: "Transfers & custody", icon: Truck, badge: (transfers ?? []).filter((t) => t.status === "reserved").length },
    { key: "forecast", label: "Demand intelligence", icon: BrainCircuit },
    { key: "integrations", label: "Facility integrations", icon: Database, badge: integrations?.filter((i) => i.status === "error").length },
  ];

  const activeTransfers = (transfers ?? []).filter((t) =>
    ["reserved", "approved", "dispatched", "in_transit"].includes(t.status),
  );

  return (
    <DashboardShell
      roleLabel={role === "hospital" ? "Hospital supply chain" : role === "red_cross" ? "Red Cross network" : ROLE_LABELS[role]}
      roleKey={org?.orgId ?? "Network command"}
      title="Autonomous blood supply command"
      subtitle="Institutional search, deterministic allocation, custody-tracked transfers, demand forecasts and donor fallback — all backed by the shared LifeLink ledger."
      items={navItems}
      active={tab}
      onSelect={setTab}
      demoData={(requests ?? []).some((r) => r.isDemo)}
      accentIcon={Zap}
      quickLinks={[
        { label: "Drone operations", href: "/drones", icon: RouteIcon },
        { label: "Public blood search", href: "/blood-search", icon: Search },
        { label: "Donation camps", href: "/donation-camps", icon: Building2 },
      ]}
    >
      <div className="mb-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open requests"
          value={openRequests.length}
          hint="Hospital-originated and verified network requests"
          icon={ClipboardList}
        />
        <StatCard
          label="Authorised units found"
          value={search?.coverage.authorizedUnits ?? "—"}
          hint={search ? `${search.coverage.eligibleSources} eligible source(s)` : "Select a request"}
          icon={ShieldCheck}
          tone="teal"
        />
        <StatCard
          label="Transfers in custody"
          value={activeTransfers.length}
          hint="Reserved, dispatched or in transit"
          icon={Truck}
          tone="primary"
        />
        <StatCard
          label="Inventory alerts"
          value={(anomalies?.persisted ?? []).filter((a) => !a.acknowledged).length + (anomalies?.demandFindings.length ?? 0)}
          hint="Demand anomalies and sync failures"
          icon={AlertTriangle}
          tone="amber"
        />
      </div>

      {tab === "allocation" && (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <Panel
            eyebrow="Step 1"
            title="Choose a network request"
            className="self-start"
            action={<span className="text-[10px] text-muted-foreground">{openRequests.length} open</span>}
          >
            {requests === undefined ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading requests…
              </div>
            ) : openRequests.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No open requests"
                description="A hospital must submit a request before the network can allocate stock."
                className="border-0 bg-transparent px-2 py-6"
              />
            ) : (
              <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
                {openRequests.map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => {
                      setSelectedId(String(r._id));
                      setScope(r.urgency === "emergency" ? "district" : "city");
                    }}
                    className={cn(
                      "w-full rounded-xl border p-2.5 text-left transition-colors",                          String(r._id) === effectiveSelectedId
                        ? "border-primary/30 bg-primary/[0.045]"
                        : "border-border bg-background hover:border-primary/20",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <BloodGroupChip group={r.bloodGroup} size="sm" />
                        <div>
                          <p className="text-[11px] font-bold leading-4">{r.requestId}</p>
                          <p className="text-[9.5px] text-muted-foreground">
                            {r.hospitalName} · {r.city}
                          </p>
                        </div>
                      </div>
                      {r.isDemo && <DemoBadge />}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <UrgencyBadge urgency={r.urgency} />
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">
                        {r.units} × {COMPONENT_LABELS[r.component]}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel
              eyebrow="Step 2"
              title="Eligibility-validated institutional search"
              action={
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-[10.5px]"
                    onClick={() => void runAllocation()}
                    disabled={!selected || busy === "allocate"}
                  >
                    {busy === "allocate" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Zap className="size-3.5" />
                    )}
                    Auto-allocate
                  </Button>
                  {search && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-[10.5px]"
                      onClick={() => {
                        if (!search.need.requestId) return;
                        setTab("transfers");
                      }}
                    >
                      Transfers <ArrowRight className="size-3" />
                    </Button>
                  )}
                </div>
              }
            >
              {!selected ? (
                <EmptyState
                  icon={Zap}
                  title="Select a request"
                  description="LifeLink will evaluate every verified batch for compatibility, release status, expiry and protected reserve before ranking by distance."
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/25 p-3">
                    <div>
                      <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold">
                        {selected.requestId}
                        <StatusBadge status={selected.status} />
                        <UrgencyBadge urgency={selected.urgency} />
                        {selected.isDemo && <DemoBadge />}
                      </p>
                      <p className="mt-1 text-[10.5px] text-muted-foreground">
                        {selected.bloodGroup} · {COMPONENT_LABELS[selected.component]} · {selected.units} unit(s) ·{" "}
                        {selected.hospitalName}, {selected.city}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Needed by
                      </p>
                      <p className="text-[10.5px] font-semibold">{formatDateTime(selected.requiredBy)}</p>
                    </div>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Search scope
                      </p>
                      {!emergency && (
                        <p className="text-[10px] font-medium text-amber-700">
                          City-only for routine/urgent · state and country open only for emergencies
                        </p>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {SCOPES.map((s) => {
                        const disabled = !emergency && s.key !== "city";
                        return (
                          <button
                            key={s.key}
                            type="button"
                            disabled={disabled}
                            onClick={() => setScope(s.key)}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors",
                              effectiveScope === s.key
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background text-muted-foreground hover:border-primary/30",
                              disabled && "cursor-not-allowed opacity-40",
                            )}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {search === undefined ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Evaluating eligibility…
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2.5 sm:grid-cols-4">
                        <Metric label="Remaining need" value={`${search.need.remainingUnits} u`} />
                        <Metric
                          label="Eligible stock"
                          value={`${search.coverage.available} u`}
                          hint={`${search.coverage.eligibleSources} source(s)`}
                        />
                        <Metric
                          label="Pre-authorised"
                          value={`${search.coverage.authorizedUnits} u`}
                          hint="Can be reserved automatically"
                        />
                        <Metric
                          label="Blocked / expired"
                          value={`${search.coverage.expiredOrBlocked}`}
                          hint="Excluded before ranking"
                        />
                      </div>

                      {search.coverage.shortage > 0 && (
                        <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 text-[10.5px] leading-5 text-amber-900">
                          <strong>Institutional shortfall of {search.coverage.shortage} unit(s).</strong>{" "}
                          Automatic allocation will invite eligible donors only after reservations are
                          attempted. Donors are never counted as available units.
                        </div>
                      )}

                      <div className="overflow-hidden rounded-xl border border-border">
                        <div className="grid grid-cols-[1.4fr_0.7fr_0.6fr_0.6fr_0.5fr] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          <span>Source</span>
                          <span>Batch / expiry</span>
                          <span>Distance</span>
                          <span>Free</span>
                          <span>Score</span>
                        </div>
                        {search.candidates.length === 0 ? (
                          <div className="px-4 py-8 text-center text-[11px] text-muted-foreground">
                            No batch matched this request. Check the city, group and component.
                          </div>
                        ) : (
                          search.candidates.slice(0, 14).map((c) => (
                            <div
                              key={`${c.organizationId}-${c.batchId}`}
                              className={cn(
                                "grid grid-cols-[1.4fr_0.7fr_0.6fr_0.6fr_0.5fr] items-start gap-2 border-b border-border px-3 py-2.5 last:border-0",
                                !c.eligible && "bg-muted/20 opacity-70",
                              )}
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[10.5px] font-semibold">{c.organizationName}</p>
                                <p className="flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
                                  {c.city} · {c.organizationType?.replace("_", " ")}
                                  {c.isDemo && <DemoBadge />}
                                  {c.autoAuthorized && (
                                    <span className="rounded-full bg-teal-50 px-1.5 py-0.5 font-bold text-teal-700">
                                      auto
                                    </span>
                                  )}
                                </p>
                                {c.blockers.length > 0 && (
                                  <p className="mt-0.5 text-[8.5px] leading-3.5 text-rose-700">
                                    {c.blockers[0]}
                                  </p>
                                )}
                              </div>
                              <div className="text-[9.5px] leading-4 text-muted-foreground">
                                <p className="truncate font-medium text-foreground">{c.batchId.slice(-6)}</p>
                                <p>{c.expiryDate}</p>
                              </div>
                              <p className="text-[9.5px] text-muted-foreground">
                                {c.distanceKm != null ? `${c.distanceKm} km` : "—"}
                              </p>
                              <p className="text-[10px] font-semibold">{c.usableUnits}</p>
                              <p
                                className={cn(
                                  "font-display text-[12px] font-extrabold",
                                  c.eligible ? "text-teal-700" : "text-muted-foreground",
                                )}
                              >
                                {c.score}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                      <p className="text-[9.5px] leading-4 text-muted-foreground">
                        {search.disclaimer}
                      </p>
                    </>
                  )}
                </div>
              )}
            </Panel>

            <Panel eyebrow="Spatial view" title="Facilities and eligible supply">
              <NetworkMap
                points={[...orgPoints, ...candidateMapPoints]}
                height={300}
                focus={candidateMapPoints[0] ? [candidateMapPoints[0].lat, candidateMapPoints[0].lng] : null}
              />
              <p className="mt-2 text-[9.5px] leading-4 text-muted-foreground">{NETWORK_MAP_NOTE}</p>
            </Panel>
          </div>
        </div>
      )}

      {tab === "transfers" && (
        <div className="space-y-4">
          <Panel
            eyebrow="Custody ledger"
            title="Transfers involving your facility"
            action={
              <span className="text-[10px] text-muted-foreground">
                {(transfers ?? []).length} record(s)
              </span>
            }
          >
            {transfers === undefined ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading transfers…
              </div>
            ) : (transfers ?? []).length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No transfers yet"
                description="Run automatic allocation on an open request, or ask another facility to reserve stock for you."
              />
            ) : (
              <div className="space-y-2">
                {(transfers ?? []).map((t) => (
                  <div key={t._id} className="rounded-xl border border-border bg-background p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                          {t.transferId}
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold capitalize text-muted-foreground">
                            {t.status.replace("_", " ")}
                          </span>
                          {t.auto && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-1.5 py-0.5 text-[8.5px] font-bold text-teal-700">
                              <Sparkles className="size-2.5" /> automatic
                            </span>
                          )}
                          {t.isDemo && <DemoBadge />}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {t.suppliedBy} → {t.requestedBy} · {t.units} × {t.bloodGroup}{" "}
                          {COMPONENT_LABELS[t.component]}
                          {t.requestCode ? ` · ${t.requestCode}` : ""}
                        </p>
                        <p className="mt-0.5 text-[9.5px] text-muted-foreground">
                          Updated {formatRelative(t.updatedAt)}
                          {t.mission ? ` · simulated mission ${t.mission.missionId} (${t.mission.state})` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(t.isSupplier || canSuperviseTransfers) && ["reserved", "approved"].includes(t.status) && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 text-[9.5px]"
                            onClick={() => void doTransferAction("dispatch", t._id)}
                            disabled={busy === `dispatch:${t._id}`}
                          >
                            {busy === `dispatch:${t._id}` ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <PackageCheck className="size-3" />
                            )}
                            Release & dispatch
                          </Button>
                        )}
                        {(!t.isSupplier || canSuperviseTransfers) && ["dispatched", "in_transit"].includes(t.status) && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 text-[9.5px]"
                            onClick={() =>
                              openReceipt({
                                _id: t._id,
                                transferId: t.transferId,
                                units: t.units,
                                bloodGroup: t.sourceBloodGroup,
                                component: t.component,
                              })
                            }
                            disabled={busy === `receive:${t._id}`}
                          >
                            {busy === `receive:${t._id}` ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="size-3" />
                            )}
                            Confirm receipt
                          </Button>
                        )}
                        {["reserved", "approved"].includes(t.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-[9.5px]"
                            onClick={() => void doTransferAction("cancel", t._id)}
                            disabled={busy === `cancel:${t._id}`}
                          >
                            <Undo2 className="size-3" /> Release
                          </Button>
                        )}
                        {t.mission && (
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-[9.5px]"
                          >
                            <a href="/drones">
                              <RouteIcon className="size-3" /> Mission
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel eyebrow="Safety rule" title="Reservations are not clinical releases">
              <ul className="space-y-2 text-[11px] leading-5 text-muted-foreground">
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                  ABO/Rh eligibility is computed by deterministic rules. Expired, unreleased and
                  protected units are filtered out before distance is considered.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                  A reservation only holds stock. Physical release requires the supplying facility to
                  dispense the exact reserved batches.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                  Receipt verifies the component, group, quantity, screening/release, cold chain,
                  packaging and cross-match before crediting only the accepted units.
                </li>
              </ul>
            </Panel>
            <Panel eyebrow="Approval flow" title="What happens next">
              <ol className="space-y-2 text-[11px] leading-5 text-muted-foreground">
                <li>1. Request verified or hospital-originated · auto-allocation allowed.</li>
                <li>2. Eligible units reserved atomically across up to five pre-authorised facilities.</li>
                <li>3. Supplying facility releases the exact batches; a transfer enters custody.</li>
                <li>4. Receiving facility verifies the physical units and release conditions.</li>
                <li>5. Only verified units are credited; the request becomes partially fulfilled or fulfilled.</li>
              </ol>
            </Panel>
          </div>
        </div>
      )}

      {tab === "forecast" && (
        <div className="space-y-4">
          <Panel
            eyebrow="Machine learning · genuine evaluation"
            title={forecast ? `${forecast.organizationName} · demand forecast` : "Demand forecast"}
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={component}
                  onChange={(event) => setComponent(event.target.value as Component)}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-[10px] font-medium"
                >
                  {Object.entries(COMPONENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-[10px]"
                  disabled={busy === "forecast"}
                  onClick={async () => {
                    setBusy("forecast");
                    try {
                      const result = await refreshForecasts({
                        component,
                        ...(user?.role === "hospital" && org ? { organizationId: org._id } : {}),
                      });
                      toast.success(
                        `${result.groupsWithForecast}/8 blood groups forecast`,
                        {
                          description: `XGBoost ${result.modelVersion}${result.syntheticData ? " · synthetic/demo training data" : ""}`,
                        },
                      );
                    } catch (error) {
                      toast.error("Could not refresh XGBoost forecast", {
                        description: friendlyError(error),
                      });
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "forecast" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-3" />
                  )}
                  Refresh XGBoost forecast
                </Button>
              </div>
            }
          >
            {forecast === undefined ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Fitting model…
              </div>
            ) : forecast === null ? (
              <EmptyState
                icon={Gauge}
                title="Forecast unavailable"
                description="Your facility profile or role does not allow demand forecasting."
              />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/25 p-2.5 text-[10px] text-muted-foreground">
                  <BrainCircuit className="size-3.5 text-primary" />
                  <strong className="text-foreground">{forecast.dataDays}-day</strong> history ·
                  Python XGBoost · lags, rolling means and seasonality · chronological holdout
                  {forecast.modelVersion ? ` · ${forecast.modelVersion}` : ""}
                  {forecast.includesDemo && <DemoBadge />}
                </div>
                <p className="text-[10px] leading-4 text-muted-foreground">{forecast.dataScope}</p>
                {forecast.forecasts.length === 0 && (
                  <EmptyState
                    icon={BrainCircuit}
                    title="No XGBoost forecast stored yet"
                    description="Start the Python ML service and use Refresh XGBoost forecast. Existing Ridge forecasts are not shown."
                  />
                )}
                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                  {forecast.forecasts.slice(0, 8).map((row) => (
                    <div key={row.bloodGroup} className="rounded-xl border border-border bg-background p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <BloodGroupChip group={row.bloodGroup} size="sm" />
                          <div>
                            <p className="text-[10px] font-bold">{row.bloodGroup}</p>
                            <p className="text-[9px] text-muted-foreground">
                              {row.status === "ok" ? row.model : "insufficient data"}
                            </p>
                          </div>
                        </div>
                        {row.confidenceLabel && (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase",
                              row.confidenceLabel === "high"
                                ? "bg-teal-50 text-teal-700"
                                : row.confidenceLabel === "medium"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-rose-50 text-rose-700",
                            )}
                          >
                            {row.confidenceLabel}
                          </span>
                        )}
                      </div>
                      {row.status === "ok" ? (
                        <>
                          <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                            {[
                              ["24h", row.horizons.h24],
                              ["7d", row.horizons.h7],
                              ["30d", row.horizons.h30],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-lg bg-muted/40 px-1 py-1.5">
                                <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                                  {label}
                                </p>
                                <p className="text-[12px] font-extrabold">{value ?? "—"}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 space-y-0.5 text-[8.5px] leading-3.5 text-muted-foreground">
                            <p>
                              MAE <strong className="text-foreground">{row.metrics?.mae}</strong> · RMSE{" "}
                              <strong className="text-foreground">{row.metrics?.rmse}</strong>
                            </p>
                            <p>
                              Baseline MAE {row.metrics?.baselineMae} · holdout {row.metrics?.holdoutSize}
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                          {row.explanation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[9.5px] leading-4 text-muted-foreground">{forecast.disclaimer}</p>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            <Panel
              eyebrow="Anomaly detection"
              title="Demand and synchronisation anomalies"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[9.5px]"
                  disabled={busy === "anomaly-scan"}
                  onClick={() => void runIsolationForestScan()}
                >
                  {busy === "anomaly-scan" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <BrainCircuit className="size-3" />
                  )}
                  Isolation Forest scan
                </Button>
              }
            >
              {anomalies === undefined ? (
                <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Scanning…
                </div>
              ) : (
                <div className="space-y-2">
                  {(anomalies?.demandFindings ?? []).length === 0 &&
                  (anomalies?.persisted ?? []).length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[10.5px] text-muted-foreground">
                      No anomaly crossed the detection threshold in the available history.
                    </p>
                  ) : (
                    <>
                      {(anomalies?.demandFindings ?? []).slice(0, 6).map((finding) => (
                        <div
                          key={`${finding.date}-${finding.bloodGroup}`}
                          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5"
                        >
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
                          <div>
                            <p className="text-[10px] font-semibold text-amber-950">
                              {finding.bloodGroup} · {finding.direction} on {finding.date}
                            </p>
                            <p className="text-[9px] leading-4 text-amber-900/80">
                              {finding.observed} vs expected {finding.expected} · z {finding.zScore}
                            </p>
                          </div>
                        </div>
                      ))}
                      {(anomalies?.persisted ?? []).slice(0, 4).map((event) => (
                        <div
                          key={event._id}
                          className="flex items-start gap-2 rounded-xl border border-border bg-background p-2.5"
                        >
                          <Radio className="mt-0.5 size-3.5 shrink-0 text-primary" />
                          <div>
                            <p className="text-[10px] font-semibold">
                              {event.kind.replace("_", " ")} · {event.severity}
                            </p>
                            <p className="text-[9px] leading-4 text-muted-foreground">{event.note}</p>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  <p className="text-[9px] leading-4 text-muted-foreground">{anomalies?.method}</p>
                </div>
              )}
            </Panel>

            <Panel eyebrow="Model registry" title="Training status">
              <div className="space-y-2">
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Donor response
                  </p>
                  {modelStatus?.donorModel?.active ? (
                    <>
                      <p className="mt-1 text-[11px] font-semibold">{modelStatus.donorModel.version}</p>
                      <p className="text-[9.5px] text-muted-foreground">
                        {modelStatus.donorModel.sampleSize} labelled invitation(s) · trained{" "}
                        {modelStatus.donorModel.trainedAt
                          ? formatRelative(modelStatus.donorModel.trainedAt)
                          : "unknown time"}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-[9.5px] leading-4 text-muted-foreground">
                      {modelStatus?.donorModel?.note ??
                        "No trained donor-response model. Invitations use eligibility and distance."}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Demand model
                  </p>
                  <p className="mt-1 text-[10.5px] font-semibold">{modelStatus?.demandModel.name}</p>
                  <p className="text-[9px] leading-4 text-muted-foreground">
                    {modelStatus?.demandModel.validation}
                  </p>
                  <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                    {modelStatus?.demandModel.active
                      ? `${modelStatus.demandModel.version} · retrained from Convex history`
                      : modelStatus?.demandModel.serviceConfigured
                        ? "Service configured; no Convex retraining registered yet."
                        : "ML_SERVICE_URL is not configured on this deployment."}
                  </p>
                </div>
                <p className="text-[9px] leading-4 text-muted-foreground">
                  Stored XGBoost runs: {modelStatus?.demandForecasts.length ?? 0}. Bundled artifacts
                  were trained on labelled synthetic data; no accuracy beyond the reported holdout
                  metrics is claimed.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === "integrations" && (
        <div className="space-y-4">
          <Panel
            eyebrow="Adapter framework"
            title="Hospital and blood-bank inventory feeds"
            action={<span className="text-[10px] text-muted-foreground">{integrations?.length ?? 0} adapter(s)</span>}
          >
            {integrations === undefined ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading integrations…
              </div>
            ) : integrations.length === 0 ? (
              <EmptyState
                icon={Database}
                title="No facility integration"
                description="An administrator can register an HMS API, blood-bank API, webhook or database replica. Mock adapters are always labelled."
                action={
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a href="/admin/dashboard">
                      Open admin console <ArrowRight className="size-3" />
                    </a>
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {integrations.map((integration) => (
                  <div key={integration._id} className="rounded-xl border border-border bg-background p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                          {integration.label}
                          {integration.isMock && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.06em] text-amber-800">
                              MOCK adapter
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[9.5px] text-muted-foreground">
                          {integration.organizationName} · {integration.kind.replace("_", " ")} ·{" "}
                          {integration.syncMode}
                        </p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">
                          {integration.baseUrl ?? "No endpoint"}
                          {integration.credentialEnvVar
                            ? ` · key ${integration.credentialEnvVar}`
                            : ""}
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
                        {integration.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-[9px]">
                      <div className="rounded-lg bg-muted/40 p-1.5">
                        <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                          Last sync
                        </p>
                        <p className="mt-0.5 font-semibold">
                          {integration.lastSyncAt ? formatRelative(integration.lastSyncAt) : "Never"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-1.5">
                        <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                          Records
                        </p>
                        <p className="mt-0.5 font-semibold">{integration.recordsLastSync}</p>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-1.5">
                        <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                          Runs logged
                        </p>
                        <p className="mt-0.5 font-semibold">{integration.history.length}</p>
                      </div>
                    </div>
                    {integration.lastError && (
                      <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-[8.5px] leading-3.5 text-rose-800">
                        {integration.lastError}
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-[8.5px] leading-3.5 text-muted-foreground">
                        {integration.configNote}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 gap-1 text-[9.5px]"
                        disabled={busy === `sync:${integration._id}`}
                        onClick={() => void syncIntegration(String(integration._id), integration.isMock)}
                      >
                        {busy === `sync:${integration._id}` ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <RefreshCcw className="size-3" />
                        )}
                        Sync
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel eyebrow="Contract" title="What the live adapter expects">
              <pre className="overflow-x-auto rounded-xl bg-[oklch(0.235_0.04_258)] p-3 text-[9px] leading-4 text-white/80">
{`GET {baseUrl}/inventory
Authorization: Bearer <credentialEnvVar>
Accept: application/json

{
  "records": [{
    "externalUnitRef": "UNIT-001",
    "bloodGroup": "O+",
    "component": "red_cells",
    "units": 4,
    "collectedAt": "2026-10-01",
    "expiresAt": "2026-11-20",
    "storageLocation": "Cold room A",
    "screened": true,
    "released": true,
    "storageTempC": 4
  }]
}`}
              </pre>
              <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                Credentials are read from the deployment environment by name. They are never stored
                in the database or returned to the browser.
              </p>
            </Panel>
            <Panel eyebrow="Failure policy" title="No invented inventory">
              <ul className="space-y-2 text-[11px] leading-5 text-muted-foreground">
                <li className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                  Failed syncs are recorded as failed, an anomaly is raised, and no batches are written.
                </li>
                <li className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                  Units with <code className="rounded bg-muted px-1">screened: false</code> or{" "}
                  <code className="rounded bg-muted px-1">released: false</code> are blocked from
                  allocation.
                </li>
                <li className="flex gap-2">
                  <FlaskIcon /> Mock imports stay flagged as demo everywhere, including allocation
                  results and the map.
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      )}

      <Dialog
        open={receiptTarget != null}
        onOpenChange={(open) => {
          if (!open) setReceiptTarget(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify receipt · {receiptTarget?.transferId}</DialogTitle>
            <DialogDescription>
              Confirm the physical units and release checks before anything is credited. A
              retry after a successful receipt is idempotent and will not add stock twice.
            </DialogDescription>
          </DialogHeader>
          {receiptTarget && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-[11px]">
                <p className="font-semibold">
                  Dispatched: {receiptTarget.units} × {receiptTarget.bloodGroup}{" "}
                  {COMPONENT_LABELS[receiptTarget.component]}
                </p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  Verify the label, component, group and quantity against the request. Partial
                  quantities are allowed; the request will remain partially fulfilled until the
                  cumulative verified quantity reaches the requested amount.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="receipt-units">Verified units received</Label>
                <Input
                  id="receipt-units"
                  type="number"
                  min={1}
                  max={receiptTarget.units}
                  step={1}
                  value={receiptUnits}
                  onChange={(event) => setReceiptUnits(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                {RECEIPT_VERIFICATION.map((check) => (
                  <div key={check.key} className="flex items-start gap-2.5 rounded-lg border border-border p-2.5">
                    <Checkbox
                      id={`receipt-${check.key}`}
                      checked={receiptChecks[check.key]}
                      onCheckedChange={(checked) =>
                        setReceiptChecks((current) => ({
                          ...current,
                          [check.key]: checked === true,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <div>
                      <Label htmlFor={`receipt-${check.key}`} className="text-[11px] leading-4">
                        {check.label}
                      </Label>
                      <p className="mt-0.5 text-[9.5px] leading-4 text-muted-foreground">
                        {check.hint}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="receipt-note">Receipt note or discrepancy</Label>
                <Textarea
                  id="receipt-note"
                  value={receiptNote}
                  onChange={(event) => setReceiptNote(event.target.value)}
                  placeholder="Handoff reference, short shipment, temperature excursion, quarantined units…"
                  className="min-h-20 text-[11px]"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptTarget(null)}>
              Cancel
            </Button>
            <Button
              className="gap-1.5"
              disabled={
                busy === `receive:${receiptTarget?._id}` ||
                !receiptVerificationComplete ||
                !receiptUnits
              }
              onClick={() => void submitReceipt()}
            >
              {busy === `receive:${receiptTarget?._id}` ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="size-3.5" />
              )}
              Verify receipt & credit inventory
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

function FlaskIcon() {
  return <Activity className="mt-0.5 size-3.5 shrink-0 text-amber-600" />;
}
