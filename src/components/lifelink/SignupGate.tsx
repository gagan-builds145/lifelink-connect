import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { EmailOtpForm } from "./EmailOtpForm";
import type { ReactNode } from "react";

export function SignupGate({ children, className }: { children: ReactNode; className?: string }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking your secure session…
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={cn("space-y-5", className)}>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">
            Step 1 of 2 · Verify email
          </p>
          <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
            No password needed. Once verified, your account form opens so the
            backend can attach the profile to your verified account.
          </p>
        </div>
        <EmailOtpForm compact mode="signup" onVerified={() => undefined} />
      </div>
    );
  }

  return <>{children}</>;
}
