import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { NetworkMap, type NetworkMapPoint } from "@/components/lifelink/NetworkMap";
import { useAuth } from "@/hooks/use-auth";
import {
  ACTIVE_AMBULANCE_STATUSES,
  AMBULANCE_LOCATION_STALE_MS,
  AMBULANCE_STATUS_LABELS,
  AMBULANCE_TYPE_LABELS,
  type AmbulanceBookingStatus,
} from "@/lib/ambulance";
import { formatRelative } from "@/lib/blood";
import {
  LOCATION_CONSENT_MESSAGE,
  readLocationChoice,
  writeLocationChoice,
  type LocationChoice,
} from "@/lib/location";
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

type Phase = "consent" | "locating" | "discovery" | "creating" | "tracking" | "error";
type LocationError = { title: string; message: string; denied?: boolean };

const TRIP_STEPS: { status: AmbulanceBookingStatus; label: string }[] = [
  { status: "requested", label: "Request sent" },
  { status: "guardian_assigned", label: "Provider accepted" },
  { status: "on_the_way", label: "On the way" },
  { status: "arrived_pickup", label: "Arrived" },
  { status: "patient_picked_up", label: "Patient picked up" },
  { status: "in_transit", label: "In transit" },
  { status: "completed", label: "Completed" },
];

function stepIndex(status: AmbulanceBookingStatus): number {
  if (status === "searching" || status === "requested") return 0;
  return Math.max(0, TRIP_STEPS.findIndex((step) => step.status === status));
}

function SirenAmbulance({ moving }: { moving: boolean }) {
  return (
    <div className="relative mx-auto flex h-28 w-full max-w-sm items-center justify-center">
      <div aria-hidden className="eresp-road absolute inset-x-0 bottom-5 h-px bg-white/20" />
      <div aria-hidden className="eresp-speed absolute inset-x-8 top-1/2 flex flex-col gap-2">
        <span className="eresp-speed-line h-px w-full" />
        <span className="eresp-speed-line h-px w-2/3" />
        <span className="eresp-speed-line h-px w-1/2" />
      </div>
      <div className={moving ? "eresp-float relative" : "relative"}>
        <div className="relative flex size-20 items-center justify-center rounded-[1.75rem] border border-white/15 bg-white/10 shadow-2xl backdrop-blur">
          <Truck className="size-9 text-white" strokeWidth={1.6} />
          <span aria-hidden className="eresp-siren-light absolute -top-1 left-3 size-2.5 rounded-full bg-rose-500" />
          <span aria-hidden className="eresp-siren-light-alt absolute -top-1 right-3 size-2.5 rounded-full bg-sky-400" />
          <span aria-hidden className="eresp-pulse-ring absolute inset-0 rounded-[1.75rem] border border-primary/60" />
        </div>
      </div>
    </div>
  );
}

/**
 * One-tap emergency request with nearby discovery before booking.
 *
 * The user supplies no destination, patient or hospital details. After explicit
 * consent and a fresh GPS fix, the page lists only server-qualified ambulances.
 * A real booking is created only by the button; acceptance is always separate.
 */
