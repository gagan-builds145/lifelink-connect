import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  ExternalLink,
  Leaf,
  LocateFixed,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { LifeLinkLogo } from "./Logo";
import { LogoutDialog, useLogoutConfirmation } from "./LogoutConfirmation";
import { NotificationBell } from "./NotificationBell";
import { LocationPermissionPrompt } from "./LocationPermissionPrompt";
import { useLocationPermission } from "@/hooks/use-location-permission";

export type DashNavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

function initials(name?: string | null) {
  if (!name) return "LL";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function DashboardShell({
  roleLabel,
  roleKey,
  title,
  items,
  active,
  onSelect,
  onProfile,
  profileLabel = "Profile & privacy",
  quickLinks = [],
  children,
  demoData = false,
  accentIcon: AccentIcon = ShieldCheck,
}: {
  roleLabel: string;
  roleKey: string;
  title: string;
  items: DashNavItem[];
  active: string;
  onSelect: (key: string) => void;
  /** Opens the role's profile & privacy screen from the header account menu. */
  onProfile?: () => void;
  /** Label for the profile entry in the header account menu. */
  profileLabel?: string;
  quickLinks?: { label: string; href: string; icon?: LucideIcon }[];
  children: ReactNode;
  demoData?: boolean;
  accentIcon?: LucideIcon;
}) {
  const { user } = useAuth();
  const logout = useLogoutConfirmation();
  const location = useLocationPermission(user?._id);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const select = (key: string) => {
    onSelect(key);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[72px] shrink-0 items-center border-b border-sidebar-border px-5">
        <LifeLinkLogo />
      </div>

      <div className="shrink-0 px-4 pt-5">
        <div className="flex items-center gap-2.5 rounded-2xl border border-primary/15 bg-primary/[0.055] p-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <AccentIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-bold">{roleLabel}</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {roleKey}
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 py-4 [&_[data-slot=scroll-area-thumb]]:bg-primary/35 [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
        <p className="px-2 pb-2 text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
          Workspace
        </p>
        <nav className="space-y-0.5" aria-label={`${roleLabel} workspace`}>
          {items.map((item) => {
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => select(item.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
              >
                <item.icon className={cn("size-4", isActive ? "opacity-100" : "opacity-70")} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[9.5px] font-bold leading-4",
                      isActive ? "bg-white/20 text-white" : "bg-primary/10 text-primary",
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {quickLinks.length > 0 && (
          <>
            <p className="px-2 pb-2 pt-5 text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
              Public network
            </p>
            <div className="space-y-0.5">
              {quickLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  {link.icon ? <link.icon className="size-4 opacity-70" /> : <Leaf className="size-4 opacity-70" />}
                  <span className="flex-1 truncate">{link.label}</span>
                  <ExternalLink className="size-3 opacity-40" />
                </Link>
              ))}
            </div>
          </>
        )}
      </ScrollArea>

      <div className="shrink-0 border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
            {initials(user?.name ?? user?.email)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold">
              {user?.name ?? "LifeLink account"}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {user?.email ?? "Verified account"}
            </p>
          </div>
          <button
            type="button"
            onClick={logout.requestLogout}
            aria-label="Sign out"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-primary"
          >
            <LogOut className="size-4" />
          </button>
        </div>
        <p className="mt-2 flex items-center gap-1 px-1 text-[9.5px] text-muted-foreground/70">
          <ShieldCheck className="size-3 text-primary" />
          Shared database · server-verified role
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/25">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[268px] border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block">
        {sidebar}
      </aside>

      <div className="lg:pl-[268px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9 rounded-full lg:hidden"
                  aria-label="Open dashboard menu"
                >
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[286px] p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Dashboard menu</SheetTitle>
                </SheetHeader>
                {sidebar}
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                {roleLabel}
              </p>
              <h1 className="truncate font-display text-[15px] font-bold sm:text-base">
                {title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {demoData && (
              <span className="hidden items-center gap-1 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-amber-700 sm:inline-flex">
                <Sparkles className="size-3" />
                Demo data present
              </span>
            )}
            <NotificationBell />

            {/* Account menu — profile & privacy lives here, next to notifications */}
            <Popover open={accountOpen} onOpenChange={setAccountOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="flex size-9 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2"
                >
                  {initials(user?.name ?? user?.email)}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(92vw,264px)] p-0">
                <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
                    {initials(user?.name ?? user?.email)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold">
                      {user?.name ?? "LifeLink account"}
                    </p>
                    <p className="truncate text-[10.5px] text-muted-foreground">
                      {user?.email ?? roleKey}
                    </p>
                  </div>
                </div>
                {onProfile && (
                  <div className="p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountOpen(false);
                        onProfile();
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors hover:bg-muted"
                    >
                      <Settings2 className="size-4 opacity-70" />
                      {profileLabel}
                    </button>
                  </div>
                )}
                <div className={cn("p-1.5", onProfile && "border-t border-border")}>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      location.openPrompt();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors hover:bg-muted"
                  >
                    <LocateFixed className="size-4 opacity-70" />
                    <span className="flex-1">Location services</span>
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {location.choice === "enabled"
                        ? "On"
                        : location.choice === "denied"
                          ? "Blocked"
                          : "Off"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      logout.requestLogout();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <LogOut className="size-4 opacity-70" />
                    Sign out
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      <LogoutDialog
        open={logout.open}
        onOpenChange={logout.onOpenChange}
        pending={logout.pending}
        onConfirm={() => void logout.confirmLogout()}
      />
      <LocationPermissionPrompt location={location} />
    </div>
  );
}
