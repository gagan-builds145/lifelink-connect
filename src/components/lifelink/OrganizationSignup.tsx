import { api } from "@/convex/_generated/api";
import { SignupFrame } from "./SignupFrame";
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
import { CITIES } from "@/lib/blood";
import { useMutation } from "convex/react";
import { AlertTriangle, Building2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export function OrganizationSignup({ type }: { type: "red_cross" | "hospital" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const register = useMutation(api.profiles.registerOrganization);
  const isRedCross = type === "red_cross";
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    contactPerson: user?.name ?? "",
    phone: user?.phone ?? "",
    email: user?.email ?? "",
    address: "",
    city: user?.city ?? "Pune",
    area: "",
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const dashboard = isRedCross ? "/red-cross/dashboard" : "/hospital/dashboard";

  return (
    <SignupFrame
      eyebrow={isRedCross ? "Red Cross authorization" : "Hospital authorization"}
      title={isRedCross ? "Register an authorized branch" : "Register a verified hospital"}
      description={
        isRedCross
          ? "Branch accounts can verify requests, manage shared inventory and camps, and record dispatch against the common ledger."
          : "Hospital accounts can submit patient-linked requests, view reported partner availability and confirm receipt."
      }
      asideTitle={
        isRedCross
          ? "Administrative access is earned, not selected."
          : "Hospital access is verified before any patient request."
      }
      asideBody={
        isRedCross
          ? "Your role is attached server-side to this verified organization account. Every inventory or status change you make is recorded in the audit log."
          : "A hospital account is linked to one organization and can only see its own requests or requests assigned to it. Receipt confirmation is restricted to the receiving hospital."
      }
    >
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
            setError("Confirm you are authorized to register this organization.");
            return;
          }
          setBusy(true);
          try {
            const result = await register({
              type,
              name: form.name,
              contactPerson: form.contactPerson,
              phone: form.phone,
              email: form.email,
              address: form.address,
              city: form.city,
              area: form.area.trim() || undefined,
              consent: true,
            });
            toast.success(`${isRedCross ? "Branch" : "Hospital"} registered · ${result.orgId}`, {
              description: "The organization is verified and linked to your account. All actions are audit logged.",
            });
            navigate(dashboard, { replace: true });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Registration failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="org-name">{isRedCross ? "Branch name" : "Hospital name"}</Label>
            <Input id="org-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={isRedCross ? "e.g. Red Cross Society — Pune Branch" : "e.g. City General Hospital"} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-contact">Contact person</Label>
            <Input id="org-contact" value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} placeholder="Authorized staff member" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-phone">Official phone</Label>
            <Input id="org-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 20 2550 1000" required />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="org-email">Official email</Label>
            <Input id="org-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="office@organization.org" required />
            <p className="text-[10px] text-muted-foreground">Use a monitored organizational address, not a personal inbox.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="org-address">Address</Label>
            <Input id="org-address" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Building, street, area" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-city">City</Label>
            <Select value={form.city} onValueChange={(v) => set("city", v)}>
              <SelectTrigger id="org-city" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CITIES.map((city) => <SelectItem key={city} value={city}>{city}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-area">Area (optional)</Label>
            <Input id="org-area" value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="Locality" />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/[0.035] p-3.5">
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
          <span className="text-[11px] leading-5 text-muted-foreground">
            I confirm I am authorized to register this organization and that it participates
            in the LifeLink network. I understand that inventory and status changes are
            attributed to my account in the audit log, and that my role cannot be changed
            through a normal profile edit.
          </span>
        </label>

        <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
          {busy ? "Registering…" : `Register ${isRedCross ? "branch" : "hospital"}`}
        </Button>
        <p className="text-center text-[10px] leading-5 text-muted-foreground">
          Already registered your organization?{" "}
          <a href="/login" className="font-semibold text-primary hover:underline">Sign in instead</a>.
        </p>
      </form>
    </SignupFrame>
  );
}
