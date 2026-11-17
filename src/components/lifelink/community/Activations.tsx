import { api } from "@/convex/_generated/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  BLOOD_GROUPS,
  CITIES,
  REQUESTOR_TYPES,
  REQUESTOR_TYPE_LABELS,
  type RequestorType,
} from "@/lib/blood";
import { friendlyError } from "@/lib/utils";
import { useMutation } from "convex/react";
import { Droplets, HeartHandshake, Loader2, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * In-dashboard profile activation.
 *
 * Both flows attach a profile to the already-authenticated community account —
 * no second login, no duplicate user row. The full sign-up pages remain
 * available for people who want every optional field.
 */

const ACTIVATION_NOTE =
  "This adds a profile to your verified community account. The same login keeps working.";

export function ActivateDonorPanel({ variant = "card" }: { variant?: "card" | "bare" }) {
  const { user } = useAuth();
  const register = useMutation(api.profiles.registerDonor);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [form, setForm] = useState({
    fullName: user?.name ?? "",
    dateOfBirth: "",
    bloodGroup: "O+",
    gender: "",
    phone: user?.phone ?? "",
    address: "",
    city: user?.city ?? "Pune",
    area: "",
    preferredCenter: "",
    shareContact: true,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!consent) {
      setError("Confirm the donor declaration to continue.");
      return;
    }
    if (!form.dateOfBirth) {
      setError("Enter your date of birth.");
      return;
    }
    if (!/^\+?\d{10,15}$/.test(form.phone.replace(/[\s()-]/g, ""))) {
      setError("Enter a valid phone number (10–15 digits).");
      return;
    }
    if (form.address.trim().length < 5) {
      setError("Enter your address or locality (at least 5 characters).");
      return;
    }
    setBusy(true);
    try {
      const result = await register({
        fullName: form.fullName,
        bloodGroup: form.bloodGroup as (typeof BLOOD_GROUPS)[number],
        dateOfBirth: form.dateOfBirth,
        gender: form.gender || undefined,
        phone: form.phone,
        address: form.address,
        city: form.city,
        area: form.area.trim() || undefined,
        preferredCenter: form.preferredCenter.trim() || undefined,
        available: true,
        shareContact: form.shareContact,
        consent: true,
      });
      toast.success(`Donor profile active · ${result.donorId}`, {
        description: "Donate Blood is now part of this same dashboard.",
      });
      setOpen(false);
    } catch (err) {
      setError(friendlyError(err, "Could not activate donor access."));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <HeartHandshake className="size-5" />
        </span>
        <div>
          <h2 className="font-display text-base font-bold text-foreground">
            Activate donor functionality
          </h2>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">
            Add your blood group, availability and consent so verified requests can reach
            you. {ACTIVATION_NOTE}
          </p>
        </div>
      </div>
      <Button className="w-fit shrink-0 gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add donor profile
      </Button>
    </div>
  );

  return (
    <>
      {variant === "card" ? (
        <section className="rounded-2xl border border-border bg-card p-5">{body}</section>
      ) : (
        body
      )}

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Activate donor functionality</DialogTitle>
            <DialogDescription>
              A server-generated donor ID is created. Blood group and date of birth are
              identity-critical and require staff verification to change later.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="activate-donor-name">Full name</Label>
                <Input
                  id="activate-donor-name"
                  value={form.fullName}
                  onChange={(event) => set("fullName", event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Blood group</Label>
                <Select
                  value={form.bloodGroup}
                  onValueChange={(value) => set("bloodGroup", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOOD_GROUPS.map((group) => (
                      <SelectItem key={group} value={group}>
                        {group}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="activate-donor-dob">Date of birth</Label>
                <Input
                  id="activate-donor-dob"
                  type="date"
                  value={form.dateOfBirth}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => set("dateOfBirth", event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="activate-donor-phone">Phone</Label>
                <Input
                  id="activate-donor-phone"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(event) => set("phone", event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Select value={form.city} onValueChange={(value) => set("city", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CITIES.map((city) => (
                      <SelectItem key={city} value={city}>
                        {city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="activate-donor-address">Address / locality</Label>
                <Input
                  id="activate-donor-address"
                  value={form.address}
                  onChange={(event) => set("address", event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="activate-donor-area">Area (optional)</Label>
                <Input
                  id="activate-donor-area"
                  value={form.area}
                  onChange={(event) => set("area", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="activate-donor-center">Preferred centre (optional)</Label>
                <Input
                  id="activate-donor-center"
                  value={form.preferredCenter}
                  onChange={(event) => set("preferredCenter", event.target.value)}
                />
              </div>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/25 p-3">
              <div>
                <p className="text-[12px] font-semibold">Share phone with coordinators</p>
                <p className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">
                  Only authorized Red Cross staff can see it. Hospitals and requestors cannot.
                </p>
              </div>
              <Checkbox
                checked={form.shareContact}
                onCheckedChange={(checked) => set("shareContact", checked === true)}
                aria-label="Share phone with authorized coordinators"
              />
            </div>
            <label className="flex items-start gap-2.5 rounded-xl border border-border bg-background p-3 text-[11px] leading-5 text-muted-foreground">
              <Checkbox
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
                aria-label="Confirm donor declaration"
                className="mt-0.5"
              />
              <span>
                I confirm these details are mine and consent to being matched with verified
                requests. I understand eligibility is confirmed at the donation centre.
              </span>
            </label>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="gap-2">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <HeartHandshake className="size-4" />}
                Activate donor access
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ActivateRequestorPanel({ variant = "card" }: { variant?: "card" | "bare" }) {
  const { user } = useAuth();
  const register = useMutation(api.profiles.registerRequestor);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [form, setForm] = useState({
    fullName: user?.name ?? "",
    phone: user?.phone ?? "",
    requestorType: "family" as RequestorType,
    city: user?.city ?? "Pune",
  });

  const submit = async (event: React.FormEvent) => {
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
      toast.success(`Requestor access active · ${result.requestorId}`, {
        description: "Request Blood is now part of this same dashboard.",
      });
      setOpen(false);
    } catch (err) {
      setError(friendlyError(err, "Could not activate requestor access."));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Droplets className="size-5" />
        </span>
        <div>
          <h2 className="font-display text-base font-bold text-foreground">
            Activate requestor functionality
          </h2>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">
            Submit verified blood requests and follow every allocation, dispatch and
            receipt step. {ACTIVATION_NOTE}
          </p>
        </div>
      </div>
      <Button className="w-fit shrink-0 gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add requestor profile
      </Button>
    </div>
  );

  return (
    <>
      {variant === "card" ? (
        <section className="rounded-2xl border border-border bg-card p-5">{body}</section>
      ) : (
        body
      )}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Activate requestor functionality</DialogTitle>
            <DialogDescription>
              For patients, family members and authorized representatives. Patient
              details stay private and every request is verified by staff.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="activate-requestor-name">Full name</Label>
              <Input
                id="activate-requestor-name"
                value={form.fullName}
                onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activate-requestor-phone">Phone</Label>
              <Input
                id="activate-requestor-phone"
                inputMode="tel"
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Relationship</Label>
                <Select
                  value={form.requestorType}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, requestorType: value as RequestorType }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REQUESTOR_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {REQUESTOR_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Select
                  value={form.city}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, city: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CITIES.map((city) => (
                      <SelectItem key={city} value={city}>
                        {city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-start gap-2.5 rounded-xl border border-border bg-background p-3 text-[11px] leading-5 text-muted-foreground">
              <Checkbox
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
                aria-label="Confirm requestor declaration"
                className="mt-0.5"
              />
              <span className="flex items-start gap-1.5">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                I confirm I am the patient, family member or authorized representative and
                that staff may verify this request with the hospital.
              </span>
            </label>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="gap-2">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Droplets className="size-4" />}
                Activate requestor access
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
