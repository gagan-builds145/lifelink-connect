import { api } from "@/convex/_generated/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { ArrowLeft, ArrowRight, Loader2, Mail, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

/**
 * Passwordless email-code form.
 *
 * `mode="signin"` authenticates an existing account and refuses to start a new
 * one; `mode="signup"` is used inside the sign-up gate to create the account a
 * profile will be attached to. There is no guest or anonymous option.
 */
export function EmailOtpForm({
  redirectTo = "/dashboard",
  onVerified,
  className,
  compact = false,
  mode = "signin",
}: {
  redirectTo?: string;
  onVerified?: () => void;
  className?: string;
  compact?: boolean;
  mode?: "signin" | "signup";
}) {
  const { signIn, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const checkLoginEmail = useMutation(api.authGate.checkLoginEmail);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!resendIn) return;
    const timer = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && onVerified) onVerified();
  }, [authLoading, isAuthenticated, onVerified]);

  const validateEmail = (address: string): string | null => {
    if (!address) return "Enter your email address.";
    if (address.length > 320) return "That email address is too long.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return "Enter a valid email address, for example name@hospital.org.";
    }
    return null;
  };

  const requestCode = async (address: string, isResend = false) => {
    setError(null);
    const invalid = validateEmail(address);
    setEmailError(invalid);
    if (invalid) return;

    setBusy(true);
    try {
      if (mode === "signin" && !isResend) {
        const check = await checkLoginEmail({ email: address });
        if (check.status === "rate_limited") {
          setError("Too many attempts. Please wait a few minutes and try again.");
          return;
        }
        if (check.status === "unknown") {
          // Clear enough to act on, without revealing names or profile data.
          setError(
            "We could not sign in with that email. Check the address, or create a new account if you have not registered yet.",
          );
          return;
        }
      }

      const formData = new FormData();
      formData.set("email", address);
      await signIn("email-otp", formData);
      setEmail(address);
      setStep("code");
      setResendIn(45);
      toast(isResend ? "New code requested" : "Verification code requested", {
        description: "If the email service is configured, a 6-digit code is on its way. It expires in 15 minutes.",
      });
    } catch (err) {
      setError(authErrorMessage(err, "send"));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (value: string) => {
    setError(null);
    if (value.length !== 6) {
      setError("Enter the 6-digit code from the email.");
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
    } catch (err) {
      // The provider deliberately uses one failure for wrong and expired codes.
      setError(authErrorMessage(err, "verify"));
      setCode("");
    } finally {
      setBusy(false);
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
        {step === "code" && (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            We requested a 6-digit code for <strong className="text-foreground">{email}</strong>. Codes expire after 15 minutes.
          </p>
        )}
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
            void requestCode(email.trim());
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
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                className="h-11 pl-9"
                disabled={busy}
                required
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "otp-email-error" : "otp-email-help"}
              />
            </div>
            {emailError ? (
              <p id="otp-email-error" role="alert" className="text-[11.5px] font-medium leading-5 text-destructive">
                {emailError}
              </p>
            ) : (
              <p id="otp-email-help" className="text-[11.5px] leading-5 text-muted-foreground">
                Only registered accounts can sign in. Your email is used for security
                codes and request updates.
              </p>
            )}
          </div>
          <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {busy ? "Checking your account…" : "Send sign-in code"}
          </Button>
          {mode === "signin" ? (
            <p className="text-center text-[12px] text-muted-foreground">
              New to LifeLink?{" "}
              <Link to="/signup" className="font-semibold text-primary hover:underline">
                Create an account
              </Link>
            </p>
          ) : (
            <p className="text-center text-[12px] text-muted-foreground">
              Already registered?{" "}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Sign in instead
              </Link>
            </p>
          )}
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
              onClick={() => void requestCode(email, true)}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
          </div>
          <p className="text-center text-[11.5px] leading-5 text-muted-foreground">
            The code is valid for 15 minutes and works once.{" "}
            <Link to="/forgot-password" className="font-semibold text-primary hover:underline">
              Recover access
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Maps provider and transport failures to stable, user-facing messages. Raw
 * provider text, request ids, function names and stack traces never reach the
 * browser.
 */
function authErrorMessage(error: unknown, phase: "send" | "verify"): string {
  const raw = error instanceof Error ? error.message.toLowerCase() : "";
  if (raw.includes("too many") || raw.includes("rate")) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (raw.includes("could not verify code") || raw.includes("invalid") || raw.includes("expired")) {
    return "That code is incorrect or has expired. Request a new code and try again.";
  }
  if (raw.includes("network") || raw.includes("fetch")) {
    return "We could not reach the sign-in service. Check your connection and try again.";
  }
  return phase === "send"
    ? "We could not send a sign-in code right now. Please try again shortly."
    : "We could not verify that code. Request a new code and try again.";
}
