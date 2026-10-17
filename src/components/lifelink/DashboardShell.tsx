import { api } from "@/convex/_generated/api";
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
import { useMutation, useQuery } from "convex/react";
import {
  Bell,
  BellRing,
  CheckCheck,
  ExternalLink,
  Leaf,
  Loader2,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { LifeLinkLogo } from "./Logo";
import { formatRelative } from "@/lib/blood";

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

function NotificationCenter() {
  const notifications = useQuery(api.notifications.listMine);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative size-9 rounded-full border-border bg-card"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold">Notifications</p>
            <p className="text-[10.5px] text-muted-foreground">
              {unread ? `${unread} unread update${unread === 1 ? "" : "s"}` : "You are up to date"}
            </p>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead({})}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </button>
          )}
        </div>
        <ScrollArea className="max-h-[420px]">
          {notifications === undefined ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading updates…
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <BellRing className="mx-auto size-6 text-muted-foreground/60" />
              <p className="mt-3 text-[13px] font-medium">No notifications yet</p>
              <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                Request updates, verified matches, stock alerts and camp news appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => (
                <button
                  key={n._id}
                  type="button"
                  onClick={() => {
                    if (!n.read) void markRead({ notificationId: n._id });
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                    !n.read && "bg-primary/[0.035]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.read ? "bg-border" : "bg-primary",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold leading-5">
                      {n.title}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-5 text-muted-foreground">
                      {n.body}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                      {n.kind}
                      <span className="size-0.5 rounded-full bg-current" />
                      {formatRelative(n.createdAt)}
                      {n.link && <ExternalLink className="size-2.5" />}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export function DashboardShell({
  roleLabel,
  roleKey,
  title,
  subtitle,
  items,
  active,
  onSelect,
  quickLinks = [],
  children,
  demoData = false,
  accentIcon: AccentIcon = ShieldCheck,
}: {
  roleLabel: string;
  roleKey: string;
  title: string;
  subtitle?: string;
  items: DashNavItem[];
  active: string;
  onSelect: (key: string) => void;
  quickLinks?: { label: string; href: string; icon?: LucideIcon }[];
  children: ReactNode;
  demoData?: boolean;
  accentIcon?: LucideIcon;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      toast("Signed out", { description: "Your session has ended securely." });
      navigate("/", { replace: true });
    } catch {
      toast.error("Could not sign out. Please try again.");
    }
  };

  const select = (key: string) => {
    onSelect(key);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-[72px] shrink-0 items-center border-b border-sidebar-border px-5">
        <LifeLinkLogo />
      </div>

      <div className="px-4 pt-5">
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

      <ScrollArea className="flex-1 px-3 py-4">
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

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
            {initials(user?.name ?? user?.email)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold">
              {user?.name ?? "LifeLink account"}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {user?.email ?? "Guest session"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
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
            <NotificationCenter />
            <span className="flex size-9 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
              {initials(user?.name ?? user?.email)}
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {subtitle && (
            <p className="mb-5 max-w-3xl text-[13px] leading-6 text-muted-foreground">
              {subtitle}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
