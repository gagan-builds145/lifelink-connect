import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { dashboardPathForRole, ROLE_LABELS, type AppRole } from "@/lib/roles";
import { Loader2, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export function RequireRole({
  roles,
  children,
}: {
  roles: AppRole[];
  children: ReactNode;
}) {
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const role = (user?.role ?? "user") as AppRole;
  if (!roles.includes(role)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-bold">Role required</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This area is for {roles.map((r) => ROLE_LABELS[r]).join(" or ")} accounts.
            {role === "user"
              ? " Finish choosing a role to continue."
              : ` You are signed in as ${ROLE_LABELS[role]}.`}{" "}
            The backend enforces the same rule on every action.
          </p>
          <div className="mt-6 grid gap-2">
            <Button asChild>
              <Link to={role === "user" ? "/signup" : dashboardPathForRole(role)}>
                {role === "user" ? "Choose a role" : "Go to my dashboard"}
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/">Back to home</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
