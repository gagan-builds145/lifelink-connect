import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { LifeLinkLogo } from "./Logo";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function AuthCard({
  children,
  footer,
  className,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-3xl border border-border/80 bg-card p-6 sm:p-8",
        className,
      )}
    >
      <div className="mb-7 flex items-center justify-between gap-4">
        <LifeLinkLogo />
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Home
        </Link>
      </div>
      {children}
      {footer}
    </div>
  );
}
