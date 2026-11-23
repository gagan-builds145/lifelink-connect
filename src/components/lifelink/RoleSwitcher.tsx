import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { dashboardPathForRole, ROLE_LABELS, type AppRole } from "@/lib/roles";
import { friendlyError } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

/**
 * Switches the active workspace without signing out. Only roles already
 * granted server-side are listed; the backend rejects anything else.
 */
export function RoleSwitcher({ className }: { className?: string }) {
  const status = useQuery(api.profiles.myRoles);
  const switchRole = useMutation(api.profiles.switchRole);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  if (!status || status.roles.length < 2) return null;

  const choose = async (role: AppRole) => {
    setBusy(role);
    try {
      await switchRole({ role: role as Parameters<typeof switchRole>[0]["role"] });
      toast.success(`Switched to ${ROLE_LABELS[role]}`);
      navigate(dashboardPathForRole(role));
    } catch (error) {
      toast.error(friendlyError(error, "Could not switch workspace."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={className}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold">
        <ArrowLeftRight className="size-3.5 text-primary" /> Workspaces on this account
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {status.roles.map((role) => {
          const appRole = role as AppRole;
          const active = appRole === status.active;
          return (
            <Button
              key={role}
              size="sm"
              variant={active ? "default" : "outline"}
              className="h-7 gap-1.5 text-[10.5px]"
              disabled={active || busy != null}
              onClick={() => void choose(appRole)}
            >
              {busy === role && <Loader2 className="size-3 animate-spin" />}
              {ROLE_LABELS[appRole] ?? role}
            </Button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
        Guardian approval never grants donor permissions, and donor access never
        approves a Guardian application.
      </p>
    </div>
  );
}
