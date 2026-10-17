import { AuthCard } from "@/components/lifelink/AuthCard";
import { AuthShell } from "@/components/lifelink/AuthShell";
import { EmailOtpForm } from "@/components/lifelink/EmailOtpForm";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Suspense, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth ?? "/dashboard",
  );

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate(redirect, { replace: true });
  }, [isLoading, isAuthenticated, navigate, redirect]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AuthShell variant="light">
      <AuthCard>
        <EmailOtpForm redirectTo={redirect} />
        <div className="mt-6 grid gap-2 border-t border-border pt-4 text-center text-[12px] text-muted-foreground">
          <p>
            New to LifeLink?{" "}
            <Link to="/signup" className="font-semibold text-primary hover:underline">
              Create an account
            </Link>
          </p>
          <p>
            Trouble accessing your account?{" "}
            <Link to="/forgot-password" className="font-medium text-foreground hover:text-primary">
              Recover access
            </Link>
          </p>
          <p className="text-[10.5px] leading-5">
            Passwordless by design. Access is verified with a short-lived email code,
            and all protected actions still require a server-verified role.
          </p>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
