import { useAuth } from "@/hooks/use-auth";
import { dashboardPathForRole } from "@/lib/roles";
import { Loader2 } from "lucide-react";
import { Navigate } from "react-router";

export default function DashboardRedirect() {
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Opening your workspace…
        </div>
      </div>
    );
  }

  if (!user?.role || user.role === "user" || user.role === "member") {
    return <Navigate to="/signup" replace />;
  }

  return <Navigate to={dashboardPathForRole(user.role)} replace />;
}
