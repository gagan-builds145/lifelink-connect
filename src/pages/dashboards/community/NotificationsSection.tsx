import { api } from "@/convex/_generated/api";
import { SectionHeading, SkeletonPanel } from "@/components/lifelink/community/shared";
import { EmptyState } from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/blood";
import { useMutation, useQuery } from "convex/react";
import {
  BellRing,
  CheckCheck,
  Circle,
  ExternalLink,
  Inbox,
  Loader2,
  MailOpen,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { SectionKey } from "../CommunityDashboard";

const KIND_LABELS: Record<string, string> = {
  request: "Requests",
  match: "Invitations & matches",
  inventory: "Allocation & stock",
  camp: "Camps",
  system: "Account alerts",
};

export function NotificationsSection({ onNavigate }: { onNavigate: (section: SectionKey) => void }) {
  const notifications = useQuery(api.notifications.listMine);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const navigate = useNavigate();
  const [view, setView] = useState<"all" | "unread">("all");
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  const rows = (notifications ?? []).filter((notification) => {
    if (view === "unread" && notification.read) return false;
    if (kind !== "all" && notification.kind !== kind) return false;
    return true;
  });

  const openNotification = async (notification: NonNullable<typeof notifications>[number]) => {
    setBusy(notification._id);
    try {
      if (!notification.read) await markRead({ notificationId: notification._id });
      if (notification.link) navigate(notification.link);
    } catch {
      toast.error("Could not open this notification");
    } finally {
      setBusy(null);
    }
  };

  const handleMarkAll = async () => {
    setBusy("all");
    try {
      const result = await markAllRead({});
      toast.success(
        result.updated > 0
          ? `${result.updated} notification(s) marked as read`
          : "Everything is already read",
      );
    } catch {
      toast.error("Could not mark notifications as read");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Notifications"
        title="Unified notification centre"
        description="Donor invitations, request stages, allocations, transfers, fulfilment and account alerts share one inbox."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy === "all" || unread === 0}
            onClick={() => void handleMarkAll()}
          >
            {busy === "all" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
            Mark all read
          </Button>
        }
      />

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Unread</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-primary">{unread}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Loaded</p>
          <p className="mt-1 font-display text-2xl font-extrabold">{notifications?.length ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Delivery</p>
          <p className="mt-1.5 text-[11px] font-semibold">Idempotent per event</p>
          <p className="text-[10px] text-muted-foreground">
            Retried invitation and request events do not create duplicates.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          {[
            { key: "all" as const, label: "All", icon: Inbox },
            { key: "unread" as const, label: "Unread", icon: MailOpen },
          ].map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setView(entry.key)}
              aria-pressed={view === entry.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                view === entry.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <entry.icon className="size-3.5" />
              {entry.label}
            </button>
          ))}
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-9 w-full text-[11.5px] sm:w-52" aria-label="Filter notifications">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {notifications === undefined ? (
        <SkeletonPanel className="h-80" />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="No notifications yet"
          description="Invitations, request status changes, allocations, dispatches and receipts arrive here as they happen."
          action={
            <Button size="sm" variant="outline" onClick={() => onNavigate("overview")}>
              Back to overview
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title={view === "unread" ? "You are all caught up" : "No notifications in this category"}
          description={
            view === "unread"
              ? "Every loaded notification has been read."
              : "Choose a different category to see other updates."
          }
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setView("all");
                setKind("all");
              }}
            >
              Show everything
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {rows.map((notification) => (
              <li key={notification._id}>
                <button
                  type="button"
                  onClick={() => void openNotification(notification)}
                  disabled={busy === notification._id}
                  className={cn(
                    "flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/40",
                    !notification.read && "bg-primary/[0.03]",
                  )}
                >
                  <span className="mt-1.5 shrink-0">
                    {notification.read ? (
                      <Circle className="size-3 text-border" />
                    ) : (
                      <span className="block size-2 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-semibold leading-5">{notification.title}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        {KIND_LABELS[notification.kind] ?? notification.kind}
                      </span>
                      {!notification.read && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                          New
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-5 text-muted-foreground">
                      {notification.body}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {formatDateTime(notification.createdAt)}
                      <span className="size-0.5 rounded-full bg-current" />
                      {formatRelative(notification.createdAt)}
                      {notification.link && <ExternalLink className="size-2.5" />}
                    </span>
                  </span>
                  {busy === notification._id && (
                    <Loader2 className="mt-1 size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