export function AmbulanceOneTap() {
  const { user } = useAuth();
  const mine = useQuery(api.ambulances.myBookings);
  const cancelBooking = useMutation(api.ambulances.cancelBooking);
  const createEmergency = useMutation(api.ambulances.createEmergencyBooking);

  const [choice, setChoice] = useState<LocationChoice>(() =>
    typeof window === "undefined"
      ? "unset"
      : readLocationChoice(window.localStorage, user?._id),
  );
  const [phase, setPhase] = useState<Phase>("consent");
  const [error, setError] = useState<LocationError | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [bookingId, setBookingId] = useState<Id<"ambulanceBookings"> | null>(null);
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());
  const [note, setNote] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  const activeExisting = mine?.find((row) =>
    ACTIVE_AMBULANCE_STATUSES.includes(row.status),
  );
  const effectiveBookingId = bookingId ?? activeExisting?.id ?? null;
  const booking = useQuery(
    api.ambulances.bookingDetail,
    effectiveBookingId ? { bookingId: effectiveBookingId } : "skip",
  );
  const nearby = useQuery(
    api.ambulances.nearby,
    coords && !activeExisting
      ? { pickupLat: coords.lat, pickupLng: coords.lng }
      : "skip",
  );

  const view: Phase =
    activeExisting || booking ? "tracking" : phase;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const rememberChoice = useCallback(
    (next: Exclude<LocationChoice, "unset">) => {
      setChoice(next);
      if (typeof window !== "undefined") {
        writeLocationChoice(window.localStorage, user?._id, next);
      }
    },
    [user?._id],
  );

  const acquire = useCallback(() => {
    setError(null);
    setNote(null);
    if (!("geolocation" in navigator)) {
      rememberChoice("unavailable");
      setError({
        title: "Location is not available",
        message:
          "This browser cannot provide a live GPS position. Use a supported browser with location services.",
      });
      setPhase("error");
      return;
    }
    setPhase("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
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
            message:
              "Enable precise location and retry. Nearby ambulances need a reliable live position.",
          });
          setPhase("error");
          return;
        }
        rememberChoice("enabled");
        setCoords({ lat: latitude, lng: longitude, accuracy });
        setPhase("discovery");
      },
      (positionError) => {
        const denied = positionError.code === positionError.PERMISSION_DENIED;
        if (denied) rememberChoice("denied");
        const messages: Record<number, LocationError> = {
          1: {
            title: "Location permission is blocked",
            message:
              "Allow location for this site in your browser settings, then try again. You can use the dashboard without location.",
            denied: true,
          },
          2: {
            title: "Live location unavailable",
            message:
              "Your device could not obtain a position. Check that location services are on and retry.",
          },
          3: {
            title: "Location request timed out",
            message: "GPS took too long to respond. Move to an open area and retry.",
          },
        };
        setError(
          messages[positionError.code] ?? {
            title: "Could not read live location",
            message: "Check your browser location settings and retry.",
          },
        );
        setPhase(denied ? "consent" : "error");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, [rememberChoice]);

  // Only a stored LifeLink consent may reuse an already-granted browser
  // permission. With no consent, the user must press Enable Location first.
  useEffect(() => {
    if (started.current || mine === undefined || activeExisting) return;
    started.current = true;
    if (choice !== "enabled") return;
    const timer = window.setTimeout(() => acquire(), 0);
    return () => window.clearTimeout(timer);
  }, [acquire, activeExisting, choice, mine]);

  const requestAmbulance = async () => {
    if (!coords) return;
    setPhase("creating");
    setError(null);
    try {
      const result = await createEmergency({
        pickupLat: coords.lat,
        pickupLng: coords.lng,
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
      setError({
        title: "Booking not confirmed",
        message: friendlyError(
          err,
          "We could not confirm the request. Retry uses the same request ID, so it cannot create a duplicate.",
        ),
      });
      setPhase("discovery");
    }
  };

  const reset = () => {
    setBookingId(null);
    setAttemptId(crypto.randomUUID());
    setCoords(null);
    setPhase("consent");
    setError(null);
    setNote(null);
  };

  const status = booking?.status as AmbulanceBookingStatus | undefined;
  const terminal = status != null && !ACTIVE_AMBULANCE_STATUSES.includes(status);
  const assigned = booking?.assignedAmbulanceId != null;
  const assignment = booking?.ambulance;
  const hasLocation = assignment?.latitude != null && assignment?.longitude != null;
  const fresh =
    hasLocation &&
    assignment?.lastLocationAt != null &&
    now - assignment.lastLocationAt <= AMBULANCE_LOCATION_STALE_MS &&
    assignment.lastLocationAt <= now;
  const step = status ? stepIndex(status) : 0;
  const nearbyCount = nearby?.length;
  const countLabel =
    nearbyCount === undefined
      ? "Checking the live ambulance network"
      : nearbyCount === 0
        ? "No ambulances nearby"
        : `${nearbyCount} ambulance${nearbyCount === 1 ? "" : "s"} nearby`;

  const discoveryPoints: NetworkMapPoint[] = coords
    ? [
        {
          id: "pickup",
          lat: coords.lat,
          lng: coords.lng,
          label: "Your pickup location",
          kind: "pickup",
          color: "#0f766e",
          badge: "Pickup",
          detail: `GPS accuracy ±${Math.round(coords.accuracy)} m`,
        },
        ...(nearby ?? []).map((ambulance) => ({
          id: String(ambulance.id),
          lat: ambulance.latitude,
          lng: ambulance.longitude,
          label: `${ambulance.registrationNumber} · ${AMBULANCE_TYPE_LABELS[ambulance.type]}`,
          kind: "ambulance" as const,
          badge: `Available · ${ambulance.distanceKm} km`,
          detail: ambulance.model,
          meta: [
            `Last GPS update ${formatRelative(ambulance.lastLocationAt)}`,
            "Driver details are shared after acceptance.",
          ],
        })),
      ]
    : [];

  const trackingPoints: NetworkMapPoint[] = booking
    ? [
        {
          id: "pickup",
          lat: booking.pickupLat,
          lng: booking.pickupLng,
          label: "Your pickup location",
          kind: "pickup",
          color: "#0f766e",
          badge: "Pickup",
        },
        ...(assigned && hasLocation
          ? [
              {
                id: "ambulance",
                lat: assignment!.latitude as number,
                lng: assignment!.longitude as number,
                label: assignment!.registrationNumber,
                kind: "ambulance" as const,
                badge: fresh ? "Live ambulance" : "Last known — not live",
                detail: `${assignment!.model} · ${AMBULANCE_TYPE_LABELS[assignment!.type]}`,
                meta: [
                  assignment!.lastLocationAt
                    ? `Last GPS update ${formatRelative(assignment!.lastLocationAt)}`
                    : "No timestamp",
                ],
                active: fresh,
              },
            ]
          : []),
      ]
    : [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-5 sm:px-6">
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

        <section className="eresp-hero relative mt-4 overflow-hidden rounded-3xl bg-foreground px-5 py-6 text-background sm:px-8">
          <div aria-hidden className="eresp-glow absolute -right-16 -top-20 size-64 rounded-full bg-primary/30 blur-2xl" />
          <div aria-hidden className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "22px 22px" }} />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-background/50">
              One-tap request
            </p>
            <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight sm:text-3xl">
              {view === "tracking"
                ? "Ambulance request live"
                : view === "discovery"
                  ? countLabel
                  : "Request an ambulance"}
            </h1>
            <SirenAmbulance
              moving={view === "locating" || view === "creating" || status === "searching"}
            />
          </div>
        </section>

        {view === "consent" && (
          <section className="mt-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MapPin className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold">Enable location to continue</h2>
                <p className="mt-1 text-[12px] leading-6 text-muted-foreground">
                  {LOCATION_CONSENT_MESSAGE}
                </p>
              </div>
            </div>
            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-[11px] leading-5 text-destructive">
                {error.message}
              </p>
            )}
            <p className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-[10.5px] leading-5 text-muted-foreground">
              LifeLink asks the browser for your position only after you choose Enable Location.
              Ambulance tracking uses a fresh GPS fix and never turns on background tracking.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button className="gap-1.5" onClick={acquire} disabled={choice === "denied"}>
                <LocateFixed className="size-4" />
                Enable Location
              </Button>
              <Button asChild variant="outline">
                <Link to="/community/dashboard">Not Now</Link>
              </Button>
            </div>
            {choice === "denied" && (
              <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                Location is blocked in this browser. Allow it in site settings, then reload this page.
              </p>
            )}
          </section>
        )}

        {view === "locating" && (
          <section className="mt-4 flex flex-1 flex-col items-center justify-center rounded-3xl border border-border bg-card px-5 py-10 text-center">
            <div className="relative flex size-20 items-center justify-center">
              <span aria-hidden className="eresp-radar absolute inset-0 rounded-full border border-primary/40" />
              <span aria-hidden className="eresp-radar eresp-radar-delay absolute inset-0 rounded-full border border-primary/30" />
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <LocateFixed className="size-6" />
              </span>
            </div>
            <h2 className="mt-5 font-display text-lg font-bold">Finding your live position</h2>
            <p className="mt-2 max-w-md text-[12px] leading-6 text-muted-foreground">
              No destination, patient or hospital details are needed. We use this fresh position
              only to discover eligible nearby ambulances.
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
            <h2 className="mt-4 font-display text-lg font-bold">Creating your one-tap request</h2>
            <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
              Saving the request against your fresh pickup position and checking the live network.
            </p>
          </section>
        )}

        {view === "error" && error && (
          <section className="mt-4 flex flex-1 flex-col items-center justify-center rounded-3xl border border-destructive/30 bg-card px-5 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </span>
            <h2 className="mt-4 font-display text-lg font-bold">{error.title}</h2>
            <p className="mt-2 max-w-md text-[12px] leading-6 text-muted-foreground">{error.message}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button className="gap-1.5" onClick={acquire}>
                <RefreshCw className="size-4" /> Retry
              </Button>
              <Button asChild variant="outline">
                <Link to="/community/dashboard">Back to dashboard</Link>
              </Button>
            </div>
          </section>
        )}

        {view === "discovery" && coords && (
          <section className="mt-4 space-y-3">
            {error && (
              <p role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[11px] leading-5 text-destructive">
                {error.message}
              </p>
            )}
            <div className="rounded-3xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Live network
                  </p>
                  <p className="mt-1 font-display text-2xl font-extrabold">
                    {nearbyCount === undefined
                      ? "Checking nearby ambulances…"
                      : nearbyCount === 0
                        ? "No available ambulances nearby."
                        : `${nearbyCount} ambulance${nearbyCount === 1 ? "" : "s"} nearby`}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    {nearbyCount === 0
                      ? "We are searching for an eligible provider. You can still open a request so the network can re-match automatically."
                      : "Approved, online, available vehicles with a current GPS fix within the discovery radius."}
                  </p>
                </div>
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-teal-800">
                  GPS ±{Math.round(coords.accuracy)} m
                </span>
              </div>

              <NetworkMap points={discoveryPoints} height={330} className="mt-4" groupDuplicateLocations legend={[
                { color: "#0f766e", label: "Your pickup" },
                { color: "#dc2626", label: "Available ambulance", shape: "dot" },
              ]} />

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  className="h-11 flex-1 gap-2 text-[13px]"
                  onClick={() => void requestAmbulance()}
                  disabled={nearby === undefined}
                >
                  {nearby === undefined ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Siren className="size-4" />
                  )}
                  {nearby === undefined
                    ? "Checking network…"
                    : nearbyCount === 0
                      ? "Request ambulance anyway"
                      : "Book nearest ambulance"}
                </Button>
                <Button variant="outline" className="h-11 gap-1.5" onClick={acquire}>
                  <RefreshCw className="size-4" /> Refresh GPS
                </Button>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                One action creates the request. No destination, patient, age or blood-group fields.
                Assignment is confirmed only after the provider accepts.
              </p>
            </div>

            {nearby && nearby.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {nearby.slice(0, 4).map((ambulance) => (
                  <div key={ambulance.id} className="rounded-2xl border border-border bg-card p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] font-bold">
                        {ambulance.registrationNumber}
                      </p>
                      <span className="text-[11px] font-bold text-primary">
                        {ambulance.distanceKm} km
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                      {AMBULANCE_TYPE_LABELS[ambulance.type]} · {ambulance.model}
                    </p>
                    <p className="mt-1 text-[9.5px] text-muted-foreground">
                      Live GPS {formatRelative(ambulance.lastLocationAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
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
                      {booking.rematchAttempts > 0
                        ? `Continuing to search. The network has been re-checked ${booking.rematchAttempts} time${booking.rematchAttempts === 1 ? "" : "s"}.`
                        : "Your request is open on the network. No approved ambulance is currently available; the status updates when one is requested."}
                    </p>
                  )}
                  {status === "requested" && assignment && (
                    <p className="mt-2 rounded-xl border border-primary/25 bg-primary/5 p-2.5 text-[11px] leading-5">
                      An ambulance has been requested and is awaiting provider acceptance. It is
                      not assigned or dispatched yet.
                    </p>
                  )}
                  {status === "searching" && assignment && (
                    <p className="mt-2 rounded-xl border border-primary/25 bg-primary/5 p-2.5 text-[11px] leading-5">
                      A newly available ambulance has been requested. Waiting for provider
                      acceptance before tracking begins.
                    </p>
                  )}

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <InfoRow icon={MapPin} label="Pickup" value={`${booking.pickupLat.toFixed(5)}, ${booking.pickupLng.toFixed(5)}`} />
                    <InfoRow icon={Clock3} label="Requested" value={formatRelative(booking.requestedAt)} />
                    {status === "searching" && booking.searchExpiresAt != null && (
                      <InfoRow icon={Clock3} label="Searching until" value={new Date(booking.searchExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
                    )}
                  </div>

                  {!terminal && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 h-8 gap-1.5 text-muted-foreground"
                      disabled={cancelling}
                      onClick={async () => {
                        if (!effectiveBookingId) return;
                        setCancelling(true);
                        try {
                          await cancelBooking({ bookingId: effectiveBookingId, reason: "Cancelled by the requester from one-tap tracking." });
                        } catch (err) {
                          setNote(friendlyError(err, "Could not cancel the request."));
                        } finally {
                          setCancelling(false);
                        }
                      }}
                    >
                      {cancelling ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Cancel request
                    </Button>
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
                </div>

                {!terminal && (
                  <div className="rounded-3xl border border-border bg-card p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                        Live journey map
                      </p>
                      {assigned && (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9.5px] font-bold ${fresh ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>
                          <span className={`size-1.5 rounded-full ${fresh ? "bg-teal-600" : "bg-amber-500"}`} />
                          {fresh ? "Live GPS" : "Not live"}
                        </span>
                      )}
                    </div>
                    <NetworkMap points={trackingPoints} height={300} className="mt-3" groupDuplicateLocations />
                    {!assigned ? (
                      <p className="mt-3 rounded-xl border border-border bg-muted/30 p-3 text-[11px] leading-5 text-muted-foreground">
                        The map will show the ambulance after a provider accepts. No vehicle is
                        displayed as dispatched before acceptance.
                      </p>
                    ) : !hasLocation ? (
                      <p className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 text-[11px] leading-5 text-amber-950">
                        Live location temporarily unavailable. The assigned provider has not sent a
                        GPS update yet; nothing is simulated.
                      </p>
                    ) : !fresh ? (
                      <p className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 text-[11px] leading-5 text-amber-950">
                        Live location temporarily unavailable. The last known position was updated{" "}
                        {assignment?.lastLocationAt ? formatRelative(assignment.lastLocationAt) : "unknown"} and is no
                        longer shown as live.
                      </p>
                    ) : (
                      <p className="mt-3 flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50/70 p-2.5 text-[10.5px] leading-5 text-teal-950">
                        <Navigation className="mt-0.5 size-3.5 shrink-0" />
                        Last real provider update{" "}
                        {assignment?.lastLocationAt ? formatRelative(assignment.lastLocationAt) : "—"}. A road route and
                        reliable arrival time appear only when the provider's live data supports them.
                      </p>
                    )}
                  </div>
                )}

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
                            <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                              done
                                ? "border-teal-600 bg-teal-600 text-white"
                                : current
                                  ? "eresp-step-current border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground"
                            }`}>
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
                    {assigned ? "Assigned ambulance" : assignment ? "Requested provider" : "Assignment"}
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
                      {assigned && assignment.driverName ? (
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
                          Driver details appear only after the provider accepts.
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
                  Destination coordination is handled by the assigned ambulance provider. LifeLink
                  does not simulate vehicle movement or arrival estimates.
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
