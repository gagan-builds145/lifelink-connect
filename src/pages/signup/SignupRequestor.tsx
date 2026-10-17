import { api } from "@/convex/_generated/api";
import { SignupFrame } from "@/components/lifelink/SignupFrame";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { CITIES, REQUESTOR_TYPES, REQUESTOR_TYPE_LABELS, type RequestorType } from "@/lib/blood";
import { useMutation } from "convex/react";
import { AlertTriangle, Droplets, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export default function SignupRequestor() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const register = useMutation(api.profiles.registerRequestor);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: user?.name ?? "",
    phone: user?.phone ?? "",
    requestorType: "family" as RequestorType,
    city: user?.city ?? "Pune",
  });

  return (
    <SignupFrame
      eyebrow="Requestor registration"
      title="Create a requestor account"
      description="For patients, family members and authorized representatives. Your account can submit and track requests without exposing patient details publicly."
      asideTitle="A clear request is faster to verify."
      asideBody="Add the hospital, blood group, component, units and urgency. Upload a prescription if you have one. Authorized Red Cross staff review the declaration before any stock is committed."
    >
      <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-[11px] leading-5 text-teal-900">
        <span className="flex items-center gap-1.5 font-bold">
          <ShieldCheck className="size-3.5" />
          Email verified · passwordless
        </span>
        <p className="mt-1 text-teal-800/80">
          {user?.email ? `${user.email} is verified. ` : "Your secure guest session is active. "}
          Request tracking and notifications are tied to this account.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form
        className="space-y-4"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          if (!consent) {
            setError("Confirm the declaration to continue.");
            return;
          }
          if (!/^\+?\d{10,15}$/.test(form.phone.replace(/[\s()-]/g, ""))) {
            setError("Enter a valid phone number (10–15 digits).");
            return;
          }
          setBusy(true);
          try {
            const result = await register({
              fullName: form.fullName,
              phone: form.phone,
              requestorType: form.requestorType,
              city: form.city,
              consent: true,
            });
            toast.success(`Requestor profile created · ${result.requestorId}`, {
              description: "You can now submit a request and track its verification timeline.",
            });
            navigate("/requestor/dashboard", { replace: true });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Registration failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="requestor-name">Full name</Label>
            <Input id="requestor-name" value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} placeholder="Your full name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="requestor-phone">Phone</Label>
            <Input id="requestor-phone" type="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+91 98765 43210" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="requestor-type">You are the</Label>
            <Select value={form.requestorType} onValueChange={(v) => setForm((p) => ({ ...p, requestorType: v as RequestorType }))}>
              <SelectTrigger id="requestor-type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REQUESTOR_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>{REQUESTOR_TYPE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="requestor-city">City</Label>
            <Select value={form.city} onValueChange={(v) => setForm((p) => ({ ...p, city: v }))}>
              <SelectTrigger id="requestor-city" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CITIES.map((city) => <SelectItem key={city} value={city}>{city}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">This helps route your request to nearby verified sources.</p>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/[0.035] p-3.5">
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
          <span className="text-[11px] leading-5 text-muted-foreground">
            I confirm I am submitting on behalf of the patient or as an authorized
            representative. I understand LifeLink verifies requests, never guarantees
            availability, and that clinical decisions remain with qualified medical staff.
            I will only share the minimum patient information necessary.
          </span>
        </label>

        <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Droplets className="size-4" />}
          {busy ? "Creating your account…" : "Create requestor account"}
        </Button>
        <p className="text-center text-[10px] leading-5 text-muted-foreground">
          Next: submit a request with hospital details, blood group, component and urgency.
        </p>
      </form>
    </SignupFrame>
  );
}
