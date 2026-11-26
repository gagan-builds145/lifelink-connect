import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useConvexAuth } from "convex/react";
import { useSound } from "@/hooks/use-sound";
import { IncomingRequestPopup } from "@/components/lifelink/IncomingRequestPopup";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Ambulance,
  Clock3,
  Navigation,
  Plus,
  Route,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import { RoleSwitcher } from "@/components/lifelink/RoleSwitcher";
import { EmptyState, StatusBadge } from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AMBULANCE_STATUS_LABELS,
  AMBULANCE_TYPE_LABELS,
  AMBULANCE_TYPES,
  nextGuardianStatuses,
  type AmbulanceBookingStatus,
  type AmbulanceType,
} from "@/lib/ambulance";
import { formatRelative } from "@/lib/blood";
import { GUARDIAN_STATUS_LABELS, type GuardianStatus } from "@/lib/guardian";

type Tab = "overview" | "fleet" | "active" | "history";

const emptyVehicle = {
  registrationNumber: "",
  model: "",
  type: "bls" as AmbulanceType,
  capacity: "2",
  driverName: "",
  driverPhone: "",
  driverLicenseRef: "",
  documentRef: "",
};

export default function GuardianDashboard() {
  const overview = useQuery(api.ambulances.guardianOverview);
  const setOnline = useMutation(api.ambulances.setGuardianOnline);
  const upsert = useMutation(api.ambulances.upsertAmbulance);
  const setAvailability = useMutation(api.ambulances.setAmbulanceAvailability);
  const publishLocation = useMutation(api.ambulances.publishAmbulanceLocation);
  const accept = useMutation(api.ambulances.acceptBooking);
  const reject = useMutation(api.ambulances.rejectBooking);
  const updateStatus = useMutation(api.ambulances.updateBookingStatus);
  const share = useMutation(api.ambulances.shareLocation);
  const cancel = useMutation(api.ambulances.cancelBooking);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const attachDocument = useMutation(api.documents.attachDocument);
  const scanDocument = useAction(api.scan.scanDocument);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<Id<"documentMetadata"> | null>(null);

  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState(emptyVehicle);
  const [editingId, setEditingId] = useState<Id<"ambulances"> | null>(null);
  const [nextStatus, setNextStatus] = useState<Record<string, string>>({});
  const [watchingBookingId, setWatchingBookingId] = useState<Id<"ambulanceBookings"> | null>(null);
  const [sharingFleetId, setSharingFleetId] = useState<Id<"ambulances"> | null>(null);
  const watchRef = useRef<number | null>(null);
  const fleetWatchRef = useRef<number | null>(null);
  const lastShareAt = useRef(0);
  const lastFleetShareAt = useRef(0);

  // Popup state - consolidated single block
  const sound = useSound();
  const [shownId, setShownId] = useState<Id<"ambulanceBookings"> | null>(null);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [popupVisibleState, setPopupVisibleState] = useState<Id<"ambulanceBookings"> | null>(null);

  const incoming = useMemo(() => overview?.incoming ?? [], [overview]);
  const topIncoming = useMemo(() => incoming.slice(0, 1)[0] ?? null, [incoming]);
  const active = useMemo(() => overview?.active ?? [], [overview]);
  const history = useMemo(() => overview?.history ?? [], [overview]);
  const ambulances = useMemo(() => overview?.ambulances ?? [], [overview]);
  const profile = overview?.profile;

  const isPopupEligible = useMemo(() => {
    if (!topIncoming) return false;
    if (!profile?.approved) return false;
    if (active.some((ab) => ab.id === topIncoming.id)) return false;
    if (shownId === topIncoming.id) return false;
    if (popupDismissed) return false;
    return true;
  }, [topIncoming, active, profile?.approved]);

  const effectiveTopBooking = useMemo(() => {
    if (!isPopupEligible) return null;
    if (popupVisibleState === topIncoming?.id && shownId === topIncoming?.id) return null;
    return topIncoming ?? null;
  }, [isPopupEligible, topIncoming, popupVisibleState]);

  const handlePopupDismiss = () => {
    if (topIncoming) {
      setShownId(topIncoming.id);
      setPopupDismissed(true);
      setPopupVisibleState(null);
    }
  };

  // Mount/unmount popup gating. The initial visibility is derived from the
  // async query result, so we must set state during this effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!topIncoming || !profile?.approved) return;
    if (!popupVisibleState && !popupDismissed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPopupVisibleState(topIncoming.id);
    }
    return () => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPopupVisibleState(null);
    };
  }, [topIncoming, profile?.approved]);

  // Reset dismissal when a new incoming arrives. The state updates keep
  // the visible booking in sync with the reactive query snapshot.
  useEffect(() => {
    if (topIncoming && shownId !== topIncoming.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPopupDismissed(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPopupVisibleState(null);
    }
  }, [topIncoming, shownId]);

  const { isAuthenticated } = useConvexAuth();

  const navItems = useMemo(
    () => [
      { key: "overview", label: "Overview", icon: ShieldCheck },
      { key: "fleet", label: "My fleet", icon: Ambulance, badge: ambulances.length },
      { key: "active", label: "Active journeys", icon: Route, badge: active.length },
      { key: "history", label: "Booking history", icon: Clock3 },
    ],
    [ambulances.length, active.length],
  );

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  const saveVehicle = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("vehicle");
    try {
      let uploadedDocumentId = documentId ?? undefined;
      if (documentFile) {
        const uploadUrl = await generateUploadUrl();
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": documentFile.type },
          body: documentFile,
        });
        if (!response.ok) throw new Error("Vehicle document upload failed.");
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        const attached = await attachDocument({
          storageId,
          fileName: documentFile.name,
          contentType: documentFile.type,
          size: documentFile.size,
        });
        const scanResult = await scanDocument({ documentId: attached.documentId });
        if (scanResult.status !== "clean") {
          throw new Error("The vehicle document was quarantined and cannot be attached.");
        }
        uploadedDocumentId = attached.documentId;
        setDocumentId(attached.documentId);
      }
      await upsert({
        ambulanceId: editingId ?? undefined,
        registrationNumber: vehicle.registrationNumber,
        model: vehicle.model,
        type: vehicle.type,
        capacity: Number(vehicle.capacity),
        driverName: vehicle.driverName,
        driverPhone: vehicle.driverPhone,
        driverLicenseRef: vehicle.driverLicenseRef || undefined,
        documentRef: vehicle.documentRef || undefined,
        documentId: uploadedDocumentId,
      });
      toast.success(editingId ? "Ambulance updated." : "Ambulance added.");
      setVehicle(emptyVehicle);
      setEditingId(null);
      setDocumentFile(null);
      setDocumentId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the ambulance.");
    } finally {
      setBusy(null);
    }
  };

  const stopLiveTracking = () => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setWatchingBookingId(null);
  };

  const stopFleetLocation = () => {
    if (fleetWatchRef.current != null) {
      navigator.geolocation.clearWatch(fleetWatchRef.current);
      fleetWatchRef.current = null;
    }
    setSharingFleetId(null);
  };

  useEffect(() => {
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      if (fleetWatchRef.current != null) navigator.geolocation.clearWatch(fleetWatchRef.current);
    };
  }, []);

  useEffect(() => {
    if (
      !watchingBookingId ||
      active.some((booking) => booking.id === watchingBookingId)
    ) {
      return;
    }
    // Let the active-list update settle before clearing the watcher state.
    const timer = window.setTimeout(() => stopLiveTracking(), 0);
    return () => window.clearTimeout(timer);
  }, [active, watchingBookingId]);

  useEffect(() => {
    if (!sharingFleetId) return;
    const vehicle = ambulances.find((row) => row.id === sharingFleetId);
    if (vehicle?.available && profile?.online) return;
    // Discovery sharing is only meaningful while this vehicle is online and
    // available. Drop the device watcher as soon as either changes.
    const timer = window.setTimeout(() => stopFleetLocation(), 0);
    return () => window.clearTimeout(timer);
  }, [ambulances, profile?.online, sharingFleetId]);

  const startFleetLocation = (ambulanceId: Id<"ambulances">) => {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser.");
      return;
    }
    stopFleetLocation();
    lastFleetShareAt.current = 0;
    setSharingFleetId(ambulanceId);
    fleetWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (Date.now() - lastFleetShareAt.current < 12_000) return;
        lastFleetShareAt.current = Date.now();
        void publishLocation({
          ambulanceId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }).catch(() => {
          toast.error("Could not publish this vehicle's GPS. Location sharing stopped.");
          stopFleetLocation();
        });
      },
      () => {
        toast.error("Location permission or GPS is unavailable. Location sharing stopped.");
        stopFleetLocation();
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
    );
    toast.success("Vehicle GPS is live for nearby discovery while you remain online and available.");
  };

  const startLiveTracking = (bookingId: Id<"ambulanceBookings">) => {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser.");
      return;
    }
    stopLiveTracking();
    lastShareAt.current = 0;
    setWatchingBookingId(bookingId);
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        // Providers control this feed explicitly. Throttle durable writes while
        // keeping the marker responsive to genuine GPS movement.
        if (Date.now() - lastShareAt.current < 8_000) return;
        lastShareAt.current = Date.now();
        void share({
          bookingId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }).catch(() => {
          toast.error("Live location update failed. The feed has been stopped.");
          stopLiveTracking();
        });
      },
      () => {
        toast.error("Location permission or GPS is unavailable. Live tracking stopped.");
        stopLiveTracking();
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
    );
    toast.success("Live GPS sharing started. It stops when this journey ends.");
  };

  const shareCurrentLocation = (bookingId: Id<"ambulanceBookings">) => {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser.");
      return;
    }
    setBusy(`location-${bookingId}`);
    navigator.geolocation.getCurrentPosition(
      (position) =>
        void run(
          `location-${bookingId}`,
          () =>
            share({
              bookingId,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          "Live location shared with the requester.",
        ),
      () => {
        setBusy(null);
        toast.error(
          "Could not read your GPS location. Enable browser location permission and try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  // Overview: render the Guardian application in card form according to its state
  const overviewPanel = () => {
    const p = profile as NonNullable<typeof profile>;
    const o = overview as NonNullable<typeof overview>;
    const amb = ambulances;
    const status = (p.status as GuardianStatus) ?? "DRAFT";
    const statusLabel = GUARDIAN_STATUS_LABELS[status];
    const vehicle = amb[0];

    if (amb.length === 0) {
      return (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4">
          <h3 className="font-display text-lg font-bold text-amber-950">Register Your Vehicle</h3>
          <p className="mt-1 text-[11.5px] text-amber-950/80">
            You have not registered an ambulance vehicle yet. Your fleet stays hidden from nearby
            searches and you cannot accept bookings until an administrator approves the application
            and every required document is valid. You can still add vehicles, drivers and documents now.
          </p>
          <Button onClick={() => setTab("fleet")}>Open my fleet</Button>
        </div>
      );
    }

    if (!p.approved) {
      let reason = p.reviewNote ?? "";
      if (!reason) {
        const compliance = o.issues.filter(
          (issue) => !issue.startsWith("Guardian application") && !issue.startsWith("No ambulance"),
        );
        reason = compliance.join(" ");
      }
      if (!reason) reason = "No additional detail recorded.";
      let nextLabel = "Continue to onboarding";
      if (status === "REJECTED") nextLabel = "Provide corrections and resubmit";
      else if (status === "SUSPENDED") nextLabel = "Contact support to reopen this application";
      else if (status === "RESUBMISSION_REQUIRED") nextLabel = "Resubmit the corrected application";

      return (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4">
          <h3 className="font-display text-lg font-bold text-amber-950">{statusLabel}</h3>
          <p className="mt-1 text-[11.5px] text-amber-950/80">{reason}</p>
          <Button onClick={() => setTab("fleet")}>{nextLabel}</Button>
        </div>
      );
    }

    const documentIssues = o.issues.filter(
      (issue) =>
        issue.includes("expired") || issue.includes("invalid") || issue.includes("missing"),
    );
    if (documentIssues.length > 0) {
      return (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4">
          <h3 className="font-display text-lg font-bold text-amber-950">Documents need attention</h3>
          <ul className="mt-2 list-disc pl-4 text-[11.5px] text-amber-950/80">
            {documentIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-amber-950/80">
            Upload refreshed versions of the affected documents, then choose to resubmit.
          </p>
          <Button onClick={() => setTab("fleet")} variant="outline">
            Open documents checklist
          </Button>
        </div>
      );
    }

    // Approved and a vehicle is registered: show the fleet and its availability.
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="font-display text-lg font-bold text-foreground">Registered vehicle</h3>
        <div className="mt-2 grid gap-2 text-sm text-foreground">
          <p>Registration: {vehicle.registrationNumber}</p>
          <p>Model: {vehicle.model} · Type: {AMBULANCE_TYPE_LABELS[vehicle.type]}</p>
          <p>Capacity: {vehicle.capacity} patients</p>
          <p>Driver: {vehicle.driverName}</p>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <StatusBadge
            status={vehicle.available ? "verified" : "pending"}
            label={vehicle.available ? "Available" : "Unavailable"}
          />
          <Button onClick={() => setTab("fleet")} size="sm">
            Open my fleet
          </Button>
        </div>
      </div>
    );
  };

  return (
    <DashboardShell
      roleLabel="Guardian"
      roleKey={profile?.companyName ?? "Ambulance provider"}
      title="Guardian ambulance dashboard"
      items={navItems}
      active={tab}
      onSelect={(key) => setTab(key as Tab)}
      onProfile={() => setTab("overview")}
      accentIcon={Ambulance}
      quickLinks={[
        { label: "Onboarding & documents", href: "/guardian/onboarding", icon: ShieldCheck },
        { label: "Public blood search", href: "/blood-search" },
      ]}
    >
      {overview === undefined ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      ) : !profile ? (
        <div className="mt-4">
          <EmptyState
            title="Guardian profile missing"
            description="Complete the Guardian registration to manage ambulances and bookings."
            action={
              <Button asChild>
                <a href="/signup/guardian">Complete registration</a>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {!profile.approved && (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4 text-[11.5px] leading-5 text-amber-950">
              <p className="font-bold">
                {GUARDIAN_STATUS_LABELS[(profile.status ?? "DRAFT") as GuardianStatus] ??
                  "Application in progress"}
              </p>
              <p className="mt-1">
                Your fleet stays hidden from nearby searches and you cannot accept bookings
                until an administrator approves the application and every required document
                is valid. You can still add vehicles, drivers and documents now.
              </p>
              <a
                href="/guardian/onboarding"
                className="mt-2 inline-flex font-bold text-amber-950 underline underline-offset-2"
              >
                Open onboarding and document checklist
              </a>
            </div>
          )}
          {profile.approved && overview.issues.length > 0 && (
            <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 p-4 text-[11.5px] leading-5 text-rose-950">
              <p className="font-bold">Documents need attention</p>
              <ul className="mt-1 list-disc pl-4">
                {overview.issues.slice(0, 4).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

                        {tab === "overview" && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                      Dispatch availability
                    </p>
                    <h2 className="mt-1 font-display text-xl font-extrabold">
                      {profile.online ? "Online for requests" : "Offline"}
                    </h2>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      {profile.contactPerson} · {profile.phone} · {profile.city}
                    </p>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 sm:items-end">
                  <Button
                    variant={profile.online ? "outline" : "default"}
                    className="gap-2"
                    disabled={
                      busy === "online" ||
                      (!profile.online && (!profile.approved || overview.issues.length > 0))
                    }
                    onClick={() =>
                      void run(
                        "online",
                        () => setOnline({ online: !profile.online }),
                        profile.online ? "You are now offline." : "You are online for requests.",
                      )
                    }
                  >
                    <ShieldCheck className="size-4" />
                    {profile.online ? "Go offline" : "Go online"}
                  </Button>
                  {!profile.online && (!profile.approved || overview.issues.length > 0) && (
                    <p className="max-w-[220px] text-[9.5px] leading-4 text-muted-foreground">
                      Going online requires an approved application and valid documents.
                    </p>
                  )}
                  <RoleSwitcher />
                  </div>
                </div>

              </section>

              {overviewPanel()}
            </div>
          )}

          {isAuthenticated && profile?.approved && active.length === 0 && (
            <IncomingRequestPopup
              booking={effectiveTopBooking}
              incomingCount={incoming.length}
              sound={sound}
              onAccept={(booking) => {
                void run(
                  `accept-${booking.id}`,
                  () => accept({ bookingId: booking.id }),
                  "Booking accepted and guardian assigned.",
                );
              }}
              onDecline={(booking) => {
                void run(
                  `decline-${booking.id}`,
                  () =>
                    reject({
                      bookingId: booking.id,
                      reason: "Declined by the ambulance provider.",
                    }),
                  "Request declined.",
                );
              }}
              onDismiss={handlePopupDismiss}
            />
          )}

          {tab === "fleet" && (
            <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-[15px] font-bold">Registered ambulances</h2>
                <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
                  Nearby discovery only lists approved, online, available vehicles with GPS
                  shared in the last two minutes. Press Share GPS while this device is in the
                  vehicle.
                </p>
                <div className="mt-3 space-y-2">
                  {ambulances.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-4 text-[11.5px] text-muted-foreground">
                      No vehicles yet.
                    </p>
                  ) : (
                    ambulances.map((ambulance) => (
                      <div
                        key={ambulance.id}
                        className="rounded-xl border border-border p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-[13px] font-bold">
                              {ambulance.registrationNumber} · {ambulance.model}
                            </p>
                            <p className="text-[10.5px] text-muted-foreground">
                              {AMBULANCE_TYPE_LABELS[ambulance.type]} · {ambulance.capacity} patient(s)
                            </p>
                            <p className="mt-1 text-[10.5px] text-muted-foreground">
                              Driver: {ambulance.driverName} · {ambulance.driverPhone}
                            </p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {ambulance.lastLocationAt
                                ? `Vehicle GPS updated ${formatRelative(ambulance.lastLocationAt)}`
                                : "No vehicle GPS shared yet"}
                            </p>
                          </div>
                          <StatusBadge
                            status={ambulance.available ? "verified" : "pending"}
                            label={ambulance.available ? "Available" : "Unavailable"}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-[10.5px]"
                            onClick={() => {
                              setEditingId(ambulance.id);
                              setVehicle({
                                registrationNumber: ambulance.registrationNumber,
                                model: ambulance.model,
                                type: ambulance.type,
                                capacity: String(ambulance.capacity),
                                driverName: ambulance.driverName,
                                driverPhone: ambulance.driverPhone,
                                driverLicenseRef: ambulance.driverLicenseRef ?? "",
                                documentRef: ambulance.documentRef ?? "",
                              });
                              setDocumentId(ambulance.documentId);
                              setDocumentFile(null);
                            }}
                          >
                            Edit
                          </Button>
                          {ambulance.available && (
                            <Button
                              size="sm"
                              variant={sharingFleetId === ambulance.id ? "secondary" : "outline"}
                              className="h-7 gap-1 text-[10.5px]"
                              disabled={!profile.online}
                              title={
                                profile.online
                                  ? "Share this device's GPS so the vehicle appears in nearby searches"
                                  : "Go online before sharing vehicle GPS"
                              }
                              onClick={() =>
                                sharingFleetId === ambulance.id
                                  ? stopFleetLocation()
                                  : startFleetLocation(ambulance.id)
                              }
                            >
                              <Navigation className="size-3" />
                              {sharingFleetId === ambulance.id ? "Stop GPS" : "Share GPS"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10.5px]"
                            disabled={busy === `availability-${ambulance.id}`}
                            onClick={() =>
                              void run(
                                `availability-${ambulance.id}`,
                                () =>
                                  setAvailability({
                                    ambulanceId: ambulance.id,
                                    available: !ambulance.available,
                                  }),
                                ambulance.available
                                  ? "Ambulance marked unavailable."
                                  : "Ambulance marked available.",
                              )
                            }
                          >
                            {ambulance.available ? "Set unavailable" : "Set available"}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-[15px] font-bold">
                  {editingId ? "Edit ambulance" : "Add ambulance"}
                </h2>
                <form className="mt-3 space-y-3" onSubmit={saveVehicle}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="amb-registration">Registration number</Label>
                      <Input
                        id="amb-registration"
                        value={vehicle.registrationNumber}
                        onChange={(event) =>
                          setVehicle((current) => ({ ...current, registrationNumber: event.target.value }))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="amb-model">Vehicle model</Label>
                      <Input
                        id="amb-model"
                        value={vehicle.model}
                        onChange={(event) =>
                          setVehicle((current) => ({ ...current, model: event.target.value }))
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="amb-type">Ambulance type</Label>
                      <select
                        id="amb-type"
                        value={vehicle.type}
                        onChange={(event) =>
                          setVehicle((current) => ({
                            ...current,
                            type: event.target.value as AmbulanceType,
                          }))
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      >
                        {AMBULANCE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {AMBULANCE_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="amb-capacity">Patient capacity</Label>
                      <Input
                        id="amb-capacity"
                        type="number"
                        min={1}
                        max={20}
                        value={vehicle.capacity}
                        onChange={(event) =>
                          setVehicle((current) => ({ ...current, capacity: event.target.value }))
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="amb-driver">Driver name</Label>
                      <Input
                        id="amb-driver"
                        value={vehicle.driverName}
                        onChange={(event) =>
                          setVehicle((current) => ({ ...current, driverName: event.target.value }))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="amb-driver-phone">Driver phone</Label>
                      <Input
                        id="amb-driver-phone"
                        type="tel"
                        value={vehicle.driverPhone}
                        onChange={(event) =>
                          setVehicle((current) => ({ ...current, driverPhone: event.target.value }))
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="amb-licence">Driver licence reference</Label>
                      <Input
                        id="amb-licence"
                        value={vehicle.driverLicenseRef}
                        onChange={(event) =>
                          setVehicle((current) => ({ ...current, driverLicenseRef: event.target.value }))
                        }
                        placeholder="Optional"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="amb-document">Vehicle document reference</Label>
                      <Input
                        id="amb-document"
                        value={vehicle.documentRef}
                        onChange={(event) =>
                          setVehicle((current) => ({ ...current, documentRef: event.target.value }))
                        }
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="amb-document-file">Upload vehicle document</Label>
                    <Input
                      id="amb-document-file"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                    />
                    <p className="text-[9.5px] leading-4 text-muted-foreground">
                      PDF, JPEG or PNG under 5 MB. {documentId ? "A document is already attached." : "Optional until verification is requested."}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy === "vehicle"} className="gap-1.5">
                      <Plus className="size-4" />
                      {editingId ? "Save changes" : "Add ambulance"}
                    </Button>
                    {editingId && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(null);
                          setVehicle(emptyVehicle);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </form>
              </section>
            </div>
          )}



          {tab === "active" && (
            <section className="space-y-3">
              {active.length === 0 ? (
                <EmptyState
                  icon={Route}
                  title="No active journey"
                  description="Accepted bookings appear here with pickup, destination and status controls."
                />
              ) : (
                active.map((booking) => {
                  const status = booking.status as AmbulanceBookingStatus;
                  const options = nextGuardianStatuses(status);
                  return (
                    <div key={booking.id} className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[13px] font-bold">{booking.bookingRef}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {AMBULANCE_STATUS_LABELS[status]}
                          </p>
                        </div>
                        <StatusBadge status="verified" label={AMBULANCE_STATUS_LABELS[status]} />
                      </div>
                      <div className="mt-3 grid gap-2 text-[11.5px] sm:grid-cols-2">
                        <p>Pickup: {booking.pickupLabel}</p>
                        <p>Destination: {booking.destinationLabel}</p>
                        <p>Driver: {booking.driverName ?? "—"}</p>
                        <p>Patient: {booking.patientName ?? "Not specified"}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        {options.length > 0 && (
                          <>
                            <select
                              value={nextStatus[booking.id] ?? options[0]}
                              onChange={(event) =>
                                setNextStatus((current) => ({
                                  ...current,
                                  [booking.id]: event.target.value,
                                }))
                              }
                              className="h-8 rounded-md border border-input bg-transparent px-2 text-[11px]"
                            >
                              {options.map((option) => (
                                <option key={option} value={option}>
                                  {AMBULANCE_STATUS_LABELS[option]}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              disabled={busy === `status-${booking.id}`}
                              onClick={() =>
                                void run(
                                  `status-${booking.id}`,
                                  () =>
                                    updateStatus({
                                      bookingId: booking.id,
                                      status: (nextStatus[booking.id] ?? options[0]) as AmbulanceBookingStatus,
                                    }),
                                  "Journey status updated.",
                                )
                              }
                            >
                              Update status
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={busy === `location-${booking.id}`}
                          onClick={() => shareCurrentLocation(booking.id)}
                        >
                          <Navigation className="size-3.5" /> Send location now
                        </Button>
                        <Button
                          size="sm"
                          variant={watchingBookingId === booking.id ? "secondary" : "outline"}
                          className="gap-1.5"
                          onClick={() =>
                            watchingBookingId === booking.id
                              ? stopLiveTracking()
                              : startLiveTracking(booking.id)
                          }
                        >
                          <Navigation className="size-3.5" />
                          {watchingBookingId === booking.id ? "Stop live GPS" : "Start live GPS"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-primary"
                          disabled={busy === `cancel-${booking.id}`}
                          onClick={() =>
                            void run(
                              `cancel-${booking.id}`,
                              () =>
                                cancel({
                                  bookingId: booking.id,
                                  reason: "Cancelled by the ambulance provider.",
                                }),
                              "Booking cancelled.",
                            )
                          }
                        >
                          Cancel booking
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          )}

          {tab === "history" && (
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[15px] font-bold">Booking history</h2>
              {history.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-[11.5px] text-muted-foreground">
                  No completed or cancelled journeys yet.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-[11.5px]">
                    <thead className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
                      <tr>
                        <th className="pb-2">Booking</th>
                        <th className="pb-2">Pickup / destination</th>
                        <th className="pb-2">Driver</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {history.map((booking) => (
                        <tr key={booking.id}>
                          <td className="py-2 font-semibold">{booking.bookingRef}</td>
                          <td className="py-2">
                            {booking.pickupLabel} → {booking.destinationLabel}
                          </td>
                          <td className="py-2">{booking.driverName ?? "—"}</td>
                          <td className="py-2">
                            {AMBULANCE_STATUS_LABELS[booking.status as AmbulanceBookingStatus]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
