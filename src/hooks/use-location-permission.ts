import {
  LOCATION_CONSENT_MESSAGE,
  readLocationChoice,
  writeLocationChoice,
  type LocationChoice,
} from "@/lib/location";
import { useCallback, useEffect, useState } from "react";

type BrowserPermission = "unknown" | "granted" | "denied" | "prompt";

/**
 * LifeLink-level consent, separate from the browser permission.
 *
 * No geolocation API is called until `enable()` runs from an explicit user
 * action. Only the consent state is persisted; precise coordinates are never
 * written to storage and no background watch is started.
 */
export function useLocationPermission(userId: string | null | undefined) {
  const [choice, setChoice] = useState<LocationChoice>(() =>
    typeof window === "undefined"
      ? "unset"
      : readLocationChoice(window.localStorage, userId),
  );
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserPermission, setBrowserPermission] =
    useState<BrowserPermission>("unknown");

  useEffect(() => {
    if (!userId || choice !== "unset") return;
    // StrictMode may run this effect twice; its cleanup clears the first
    // timer, while the second still shows the prompt exactly once.
    const timer = window.setTimeout(() => setOpen(true), 650);
    return () => window.clearTimeout(timer);
  }, [choice, userId]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let mounted = true;
    let permission: PermissionStatus | null = null;
    const sync = () => {
      if (mounted && permission) setBrowserPermission(permission.state);
    };
    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (!mounted) return;
        permission = status;
        setBrowserPermission(status.state);
        status.addEventListener?.("change", sync);
      })
      .catch(() => {
        // Safari and some embedded browsers do not expose geolocation here.
      });
    return () => {
      mounted = false;
      permission?.removeEventListener?.("change", sync);
    };
  }, []);

  const persist = useCallback(
    (next: Exclude<LocationChoice, "unset">) => {
      setChoice(next);
      if (typeof window !== "undefined") {
        writeLocationChoice(window.localStorage, userId, next);
      }
    },
    [userId],
  );

  const dismiss = useCallback(() => {
    persist("not_now");
    setOpen(false);
    setError(null);
  }, [persist]);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const enable = useCallback(() => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      persist("unavailable");
      setError("Location is not available in this browser.");
      return;
    }
    setRequesting(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        // Deliberately ignore coordinates here. The consent screen does not
        // need them; each location-dependent feature requests a fresh fix.
        persist("enabled");
        setRequesting(false);
        setOpen(false);
      },
      (positionError) => {
        setRequesting(false);
        if (positionError.code === positionError.PERMISSION_DENIED) {
          persist("denied");
          setError(
            "Location is blocked in your browser. Allow it in site settings, then try again.",
          );
          return;
        }
        if (positionError.code === positionError.POSITION_UNAVAILABLE) {
          setError(
            "Your device could not find a location. Check that location services are on and try again.",
          );
          return;
        }
        setError("The location request timed out. Move to an open area and try again.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, [persist]);

  return {
    message: LOCATION_CONSENT_MESSAGE,
    choice,
    open,
    setOpen,
    openPrompt: () => setOpen(true),
    dismiss,
    close,
    enable,
    requesting,
    error,
    browserPermission,
  };
}

export type LocationPermissionState = ReturnType<typeof useLocationPermission>;
