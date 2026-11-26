import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  Navigation,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatRelative } from "@/lib/blood";
import {
  AMBULANCE_STATUS_LABELS,
  type AmbulanceBookingStatus,
} from "@/lib/ambulance";
import { cn } from "@/lib/utils";
import type { UseSoundReturn } from "@/hooks/use-sound";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  AmbulanceBookingSummary,
  AmbulanceBookingSummaryLike,
} from "@/convex/ambulances";

export type IncomingBooking = AmbulanceBookingSummaryLike & {
  id: Id<"ambulanceBookings">;
};

type Props = {
  booking: IncomingBooking | null;
  incomingCount: number;
  sound: UseSoundReturn;
  onAccept: (booking: IncomingBooking) => void;
  onDecline: (booking: IncomingBooking) => void;
  onDismiss: () => void;
};

export function IncomingRequestPopup({
  booking,
  incomingCount,
  sound,
  onAccept,
  onDecline,
  onDismiss,
}: Props) {
  const [peeked, setPeeked] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [localAccepting, setLocalAccepting] = useState(false);
  const [localDeclining, setLocalDeclining] = useState(false);
  const [acknowledgedId, setAcknowledgedId] = useState<Id<"ambulanceBookings"> | null>(
    null,
  );
  const hasEverSeenBookingId = useRef(false);
  const popupMutedRef = useRef(false);
  const mountRef = useRef(true);
  const lastBookingIdRef = useRef<Id<"ambulanceBookings"> | null>(null);
  const popupDismissedRef = useRef(false);
  const popupVisibleRef = useRef(false);

  const shouldSuppressPopup =
    popupDismissedRef.current ||
    acknowledgedId === booking?.id ||
    hasEverSeenBookingId.current ||
    popupMutedRef.current;
  const shouldSuppressDuplicate = shouldSuppressPopup;

  // Decide whether this particular booking should trigger a fresh alert.
  const isNewNotification = booking != null && lastBookingIdRef.current !== booking.id && !shouldSuppressDuplicate;

  // Keep sound playback strictly tied to the first render where a genuinely new
  // booking is present, and never replay it on reconnect/refresh for an already
  // seen booking.
  useEffect(() => {
    mountRef.current = true;
    if (!isNewNotification) return;
    if (!sound.muted) {
      sound.play();
    }
    return () => {
      mountRef.current = false;
    };
  }, [booking?.id, isNewNotification, sound.muted, sound.play]);

  // Persist the latest seen identifier so reconnect cannot replay the same alert.
  useEffect(() => {
    if (!booking) return;
    hasEverSeenBookingId.current = true;
    if (mountRef.current) {
      lastBookingIdRef.current = booking.id;
      return;
    }
    setAcknowledgedId((prev) => (prev === booking.id ? prev : booking.id));
  }, [booking?.id]);

  if (!booking && incomingCount === 0) {
    return null;
  }

  const status = booking?.status as AmbulanceBookingStatus | undefined;
  const terminal = status != null && !["requested", "searching"].includes(status);
  const isAcceptable = status === "requested" || status === "searching";

  const handleAccept = async () => {
    if (!booking || localAccepting) return;
    setLocalAccepting(true);
    try {
      onAccept(booking);
      setAcknowledgedId(booking.id);
      setPeeked(false);
      setMobileOpen(false);
      onDismiss();
    } finally {
      setLocalAccepting(false);
    }
  };
  const handleDecline = async () => {
    if (!booking || localDeclining) return;
    setLocalDeclining(true);
    try {
      onDecline(booking);
      setAcknowledgedId(booking.id);
      setPeeked(false);
      setMobileOpen(false);
      onDismiss();
    } finally {
      setLocalDeclining(false);
    }
  };

  const desktopPopup = (
    <div
      className={cn(
        "pointer-events-auto fixed left-1/2 top-20 z-50 w-[min(92vw,640px)] -translate-x-1/2 animate-in fade-in-0 slide-in-from-top-4",
      )}
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {terminal ? (
                <XCircle className="size-5" />
              ) : (
                <AlertTriangle className="size-5" />
              )}
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                Incoming request
              </p>
              <p className="text-[11px] text-muted-foreground">
                {terminal
                  ? "This request is no longer open for response."
                  : `${incomingCount} request${incomingCount === 1 ? "" : "s"} pending`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full text-muted-foreground"
            onClick={() => {
              setAcknowledgedId(booking?.id ?? null);
              setPeeked(false);
              onDismiss();
            }}
            aria-label="Dismiss incoming request alert"
          >
            <XCircle className="size-4" />
          </Button>
        </div>

        <div className="border-t border-border p-4">
          <IncomingRequestCard
            booking={booking}
            onAccept={handleAccept}
            onDecline={handleDecline}
            acceptDisabled={!isAcceptable || localAccepting || localDeclining}
            declineDisabled={!isAcceptable || localAccepting || localDeclining}
          />
        </div>
      </div>
    </div>
  );

  const mobileSheet = (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="bottom" className="w-[100vw] overflow-y-auto sm:max-w-sm">
        <SheetHeader className="sr-only">
          <SheetTitle>Incoming ambulance request</SheetTitle>
          <SheetDescription>
            Response options for the latest pending ambulance booking.
          </SheetDescription>
        </SheetHeader>
        <IncomingRequestCard
          booking={booking}
          onAccept={handleAccept}
          onDecline={handleDecline}
          acceptDisabled={!isAcceptable || localAccepting || localDeclining}
          declineDisabled={!isAcceptable || localAccepting || localDeclining}
        />
      </SheetContent>
    </Sheet>
  );

  return (
    <>
      {desktopPopup}
      {mobileSheet}
      {terminal && (
        <div className="pointer-events-auto absolute left-1/2 top-20 z-50 w-[min(92vw,640px)] -translate-x-1/2">
          <div className="rounded-2xl border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
            {terminal ? (
              <p>
                The latest incoming request is{" "}
                {status === "cancelled"
                  ? "cancelled"
                  : status === "expired"
                    ? "expired"
                    : "no longer open"} and has been removed from the dashboard.
              </p>
            ) : null}
          </div>
        </div>
      )}
      {!terminal && incomingCount > 0 && !peeked && !shouldSuppressDuplicate && (
        <button
          type="button"
          className="pointer-events-auto fixed left-4 bottom-4 z-50 rounded-full bg-primary text-primary-foreground shadow-lg transition-transform sm:left-6 sm:bottom-6 sm:right-auto sm:w-auto sm:max-w-xs sm:flex sm:flex-col sm:items-start sm:justify-start sm:p-4 sm:text-left"
          onClick={() => {
            setPeeked(true);
            setMobileOpen(true);
          }}
        >
          <div className="flex items-center gap-3 rounded-full px-4 py-2 sm:gap-2 sm:px-5 sm:py-3 sm:text-sm">
            <AlertTriangle className="size-4 shrink-0 text-primary" />
            <span className="font-medium">
              {incomingCount === 1
                ? "1 incoming request"
                : `${incomingCount} incoming requests`}
            </span>
            <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:hidden">
              Tap
            </span>
          </div>
        </button>
      )}
    </>
  );
}

function IncomingRequestCard({
  booking,
  onAccept,
  onDecline,
  acceptDisabled,
  declineDisabled,
}: {
  booking: IncomingBooking | null;
  onAccept: () => void;
  onDecline: () => void;
  acceptDisabled: boolean;
  declineDisabled: boolean;
}) {
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const status = booking?.status as AmbulanceBookingStatus | undefined;
  const terminal = status != null && !["requested", "searching"].includes(status);
  const isAcceptable = status === "requested" || status === "searching";

  const handleAccept = async () => {
    if (!booking || accepting || declineDisabled) return;
    setAccepting(true);
    try {
      onAccept();
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (!booking || declining || acceptDisabled) return;
    setDeclining(true);
    try {
      onDecline();
    } finally {
      setDeclining(false);
    }
  };

  if (!booking) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-muted-foreground">No pending request to show.</p>
      </div>
    );
  }

  return (
    <div ref={cardRef} className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
            Booking reference
          </p>
          <p className="mt-1 font-display text-xl font-extrabold">{booking.bookingRef}</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold",
            terminal
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          <span className={cn("size-1.5 rounded-full", terminal ? "bg-muted-foreground" : "bg-primary")} />
          {terminal
            ? AMBULANCE_STATUS_LABELS[status]
            : "Awaiting response"}
        </span>
      </div>

      {isAcceptable && booking.estimatedDistanceKm != null && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
          <Navigation className="size-3.5 text-primary" />
          <span>
            Estimated distance: {booking.estimatedDistanceKm} km
          </span>
        </div>
      )}

      {isAcceptable && booking.patientName && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
          <MapPin className="size-3.5 text-primary mt-0.5" />
          <span>Patient contact: {booking.patientName}</span>
        </div>
      )}

      <div className="grid gap-2 text-[11px] sm:grid-cols-2">
        <p className="flex items-center gap-1.5">
          <MapPin className="size-3.5 text-primary" />
          Pickup: {booking.pickupLabel}
        </p>
        <p className="flex items-center gap-1.5">
          <Navigation className="size-3.5 text-primary" />
          Destination: {booking.destinationLabel}
        </p>
      </div>

      {!terminal && (
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            disabled={acceptDisabled || accepting}
            onClick={handleAccept}
          >
            {accepting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5"
            disabled={declineDisabled || declining}
            onClick={handleDecline}
          >
            {declining ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <XCircle className="size-3.5" />
            )}
            Decline
          </Button>
        </div>
      )}

      {terminal && (
        <p className="rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 text-[11px] leading-5 text-amber-950">
          This incoming request is no longer open for response.
        </p>
      )}
    </div>
  );
}
