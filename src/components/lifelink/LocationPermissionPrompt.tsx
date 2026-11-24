import { Button } from "@/components/ui/button";
import type { LocationPermissionState } from "@/hooks/use-location-permission";
import { Loader2, LocateFixed, MapPin, ShieldCheck, X } from "lucide-react";

/**
 * Small, non-blocking consent card. Dashboard access never depends on it and
 * the browser's native prompt only appears after Enable Location.
 */
export function LocationPermissionPrompt({
  location,
}: {
  location: LocationPermissionState;
}) {
  if (!location.open) return null;

  return (
    <aside
      role="dialog"
      aria-labelledby="location-consent-title"
      aria-describedby="location-consent-description"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-foreground/10 sm:left-auto sm:right-5 sm:mx-0"
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MapPin className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p id="location-consent-title" className="text-[13px] font-bold">
            Enable location services?
          </p>
          <p
            id="location-consent-description"
            className="mt-1 text-[11.5px] leading-5 text-muted-foreground"
          >
            {location.message}
          </p>
        </div>
        <button
          type="button"
          onClick={location.close}
          aria-label="Close location prompt"
          className="-mr-1 -mt-1 flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {location.error && (
        <p role="alert" className="mx-4 mb-2 rounded-lg bg-destructive/5 px-2.5 py-2 text-[10.5px] leading-4 text-destructive">
          {location.error}
        </p>
      )}

      <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg bg-muted/45 px-2.5 py-2 text-[9.5px] leading-4 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" />
        LifeLink requests a fresh location only when you use a location feature. It does not
        track you in the background.
      </p>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={location.dismiss}>
          Not Now
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-[11px]"
          disabled={location.requesting}
          onClick={location.enable}
        >
          {location.requesting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <LocateFixed className="size-3.5" />
          )}
          {location.requesting ? "Requesting…" : "Enable Location"}
        </Button>
      </div>
    </aside>
  );
}
