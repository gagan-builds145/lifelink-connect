import { api } from "@/convex/_generated/api";
import { SectionHeading } from "@/components/lifelink/community/shared";
import { BloodGroupChip } from "@/components/lifelink/ui-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BLOOD_GROUPS, formatDate, formatRelative } from "@/lib/blood";
import { friendlyError } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  Clock3,
  Droplets,
  Fingerprint,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { SectionKey } from "../CommunityDashboard";

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  PENDING: "Pending",
  VERIFIED: "Verified",
  FAILED: "Failed",
  EXPIRED: "Expired",
  REVOKED: "Consent withdrawn",
  REQUIRES_REVIEW: "Requires review",
};

export function IdentitySection({
  onNavigate,
}: {
  onNavigate: (section: SectionKey) => void;
}) {
  const data = useQuery(api.aadhaar.myVerification);
  const history = useQuery(api.donors.bloodGroupHistory);
  const start = useMutation(api.aadhaar.startVerification);
  const cancel = useMutation(api.aadhaar.cancelVerification);
  const completeSandbox = useMutation(api.aadhaar.completeSandboxVerification);
  const withdraw = useMutation(api.aadhaar.withdrawConsent);
  const setBloodGroup = useMutation(api.donors.setBloodGroup);

  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-[12px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading identity status…
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <SectionHeading
          eyebrow="Identity"
          title="Activate your donor profile first"
          description="Identity verification and blood group selection are part of the donor profile."
        />
        <Button className="mt-3" onClick={() => onNavigate("donate")}>
          Add donor profile
        </Button>
      </div>
    );
  }

  const latest = data.latest;
  const status = latest?.status ?? "NOT_STARTED";
  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      toast.success(success);
    } catch (err) {
      setError(friendlyError(err, "That action could not be completed."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Trust & safety"
        title="Identity verification and blood group"
        description="Identity verification confirms who you are. It never sets or confirms your blood group, medical eligibility or fitness to donate."
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Identity verification */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Fingerprint className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold">Aadhaar identity verification</h2>
                <p className="text-[10.5px] text-muted-foreground">
                  Donor ID {data.donorId}
                </p>
              </div>
            </div>
            <Badge
              variant={status === "VERIFIED" ? "default" : status === "PENDING" ? "secondary" : "outline"}
              className="text-[9.5px] uppercase tracking-[0.08em]"
            >
              {STATUS_LABELS[status] ?? status}
            </Badge>
          </div>

          {latest?.sandbox && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-[11px] leading-5 text-amber-950">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <p>
                <span className="font-bold">Sandbox mode.</span> This deployment uses a
                sandbox provider. A sandbox result is <span className="font-bold">not</span> a
                UIDAI Aadhaar verification and must not be presented as one. Live verification
                stays disabled until an authorised provider and legal approval are in place.
              </p>
            </div>
          )}

          <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3 text-[11px] leading-5 text-muted-foreground">
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              <Lock className="size-3.5 text-primary" /> What is stored
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>Verification status, provider, consent version and timestamps.</li>
              <li>Only identity fields the authorised provider is permitted to return.</li>
              <li>Never your Aadhaar number, OTP, biometrics or document images.</li>
            </ul>
          </div>

          {status === "PENDING" && latest ? (
            <div className="mt-4 space-y-3">
              <p className="flex items-center gap-1.5 text-[11.5px]">
                <Clock3 className="size-3.5 text-amber-600" />
                Session created {formatRelative(latest.consentTimestamp)} · expires{" "}
                {formatDate(new Date(latest.expiryTimestamp).toISOString())}
              </p>
              <div className="flex flex-wrap gap-2">
                {latest.sandbox && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={busy != null}
                    onClick={() =>
                      void run(
                        "sandbox",
                        () => completeSandbox({ verificationId: latest.id }),
                        "Sandbox verification completed. This is not a UIDAI verification.",
                      )
                    }
                  >
                    {busy === "sandbox" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                    Complete sandbox verification
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={busy != null}
                  onClick={() =>
                    void run(
                      "cancel",
                      () => cancel({ verificationId: latest.id }),
                      "Verification session cancelled.",
                    )
                  }
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : status === "VERIFIED" && latest ? (
            <div className="mt-4 space-y-3">
              <dl className="space-y-2 text-[11px]">
                {[
                  ["Verified name", latest.verifiedName ?? "Not returned by provider"],
                  ["Verified address", latest.verifiedAddress ?? "Not returned by provider"],
                  ["Verified at", latest.verificationTimestamp ? formatRelative(latest.verificationTimestamp) : "—"],
                  ["Provider", latest.sandbox ? "Sandbox (not UIDAI)" : latest.provider],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="max-w-[62%] text-right font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={busy != null}
                onClick={() =>
                  void run(
                    "withdraw",
                    () => withdraw({ verificationId: latest.id }),
                    "Consent withdrawn and your identity copy erased.",
                  )
                }
              >
                <XCircle className="size-3.5" /> Withdraw consent & erase identity copy
              </Button>
            </div>
          ) : status === "REVOKED" ? (
            <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3 text-[11px] leading-5">
              <p className="font-semibold">Consent withdrawn</p>
              <p className="mt-1 text-muted-foreground">
                New verification operations are stopped. The lifecycle record is retained for
                audit; the permitted identity copy was erased.
              </p>
              <Button
                size="sm"
                className="mt-2 h-8 gap-1.5"
                disabled={busy != null}
                onClick={() => setConsent(false)}
              >
                <RefreshCw className="size-3.5" /> Review consent again
              </Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {(status === "FAILED" || status === "EXPIRED" || status === "REQUIRES_REVIEW") && (
                <p className="rounded-xl border border-border bg-muted/20 p-2.5 text-[11px] leading-5 text-muted-foreground">
                  {latest?.failureReason ?? latest?.reviewNote ?? "The previous attempt did not complete."}
                </p>
              )}
              <div className="rounded-xl border border-border bg-background p-3 text-[11px] leading-5">
                <p className="font-semibold">Consent notice</p>
                <p className="mt-1 text-muted-foreground">
                  I consent to LifeLink starting an identity-verification session with its
                  authorised provider and storing the permitted verification result. I
                  understand this is separate from blood donation consent, that my blood
                  group is not derived from Aadhaar, and that I can withdraw consent at any
                  time.
                </p>
                <label className="mt-2 flex items-start gap-2">
                  <Checkbox
                    checked={consent}
                    onCheckedChange={(checked) => setConsent(checked === true)}
                    aria-label="Consent to identity verification"
                    className="mt-0.5"
                  />
                  <span>I have read and agree to the consent notice.</span>
                </label>
              </div>
              <Button
                size="sm"
                className="h-8 gap-1.5"
                disabled={!consent || busy != null}
                onClick={() =>
                  void run(
                    "start",
                    () =>
                      start({
                        consent: true,
                        consentVersion: data.consentVersion,
                      }),
                    "Verification session created.",
                  )
                }
              >
                {busy === "start" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Fingerprint className="size-3.5" />
                )}
                Start identity verification
              </Button>
              {!consent && (
                <p className="text-[10px] text-muted-foreground">
                  The consent box is never preselected.
                </p>
              )}
            </div>
          )}

          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
            Need help or a correction? Contact support. Identity verification is optional and
            never blocks blood donation or ambulance services.
          </p>
        </section>

        {/* Blood group */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Droplets className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold">Blood group</h2>
                <p className="text-[10.5px] text-muted-foreground">Manually declared by you</p>
              </div>
            </div>
            <BloodGroupChip group={data.bloodGroup} size="sm" />
          </div>

          <div className="mt-4 rounded-xl border border-amber-300/80 bg-amber-50/70 p-3 text-[10.5px] leading-5 text-amber-950">
            <p className="font-bold">Donor-Declared Blood Group — Not Medically Verified</p>
            <p className="mt-1">
              Aadhaar verification is not blood-group verification. Final blood group is
              confirmed by the donation centre through laboratory testing before transfusion.
            </p>
          </div>

          <div className="mt-4 flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <p className="text-[11px] font-semibold">Select your blood group</p>
              <Select value={group ?? data.bloodGroup} onValueChange={setGroup}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUPS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="h-9"
              disabled={busy != null || (group ?? data.bloodGroup) === data.bloodGroup}
              onClick={() =>
                void run(
                  "group",
                  () =>
                    setBloodGroup({
                      bloodGroup: (group ?? data.bloodGroup) as (typeof BLOOD_GROUPS)[number],
                    }),
                  "Blood group updated. This remains a donor declaration.",
                )
              }
            >
              {busy === "group" && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Save
            </Button>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            Source: {data.bloodGroupSource === "medical_verified" ? "medically verified" : "donor-declared"}.
            A medically verified group can only be changed by clinical staff.
          </p>

          <div className="mt-4 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold">
              <BadgeCheck className="size-3.5 text-teal-600" /> Change history
            </p>
            {(history ?? []).length === 0 ? (
              <p className="mt-1.5 text-[10.5px] text-muted-foreground">
                No changes recorded yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {(history ?? []).slice(0, 6).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 text-[10.5px]">
                    <span>
                      {row.previousGroup ? `${row.previousGroup} → ` : ""}
                      <span className="font-semibold">{row.newGroup}</span>
                    </span>
                    <span className="text-muted-foreground">{formatRelative(row.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
