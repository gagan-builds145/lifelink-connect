import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { dashboardPathForRole, hasDashboardRole, ROLE_LABELS, type AppRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { LifeLinkLogo } from "./Logo";

const NAV = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Blood search", href: "/blood-search" },
  { label: "Donation camps", href: "/donation-camps" },
  { label: "About", href: "/#about" },
  { label: "Contact", href: "/#contact" },
];

export function SiteHeader() {
  const { isAuthenticated, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const role = (user?.role ?? undefined) as AppRole | undefined;
  // A signed-in session without a finished role still has no dashboard, so it
  // must keep the signed-out actions instead of a Dashboard button that loops
  // back to the role picker.
  const signedInWithWorkspace = isAuthenticated && hasDashboardRole(role);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b transition-colors duration-300",
        scrolled
          ? "border-border/80 bg-background/92 backdrop-blur-xl"
          : "border-transparent bg-background/70 backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-[72px] w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <LifeLinkLogo />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="rounded-full px-3.5 py-2 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 sm:flex">
          {signedInWithWorkspace ? (
            <>
              <div className="mr-1 hidden flex-col items-end leading-tight md:flex">
                <span className="max-w-[150px] truncate text-[12px] font-semibold">
                  {user?.name ?? user?.email ?? "Signed in"}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {role ? ROLE_LABELS[role] : "Account"}
                </span>
              </div>
              <Button asChild size="sm" className="gap-1.5">
                <Link to={dashboardPathForRole(role)}>
                  Dashboard
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="text-[13px]">
                <Link to="/login">Log in</Link>
              </Button>
              <Button asChild size="sm" className="gap-1.5 text-[13px]">
                <Link to="/signup">
                  Create account
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </>
          )}
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground lg:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-background px-4 pb-5 pt-3 shadow-none lg:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            {NAV.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 grid gap-2 border-t border-border pt-4">
            {signedInWithWorkspace ? (
              <Button asChild className="w-full">
                <Link to={dashboardPathForRole(role)}>Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild className="w-full">
                  <Link to="/signup">Create account</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
