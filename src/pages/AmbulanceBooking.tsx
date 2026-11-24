import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  Ambulance,
  Clock3,
  Crosshair,
  History,
  MapPin,
  Navigation,
  PhoneCall,
  Route,
  ShieldAlert,
  Siren,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import { EmptyState, StatusBadge } from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { NetworkMap, type NetworkMapPoint } from "@/components/lifelink/NetworkMap";
import { useAuth } from "@/hooks/use-auth";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import {
  AMBULANCE_BOOKING_STATUSES,
  AMBULANCE_LOCATION_STALE_MS,
  AMBULANCE_STATUS_LABELS,
  AMBULANCE_TYPE_LABELS,
  AMBULANCE_TYPES,
  isActiveAmbulanceStatus,
  type AmbulanceBookingStatus,
  type AmbulanceType,
} from "@/lib/ambulance";
import { formatRelative } from "@/lib/blood";
import { AmbulanceOneTap } from "./AmbulanceOneTap";

type Tab = "book" | "bookings";

function asNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `/ambulance` keeps one route. `?auto=1` is the donor one-tap GPS flow; the
 * existing manual/staff booking interface remains available otherwise.
 */
export default function AmbulanceBooking() {
  const [params] = useSearchParams();
  const { user, isLoading } = useAuth();
  const auto = params.get("auto") === "1";
  const manual = params.get("manual") === "1";
  const communityRole = ["community", "donor", "requestor"].includes(user?.role ?? "");
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[12px] text-muted-foreground">
        Loading ambulance booking…
      </div>
    );
  }
  // Community members get the destination-free one-tap flow by default. Staff
  // retain the detailed manual form, and `?manual=1` is an explicit escape hatch.
  if (auto || (communityRole && !manual)) return <AmbulanceOneTap />;
  return <ManualAmbulanceBooking />;
}

