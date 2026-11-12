import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Turn a Convex/client error into a short, user-safe message. Convex appends
 * request IDs, server stack frames and a "Called by client" suffix to some
 * errors; those are useful in logs but must never be rendered in the UI.
 */
export function friendlyError(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  let message = error.message.replace(/\s+/g, " ").trim();
  message = message
    .replace(/\[CONVEX[^\]]*\]\s*/g, "")
    .replace(/\[Request ID:[^\]]*\]\s*/g, "");
  const serverError = message.split(/Server Error\s*/i);
  if (serverError.length > 1) message = serverError.slice(1).join(" ");
  message = message
    .replace(/Uncaught Error:\s*/i, "")
    .replace(/\s+Called by client\.?$/i, "")
    .replace(/\s+at\s+.*$/i, "")
    .trim();
  if (!message) return fallback;
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}
