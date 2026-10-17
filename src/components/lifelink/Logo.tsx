import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function LifeLinkMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="LifeLink blood drop mark"
      className={cn("size-9", className)}
    >
      <defs>
        <linearGradient id="lifelink-drop" x1="8" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d4293f" />
          <stop offset="1" stopColor="#8d1024" />
        </linearGradient>
      </defs>
      <path
        d="M24 4.5c5.6 8.1 14.5 17.3 14.5 26.1a14.5 14.5 0 1 1-29 0C9.5 21.8 18.4 12.6 24 4.5Z"
        fill="url(#lifelink-drop)"
      />
      <path
        d="M24 35.5c-5.4 0-9.8-4.2-9.8-9.4 0-4 3-8.3 5.9-11.8.6 3.6 2.4 5.7 4.4 7.2 2.3 1.7 4.9 3.4 6.7 6.1a8.6 8.6 0 0 1 .4 2.2c0 3.3-3.4 5.7-7.6 5.7Z"
        fill="#fff"
        opacity=".18"
      />
      <path
        d="M20.4 26.2h2.6v-2.6h2.6v2.6h2.6v2.6h-2.6v2.6h-2.6v-2.6h-2.6v-2.6Z"
        fill="#fff"
      />
    </svg>
  );
}

export function LifeLinkLogo({
  className,
  compact = false,
  onDark = false,
}: {
  className?: string;
  compact?: boolean;
  onDark?: boolean;
}) {
  return (
    <Link
      to="/"
      aria-label="LifeLink home"
      className={cn(
        "group inline-flex items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 rounded-lg",
        className,
      )}
    >
      <span className="relative flex size-9 items-center justify-center">
        <LifeLinkMark className="size-9 transition-transform duration-300 group-hover:-translate-y-0.5" />
      </span>
      <span className="leading-none">
        <span
          className={cn(
            "block font-display text-[19px] font-extrabold tracking-tight",
            onDark ? "text-white" : "text-foreground",
          )}
        >
          Life<span className="text-primary">Link</span>
        </span>
        {!compact && (
          <span
            className={cn(
              "mt-1 block text-[9px] font-semibold uppercase tracking-[0.2em]",
              onDark ? "text-white/50" : "text-muted-foreground",
            )}
          >
            Blood network
          </span>
        )}
      </span>
    </Link>
  );
}