function ManualAmbulanceBooking() {
  const { user } = useAuth();
  const role = (user?.role ?? "donor") as AppRole;
  const [tab, setTab] = useState<Tab>("book");
  const [pickupLabel, setPickupLabel] = useState("");
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLng, setPickupLng] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [destinationLat, setDestinationLat] = useState("");
  const [destinationLng, setDestinationLng] = useState("");
  const [patientName, setPatientName] = useState("");
  const [notes, setNotes] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | AmbulanceType>("all");
  const [selectedAmbulance, setSelectedAmbulance] = useState<Id<"ambulances"> | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<Id<"ambulanceBookings"> | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const lat = asNumber(pickupLat);
  const lng = asNumber(pickupLng);
  const validPickup =
    lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const nearby = useQuery(
    api.ambulances.nearby,
    validPickup
      ? {
          pickupLat: lat,
          pickupLng: lng,
          type: typeFilter === "all" ? undefined : typeFilter,
        }
      : "skip",
  );
  const bookings = useQuery(api.ambulances.myBookings);
  const createBooking = useMutation(api.ambulances.createBooking);
  const cancelBooking = useMutation(api.ambulances.cancelBooking);

  const activeBookings = useMemo(
    () => (bookings ?? []).filter((booking) => isActiveAmbulanceStatus(booking.status)),
    [bookings],
  );
  const latestActive =
    activeBookings.find((booking) => booking.id === selectedBookingId) ??
    activeBookings[0] ??
    null;
  const detail = useQuery(
    api.ambulances.bookingDetail,
    latestActive ? { bookingId: latestActive.id } : "skip",
  );

  const nearbyPoints: NetworkMapPoint[] = useMemo(() => {
    const points: NetworkMapPoint[] = [];
    if (validPickup && lat != null && lng != null) {
      points.push({
        id: "pickup",
        lat,
        lng,
        label: pickupLabel || "Pickup location",
        kind: "pickup",
        color: "#0f766e",
        badge: "Pickup",
      });
    }
    for (const ambulance of nearby ?? []) {
      points.push({
        id: String(ambulance.id),
        lat: ambulance.latitude,
        lng: ambulance.longitude,
        label: `${ambulance.registrationNumber} · ${AMBULANCE_TYPE_LABELS[ambulance.type]}`,
        kind: "facility",
        color: "#2563EB",
        badge: `Available · ${ambulance.distanceKm} km away`,
        detail: ambulance.model,
        meta: [`ETA ${ambulance.etaMinutes} min`, `Estimated fare ₹${ambulance.estimatedFare}`],
        active: selectedAmbulance === ambulance.id,
      });
    }
    return points;
  }, [
    nearby,
    validPickup,
    lat,
    lng,
    pickupLabel,
    selectedAmbulance,
  ]);

  const trackingPoints: NetworkMapPoint[] = useMemo(() => {
    if (!detail) return [];
    const points: NetworkMapPoint[] = [
      {
        id: "pickup",
        lat: detail.pickupLat,
        lng: detail.pickupLng,
        label: detail.pickupLabel,
        kind: "pickup",
        color: "#0f766e",
        badge: "Pickup",
      },
    ];
    if (detail.destinationLat != null && detail.destinationLng != null) {
      points.push({
        id: "destination",
        lat: detail.destinationLat,
        lng: detail.destinationLng,
        label: detail.destinationLabel,
        kind: "dropoff",
        color: "#b21f34",
        badge: "Destination",
      });
    }
    const ambulanceLat = detail.ambulance?.latitude;
    const ambulanceLng = detail.ambulance?.longitude;
    const lastLocationAt = detail.ambulance?.lastLocationAt;
    const fresh =
      lastLocationAt != null &&
      now - lastLocationAt <= AMBULANCE_LOCATION_STALE_MS &&
      lastLocationAt <= now;
    if (fresh && ambulanceLat != null && ambulanceLng != null) {
      points.push({
        id: "ambulance",
        lat: ambulanceLat,
        lng: ambulanceLng,
        label: detail.ambulance?.registrationNumber ?? "Assigned ambulance",
        kind: "facility",
        color: "#16A34A",
        badge: "Assigned ambulance",
        detail: detail.ambulance
          ? `${detail.ambulance.model} · ${AMBULANCE_TYPE_LABELS[detail.ambulance.type]}`
          : undefined,
        active: true,
      });
    }
    return points;
  }, [detail, now]);

  const detectLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser. Enter coordinates manually.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPickupLat(position.coords.latitude.toFixed(6));
        setPickupLng(position.coords.longitude.toFixed(6));
        if (!pickupLabel) {
          setPickupLabel(
            `Current location (±${Math.round(position.coords.accuracy)} m accuracy)`,
          );
        }
        setLocating(false);
        toast.success("Pickup location detected.");
      },
      (error) => {
        setLocating(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? "Location permission is disabled. Enable it in the browser or enter coordinates manually."
            : "Could not read your location. Enter coordinates manually or try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  const confirmBooking = async () => {
    if (!validPickup || lat == null || lng == null) {
      toast.error("Set a valid pickup location first.");
      return;
    }
    if (!pickupLabel.trim() || !destinationLabel.trim()) {
      toast.error("Add a pickup label and destination.");
      return;
    }
    if (!selectedAmbulance) {
      toast.error("Select an available ambulance.");
      return;
    }
    setBusy(true);
    try {
      const result = await createBooking({
        ambulanceId: selectedAmbulance,
        pickupLabel: pickupLabel.trim(),
        pickupLat: lat,
        pickupLng: lng,
        destinationLabel: destinationLabel.trim(),
        destinationLat: asNumber(destinationLat) ?? undefined,
        destinationLng: asNumber(destinationLng) ?? undefined,
        ambulanceType: typeFilter === "all" ? undefined : typeFilter,
        patientName: patientName.trim() || undefined,
        notes: notes.trim() || undefined,
        clientRequestId: crypto.randomUUID(),
      });
      setSelectedBookingId(result.bookingId);
      setTab("bookings");
      toast.success(
        result.reused
          ? "Existing booking restored."
          : "Request sent. Waiting for the Guardian to accept.",
      );
      setSelectedAmbulance(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the booking.");
    } finally {
      setBusy(false);
    }
  };

  const navItems = [
    { key: "book", label: "Book ambulance", icon: Siren },
    { key: "bookings", label: "My bookings", icon: History, badge: activeBookings.length },
  ];

  return (
    <DashboardShell
      roleLabel={ROLE_LABELS[role] ?? "LifeLink"}
      roleKey="Shared ambulance dispatch"
      title="Book an ambulance"
      items={navItems}
      active={tab}
      onSelect={(key) => setTab(key as Tab)}
      accentIcon={Ambulance}
      quickLinks={[{ label: "Public blood search", href: "/blood-search" }]}
    >
      <div className="mt-4 space-y-4">
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4 text-[11px] leading-5 text-amber-950">
          <p className="flex items-center gap-1.5 font-bold">
            <ShieldAlert className="size-3.5" /> Emergency notice
          </p>
          <p className="mt-1">
            LifeLink facilitates ambulance bookings and does not itself provide emergency
            medical response. For an immediate life-threatening emergency, call your local
            emergency number directly.
          </p>
          <a
            href="tel:108"
            className="mt-1.5 inline-flex items-center gap-1.5 font-semibold underline"
          >
            <PhoneCall className="size-3" /> Call 108 emergency services
          </a>
        </div>

        {tab === "book" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
            <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <div>
                <h2 className="text-[15px] font-bold">Trip details</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Pickup coordinates are required. Use GPS or enter real coordinates manually.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pickup-label">Pickup location</Label>
                <Input
                  id="pickup-label"
                  value={pickupLabel}
                  onChange={(event) => setPickupLabel(event.target.value)}
                  placeholder="Building, street or landmark"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={locating}
                  onClick={detectLocation}
                >
                  <Crosshair className="size-3.5" />
                  {locating ? "Detecting…" : "Use my current location"}
                </Button>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="pickup-lat" className="text-[10px] text-muted-foreground">
                      Pickup latitude
                    </Label>
                    <Input
                      id="pickup-lat"
                      inputMode="decimal"
                      value={pickupLat}
                      onChange={(event) => setPickupLat(event.target.value)}
                      placeholder="18.5204"
                    />
                  </div>
                  <div>
                    <Label htmlFor="pickup-lng" className="text-[10px] text-muted-foreground">
                      Pickup longitude
                    </Label>
                    <Input
                      id="pickup-lng"
                      inputMode="decimal"
                      value={pickupLng}
                      onChange={(event) => setPickupLng(event.target.value)}
                      placeholder="73.8567"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="destination-label">Destination</Label>
                <Input
                  id="destination-label"
                  value={destinationLabel}
                  onChange={(event) => setDestinationLabel(event.target.value)}
                  placeholder="Hospital, clinic or address"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="destination-lat" className="text-[10px] text-muted-foreground">
                      Destination latitude (optional)
                    </Label>
                    <Input
                      id="destination-lat"
                      inputMode="decimal"
                      value={destinationLat}
                      onChange={(event) => setDestinationLat(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="destination-lng" className="text-[10px] text-muted-foreground">
                      Destination longitude (optional)
                    </Label>
                    <Input
                      id="destination-lng"
                      inputMode="decimal"
                      value={destinationLng}
                      onChange={(event) => setDestinationLng(event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="patient-name">Patient name (optional)</Label>
                  <Input
                    id="patient-name"
                    value={patientName}
                    onChange={(event) => setPatientName(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="ambulance-type">Ambulance type</Label>
                  <select
                    id="ambulance-type"
                    value={typeFilter}
                    onChange={(event) => {
                      setTypeFilter(event.target.value as "all" | AmbulanceType);
                      setSelectedAmbulance(null);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="all">Any available type</option>
                    {AMBULANCE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {AMBULANCE_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor="booking-notes">Notes for the Guardian (optional)</Label>
                <textarea
                  id="booking-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  placeholder="Access instructions, oxygen requirement, contact person…"
                />
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[15px] font-bold">
                    {!validPickup
                      ? "Set a pickup location"
                      : nearby === undefined
                        ? "Checking nearby ambulances…"
                        : nearby.length === 0
                          ? "No available ambulances nearby"
                          : `${nearby.length} ambulance${nearby.length === 1 ? "" : "s"} nearby`}
                  </h2>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Approved, online, available vehicles with a current GPS fix.
                  </p>
                </div>
              </div>
              {validPickup ? (
                <NetworkMap points={nearbyPoints} height={250} groupDuplicateLocations />
              ) : (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-[11.5px] text-muted-foreground">
                  <MapPin className="mx-auto size-5 text-muted-foreground/60" />
                  Set a valid pickup location to discover nearby ambulances.
                </div>
              )}

              {nearby === undefined && validPickup ? (
                <Skeleton className="h-24 w-full rounded-xl" />
              ) : nearby?.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[11px] leading-5 text-amber-950">
                  No available ambulances nearby. We are searching for an eligible provider.
                  You can adjust the ambulance type or call emergency services directly.
                </div>
              ) : (
                <div className="space-y-2">
                  {(nearby ?? []).map((ambulance) => (
                    <button
                      key={ambulance.id}
                      type="button"
                      onClick={() => setSelectedAmbulance(ambulance.id)}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        selectedAmbulance === ambulance.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/25"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[12.5px] font-bold">
                            {ambulance.registrationNumber} · {ambulance.model}
                          </p>
                          <p className="text-[10.5px] text-muted-foreground">
                            {AMBULANCE_TYPE_LABELS[ambulance.type]} · {ambulance.capacity} patient(s)
                          </p>
                          <p className="mt-1 text-[10.5px] text-muted-foreground">
                            Driver details are shared after acceptance.
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-extrabold">{ambulance.etaMinutes} min</p>
                          <p className="text-[10px] text-muted-foreground">
                            {ambulance.distanceKm} km · ₹{ambulance.estimatedFare}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <Button
                className="w-full gap-1.5"
                disabled={busy || !selectedAmbulance || !validPickup}
                onClick={() => void confirmBooking()}
              >
                <Siren className="size-4" />
                {busy ? "Sending request…" : "Confirm ambulance request"}
              </Button>
              <p className="text-[9.5px] leading-4 text-muted-foreground">
                The vehicle is not considered dispatched until a Guardian accepts. Driver
                contact details appear after acceptance.
              </p>
            </section>
          </div>
        )}

        {tab === "bookings" && (
          <div className="space-y-4">
            {bookings === undefined ? (
              <Skeleton className="h-52 w-full rounded-2xl" />
            ) : bookings.length === 0 ? (
              <EmptyState
                icon={Ambulance}
                title="No ambulance bookings yet"
                description="Book an ambulance and its live status will appear here."
                action={<Button onClick={() => setTab("book")}>Book an ambulance</Button>}
              />
            ) : (
              <>
                {activeBookings.length > 0 && (
                  <section className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="text-[15px] font-bold">Active booking</h2>
                        <p className="text-[11px] text-muted-foreground">
                          {latestActive?.bookingRef} · {latestActive ? AMBULANCE_STATUS_LABELS[latestActive.status as AmbulanceBookingStatus] : ""}
                        </p>
                      </div>
                      {latestActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-primary"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void cancelBooking({
                              bookingId: latestActive.id,
                              reason: "Cancelled by the requester.",
                            })
                              .then(() => toast.success("Booking cancelled."))
                              .catch((error: unknown) =>
                                toast.error(
                                  error instanceof Error ? error.message : "Could not cancel booking.",
                                ),
                              )
                              .finally(() => setBusy(false));
                          }}
                        >
                          Cancel booking
                        </Button>
                      )}
                    </div>
                    {detail && (
                      <>
                        <div className="mt-3 grid gap-2 text-[11.5px] sm:grid-cols-2">
                          <p className="flex items-start gap-1.5">
                            <MapPin className="mt-0.5 size-3.5 text-primary" /> {detail.pickupLabel}
                          </p>
                          <p className="flex items-start gap-1.5">
                            <Navigation className="mt-0.5 size-3.5 text-teal-600" />{" "}
                            {detail.destinationLabel}
                          </p>
                          {detail.driverName && (
                            <p className="flex items-center gap-1.5">
                              <PhoneCall className="size-3.5" /> {detail.driverName} ·{" "}
                              {detail.driverPhone}
                            </p>
                          )}
                          <p>
                            {detail.estimatedDistanceKm != null
                              ? `${detail.estimatedDistanceKm} km · ETA ${detail.estimatedEtaMinutes} min`
                              : `Ambulance ETA ${detail.estimatedEtaMinutes} min to pickup`}
                          </p>
                        </div>
                        <NetworkMap
                          points={trackingPoints}
                          height={260}
                          className="mt-3"
                          groupDuplicateLocations
                        />
                        {detail.assignedAmbulanceId &&
                          (detail.ambulance?.lastLocationAt == null ||
                            now - detail.ambulance.lastLocationAt >
                              AMBULANCE_LOCATION_STALE_MS) && (
                            <p className="mt-2 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 text-[11px] leading-5 text-amber-950">
                              Live location temporarily unavailable. The assigned provider has not
                              sent a current GPS update, so no vehicle position is shown as live.
                            </p>
                          )}
                        <div className="mt-3 space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                            Status history
                          </p>
                          {detail.events.map((event) => (
                            <div
                              key={event.id}
                              className="flex items-start gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 text-[10.5px]"
                            >
                              <Clock3 className="mt-0.5 size-3 text-muted-foreground" />
                              <div>
                                <p className="font-semibold">
                                  {AMBULANCE_STATUS_LABELS[event.status as AmbulanceBookingStatus]}
                                </p>
                                <p className="text-muted-foreground">
                                  {event.note} · {formatRelative(event.createdAt)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </section>
                )}

                <section className="rounded-2xl border border-border bg-card p-5">
                  <h2 className="flex items-center gap-1.5 text-[15px] font-bold">
                    <Route className="size-4 text-primary" /> Booking history
                  </h2>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-[11.5px]">
                      <thead className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
                        <tr>
                          <th className="pb-2">Booking</th>
                          <th className="pb-2">Route</th>
                          <th className="pb-2">Driver</th>
                          <th className="pb-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {bookings.map((booking) => (
                          <tr key={booking.id}>
                            <td className="py-2 font-semibold">{booking.bookingRef}</td>
                            <td className="py-2">
                              {booking.pickupLabel} → {booking.destinationLabel}
                            </td>
                            <td className="py-2">{booking.driverName ?? "Not assigned"}</td>
                            <td className="py-2">
                              <StatusBadge
                                status={booking.status}
                                label={
                                  AMBULANCE_BOOKING_STATUSES.includes(
                                    booking.status as AmbulanceBookingStatus,
                                  )
                                    ? AMBULANCE_STATUS_LABELS[
                                        booking.status as AmbulanceBookingStatus
                                      ]
                                    : booking.status
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
