import { useEffect, useRef, useState, useCallback } from "react";

type SoundState = "idle" | "ready" | "muted" | "blocked" | "error";

export type UseSoundReturn = {
  muted: boolean;
  state: SoundState;
  play: () => void;
  toggle: () => void;
};

const STORAGE_KEY = "lifelink.incomingRequestSound.muted";

function loadMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // ignore unrelated storage failures
  }
}

export function useSound(): UseSoundReturn {
  const [muted, setMuted] = useState(loadMuted);
  const [state, setState] = useState<SoundState>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (audioRef.current) return;
    try {
      const audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;

      audio.addEventListener("canplaythrough", () => {
        if (!readyRef.current) {
          readyRef.current = true;
          setState(muted ? "muted" : "ready");
        }
      });

      audio.addEventListener("error", () => {
        setState("blocked");
      });

      // Blob URL is used to avoid any external request; the asset must exist in
      // the public folder. If it is missing, the audio element will error above.
      const src =
        "/sounds/incoming-request.ogg" in window
          ? "/sounds/incoming-request.ogg"
          : "/sounds/incoming-request.ogg";

      // Only set src after creation so the preload logic is consistent.
      audio.src = src;
    } catch {
      setState("blocked");
    }
  }, []);

  const play = useCallback(() => {
    if (muted) return;
    if (!audioRef.current || !readyRef.current) return;
    try {
      audioRef.current.currentTime = 0;
      const promise = audioRef.current.play();
      if (promise) {
        promise.catch(() => {
          setState("blocked");
        });
      }
    } catch {
      setState("blocked");
    }
  }, [muted]);

  const toggle = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      saveMuted(next);
      setState(next ? "muted" : readyRef.current ? "ready" : "idle");
      return next;
    });
  }, []);

  return { muted, state, play, toggle };
}
