import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_AMBULANCE_STATUSES,
  AMBULANCE_STATUS_LABELS,
  AMBULANCE_TYPE_LABELS,
  type AmbulanceBookingStatus,
} from "@/lib/ambulance";
import { formatRelative } from "@/lib/blood";
import { friendlyError } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock3,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Radio,
  RefreshCw,
  ShieldCheck,
  Siren,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

type Phase = "locating" | "creating" | "tracking" | "error";
type LocationError = { title: string; message: string };

const TRIP_STEPS: { status: AmbulanceBookingStatus; label: string }[] = [
  { status: "requested", label: "Requested" },
  { status: "guardian_assigned", label: "Provider assigned" },
  { status: "on_the_way", label: "On the way" },
  { status: "arrived_pickup", label: "Arrived" },
  { status: "patient_picked_up", label: "Patient picked up" },
  { status: "in_transit", label: "In transit" },
  { status: "completed", label: "Completed" },
];

function stepIndex(status: AmbulanceBookingStatus): number {
  if (status === "searching" || status === "requested") return 0;
  if (status === "accepted") return 1;
  return Math.max(0, TRIP_STEPS.findIndex((step) => step.status === status));
}

function SirenAmbulance({ moving }: { moving: boolean }) {
  return (
    <div className="relative mx-auto flex h-32 w-full max-w-sm items-center justify-center">
      <div aria-hidden className="eresp-road absolute inset-x-0 bottom-6 h-px bg-white/20" />
      <div aria-hidden className="eresp-speed absolute inset-x-8 top-1/2 flex flex-col gap-2">
        <span className="eresp-speed-line h-px w-full" />
        <span className="eresp-speed-line h-px w-2/3" />
        <span className="eresp-speed-line h-px w-1/2" />
      </div>
      <div className={moving ? "eresp-float relative" : "relative"}>
        <div className="relative flex size-24 items-center justify-center rounded-[2rem] border border-white/15 bg-white/10 shadow-2xl backdrop-blur">
          <Truck className="size-10 text-white" strokeWidth={1.6} />
          <span aria-hidden className="eresp-siren-light absolute -top-1 left-4 size-2.5 rounded-full bg-rose-500" />
          <span aria-hidden className="eresp-siren-light-alt absolute -top-1 right-4 size-2.5 rounded-full bg-sky-400" />
          <span aria-hidden className="eresp-pulse-ring absolute inset-0 rounded-[2rem] border border-primary/60" />
        </div>
      </div>
    </div>
  );
}

/**
 * One-tap emergency ambulance request.
 *
 * The only user action is granting live location. No destination, patient or
 * hospital details are requested. If no ambulance is available, the booking is
 * created in a real "searching" state and the UI says so.
 */
