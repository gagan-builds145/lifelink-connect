import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Loader2, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export function EmailOtpForm({
  redirectTo = "/dashboard",
  onVerified,
  className,
  compact = false,
}: {
  redirectTo?: string;
  onVerified?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const { signIn, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!resendIn) return;
    const timer = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && onVerified) onVerified();
  }, [authLoading, isAuthenticated, onVerified]);

  const sendCode = async (address: string) => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("email", address);
      await signIn("email-otp", formData);
      setEmail(address);
      setStep("code");
      setResendIn(45);
      toast("Verification code requested", {
        description: `If email delivery is configured, a 6-digit code was sent to ${address}.`,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not request a code. Check the email service configuration.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (value: string) => {
    setError(null);
    if (value.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("code", value);
      await signIn("email-otp", formData);
      toast.success("Signed in securely");
      if (onVerified) onVerified();
      else navigate(redirectTo, { replace: true });
    } catch {
      setError("That code did not work. It may have expired — request a new one.");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    setGuestBusy(true);
    setError(null);
    try {
      await signIn("anonymous");
      toast.success("Demo guest session started", {
        description: "Choose a role to explore the dashboards. Demo records are labelled.",
      });
      if (onVerified) onVerified();
      else navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Guest access is unavailable right now.",
      );
    } finally {
      setGuestBusy(false);
    }
  };

  return (
    <div className={cn("space-y-5", className)}>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          {step === "email" ? "Secure sign in" : "Check your inbox"}
        </p>
        <h1 className={cn("mt-2 font-display font-extrabold text-foreground", compact ? "text-2xl" : "text-3xl")}>
          {step === "email" ? "Sign in to LifeLink" : "Enter your code"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {step === "email"
            ? "LifeLink uses passwordless email codes — there is no password to leak or recover."
            : <>We requested a 6-digit code for <strong className="text-foreground">{email}</strong>. Codes expire after 15 minutes.</>}
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === "email" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void sendCode(email.trim());
          }}
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="otp-email">Email address</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="otp-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 pl-9"
                disabled={busy}
                required
                aria-describedby="otp-email-help"
              />
            </div>
            <p id="otp-email-help" className="text-[11.5px] leading-5 text-muted-foreground">
              We only use your email for security codes and request updates. You can
              control profile sharing after registration.
            </p>
          </div>
          <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {busy ? "Requesting code…" : "Send verification code"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-center rounded-2xl border border-border bg-muted/40 px-3 py-6">
            <InputOTP
              value={code}
              onChange={(value) => {
                setCode(value);
                if (value.length === 6 && !busy) void verifyCode(value);
              }}
              maxLength={6}
              disabled={busy}
              autoFocus
              aria-label="6-digit verification code"
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }).map((_, i) => (
                  <InputOTPSlot key={i} index={i} className="size-11 text-base" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button
            type="button"
            className="h-11 w-full gap-2"
            disabled={busy || code.length !== 6}
            onClick={() => void verifyCode(code)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {busy ? "Verifying…" : "Verify and continue"}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              disabled={busy}
            >
              <ArrowLeft className="size-3.5" />
              Use a different email
            </button>
            <button
              type="button"
              className="font-semibold text-primary hover:underline disabled:opacity-50"
              disabled={busy || resendIn > 0}
              onClick={() => void sendCode(email)}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
          </div>
        </div>
      )}

      {
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-[0.18em]">
              <span className="bg-card px-3 text-muted-foreground">or explore first</span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-2"
            onClick={() => void guest()}
            disabled={guestBusy || busy}
          >
            {guestBusy ? <Loader2 className="size-4 animate-spin" /> : <UserRound className="size-4" />}
            Continue as demo guest
          </Button>
          <p className={cn("text-center text-[11.5px] leading-5 text-muted-foreground", compact && "text-[10.5px]")}>
            Guest access creates a real account. Choose a role next to finish setting
            up your workspace.
          </p>
        </>
      }
    </div>
  );
}
