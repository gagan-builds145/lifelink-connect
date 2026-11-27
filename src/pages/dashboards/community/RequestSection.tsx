import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { ActivateRequestorPanel } from "@/components/lifelink/community/Activations";
import { SectionHeading, SkeletonPanel } from "@/components/lifelink/community/shared";
import {
  BloodGroupChip,
  DemoDataBanner,
  EmptyState,
  StatCard,
  StatusBadge,
  UrgencyBadge,
} from "@/components/lifelink/ui-bits";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMPONENT_LABELS,
  STATUS_LABELS,
  URGENCIES,
  URGENCY_LABELS,
  formatDateTime,
  formatRelative,
  type Component,
  type Urgency,
} from "@/lib/blood";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Droplets,
  FileCheck2,
  Loader2,
  MapPin,
  Pencil,
  Search,
  ShieldCheck,
  Siren,
  Trash2,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { SectionKey } from "../CommunityDashboard";

type RequestRow = FunctionReturnType<typeof api.requests.mine>[number];
type RequestorProfile = NonNullable<FunctionReturnType<typeof api.profiles.me>>["requestor"];
type User = { name: string | null; email: string | null; city: string | null };

const ACTIVE_STATUSES = ["pending", "under_verification", "approved", "dispatched", "partially_fulfilled"];