export function AmbulanceOneTap() {
  const mine = useQuery(api.ambulances.myBookings);
  const createEmergency = useMutation(api.ambulances.createEmergencyBooking);
  const [phase, setPhase] = useState<Phase>("locating");
  const [error, setError] = useState<LocationError | null>(null);
  const [bookingId, setBookingId] = useState<Id<"ambulanceBookings"> | null>(null);
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());
  const [note, setNote] = useState<string | null>(null);
  const started = useRef(false);
  const activeExisting = mine?.find((row) =>
    ACTIVE_AMBULANCE_STATUSES.includes(row.status),
  );
  const effectiveBookingId = bookingId ?? activeExisting?.id ?? null;
  const view: Phase =
    activeExisting && phase !== "creating" ? "tracking" : phase;
  const booking = useQuery(
    api.ambulances.bookingDetail,
    effectiveBookingId ? { bookingId: effectiveBookingId } : "skip",
  );

  const locate = useCallback(() => {
    setError(null);
    setNote(null);
    setPhase("locating");
    if (!("geolocation" in navigator)) {
      setError({
        title: "Location is not available",
        message: "This browser cannot provide live GPS location. Use a supported browser with location services.",
      });
      setPhase("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          setError({
            title: "Invalid GPS reading",
            message: "The device returned invalid coordinates. Move to an open area and retry.",
          });
          setPhase("error");
          return;
        }
        if (accuracy > 2000) {
          setError({
            title: "GPS signal is too weak",
            message: "Enable precise location and retry. An emergency request needs a reliable live position.",
          });
          setPhase("error");
          return;
        }
        setPhase("creating");
        try {
          const result = await createEmergency({
            pickupLat: latitude,
            pickupLng: longitude,
            clientRequestId: attemptId,
          });
          setBookingId(result.bookingId);
          setNote(
            result.assigned
              ? null
              : "No approved ambulance is available right now. Your request stays open and is being shown to the network.",
          );
          setPhase("tracking");
        } catch (err) {
          const message = friendlyError(err, "The ambulance request could not be confirmed.");
          if (/already have an active ambulance/i.test(message)) {
            setNote("An active ambulance request already exists on this account. Showing it below.");
            setPhase("tracking");
            return;
          }
          setError({
            title: "Booking not confirmed",
            message:
              "We could not confirm the request. Retry is safe: the same request ID is reused, so a duplicate booking will not be created.",
          });
          setPhase("error");
        }
      },
      (positionError) => {
        const messages: Record<number, LocationError> = {
          1: {
            title: "Location permission is required",
            message:
              "An ambulance can only be sent to your real position. Allow location access in the browser, then retry.",
          },
          2: {
            title: "Live location unavailable",
            message:
              "Your device could not obtain a position. Check that location services are on and retry.",
          },
          3: {
            title: "Location request timed out",
            message:
              "GPS took too long to respond. Move to an open area, check signal, and retry.",
          },
        };
        setError(
          messages[positionError.code] ?? {
            title: "Could not read live location",
            message: "Check your browser location settings and retry.",
          },
        );
        setPhase("error");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, [attemptId, createEmergency]);

  // Resume an existing active request instead of creating a duplicate.
  useEffect(() => {
    if (mine === undefined || bookingId || activeExisting) return;
    if (started.current) return;
    started.current = true;
    locate();
  }, [mine, bookingId, activeExisting, locate]);

  const reset = () => {
    setBookingId(null);
    setAttemptId(crypto.randomUUID());
    setPhase("locating");
    setError(null);
    setNote(null);
    locate();
  };

  const status = booking?.status as AmbulanceBookingStatus | undefined;
  const terminal = status != null && !ACTIVE_AMBULANCE_STATUSES.includes(status);
  const assignment = booking?.ambulance;
  const live =
    assignment?.latitude != null &&
    assignment?.longitude != null &&
    assignment?.lastLocationAt != null;
  const step = status ? stepIndex(status) : 0;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-5 sm:px-6">
        <header className="flex items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-[11px]">
            <Link to="/community/dashboard">
              <ArrowLeft className="size-3.5" /> Dashboard
            </Link>
          </Button>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
            <Siren className="size-3" /> Emergency transport
          </span>
        </header>

        <section className="eresp-hero relative mt-4 overflow-hidden rounded-3xl bg-foreground px-5 py-6 text-background sm:px-8 sm:py-8">
          <div aria-hidden className="eresp-glow absolute -right-16 -top-20 size-64 rounded-full bg-primary/30 blur-2xl" />
          <div aria-hidden className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "22px 22px" }} />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-background/50">
              One-tap request
            </p>
            <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight sm:text-3xl">
              {view === "tracking" ? "Ambulance request live" : "Request an ambulance"}
            </h1>
            <SirenAmbulance moving={view === "locating" || view === "creating"} />
          </div>
        </section>

        {view === "locating" && (
          <section className="mt-4 flex flex-1 flex-col items-center justify-center rounded-3xl border border-border bg-card px-5 py-10 text-center">
            <div className="relative flex size-20 items-center justify-center">
              <span aria-hidden className="eresp-radar absolute inset-0 rounded-full border border-primary/40" />
              <span aria-hidden className="eresp-radar eresp-radar-delay absolute inset-0 rounded-full border border-primary/30" />
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <LocateFixed className="size-6" />
              </span>
            </div>
            <h2 className="mt-5 font-display text-lg font-bold">Acquiring live GPS location</h2>
            <p className="mt-2 max-w-md text-[12px] leading-6 text-muted-foreground">
              Allow location access when your browser asks. The request is created
              automatically from your live position — you will not be asked for a
              destination, patient or hospital.
            </p>
            <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Waiting for a high-accuracy fix…
            </div>
          </section>
        )}

        {view === "creating" && (
          <section className="mt-4 flex flex-1 flex-col items-center justify-center rounded-3xl border border-border bg-card px-5 py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Loader2 className="size-6 animate-spin" />
            </span>
            <h2 className="mt-4 font-display text-lg font-bold">Creating your request</h2>
            <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
              Location captured. Saving the request and checking the live ambulance network.
            </p>
          </section>
        )}

        {view === "error" && error && (
          <section className="mt-4 flex flex-1 flex-col items-center justify-center rounded-3xl border border-destructive/30 bg-card px-5 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </span>
            <h2 className="mt-4 font-display text-lg font-bold">{error.title}</h2>
            <p className="mt-2 max-w-md text-[12px] leading-6 text-muted-foreground">
              {error.message}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button className="gap-1.5" onClick={locate}>
                <RefreshCw className="size-4" /> Retry
              </Button>
              <Button asChild variant="outline">
                <Link to="/community/dashboard">Back to dashboard</Link>
              </Button>
            </div>
          </section>
        )}

        {view === "tracking" && (
          <section className="mt-4 flex flex-1 flex-col gap-3">
            {booking === undefined ? (
              <div className="flex items-center justify-center gap-2 rounded-3xl border border-border bg-card py-16 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading booking…
              </div>
            ) : booking === null ? (
              <div className="rounded-3xl border border-border bg-card p-6 text-center text-[12px] text-muted-foreground">
                This booking is no longer available to this account.
              </div>
            ) : (
              <>
                <div className="rounded-3xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                        Booking reference
                      </p>
                      <p className="mt-0.5 font-display text-xl font-extrabold">{booking.bookingRef}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${terminal ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                      <span className={terminal ? "size-1.5 rounded-full bg-muted-foreground" : "eresp-live-dot size-1.5 rounded-full bg-primary"} />
                      {AMBULANCE_STATUS_LABELS[status ?? "requested"]}
                    </span>
                  </div>

                  {note && (
                    <p className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50/70 p-2.5 text-[11px] leading-5 text-amber-950">
                      {note}
                    </p>
                  )}
                  {status === "searching" && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-2.5 text-[11px] leading-5 text-muted-foreground">
                      <Radio className="mt-0.5 size-3.5 shrink-0 animate-pulse text-primary" />
                      Your request is open on the network. No approved ambulance is currently
                      available; the status will update when one is assigned.
                    </p>
                  )}
                  {terminal && (
                    <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[11px] leading-5">
                      <p className="font-bold">This request is closed: {AMBULANCE_STATUS_LABELS[status ?? "cancelled"]}</p>
                      {booking.cancellationReason && <p className="mt-1 text-muted-foreground">{booking.cancellationReason}</p>}
                      <Button size="sm" className="mt-2 h-8 gap-1.5" onClick={reset}>
                        <RefreshCw className="size-3.5" /> Request a new ambulance
                      </Button>
                    </div>
                  )}

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <InfoRow icon={MapPin} label="Pickup" value={`${booking.pickupLat.toFixed(5)}, ${booking.pickupLng.toFixed(5)}`} />
                    <InfoRow icon={Clock3} label="Requested" value={formatRelative(booking.requestedAt)} />
                    {booking.estimatedEtaMinutes != null && !terminal && (
                      <InfoRow icon={Navigation} label="Estimated arrival" value={`~${booking.estimatedEtaMinutes} min to pickup`} />
                    )}
                    {assignment?.lastLocationAt != null && (
                      <InfoRow icon={Radio} label="Last location update" value={formatRelative(assignment.lastLocationAt)} />
                    )}
                  </div>
                </div>

                {!terminal && (
                  <div className="rounded-3xl border border-border bg-card p-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      Response timeline
                    </p>
                    <ol className="mt-3 space-y-2.5">
                      {TRIP_STEPS.map((stepDef, index) => {
                        const done = index < step;
                        const current = index === step && !terminal;
                        return (
                          <li key={stepDef.status} className="flex items-center gap-2.5">
                            <span
                              className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                                done
                                  ? "border-teal-600 bg-teal-600 text-white"
                                  : current
                                    ? "eresp-step-current border-primary bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground"
                              }`}
                            >
                              {done ? <Check className="size-3" /> : index + 1}
                            </span>
                            <span className={`text-[11.5px] ${done || current ? "font-semibold" : "text-muted-foreground"}`}>
                              {stepDef.label}
                            </span>
                            {current && <Loader2 className="ml-auto size-3 animate-spin text-primary" aria-label="In progress" />}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}

                <div className="rounded-3xl border border-border bg-card p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    {assignment && status === "requested" ? "Requested provider" : "Assignment"}
                  </p>
                  {assignment ? (
                    <div className="mt-3 space-y-2.5">
                      <div className="flex items-start gap-3">
                        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Truck className="size-5" />
                        </span>
                        <div>
                          <p className="text-[12.5px] font-bold">
                            {assignment.registrationNumber} · {AMBULANCE_TYPE_LABELS[assignment.type as keyof typeof AMBULANCE_TYPE_LABELS] ?? assignment.type}
                          </p>
                          <p className="text-[10.5px] text-muted-foreground">{assignment.model}</p>
                        </div>
                      </div>
                      {assignment.driverName ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/25 p-2.5 text-[11px]">
                          <ShieldCheck className="size-3.5 text-teal-600" />
                          <span className="font-semibold">{assignment.driverName}</span>
                          {assignment.driverPhone && (
                            <a href={`tel:${assignment.driverPhone}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-primary">
                              <Phone className="size-3" /> {assignment.driverPhone}
                            </a>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Vehicle identified. Driver details appear after the provider accepts.
                        </p>
                      )}
                      {live ? (
                        <p className="rounded-xl border border-teal-200 bg-teal-50/70 p-2.5 text-[10.5px] leading-5 text-teal-950">
                          Live ambulance coordinates received: {assignment.latitude!.toFixed(5)},{" "}
                          {assignment.longitude!.toFixed(5)}. Last update{" "}
                          {assignment.lastLocationAt ? formatRelative(assignment.lastLocationAt) : "—"}. This is
                          the last actual location reported by the provider.
                        </p>
                      ) : (
                        <p className="text-[10px] leading-5 text-muted-foreground">
                          No live ambulance coordinates have been shared yet. Nothing is simulated.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                      <Radio className="mt-0.5 size-3.5 shrink-0" />
                      No ambulance has accepted yet. Real assignment details will appear here.
                    </p>
                  )}
                </div>

                <p className="px-1 text-[9.5px] leading-5 text-muted-foreground">
                  Destination coordination is handled by the assigned ambulance provider.
                  Estimates are only shown when the backend has distance data.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-3 py-2">
      <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        <Icon className="size-3" /> {label}
      </p>
      <p className="mt-0.5 text-[11.5px] font-semibold">{value}</p>
    </div>
  );
}
