import { LifeLinkMark } from "./Logo";
import { cn } from "@/lib/utils";
import { HeartPulse, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

const VIDEO_SRC =
  (import.meta.env.VITE_AUTH_BG_VIDEO_URL as string | undefined) ||
  "/media/auth-bg.mp4";

export function AuthShell({
  children,
  variant = "video",
  eyebrow,
  asideTitle,
  asideBody,
}: {
  children: ReactNode;
  variant?: "video" | "light";
  eyebrow?: string;
  asideTitle?: string;
  asideBody?: string;
}) {
  const [videoFailed, setVideoFailed] = useState(false);
  const showVideo = variant === "video" && !videoFailed;

  return (
    <div
      className={cn(
        "relative min-h-screen overflow-hidden",
        variant === "video" ? "bg-[oklch(0.17_0.03_258)]" : "bg-background",
      )}
    >
      {/* Fallback background: always visible, video is an enhancement. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0",
          variant === "video"
            ? "bg-[radial-gradient(circle_at_15%_20%,oklch(0.42_0.15_20/0.55),transparent_45%),radial-gradient(circle_at_85%_75%,oklch(0.38_0.09_245/0.6),transparent_50%),linear-gradient(140deg,oklch(0.16_0.03_258),oklch(0.22_0.05_18))]"
            : "bg-[radial-gradient(circle_at_15%_20%,oklch(0.94_0.03_22),transparent_42%),radial-gradient(circle_at_90%_10%,oklch(0.94_0.025_190),transparent_38%),linear-gradient(160deg,oklch(0.99_0.004_95),oklch(0.972_0.008_250))]",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 bg-grid",
          variant === "video" ? "opacity-[0.14]" : "opacity-70",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -left-24 top-1/3 size-[420px] rounded-full border",
          variant === "video" ? "border-white/10" : "border-primary/10",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -left-10 top-[38%] size-[260px] rounded-full border animate-heartbeat",
          variant === "video" ? "border-white/10" : "border-primary/15",
        )}
      />

      {showVideo && (
        <video
          className="absolute inset-0 size-full object-cover opacity-55"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
          onError={() => setVideoFailed(true)}
        >
          <source src={VIDEO_SRC} type="video/mp4" />
        </video>
      )}
      {variant === "video" && (
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-[oklch(0.14_0.03_258/0.94)] via-[oklch(0.16_0.03_258/0.82)] to-[oklch(0.24_0.06_20/0.86)]"
        />
      )}

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-12">
        <div
          className={cn(
            "order-2 hidden flex-col justify-between self-stretch rounded-3xl border p-8 lg:flex",
            variant === "video"
              ? "border-white/12 bg-white/[0.04] text-white backdrop-blur-md"
              : "border-border bg-white/70 text-foreground backdrop-blur-md",
          )}
        >
          <div>
            <Link to="/" className="inline-flex items-center gap-3">
              <LifeLinkMark className="size-11" />
              <span>
                <span className="block font-display text-2xl font-extrabold tracking-tight">
                  Life<span className="text-primary">Link</span>
                </span>
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-[0.22em]",
                    variant === "video" ? "text-white/50" : "text-muted-foreground",
                  )}
                >
                  Smart blood network
                </span>
              </span>
            </Link>

            <p
              className={cn(
                "mt-12 text-[11px] font-bold uppercase tracking-[0.22em]",
                variant === "video" ? "text-white/45" : "text-primary",
              )}
            >
              {eyebrow ?? "Every second matters"}
            </p>
            <h2 className="mt-4 max-w-md text-balance text-4xl font-bold leading-[1.08]">
              {asideTitle ?? "The right blood. The nearest verified source. One shared record."}
            </h2>
            <p
              className={cn(
                "mt-5 max-w-md text-[15px] leading-7",
                variant === "video" ? "text-white/65" : "text-muted-foreground",
              )}
            >
              {asideBody ??
                "LifeLink connects donors, requestors, Red Cross branches and hospitals to a single verified workflow — from request and document review to stock reservation, dispatch and receipt."}
            </p>
          </div>

          <div className="mt-12 grid gap-3">
            {[
              {
                icon: ShieldCheck,
                title: "Server-enforced roles",
                body: "Every protected action checks your role and organization on the backend.",
              },
              {
                icon: HeartPulse,
                title: "Traceable stock",
                body: "Reservations, dispatches and receipts update one ledger, never a copy.",
              },
              {
                icon: Sparkles,
                title: "Explainable matching",
                body: "Transparent, rules-based ranking with a clear medical-safety disclaimer.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className={cn(
                  "flex gap-3 rounded-2xl border p-3.5",
                  variant === "video"
                    ? "border-white/10 bg-white/[0.03]"
                    : "border-border bg-background/70",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl",
                    variant === "video" ? "bg-white/10 text-white" : "bg-primary/10 text-primary",
                  )}
                >
                  <item.icon className="size-4" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold">{item.title}</p>
                  <p
                    className={cn(
                      "mt-0.5 text-[12px] leading-5",
                      variant === "video" ? "text-white/50" : "text-muted-foreground",
                    )}
                  >
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <p
            className={cn(
              "mt-8 text-[11px] leading-5",
              variant === "video" ? "text-white/35" : "text-muted-foreground",
            )}
          >
            LifeLink is advisory. Clinical eligibility, compatibility, screening
            and final blood issue remain with qualified medical staff.
          </p>
        </div>

        <div className="order-1 flex w-full items-center justify-center lg:order-2">
          <div className="w-full max-w-[480px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
