import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelative } from "@/lib/blood";
import { notificationKindLabel } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Bell,
  BellRing,
  CalendarHeart,
  CheckCheck,
  Droplets,
  ExternalLink,
  HeartHandshake,
  Loader2,
  PackageCheck,
  ShieldCheck,
  Siren,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

const KIND_ICONS: Record<string, LucideIcon> = {
  request: Droplets,
  match: HeartHandshake,
  inventory: PackageCheck,
  camp: CalendarHeart,
  ambulance: Siren,
  system: ShieldCheck,
};

/**
 * One place for every in-app notification. The Convex query is scoped to the
 * signed-in user, and both mutations re-check ownership server-side.
 */
export function NotificationBell() {
  const notifications = useQuery(api.notifications.listMine);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"all" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const openNotification = async (notification: NonNullable<typeof notifications>[number]) => {
    setError(null);
    setBusy(notification._id);
    try {
      if (!notification.read) {
        await markRead({ notificationId: notification._id });
      }
      setOpen(false);
      if (notification.link) navigate(notification.link);
    } catch {
      setError("Could not update that notification. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const markEverything = async () => {
    setError(null);
    setBusy("all");
    try {
      await markAllRead({});
    } catch {
      setError("Could not mark notifications as read.");
    } finally {
      setBusy(null);
    }
  };

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
            <>
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary ring-2 ring-card"
              />
              <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,390px)] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold">Notifications</p>
            <p className="text-[10.5px] text-muted-foreground" aria-live="polite">
              {unread
                ? `${unread} unread update${unread === 1 ? "" : "s"}`
                : "You are up to date"}
            </p>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markEverything()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-60"
            >
              {busy === "all" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCheck className="size-3.5" />
              )}
              Mark all read
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-[11px] text-destructive">
            {error}
          </p>
        )}

        <ScrollArea className="max-h-[min(420px,60vh)] [&_[data-slot=scroll-area-thumb]]:bg-primary/35">
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
                Blood requests, donor invitations, allocations, ambulance updates and
                account alerts will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((notification) => {
                const Icon = KIND_ICONS[notification.kind] ?? BellRing;
                return (
                  <button
                    key={notification._id}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void openNotification(notification)}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-70",
                      !notification.read && "bg-primary/[0.035]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                        notification.read
                          ? "bg-muted text-muted-foreground"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {busy === notification._id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Icon className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="block flex-1 text-[12.5px] font-semibold leading-5">
                          {notification.title}
                        </span>
                        {!notification.read && (
                          <span
                            aria-label="Unread"
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                          />
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-5 text-muted-foreground">
                        {notification.body}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70">
                        <span>{notificationKindLabel(notification.kind)}</span>
                        <span className="size-0.5 rounded-full bg-current" />
                        <span>{formatRelative(notification.createdAt)}</span>
                        {notification.link && <ExternalLink className="size-2.5" />}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