function toLocalInput(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function RequestSection({
  requestor,
  user,
  onNavigate,
}: {
  requestor: RequestorProfile;
  user: User;
  onNavigate: (section: SectionKey) => void;
}) {
  const [tab, setTab] = useState<"requests">("requests");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [trackedId, setTrackedId] = useState<Id<"bloodRequests"> | null>(null);
  const [editing, setEditing] = useState<RequestRow | null>(null);
  const [cancelling, setCancelling] = useState<RequestRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    units: "1",
    requiredBy: "",
    urgency: "urgent" as Urgency,
    requesterPhone: "",
    area: "",
  });

  const requests = useQuery(api.requests.mine);
  const updateStatus = useMutation(api.requests.updateStatus);
  const tracked = useQuery(api.requests.getDetail, trackedId ? { id: trackedId } : "skip");

  const stats = useMemo(() => {
    const rows = requests ?? [];
    return {
      active: rows.filter((row) => ACTIVE_STATUSES.includes(row.status)).length,
      pending: rows.filter((row) => ["pending", "under_verification"].includes(row.status)).length,
      partial: rows.filter((row) => row.status === "partially_fulfilled").length,
      fulfilled: rows.filter((row) => ["fulfilled", "received"].includes(row.status)).length,
      emergency: rows.filter(
        (row) =>
          row.urgency === "emergency" &&
          !["fulfilled", "received", "cancelled", "rejected"].includes(row.status),
      ).length,
    };
  }, [requests]);

  const filtered = useMemo(() => {
    const rows = requests ?? [];
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (statusFilter === "active") return ACTIVE_STATUSES.includes(row.status);
        if (statusFilter === "history")
          return ["fulfilled", "received", "cancelled", "rejected", "partially_fulfilled"].includes(
            row.status,
          );
        if (statusFilter === "all") return true;
        return row.status === statusFilter;
      })
      .filter((row) =>
        query
          ? [row.requestId, row.hospitalName, row.city, row.requestorName]
              .join(" ")
              .toLowerCase()
              .includes(query)
          : true,
      );
  }, [requests, search, statusFilter]);

  const demoPresent = (requests ?? []).some((row) => row.isDemo);

  const openEdit = (row: RequestRow) => {
    setEditError(null);
    setEditForm({
      units: String(row.units),
      requiredBy: toLocalInput(row.requiredBy),
      urgency: row.urgency as Urgency,
      requesterPhone: "",
      area: "",
    });
    setEditing(row);
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setEditError(null);
    setEditBusy(true);
    try {
      await updateOwnRequest({
        id: editing._id,
        units: Number(editForm.units),
        requiredBy: new Date(editForm.requiredBy).getTime(),
        urgency: editForm.urgency,
        requesterPhone: editForm.requesterPhone.trim() || undefined,
        area: editForm.area.trim() || undefined,
      });
      toast.success("Request updated", {
        description: `${editing.requestId} was updated before verification. Staff have been notified.`,
      });
      setEditing(null);
    } catch (error) {
      setEditError(friendlyError(error, "Could not update this request."));
    } finally {
      setEditBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (!cancelling) return;
    setCancelBusy(true);
    try {
      await updateStatus({
        id: cancelling._id,
        status: "cancelled",
        note: "Cancelled by requestor from the unified dashboard.",
      });
      toast("Request cancelled", {
        description: `${cancelling.requestId} is closed. No stock will be reserved.`,
      });
      setCancelling(null);
    } catch (error) {
      toast.error("Could not cancel request", { description: friendlyError(error) });
    } finally {
      setCancelBusy(false);
    }
  };

  if (!requestor) {
    return (
      <div className="space-y-5">
        <SectionHeading
          eyebrow="Request blood"
          title="Requestor functionality is not active yet"
          description="Donor access still works on this account. Add requestor access to submit and track verified blood requests."
        />
        <ActivateRequestorPanel />
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-display text-base font-bold">What you get</h3>
            <ul className="mt-3 space-y-2 text-[11.5px] leading-5 text-muted-foreground">
              {[
                "Structured requests with a unique ID and document upload.",
                "Verification, allocation and dispatch progress in one timeline.",
                "Verified receipt details and partial-fulfilment tracking.",
                "Notifications for every stage change.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-5">
            <Droplets className="size-5 text-primary" />
            <h3 className="mt-2 font-display text-base font-bold">Donating still works</h3>
            <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
              Your donor profile is independent of requestor access. Keep availability current
              while you decide.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => onNavigate("donate")}
            >
              <Droplets className="size-3.5" /> Go to donate blood
            </Button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Request blood"
        title="Requestor functionality"
        description="Track allocation and transfers, confirm receipts and review your history. Only verified hospitals and Red Cross organizations can create new blood requests."
      />

      {demoPresent && <DemoDataBanner />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active requests" value={stats.active} hint="In progress across the network" icon={ClipboardList} tone="primary" />
        <StatCard label="Awaiting verification" value={stats.pending} hint="Staff review pending" icon={Clock3} tone="amber" />
        <StatCard label="Partially fulfilled" value={stats.partial} hint="Additional units still needed" icon={Truck} />
        <StatCard label="Fulfilled" value={stats.fulfilled} hint="Received or completed" icon={CheckCircle2} tone="teal" />
      </div>

      <div
        role="tablist"
        aria-label="Request functionality"
        className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1"
      >
        <button
          role="tab"
          type="button"
          aria-selected={tab === "requests"}
          onClick={() => setTab("requests")}
          className={
            tab === "requests"
              ? "rounded-lg bg-foreground px-3 py-1.5 text-[11.5px] font-semibold text-background"
              : "rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          }
        >
          My requests
        </button>
      </div>

      {tab === "requests" && (
        <>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 text-amber-600" />
            <div>
              <h3 className="font-display text-lg font-extrabold">Blood request creation is limited</h3>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                New blood requests can only be created by verified hospitals and Red Cross
                organizations. This keeps requests clinically vetted and tied to a verified
                facility from the start.
              </p>
              <p className="mt-2 text-[11.5px] leading-5 text-muted-foreground">
                If you need blood, contact a hospital directly or ask a verified facility to
                submit a request on your behalf. You can still track any request you created
                previously from this tab, and check reported stock availability.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" className="gap-1.5 text-[11.5px]">
              <Link to="/blood-search">
                <Search className="size-3.5" /> Check reported availability
              </Link>
            </Button>
            <Button asChild variant="ghost" className="gap-1.5 text-[11.5px]">
              <Link to="/ambulance?auto=1">
                <Siren className="size-3.5" /> Arrange transport
              </Link>
            </Button>
          </div>
        </div>


        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-[14px] font-bold">All my requests</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Previous and active requests, newest first. Patient details stay private.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search ID or hospital"
                  aria-label="Search requests"
                  className="h-9 w-full pl-8 text-[11.5px] sm:w-56"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-full text-[11.5px] sm:w-44" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="history">History & completed</SelectItem>
                  <SelectItem value="all">All requests</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="under_verification">Under verification</SelectItem>
                  <SelectItem value="partially_fulfilled">Partially fulfilled</SelectItem>
                  <SelectItem value="fulfilled">Fulfilled</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {requests === undefined ? (
            <SkeletonPanel />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No requests submitted"
              description="Previous requests, if any, appear here. New blood requests can only be created by verified hospitals and Red Cross organizations."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/blood-search">
                    <Search className="mr-1 size-3" /> Check availability
                  </Link>
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No requests match this filter"
              description="Try a different status or clear the search term."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((request) => {
                const canCancel = ["pending", "under_verification"].includes(request.status);
                const progress =
                  request.status === "fulfilled" || request.status === "received"
                    ? 100
                    : request.status === "partially_fulfilled"
                      ? 55
                      : ["approved", "dispatched"].includes(request.status)
                        ? 35
                        : 10;
                return (
                  <article key={request._id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-3">
                        <BloodGroupChip group={request.bloodGroup} />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12.5px] font-bold">{request.requestId}</p>
                            <StatusBadge status={request.status} />
                            <UrgencyBadge urgency={request.urgency} />
                          </div>
                          <p className="mt-1 text-[11.5px] text-muted-foreground">
                            {COMPONENT_LABELS[request.component as Component]} · {request.units} unit(s)
                            {" · "}
                            {request.hospitalName}, {request.city}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="size-3" /> Needed {formatDateTime(request.requiredBy)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="size-3" /> {request.city}
                            </span>
                            <span>Created {formatRelative(request.createdAt)}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 text-[10.5px]"
                          onClick={() => setTrackedId(request._id)}
                        >
                          <FileCheck2 className="size-3" /> Track
                        </Button>
                        {request.status === "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1 text-[10.5px]"
                            onClick={() => openEdit(request)}
                          >
                            <Pencil className="size-3" /> Edit
                          </Button>
                        )}
                        {canCancel && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1 text-[10.5px] text-muted-foreground hover:text-primary"
                            onClick={() => setCancelling(request)}
                          >
                            <Trash2 className="size-3" /> Cancel
                          </Button>
                        )}
                        <Button asChild size="sm" variant="ghost" className="h-8 text-[10.5px]">
                          <Link to={`/requests/${request._id}`}>
                            Full record <ArrowRight className="ml-0.5 size-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
                        <span>Progress</span>
                        <span>
                          {request.status === "partially_fulfilled"
                            ? "Partial fulfilment"
                            : request.status === "fulfilled" || request.status === "received"
                              ? "Complete"
                              : "In progress"}
                        </span>
                      </div>
                      <Progress value={progress} className="mt-1 h-1.5" />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tracking dialog */}
      <Dialog open={trackedId != null} onOpenChange={(open) => !open && setTrackedId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Request tracking</DialogTitle>
            <DialogDescription>
              Allocation, dispatch and verified receipt progress from the shared ledger.
            </DialogDescription>
          </DialogHeader>
          {tracked === undefined ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading tracking…
            </div>
          ) : tracked === null ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-[11.5px] text-muted-foreground">
              This request is not available to your account.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-background p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <BloodGroupChip group={tracked.request.bloodGroup} size="sm" />
                  <p className="text-[12.5px] font-bold">{tracked.request.requestId}</p>
                  <StatusBadge status={tracked.request.status} />
                  <UrgencyBadge urgency={tracked.request.urgency} />
                </div>
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  {COMPONENT_LABELS[tracked.request.component as Component]} ·{" "}
                  {tracked.request.units} unit(s) · {tracked.request.hospitalName},{" "}
                  {tracked.request.city}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/40 p-2 text-center">
                    <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Reserved</p>
                    <p className="text-[13px] font-bold">{tracked.request.reservedUnits}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2 text-center">
                    <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Received</p>
                    <p className="text-[13px] font-bold">{tracked.request.receivedUnits}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2 text-center">
                    <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Remaining</p>
                    <p className="text-[13px] font-bold">{tracked.request.remainingUnits}</p>
                  </div>
                </div>
                <Progress
                  className="mt-3 h-1.5"
                  value={
                    tracked.request.units > 0
                      ? Math.min(100, (tracked.request.receivedUnits / tracked.request.units) * 100)
                      : 0
                  }
                />
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {tracked.request.assignedOrgName
                    ? `Handled by ${tracked.request.assignedOrgName}. `
                    : ""}
                  {tracked.request.hasInstitutionalTransfers
                    ? "An institutional transfer is linked to this request."
                    : "No institutional transfer is linked yet."}
                </p>
              </div>

              <div>
                <h3 className="flex items-center gap-1.5 text-[12px] font-bold">
                  <FileCheck2 className="size-3.5 text-primary" /> Status timeline
                </h3>
                <ol className="mt-2 space-y-2 border-l border-border pl-4">
                  {tracked.history.length === 0 ? (
                    <li className="text-[11px] text-muted-foreground">No status history yet.</li>
                  ) : (
                    tracked.history.map((entry) => (
                      <li key={entry._id} className="relative">
                        <span className="absolute -left-[21px] mt-1.5 size-2 rounded-full bg-primary/60" />
                        <p className="text-[11.5px] font-semibold">{STATUS_LABELS[entry.status as keyof typeof STATUS_LABELS] ?? entry.status}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatDateTime(entry.createdAt)} · {entry.actorRole.replace(/_/g, " ")}
                        </p>
                        {entry.note && (
                          <p className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">{entry.note}</p>
                        )}
                      </li>
                    ))
                  )}
                </ol>
              </div>

              <div>
                <h3 className="flex items-center gap-1.5 text-[12px] font-bold">
                  <Truck className="size-3.5 text-primary" /> Verified receipts
                </h3>
                {tracked.receipts.length === 0 ? (
                  <p className="mt-1.5 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3 text-[10.5px] text-muted-foreground">
                    No receipt has been verified yet. Received units appear only after the
                    receiving facility completes its checks.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {tracked.receipts.map((receipt) => (
                      <div key={receipt._id} className="rounded-lg border border-border bg-background p-2.5 text-[10.5px]">
                        <p className="font-semibold">
                          {receipt.units} unit(s) {COMPONENT_LABELS[receipt.component as Component]} ·{" "}
                          {receipt.bloodGroup}
                        </p>
                        <p className="text-muted-foreground">
                          {receipt.supplierName} · verified {formatDateTime(receipt.receivedAt)}
                          {receipt.evidenceCode ? ` · evidence ${receipt.evidenceCode}` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[10.5px] leading-5 text-amber-900/80">
                <p className="flex items-center gap-1.5 font-bold uppercase tracking-[0.08em] text-amber-800">
                  <ShieldCheck className="size-3.5" /> Receipts are clinical checks
                </p>
                <p className="mt-1">
                  A receipt records label, screening, temperature, packaging and cross-match
                  confirmation. LifeLink never treats a donor response as available stock.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTrackedId(null)}>
              Close
            </Button>
            {trackedId && (
              <Button asChild className="gap-1.5">
                <Link to={`/requests/${trackedId}`}>Open full record</Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editing != null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit pending request</DialogTitle>
            <DialogDescription>
              Only operational details can change before verification. Patient identity,
              hospital and blood group stay locked.
            </DialogDescription>
          </DialogHeader>
          {editError && (
            <Alert variant="destructive">
              <AlertDescription>{editError}</AlertDescription>
            </Alert>
          )}
          <form className="space-y-4" onSubmit={(event) => void saveEdit(event)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-units">Units</Label>
                <Input
                  id="edit-units"
                  type="number"
                  min={1}
                  max={10}
                  value={editForm.units}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, units: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Urgency</Label>
                <Select
                  value={editForm.urgency}
                  onValueChange={(value) =>
                    setEditForm((prev) => ({ ...prev, urgency: value as Urgency }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {URGENCIES.map((urgency) => (
                      <SelectItem key={urgency} value={urgency}>
                        {URGENCY_LABELS[urgency]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-required-by">Needed by</Label>
                <Input
                  id="edit-required-by"
                  type="datetime-local"
                  value={editForm.requiredBy}
                  onChange={(event) =>
                    setEditForm((prev) => ({ ...prev, requiredBy: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">Contact phone (optional)</Label>
                <Input
                  id="edit-phone"
                  inputMode="tel"
                  placeholder="Leave blank to keep current"
                  value={editForm.requesterPhone}
                  onChange={(event) =>
                    setEditForm((prev) => ({ ...prev, requesterPhone: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-area">Area (optional)</Label>
                <Input
                  id="edit-area"
                  placeholder="Leave blank to keep current"
                  value={editForm.area}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, area: event.target.value }))}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={editBusy}>
                Cancel
              </Button>
              <Button type="submit" disabled={editBusy} className="gap-2">
                {editBusy ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation */}
      <AlertDialog open={cancelling != null} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {cancelling?.requestId}?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes the request and releases any reserved holds. It cannot be undone;
              submit a new request if the need returns.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelBusy}>Keep request</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelBusy}
              onClick={(event) => {
                event.preventDefault();
                void cancelRequest();
              }}
            >
              {cancelBusy ? "Cancelling…" : "Cancel request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {stats.emergency > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2 text-[10.5px] text-primary">
          <Siren className="size-3.5" />
          {stats.emergency} active emergency request(s). Contact the hospital directly as well
          if the need is immediate.
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[10.5px] text-muted-foreground"
          onClick={() => onNavigate("activities")}
        >
          View combined activity <ArrowRight className="size-3" />
        </Button>
      </div>
    </div>
  );
}
