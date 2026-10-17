import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SiteFooter } from "@/components/lifelink/SiteFooter";
import { SiteHeader } from "@/components/lifelink/SiteHeader";
import { MatchingPanel } from "@/components/lifelink/MatchingPanel";
import { RequestTimeline } from "@/components/lifelink/RequestTimeline";
import {
  BloodGroupChip,
  DemoBadge,
  EmptyState,
  StatusBadge,
  UrgencyBadge,
} from "@/components/lifelink/ui-bits";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  COMPONENT_LABELS,
  formatDate,
  formatDateTime,
  formatRelative,
  type Component,
} from "@/lib/blood";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  Droplets,
  FileText,
  HeartHandshake,
  Hospital,
  Info,
  Loader2,
  MapPin,
  ShieldCheck,
  Siren,
  Truck,
  Undo2,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0 last:pb-0 first:pt-0">
      <dt className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="max-w-[62%] text-right text-[11.5px] font-medium">{value}</dd>
    </div>
  );
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const requestId = id as Id<"bloodRequests">;
  const detail = useQuery(api.requests.getDetail, id ? { id: requestId } : "skip");
  const me = useQuery(api.profiles.me);
  const role = (me?.user.role ?? user?.role ?? "user") as string;

  const isRedCross = role === "red_cross" || role === "admin";
  const isHospital = role === "hospital";

  const batches = useQuery(
    api.inventory.orgBatchesForRequest,
    detail?.viewer === "full" && isRedCross ? { requestId } : "skip",
  );

  const updateStatus = useMutation(api.requests.updateStatus);
  const reserveStock = useMutation(api.requests.reserveStock);
  const dispatchRequest = useMutation(api.requests.dispatch);
  const releaseReservation = useMutation(api.requests.releaseReservation);
  const createOffer = useMutation(api.requests.createOffer);
  const withdrawOffer = useMutation(api.requests.withdrawOffer);
  const acceptOffer = useMutation(api.requests.acceptOffer);

  const [busy, setBusy] = useState<string | null>(null);
  const [unitCount, setUnitCount] = useState("1");
  const [batchId, setBatchId] = useState("");
  const [dialog, setDialog] = useState<"reject" | "cancel" | "offer" | "release" | null>(null);
  const [note, setNote] = useState("");
  const [offerNote, setOfferNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (batches && batches.length > 0 && !batchId) setBatchId(String(batches[0]._id));
  }, [batches, batchId]);

  useEffect(() => {
    if (detail?.request.units) setUnitCount(String(detail.request.units));
  }, [detail?.request._id, detail?.request.units]);

  if (detail === undefined) {
    return (
      <div className="min-h-screen bg-muted/25">
        <SiteHeader />
        <div className="flex min-h-[60vh] items-center justify-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Loading request record…
        </div>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="min-h-screen bg-muted/25">
        <SiteHeader />
        <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center px-4">
          <EmptyState
            icon={ShieldCheck}
            title="This request is not available to your account"
            description="Record access is limited to the request owner, authorized Red Cross staff and the hospital involved. If you believe this is wrong, contact the LifeLink administrator."
            action={<Button asChild><Link to="/dashboard">Go to my dashboard</Link></Button>}
            className="w-full border-border bg-card"
          />
        </div>
      </div>
    );
  }

  const request = detail.request;
  const full = detail.viewer === "full";
  const isOwner = request.createdByUserId === me?.user._id;
  const myOrgId = me?.organization?._id;
  const isReceivingHospital = isHospital && myOrgId != null && request.hospitalOrgId === myOrgId;
  const status = request.status;

  const refreshError = (err: unknown, fallback: string) =>
    setActionError(err instanceof Error ? err.message : fallback);

  const runStatus = async (
    next: "under_verification" | "approved" | "fulfilled" | "received" | "rejected" | "cancelled",
    reason?: string,
    key: string = next,
  ) => {
    setBusy(key);
    setActionError(null);
    try {
      await updateStatus({ id: request._id, status: next, note: reason });
      toast.success(`Request ${request.requestId} is now ${next.replace(/_/g, " ")}`, {
        description: "The shared record and the requestor's notifications were updated.",
      });
      setDialog(null);
      setNote("");
    } catch (err) {
      refreshError(err, "Could not update this request.");
    } finally {
      setBusy(null);
    }
  };

  const reserve = async () => {
    if (!batchId) {
      setActionError("Select a verified batch first.");
      return;
    }
    setBusy("reserve");
    setActionError(null);
    try {
      await reserveStock({
        id: request._id,
        inventoryId: batchId as Id<"inventory">,
        units: Number(unitCount),
      });
      toast.success("Stock reserved", {
        description: "The units are held transactionally; another request cannot oversell them.",
      });
    } catch (err) {
      refreshError(err, "Could not reserve stock.");
    } finally {
      setBusy(null);
    }
  };

  const releaseNow = async () => {
    setBusy("release");
    setActionError(null);
    try {
      const result = await releaseReservation({
        id: request._id,
        note: note.trim() || undefined,
      });
      toast.success(`${result.released} unit(s) released`, {
        description: "The units are available again and the release is recorded in the ledger.",
      });
      setDialog(null);
      setNote("");
    } catch (err) {
      refreshError(err, "Could not release the reservation.");
    } finally {
      setBusy(null);
    }
  };

  const dispatchNow = async () => {
    setBusy("dispatch");
    setActionError(null);
    try {
      await dispatchRequest({ id: request._id, note: "Dispatch recorded from the request record." });
      toast.success("Dispatch recorded", {
        description: "Inventory was consumed and the hospital has been notified to confirm receipt.",
      });
    } catch (err) {
      refreshError(err, "Could not dispatch this request.");
    } finally {
      setBusy(null);
    }
  };

  const offer = async () => {
    setBusy("offer");
    setActionError(null);
    try {
      await createOffer({ id: request._id, note: offerNote.trim() || undefined });
      toast.success("Offer submitted", {
        description: "The coordinating team has been notified. Your contact details stay protected.",
      });
      setDialog(null);
      setOfferNote("");
    } catch (err) {
      refreshError(err, "Could not submit your offer.");
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    setBusy("withdraw");
    try {
      await withdrawOffer({ id: request._id });
      toast("Offer withdrawn");
    } catch (err) {
      refreshError(err, "Could not withdraw your offer.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-muted/25">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Link
          to={isRedCross ? "/red-cross/dashboard" : isHospital ? "/hospital/dashboard" : "/dashboard"}
          className="mb-4 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3.5" />
          Back to dashboard
        </Link>

        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <BloodGroupChip group={request.bloodGroup} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Request record</p>
                  {request.isDemo && <DemoBadge />}
                </div>
                <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight">{request.requestId}</h1>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {COMPONENT_LABELS[request.component as Component]} · {request.units} unit(s) ·{" "}
                  {request.city}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
                  <Clock3 className="size-3" />
                  Updated {formatRelative(request.updatedAt)} · created {formatDateTime(request.createdAt)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <UrgencyBadge urgency={request.urgency} />
              <StatusBadge status={status} />
              {!full && (
                <span className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Donor view · masked
                </span>
              )}
            </div>
          </div>

          {actionError && (
            <Alert variant="destructive" className="mt-4" role="alert">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
            <div>
              <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">Required by</p>
              <p className="mt-1 text-[11.5px] font-semibold">{formatDateTime(request.requiredBy)}</p>
            </div>
            <div>
              <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">Hospital</p>
              <p className="mt-1 text-[11.5px] font-semibold">{request.hospitalName}</p>
            </div>
            <div>
              <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">Assigned source</p>
              <p className="mt-1 text-[11.5px] font-semibold">{request.assignedOrgName ?? "Not assigned yet"}</p>
            </div>
            <div>
              <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">Document</p>
              <p className="mt-1 text-[11.5px] font-semibold">{request.hasDocument ? "Attached" : "None attached"}</p>
            </div>
          </div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-1.5 text-[13px] font-bold">
                <Hospital className="size-4 text-primary" />
                Request &amp; patient details
              </h2>
              <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <DetailRow label="Patient name" value={request.patientName} />
                <DetailRow label="Patient reference" value={request.patientRef} />
                <DetailRow label="Patient age" value={request.patientAge ?? "—"} />
                <DetailRow label="Requestor" value={request.requestorName} />
                <DetailRow label="Requestor type" value={request.requestorType} />
                <DetailRow label="Requestor phone" value={request.requesterPhone ?? "Protected"} />
                <DetailRow label="Doctor" value={request.doctorName ?? "—"} />
                <DetailRow label="Doctor contact" value={request.doctorContact ?? "—"} />
                <DetailRow label="Hospital city" value={`${request.city}${request.area ? ` · ${request.area}` : ""}`} />
                <DetailRow label="Verified by" value={request.verifiedAt ? formatDateTime(request.verifiedAt) : "Pending"} />
              </dl>
              <div className="mt-3 rounded-xl border border-border bg-muted/25 p-3">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Reason for request</p>
                <p className="mt-1 text-[11.5px] leading-5">{request.reason}</p>
              </div>
              {request.rejectionReason && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-rose-800">Rejection reason</p>
                  <p className="mt-1 text-[11.5px] leading-5 text-rose-900">{request.rejectionReason}</p>
                </div>
              )}
              {hasDocument(detail) && (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary">
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-semibold">{detail.document?.fileName}</p>
                    <p className="text-[10px] text-muted-foreground">Private document · authorized viewers only</p>
                  </div>
                  {detail.document?.url ? (
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1 text-[10.5px]">
                      <a href={detail.document.url} target="_blank" rel="noreferrer">
                        <Download className="size-3" /> Open
                      </a>
                    </Button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Link unavailable</span>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[13px] font-bold">Status timeline</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Server-recorded status changes with timestamps.</p>
              <div className="mt-4">
                <RequestTimeline entries={detail.history} currentStatus={status} />
              </div>
            </section>

            {full && detail.offers.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-[13px] font-bold">Donor offers</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Contact details are shown only when the donor opted in and you are authorized Red Cross staff.
                </p>
                <div className="mt-3 space-y-2">
                  {detail.offers.map((offer) => (
                    <div key={offer._id} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[11.5px] font-semibold">{offer.donorName}</p>
                          {offer.bloodGroup && <span className="rounded-full bg-primary/8 px-1.5 py-0.5 text-[9px] font-bold text-primary">{offer.bloodGroup}</span>}
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">{offer.status}</span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {offer.donorId ?? "Donor"} · {offer.city ?? "—"} · {offer.phone ?? "Contact protected"}
                        </p>
                        {offer.note && <p className="mt-1 text-[10.5px] text-muted-foreground">{offer.note}</p>}
                      </div>
                      {isRedCross && offer.status === "offered" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-fit text-[10.5px]"
                          disabled={busy === "accept"}
                          onClick={async () => {
                            setBusy("accept");
                            setActionError(null);
                            try {
                              await acceptOffer({ id: request._id, offerId: offer._id });
                              toast.success("Donor offer accepted");
                            } catch (err) {
                              refreshError(err, "Could not accept the offer.");
                            } finally {
                              setBusy(null);
                            }
                          }}
                        >
                          Accept offer
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-4">
            {full && <MatchingPanel requestId={request._id} />}

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-1.5 text-[13px] font-bold">
                <ShieldCheck className="size-4 text-primary" />
                Authorized actions
              </h2>
              <p className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">
                Your role is checked on the server for every action below.
              </p>

              <div className="mt-4 space-y-3">
                {!full && detail.myOffer && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-teal-800">Your offer · {detail.myOffer.status}</p>
                    <p className="mt-1 text-[11px] text-teal-900/80">
                      The coordinating team can see that you offered to help. Keep your availability current.
                    </p>
                    {detail.myOffer.status === "offered" && (
                      <Button size="sm" variant="outline" className="mt-2 h-7 text-[10.5px]" disabled={busy === "withdraw"} onClick={() => void withdraw()}>
                        {busy === "withdraw" ? <Loader2 className="size-3 animate-spin" /> : null}
                        Withdraw offer
                      </Button>
                    )}
                  </div>
                )}

                {!full && !detail.myOffer && (
                  <Button className="w-full gap-2" onClick={() => setDialog("offer")} disabled={busy === "offer"}>
                    <HeartHandshake className="size-4" />
                    Offer to help
                  </Button>
                )}

                {isRedCross && status === "pending" && (
                  <Button
                    className="w-full gap-2"
                    disabled={busy === "under_verification"}
                    onClick={() => void runStatus("under_verification", "Document review started by Red Cross staff.")}
                  >
                    {busy === "under_verification" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                    Start verification
                  </Button>
                )}

                {isRedCross && status === "under_verification" && (
                  <>
                    <Button className="w-full gap-2" disabled={busy === "approved"} onClick={() => void runStatus("approved", "Verified and approved for fulfilment.")}>
                      {busy === "approved" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                      Approve request
                    </Button>
                    <Button variant="outline" className="w-full gap-2 text-primary" onClick={() => setDialog("reject")}>
                      <XCircle className="size-4" />
                      Reject with reason
                    </Button>
                  </>
                )}

                {isRedCross && ["under_verification", "approved"].includes(status) && (
                  <div className="rounded-xl border border-border bg-muted/20 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Reserve verified stock</p>
                    {batches === undefined ? (
                      <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading batches…</p>
                    ) : batches.length === 0 ? (
                      <p className="mt-2 text-[10.5px] leading-5 text-muted-foreground">
                        No verified matching batch at your organization. Add stock or coordinate with another branch.
                      </p>
                    ) : (
                      <>
                        <Select value={batchId} onValueChange={setBatchId}>
                          <SelectTrigger className="mt-2 h-9 w-full text-[10.5px]"><SelectValue placeholder="Choose batch" /></SelectTrigger>
                          <SelectContent>
                            {batches.map((b) => (
                              <SelectItem key={b._id} value={String(b._id)}>
                                {b.batchRef} · {b.bloodGroup} · {b.unitsAvailable - b.unitsReserved} free · exp {formatDate(b.expiryDate)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="mt-2 flex gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={request.units}
                            value={unitCount}
                            onChange={(e) => setUnitCount(e.target.value)}
                            className="h-9 w-20 text-[11px]"
                            aria-label="Units to reserve"
                          />
                          <Button size="sm" className="h-9 flex-1 gap-1.5 text-[11px]" disabled={busy === "reserve"} onClick={() => void reserve()}>
                            {busy === "reserve" ? <Loader2 className="size-3.5 animate-spin" /> : <Droplets className="size-3.5" />}
                            Reserve units
                          </Button>
                        </div>
                        <p className="mt-1.5 text-[9.5px] leading-4 text-muted-foreground">
                          Reserve all {request.units} requested unit(s) before dispatch.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {isRedCross && status === "approved" && (
                  <Button className="w-full gap-2" disabled={busy === "dispatch"} onClick={() => void dispatchNow()}>
                    {busy === "dispatch" ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
                    Record dispatch
                  </Button>
                )}

                {isRedCross && status === "approved" && request.reservedUnits > 0 && (
                  <Button
                    variant="outline"
                    className="w-full gap-2 text-muted-foreground hover:text-primary"
                    disabled={busy === "release"}
                    onClick={() => setDialog("release")}
                  >
                    <Undo2 className="size-4" />
                    Release {request.reservedUnits} reserved unit(s)
                  </Button>
                )}

                {isRedCross && (["dispatched", "received"].includes(status) || (status === "approved" && request.reservedUnits === 0)) && (
                  <Button variant="outline" className="w-full gap-2" disabled={busy === "fulfilled"} onClick={() => void runStatus("fulfilled", "Fulfilment confirmed by Red Cross staff.")}>
                    {busy === "fulfilled" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Mark fulfilled
                  </Button>
                )}

                {isHospital && status === "dispatched" && isReceivingHospital && (
                  <Button className="w-full gap-2" disabled={busy === "received"} onClick={() => void runStatus("received", "Hospital confirmed receipt of dispatched components.")}>
                    {busy === "received" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Confirm receipt
                  </Button>
                )}

                {user && detail.myOffer == null && !full && !["approved", "under_verification", "pending"].includes(status) && (
                  <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-[10.5px] text-muted-foreground">
                    This request is no longer accepting donor offers.
                  </p>
                )}

                {(isOwner || (isHospital && isReceivingHospital)) && ["pending", "under_verification"].includes(status) && (
                  <Button variant="ghost" className="w-full gap-2 text-muted-foreground hover:text-primary" onClick={() => setDialog("cancel")}>
                    <XCircle className="size-4" />
                    Cancel request
                  </Button>
                )}

                {isRedCross && status === "dispatched" && (
                  <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-[10.5px] leading-5 text-indigo-900">
                    Dispatched. Waiting for the receiving hospital to confirm receipt.
                  </p>
                )}
                {isHospital && status === "dispatched" && !isReceivingHospital && (
                  <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-[10.5px] leading-5 text-muted-foreground">
                    Only the receiving hospital assigned to this request can confirm receipt.
                  </p>
                )}
                {isHospital && status === "approved" && (
                  <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-[10.5px] leading-5 text-muted-foreground">
                    Awaiting Red Cross dispatch. Receipt confirmation opens after dispatch.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
              <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-primary">
                <ShieldCheck className="size-3.5" /> Medical safety
              </p>
              <p className="mt-1.5 text-[10.5px] leading-5 text-muted-foreground">
                Matching and stock reports are advisory. Cross-matching, testing and final
                issue are performed by qualified medical staff. Patient identity and
                prescriptions are never public.
              </p>
            </section>
          </aside>
        </div>
      </main>
      <SiteFooter />

      <Dialog open={dialog != null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialog === "reject"
                ? "Reject request"
                : dialog === "cancel"
                  ? "Cancel request"
                  : dialog === "release"
                    ? "Release reserved stock"
                    : "Offer to help"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "reject"
                ? "The requestor will see this reason in their timeline and notification. Be clear but avoid unnecessary medical detail."
                : dialog === "cancel"
                  ? "Cancelling closes the request and releases any pending coordination. You cannot undo this."
                  : dialog === "release"
                    ? "The reserved units return to general availability. This is recorded in the inventory ledger and the request timeline."
                    : "This notifies the coordinating team. Your contact details remain protected unless authorized staff accept the offer."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "offer" ? (
            <Textarea
              rows={3}
              value={offerNote}
              onChange={(e) => setOfferNote(e.target.value)}
              placeholder="Availability window or preferred center. Do not include patient details."
            />
          ) : (
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                dialog === "reject"
                  ? "Reason for rejection (required)"
                  : dialog === "release"
                    ? "Reason for releasing the reservation (optional)"
                    : "Reason for cancellation (optional)"
              }
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>Close</Button>
            {dialog === "offer" ? (
              <Button onClick={() => void offer()} disabled={busy === "offer"} className="gap-2">
                {busy === "offer" ? <Loader2 className="size-4 animate-spin" /> : <HeartHandshake className="size-4" />}
                Send offer
              </Button>
            ) : (
              <Button
                variant={dialog === "reject" ? "destructive" : "default"}
                disabled={busy != null || (dialog === "reject" && note.trim().length < 5)}
                onClick={() => {
                  if (dialog === "reject") void runStatus("rejected", note.trim(), "reject");
                  else if (dialog === "release") void releaseNow();
                  else void runStatus("cancelled", note.trim() || "Cancelled by the request owner.", "cancel");
                }}
              >
                {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {dialog === "reject"
                  ? "Reject request"
                  : dialog === "release"
                    ? "Release stock"
                    : "Cancel request"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function hasDocument(detail: { document: { fileName: string } | null }) {
  return detail.document != null;
}
