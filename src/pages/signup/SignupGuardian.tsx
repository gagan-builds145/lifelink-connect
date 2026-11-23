import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Ambulance, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { SignupFrame } from "@/components/lifelink/SignupFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupGuardian() {
  const navigate = useNavigate();
  const register = useMutation(api.ambulances.registerGuardian);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    contactPerson: "",
    phone: "",
    city: "Pune",
    address: "",
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await register(form);
      toast.success("Guardian account created", {
        description: "Add your ambulance and driver details in the Guardian dashboard.",
      });
      navigate("/guardian/dashboard", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not register the ambulance service.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignupFrame
      eyebrow="Guardian registration"
      title="Register your ambulance service"
      description="Guardian accounts manage ambulances, drivers, availability, incoming requests and live journey status. Guardian access is separate from donor, hospital and blood bank accounts."
      asideTitle="One dispatch desk for your fleet"
      asideBody="Receive nearby requests, accept or decline them, share live location during an active journey and keep a complete status history."
      asideNote="Vehicle and driver details are required before accepting bookings."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="guardian-company">Ambulance service name</Label>
          <Input
            id="guardian-company"
            value={form.companyName}
            onChange={(event) => set("companyName", event.target.value)}
            placeholder="City Care Ambulance Service"
            required
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="guardian-contact">Contact person</Label>
            <Input
              id="guardian-contact"
              value={form.contactPerson}
              onChange={(event) => set("contactPerson", event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guardian-phone">Phone</Label>
            <Input
              id="guardian-phone"
              type="tel"
              value={form.phone}
              onChange={(event) => set("phone", event.target.value)}
              placeholder="+91 98765 43210"
              required
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guardian-city">City</Label>
          <Input
            id="guardian-city"
            value={form.city}
            onChange={(event) => set("city", event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guardian-address">Registered address</Label>
          <Input
            id="guardian-address"
            value={form.address}
            onChange={(event) => set("address", event.target.value)}
            placeholder="Depot / street / area"
            required
          />
        </div>

        <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-[10.5px] leading-5 text-sky-900">
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="size-3.5" /> Independent ambulance provider
          </p>
          <p className="mt-1">
            LifeLink facilitates bookings and does not itself operate ambulances or
            guarantee emergency medical response. Keep your vehicle documents available
            for verification.
          </p>
        </div>

        <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Ambulance className="size-4" />}
          {busy ? "Creating Guardian account…" : "Create Guardian account"}
          {!busy && <ArrowRight className="size-3.5" />}
        </Button>
      </form>
    </SignupFrame>
  );
}
