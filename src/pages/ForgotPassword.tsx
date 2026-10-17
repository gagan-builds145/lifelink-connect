import { AuthCard } from "@/components/lifelink/AuthCard";
import { AuthShell } from "@/components/lifelink/AuthShell";
import { EmailOtpForm } from "@/components/lifelink/EmailOtpForm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, MailCheck, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

export default function ForgotPassword() {
  return (
    <AuthShell
      variant="video"
      eyebrow="Secure account recovery"
      asideTitle="No password to reset. Your verified email is the key."
      asideBody="LifeLink uses passwordless email verification. Recovering access and signing in are the same secure flow — a 6-digit code that expires after 15 minutes, followed by server-side role checks."
    >
      <AuthCard>
        <div className="mb-5">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/8 text-primary">
            <KeyRound className="size-5" />
          </span>
          <h1 className="mt-4 font-display text-3xl font-extrabold">Recover access</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            Enter the email linked to your LifeLink account. We will request a fresh
            verification code — no password reset link or security question is needed.
          </p>
        </div>

        <EmailOtpForm redirectTo="/dashboard" />

        <div className="mt-6 space-y-3 border-t border-border pt-4">
          <div className="flex gap-2.5">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-[11.5px] leading-5 text-muted-foreground">
              <strong className="text-foreground">Didn't receive a code?</strong> Check the
              spam folder and confirm the email exists. If the deployment has no email
              provider configured, use demo guest access or contact the administrator.
            </p>
          </div>
          <div className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-600" />
            <p className="text-[11.5px] leading-5 text-muted-foreground">
              Your role and organization cannot be changed by recovery. Role changes are
              server-controlled and audit logged.
            </p>
          </div>
          <Alert className="border-border bg-muted/40">
            <AlertDescription className="text-[11px] leading-5">
              Support contact is configured with{" "}
              <code className="rounded bg-card px-1">VITE_LIFELINK_CONTACT_EMAIL</code>.
              Outbound support email is not automatically sent from this prototype.
            </AlertDescription>
          </Alert>
          <p className="text-center text-[12px]">
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Back to sign in
            </Link>
            <span className="mx-2 text-border">·</span>
            <Link to="/signup" className="font-medium text-foreground hover:text-primary">
              Create an account
            </Link>
          </p>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
