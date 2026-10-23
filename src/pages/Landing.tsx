import { api } from "@/convex/_generated/api";
import { SiteFooter } from "@/components/lifelink/SiteFooter";
import { SiteHeader } from "@/components/lifelink/SiteHeader";
import {
  BloodGroupChip,
  DemoBadge,
  SectionHeading,
  VerifiedBadge,
} from "@/components/lifelink/ui-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { hasDashboardRole } from "@/lib/roles";
import {
  BLOOD_GROUPS,
  CITIES,
  COMPONENTS,
  COMPONENT_LABELS,
  MATCHING_DISCLAIMER,
  type Component,
} from "@/lib/blood";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarHeart,
  CheckCircle2,
  Clock3,
  Droplets,
  FileCheck2,
  FlaskConical,
  HeartHandshake,
  HeartPulse,
  Hospital,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  Siren,
  Sparkles,
  Stethoscope,
  Truck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

const fadeUp = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

const CONTACT_EMAIL =
  (import.meta.env.VITE_LIFELINK_CONTACT_EMAIL as string | undefined) ??
  "hello@lifelink.example";
const CONTACT_PHONE =
  (import.meta.env.VITE_LIFELINK_CONTACT_PHONE as string | undefined) ??
  "+91 20 2550 1000";

function HeroVisual({
  units,
  organizations,
  camps,
  demo,
}: {
  units?: number;
  organizations?: number;
  camps?: number;
  demo?: boolean;
}) {
  return (
    <div className="relative mx-auto aspect-[5/4.4] w-full max-w-[560px]">
      <div aria-hidden className="absolute inset-6 rounded-[42px] bg-grid opacity-60" />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 size-[74%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_35%_30%,oklch(0.97_0.03_20),oklch(0.93_0.06_22))]"
      />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 size-[88%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/10"
      />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 size-[66%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/15"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="absolute left-1/2 top-[44%] w-[58%] -translate-x-1/2 -translate-y-1/2"
      >
        <div className="relative rounded-[34px] border border-primary/15 bg-card/90 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-teal-800">
              <ShieldCheck className="size-2.5" />
              Verified network
            </span>
            {demo ? <DemoBadge /> : <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Live metrics</span>}
          </div>

          <div className="mt-4 flex items-center gap-4">
            <div className="relative flex size-[74px] items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-primary/20 pulse-ring" />
              <svg viewBox="0 0 48 48" className="size-[58px] animate-float-slow" aria-hidden>
                <defs>
                  <linearGradient id="hero-drop" x1="10" y1="4" x2="38" y2="44" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#d4293f" />
                    <stop offset="1" stopColor="#8d1024" />
                  </linearGradient>
                </defs>
                <path
                  d="M24 3.5c5.9 8.5 15 17.8 15 26.8a15 15 0 1 1-30 0C9 21.3 18.1 12 24 3.5Z"
                  fill="url(#hero-drop)"
                />
                <path
                  d="M20.2 26.1h2.8v-2.8h2.8v2.8h2.8v2.8h-2.8v2.8h-2.8v-2.8h-2.8v-2.8Z"
                  fill="white"
                />
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Network availability
              </p>
              <p className="mt-1 font-display text-[34px] font-extrabold leading-none">
                {units ?? "—"}
                <span className="ml-1.5 text-[11px] font-semibold tracking-normal text-muted-foreground">
                  units
                </span>
              </p>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {organizations ?? 0} verified sources · {camps ?? 0} camps ahead
              </p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-border bg-[oklch(0.235_0.04_258)] px-3 py-2.5">
            <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.14em] text-white/45">
              <span>Shared request ledger</span>
              <span className="flex items-center gap-1 text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                synced
              </span>
            </div>
            <svg viewBox="0 0 260 40" className="mt-1.5 w-full" aria-hidden>
              <path
                d="M0 24h52l7-12 8 24 8-19 7 7h56l6-8 7 16 8-12 6 4h62"
                fill="none"
                stroke="oklch(0.65 0.22 24)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="ecg-line"
              />
            </svg>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.25, duration: 0.6 }}
        className="absolute left-0 top-[12%] w-[45%] rounded-2xl border border-border bg-card/95 p-3 backdrop-blur-sm animate-float-slower"
      >
        <div className="flex items-center gap-2">
          <BloodGroupChip group="O−" size="sm" />
          <div className="min-w-0">
            <p className="text-[10.5px] font-bold">Emergency request</p>
            <p className="text-[9px] text-muted-foreground">Verified · Pune · 3 units</p>
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[68%] rounded-full bg-primary" />
        </div>
        <p className="mt-1.5 flex items-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.08em] text-primary">
          <Siren className="size-2.5" />
          Coordinating stock
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="absolute right-0 top-[26%] w-[42%] rounded-2xl border border-border bg-card/95 p-3 backdrop-blur-sm animate-float-slow"
      >
        <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          <Activity className="size-3 text-primary" />
          Matching reasons
        </p>
        <p className="mt-1.5 text-[10.5px] font-semibold">Same city · 2.4 km</p>
        <p className="text-[9.5px] text-muted-foreground">ABO/Rh compatible · verified stock</p>
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[8.5px] font-bold text-teal-800">
          <BadgeCheck className="size-2.5" />
          92 / 100 match
        </span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.6 }}
        className="absolute bottom-[4%] right-0 w-[52%] rounded-2xl border border-border bg-card/95 p-3 backdrop-blur-sm"
      >
        <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          <Truck className="size-3 text-primary" />
          Dispatch → receipt
        </p>
        <div className="mt-2 flex items-center gap-1.5 text-[9.5px] font-medium text-muted-foreground">
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">Reserved</span>
          <span className="h-px flex-1 bg-border" />
          <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 font-bold text-indigo-700">Dispatched</span>
          <span className="h-px flex-1 bg-border" />
          <span className="rounded-full bg-muted px-1.5 py-0.5 font-bold">Received</span>
        </div>
      </motion.div>
    </div>
  );
}

function SearchWidget({
  light = false,
  onDemo,
  demoBusy,
}: {
  light?: boolean;
  onDemo?: () => void;
  demoBusy?: boolean;
}) {
  const navigate = useNavigate();
  const [group, setGroup] = useState<string>("O+");
  const [component, setComponent] = useState<Component>("red_cells");
  const [city, setCity] = useState<string>("Pune");

  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        light ? "border-white/15 bg-white/[0.055]" : "border-border bg-card",
      )}
    >
      <div className="grid gap-2.5 sm:grid-cols-[110px_1fr_1fr_auto]">
        <div>
          <Label className={cn("mb-1 block text-[10px] font-bold uppercase tracking-[0.12em]", light ? "text-white/50" : "text-muted-foreground")}>
            Blood group
          </Label>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className={cn("w-full", light && "border-white/15 bg-white/10 text-white")} aria-label="Blood group"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BLOOD_GROUPS.map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className={cn("mb-1 block text-[10px] font-bold uppercase tracking-[0.12em]", light ? "text-white/50" : "text-muted-foreground")}>
            Component
          </Label>
          <Select value={component} onValueChange={(v) => setComponent(v as Component)}>
            <SelectTrigger className={cn("w-full", light && "border-white/15 bg-white/10 text-white")} aria-label="Blood component"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMPONENTS.map((c) => (
                <SelectItem key={c} value={c}>{COMPONENT_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className={cn("mb-1 block text-[10px] font-bold uppercase tracking-[0.12em]", light ? "text-white/50" : "text-muted-foreground")}>
            City
          </Label>
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className={cn("w-full", light && "border-white/15 bg-white/10 text-white")} aria-label="City"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CITIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button
            className="h-9 w-full gap-1.5 sm:w-auto"
            onClick={() =>
              navigate(
                `/blood-search?group=${encodeURIComponent(group)}&component=${encodeURIComponent(component)}&city=${encodeURIComponent(city)}`,
              )
            }
          >
            <Search className="size-3.5" />
            Search
          </Button>
        </div>
      </div>
      {onDemo && (
        <button
          type="button"
          onClick={onDemo}
          disabled={demoBusy}
          className={cn(
            "mt-2 inline-flex items-center gap-1.5 text-[10.5px] font-semibold transition-colors disabled:opacity-60",
            light ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-primary",
          )}
        >
          {demoBusy ? <Loader2 className="size-3 animate-spin" /> : <FlaskConical className="size-3" />}
          {demoBusy ? "Loading demo network…" : "No data? Load the labelled demo network"}
        </button>
      )}
    </div>
  );
}

function ContactForm() {
  const submit = useMutation(api.contact.submit);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setSent(null);
        if (!form.name.trim() || !form.email.trim() || form.message.trim().length < 10) {
          setError("Add your name, email and a message of at least 10 characters.");
          return;
        }
        setBusy(true);
        try {
          const result = await submit({
            name: form.name,
            email: form.email,
            subject: form.subject || "Website enquiry",
            message: form.message,
          });
          setSent(result.message);
          setForm({ name: "", email: "", subject: "", message: "" });
          toast.success("Message saved", { description: "The LifeLink team can review it in the shared database." });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save your message.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {sent && (
        <Alert className="border-teal-200 bg-teal-50 text-teal-900">
          <CheckCircle2 className="size-4 text-teal-700" />
          <AlertDescription>{sent}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-name">Name</Label>
          <Input id="contact-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">Email</Label>
          <Input id="contact-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-subject">Subject</Label>
        <Input id="contact-subject" value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="How can we help?" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-message">Message</Label>
        <Textarea id="contact-message" rows={4} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="Please avoid sharing patient-identifying information in this form." required />
      </div>
      <Button type="submit" className="h-10 gap-2" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
        {busy ? "Saving…" : "Send message"}
      </Button>
    </form>
  );
}

export default function Landing() {
  const { isAuthenticated, user } = useAuth();
  // Dashboard actions are only offered once sign-up finished and a role exists;
  // a half-finished session must still see Log in / Create account.
  const canOpenDashboard = isAuthenticated && hasDashboardRole(user?.role);
  const location = useLocation();
  const stats = useQuery(api.stats.publicOverview);
  const stock = useQuery(api.inventory.publicStock, {});
  const seedDemo = useMutation(api.demo.seed);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const result = await seedDemo({});
      if (result.seeded) {
        toast.success("Demo network loaded", { description: "All demo records are labelled Demo Data and are not live inventory." });
      } else {
        toast("Demo data already loaded", { description: "The labelled demo records are already in the shared database." });
      }
    } catch (err) {
      toast.error("Could not load demo data", { description: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setDemoBusy(false);
    }
  };

  const topStock = (stock ?? []).slice(0, 3);
  const units = stats?.availableUnits;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border/70">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,oklch(0.96_0.03_22),transparent_38%),radial-gradient(circle_at_95%_35%,oklch(0.95_0.025_190),transparent_34%)]" />
        <div aria-hidden className="absolute inset-0 bg-grid opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:gap-6 lg:px-8 lg:pb-24 lg:pt-16">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="max-w-[660px] text-balance font-display text-[42px] font-extrabold leading-[1.02] tracking-[-0.045em] sm:text-[56px] lg:text-[62px]">
              LifeLink
              <span className="block text-[27px] font-bold leading-[1.15] tracking-[-0.03em] text-muted-foreground sm:text-[34px]">
                Smart Blood Donation Management System
              </span>
            </h1>
            <p className="mt-5 font-display text-[18px] font-bold tracking-tight text-primary sm:text-[21px]">
              Donate Blood, Save Lives. Every Second Matters.
            </p>
            <p className="mt-4 max-w-[560px] text-pretty text-[14.5px] leading-7 text-muted-foreground">
              One verified network connecting people who need blood with compatible
              donors, authorized Red Cross branches, participating blood banks and
              hospitals — with documents, stock and request status committed to a
              single shared record.
            </p>

            <div className="mt-7 flex flex-wrap gap-2.5">
              <Button asChild size="lg" className="h-11 gap-2 px-5">
                <Link to="/blood-search">
                  <Search className="size-4" />
                  Find Blood
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 gap-2 px-5">
                <Link to="/signup/requestor">
                  <Siren className="size-4 text-primary" />
                  Request Blood
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 gap-2 px-5">
                <Link to="/signup/donor">
                  <HeartHandshake className="size-4 text-primary" />
                  Become a Donor
                </Link>
              </Button>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
              {canOpenDashboard ? (
                <Link to="/dashboard" className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary">
                  Open my dashboard <ArrowRight className="size-3.5" />
                </Link>
              ) : (
                <>
                  <Link to="/login" className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary">
                    Log in <ArrowRight className="size-3.5" />
                  </Link>
                  <span className="text-border">|</span>
                  <Link to="/signup" className="font-semibold text-foreground hover:text-primary">
                    Create account
                  </Link>
                </>
              )}
              <span className="text-border">|</span>
              <Link to="/donation-camps" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
                <CalendarHeart className="size-3.5" />
                Find a donation camp
              </Link>
            </div>

            <div className="mt-8 grid max-w-[520px] grid-cols-3 gap-3 border-t border-border/80 pt-5">
              {[
                { value: stats ? stats.verifiedDonors : "—", label: "Registered donors" },
                { value: stats ? stats.fulfilledRequests : "—", label: "Requests fulfilled" },
                { value: stats ? stats.verifiedOrganizations : "—", label: "Verified sources" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="font-display text-[22px] font-extrabold leading-none">{item.value}</p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
              <FlaskConical className="size-3" />
              {stats?.demoDataPresent
                ? "Includes clearly labelled Demo Data. Not live verified inventory."
                : "Counts come from the shared LifeLink database; no demo inventory is claimed unless labelled."}
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.1 }}>
            <HeroVisual
              units={units}
              organizations={stats?.verifiedOrganizations}
              camps={stats?.upcomingCamps}
              demo={stats?.demoDataPresent}
            />
          </motion.div>
        </div>
      </section>

      {/* EMERGENCY */}
      <section className="relative overflow-hidden bg-[oklch(0.215_0.038_258)] text-white">
        <div aria-hidden className="absolute inset-0 bg-grid-soft opacity-50" />
        <div aria-hidden className="absolute -right-24 -top-24 size-[420px] rounded-full bg-primary/20 blur-3xl" />
        <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:px-8 lg:py-16">
          <motion.div {...fadeUp}>
            <p className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.22em] text-primary">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/70" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              Emergency blood request
            </p>
            <h2 className="mt-4 max-w-xl text-balance font-display text-[32px] font-extrabold leading-[1.1] sm:text-[40px]">
              A critical need should never wait in a queue of phone calls.
            </h2>
            <p className="mt-4 max-w-xl text-[14px] leading-7 text-white/65">
              Raise an emergency or urgent request with hospital details, units and a
              prescription. Authorized Red Cross staff verify it, reserve compatible
              stock, and notify the hospital for dispatch and receipt — with every step
              timestamped.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Button asChild size="lg" className="h-11 gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <Link to="/signup/requestor">
                  <Siren className="size-4" />
                  Start an emergency request
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <Link to="/blood-search">
                  Check reported availability
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
            </div>
            <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-white/45">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
              For an immediate medical emergency, call your local emergency service
              first. LifeLink coordinates blood; it does not replace emergency care.
            </p>
          </motion.div>

          <motion.div {...fadeUp} className="rounded-2xl border border-white/12 bg-white/[0.04] p-5">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                Emergency workflow
              </p>
              <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-white">
                Emergency · 3h target
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { title: "Request verified", body: "Hospital, patient reference, component and units checked.", done: true },
                { title: "Compatible stock reserved", body: "The ledger holds units so another request cannot oversell them.", done: true },
                { title: "Dispatch recorded", body: "Red Cross staff consume the reserved batch; hospital is notified.", done: false },
                { title: "Hospital receipt confirmed", body: "Only the receiving hospital can confirm receipt.", done: false },
              ].map((step, index) => (
                <div key={step.title} className="flex gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                      step.done
                        ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
                        : "border-white/15 bg-white/5 text-white/45",
                    )}
                  >
                    {step.done ? <CheckCircle2 className="size-3.5" /> : index + 1}
                  </span>
                  <div>
                    <p className={cn("text-[12.5px] font-semibold", step.done ? "text-white" : "text-white/75")}>
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-5 text-white/45">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Demo data inside</p>
              <p className="mt-1 text-[11px] leading-5 text-white/55">
                Sample requests are labelled <strong className="text-white">Demo Data</strong>.
                Live requests will never be invented to make the dashboard look busy.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* SEARCH */}
      <section id="blood-search" className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <motion.div {...fadeUp}>
            <SectionHeading
              eyebrow="Verified blood search"
              title={<>Search reported availability, <span className="text-primary">not promises.</span></>}
              description="Filter by blood group, component and city. Results come only from verified Red Cross branches, blood banks and hospitals sharing this database — with the last stock update time shown."
            />
            <div className="mt-6">
              <SearchWidget onDemo={() => void loadDemo()} demoBusy={demoBusy} />
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-teal-600" /> Verified organizations only</span>
              <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5 text-primary" /> Last-updated timestamps</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-emerald-600" /> Patient identity never exposed</span>
            </div>
            <p className="mt-5 rounded-xl border border-border bg-muted/30 p-3 text-[11px] leading-5 text-muted-foreground">
              Availability is reported, not guaranteed. Final compatibility, screening
              and issue are confirmed by qualified medical staff.
            </p>
          </motion.div>

          <motion.div {...fadeUp} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Availability snapshot</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Verified sources, unexpired unreserved stock only</p>
              </div>
              <Button asChild variant="ghost" size="sm" className="gap-1 text-[11px]">
                <Link to="/blood-search">View all <ArrowRight className="size-3" /></Link>
              </Button>
            </div>

            {stock === undefined ? (
              <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading reported stock…
              </div>
            ) : topStock.length === 0 ? (
              <div className="py-10 text-center">
                <Droplets className="mx-auto size-7 text-muted-foreground/50" />
                <p className="mt-3 text-[13px] font-semibold">No verified stock is reported yet</p>
                <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-5 text-muted-foreground">
                  Connect a verified branch or load the clearly labelled demo network to
                  preview the search experience.
                </p>
                <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={() => void loadDemo()} disabled={demoBusy}>
                  {demoBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
                  Load demo network
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-2.5">
                {topStock.map((item) => (
                  <Link
                    key={`${item.organizationId}-${item.bloodGroup}-${item.component}`}
                    to={`/blood-search?group=${encodeURIComponent(item.bloodGroup)}&component=${encodeURIComponent(item.component)}&city=${encodeURIComponent(item.city)}`}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-primary/25 hover:bg-primary/[0.02]"
                  >
                    <BloodGroupChip group={item.bloodGroup} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-[12.5px] font-semibold">{item.organizationName}</p>
                        {item.isDemo && <DemoBadge />}
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                        {COMPONENT_LABELS[item.component as Component] ?? item.component} · {item.city} · updated {new Date(item.lastUpdated).toLocaleDateString()}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <VerifiedBadge />
                        <span className="text-[9.5px] text-muted-foreground">{item.units} unit(s) reported</span>
                      </div>
                    </div>
                    <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                ))}
                <p className="flex items-start gap-1.5 pt-1 text-[10px] leading-4 text-muted-foreground">
                  <FlaskConical className="mt-0.5 size-3 shrink-0 text-amber-600" />
                  Demo rows are labelled and can be filtered from live records visually.
                </p>
              </div>
            )}
          </motion.div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="border-y border-border bg-muted/25">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <motion.div {...fadeUp}>
            <SectionHeading
              align="center"
              eyebrow="How it works"
              title="Four steps from need to confirmed receipt"
              description="Every handoff is authorized, timestamped and visible to the people who need to act next — never a separate copy of the data."
            />
          </motion.div>
          <div className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Siren,
                step: "01",
                title: "Request blood",
                body: "Requestor or hospital submits group, component, units, urgency and a prescription if available.",
              },
              {
                icon: FileCheck2,
                step: "02",
                title: "Verify request",
                body: "Authorized Red Cross staff review the request and uploaded document, then approve or reject with a reason.",
              },
              {
                icon: Search,
                step: "03",
                title: "Find suitable availability",
                body: "The rules engine ranks compatible verified batches and eligible nearby donors with transparent reasons.",
              },
              {
                icon: Truck,
                step: "04",
                title: "Coordinate fulfilment",
                body: "Stock is reserved, dispatched and received against the same ledger; the requestor sees each status change.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.07 }}
                className="relative rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
                    <item.icon className="size-5" />
                  </span>
                  <span className="font-display text-[11px] font-extrabold tracking-[0.14em] text-muted-foreground/50">
                    {item.step}
                  </span>
                </div>
                <h3 className="mt-4 text-[15px] font-bold">{item.title}</h3>
                <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">{item.body}</p>
                {i < 3 && <span aria-hidden className="absolute -right-1.5 top-1/2 hidden h-px w-3 bg-border lg:block" />}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <motion.div {...fadeUp}>
            <SectionHeading
              eyebrow="Our services"
              title="One platform for the whole coordination chain"
              description="Purpose-built tools for donors, families, hospitals and authorized blood network staff."
            />
          </motion.div>
          <Button asChild variant="outline" className="w-fit gap-1.5">
            <Link to="/signup">
              Choose your role <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Donor management",
              body: "Unique donor IDs, availability controls, donation history, interval guidance and privacy-first contact sharing.",
              href: "/signup/donor",
            },
            {
              icon: HeartPulse,
              title: "Blood request coordination",
              body: "Structured requests with document review, status timeline, donor offers and notifications at every step.",
              href: "/signup/requestor",
            },
            {
              icon: Droplets,
              title: "Verified stock monitoring",
              body: "Group and component stock with expiry, low-stock alerts, reservations and an immutable movement ledger.",
              href: "/red-cross/dashboard",
            },
            {
              icon: CalendarHeart,
              title: "Donation camps",
              body: "Publish camps, manage capacity and registrations, and record verified donations after medical clearance.",
              href: "/donation-camps",
            },
            {
              icon: Hospital,
              title: "Hospital coordination",
              body: "Hospital-specific requests, dispatch tracking, receipt confirmation and reported nearby availability.",
              href: "/signup/hospital",
            },
            {
              icon: Sparkles,
              title: "Explainable matching",
              body: "Compatible inventory and donor ranking with visible reasons, a last-updated timestamp and no invented AI predictions.",
              href: "/#matching",
            },
          ].map((service, i) => (
            <motion.div
              key={service.title}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: (i % 3) * 0.06 }}
            >
              <Link
                to={service.href}
                className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/25"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
                  <service.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-[15px] font-bold">{service.title}</h3>
                <p className="mt-1.5 flex-1 text-[12px] leading-5 text-muted-foreground">{service.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                  Explore <ArrowUpRight className="size-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* MATCHING */}
      <section id="matching" className="border-y border-border bg-muted/25">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-20">
          <motion.div {...fadeUp}>
            <SectionHeading
              eyebrow="Smart matching, honestly labelled"
              title={<>Rules first. <span className="text-primary">No invented AI.</span></>}
              description="LifeLink ships a transparent baseline that ranks verified inventory and eligible donors using ABO/Rh component rules, distance, reported availability, urgency and verification state. A future ML model can improve ranking, demand forecasting and camp planning — but only when a real model is configured."
            />
            <ul className="mt-6 space-y-2.5">
              {[
                "Component-specific compatibility rules, not label matching alone",
                "Visible score reasons and warnings for every option",
                "Verified-source filtering before ranking",
                "Clear 'ML model not connected' status in every matching panel",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2 text-[12.5px] leading-6 text-muted-foreground">
                  <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-teal-600" />
                  {point}
                </li>
              ))}
            </ul>
            <p className="mt-5 max-w-xl rounded-xl border border-border bg-card p-3 text-[10.5px] leading-5 text-muted-foreground">
              {MATCHING_DISCLAIMER}
            </p>
          </motion.div>

          <motion.div {...fadeUp} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Candidate ranking · demo view</p>
              <Badge variant="outline" className="border-border text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Rules baseline
              </Badge>
            </div>
            <div className="mt-4 space-y-2.5">
              {[
                { group: "O−", title: "Red Cross Pune · batch DEMO-001", score: 96, tags: ["Same city", "4 free units", "Verified"], tone: "teal" },
                { group: "O+", title: "Sahyadri Blood Bank · batch DEMO-011", score: 88, tags: ["ABO compatible", "12 free units", "Verified"], tone: "teal" },
                { group: "A−", title: "Donor LL-D-0007 · 3.1 km", score: 81, tags: ["Interval OK", "Contact protected"], tone: "amber" },
              ].map((row) => (
                <div key={row.title} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                  <BloodGroupChip group={row.group} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold">{row.title}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {row.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <span className="rounded-full bg-primary/8 px-2 py-0.5 font-display text-[11px] font-bold text-primary">{row.score}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" />
              Illustrative ranking. Real matches are computed only from verified records for an authorized request, and final clinical decisions remain with medical staff.
            </p>
          </motion.div>
        </div>
      </section>

      {/* AWARENESS */}
      <section id="awareness" className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <motion.div {...fadeUp}>
          <SectionHeading
            eyebrow="Donation awareness"
            title="Preparing for a donation"
            description="General guidance only. Final eligibility is always determined by qualified medical personnel at the donation center."
          />
        </motion.div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Users, title: "Age guidance", body: "Commonly 18–65 years. Local rules and clinician assessment apply." },
            { icon: Activity, title: "General wellbeing", body: "Eat a normal meal, hydrate well, and avoid alcohol before donating." },
            { icon: Clock3, title: "Donation interval", body: "A 90-day advisory baseline between whole blood donations; medical staff confirm." },
            { icon: Stethoscope, title: "Screening matters", body: "Haemoglobin, vitals and a health questionnaire are part of every donation." },
          ].map((card) => (
            <div key={card.title} className="rounded-2xl border border-border bg-card p-5">
              <card.icon className="size-5 text-primary" />
              <h3 className="mt-3 text-[13.5px] font-bold">{card.title}</h3>
              <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">{card.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-[11.5px] leading-5 text-muted-foreground">
            <strong className="text-foreground">Medical safety notice:</strong>{" "}
            LifeLink does not determine eligibility or compatibility. Donor health,
            screening results, component-specific rules and cross-matching must be
            confirmed by qualified professionals.
          </p>
          <Button asChild size="sm" variant="outline" className="w-fit shrink-0 gap-1.5">
            <Link to="/donation-camps">See upcoming camps <ArrowRight className="size-3.5" /></Link>
          </Button>
        </div>
      </section>

      {/* IMPACT */}
      <section id="impact" className="relative overflow-hidden border-y border-border bg-[oklch(0.24_0.05_258)] text-white">
        <div aria-hidden className="absolute inset-0 bg-grid-soft opacity-40" />
        <div aria-hidden className="absolute -left-20 bottom-0 size-[340px] rounded-full bg-primary/20 blur-3xl" />
        <div className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr] lg:items-center">
            <motion.div {...fadeUp}>
              <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-primary">Impact, measured honestly</p>
              <h2 className="mt-3 text-balance font-display text-[32px] font-extrabold leading-[1.12] sm:text-[40px]">
                Real database metrics.
                <span className="block text-white/50">Demo data always labelled.</span>
              </h2>
              <p className="mt-4 max-w-md text-[13px] leading-6 text-white/60">
                These figures are generated from the shared LifeLink database, not
                marketing copy. When demonstration records are present, every dashboard
                and public result labels them.
              </p>
              <Button asChild className="mt-6 gap-1.5 bg-white text-[oklch(0.24_0.05_258)] hover:bg-white/90">
                <Link to="/blood-search">Explore the live search <ArrowRight className="size-4" /></Link>
              </Button>
            </motion.div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { value: stats?.availableUnits ?? "—", label: "Verified units reported", icon: Droplets },
                { value: stats?.verifiedDonors ?? "—", label: "Registered donors", icon: Users },
                { value: stats?.fulfilledRequests ?? "—", label: "Requests fulfilled", icon: CheckCircle2 },
                { value: stats?.verifiedOrganizations ?? "—", label: "Verified organizations", icon: Building2 },
                { value: stats?.upcomingCamps ?? "—", label: "Upcoming camps", icon: CalendarHeart },
                { value: stats?.citiesCovered ?? "—", label: "Cities covered", icon: MapPin },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <item.icon className="size-4 text-primary" />
                  <p className="mt-3 font-display text-[26px] font-extrabold leading-none">{item.value}</p>
                  <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.1em] leading-4 text-white/45">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-8 flex flex-wrap items-center gap-2 text-[10px] text-white/35">
            <ShieldCheck className="size-3 text-primary" />
            Source: LifeLink shared database · updated {stats ? new Date(stats.generatedAt).toLocaleString() : "—"}
            {stats?.demoDataPresent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 font-bold uppercase tracking-[0.08em] text-amber-200">
                <FlaskConical className="size-2.5" /> Includes Demo Data
              </span>
            )}
          </p>
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <motion.div {...fadeUp}>
            <SectionHeading
              eyebrow="About LifeLink"
              title="A coordination layer for a life-saving network"
              description="LifeLink was designed for a Generative AI & Machine Learning Buildathon with a simple conviction: the technology should make verified coordination faster without ever pretending to replace medical judgement."
            />
            <div className="mt-6 flex flex-wrap gap-2">
              {["Shared database", "Server-side RBAC", "Audit logged", "Privacy-first", "Rules-based matching"].map((tag) => (
                <span key={tag} className="rounded-full border border-border bg-card px-3 py-1.5 text-[10.5px] font-semibold text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div {...fadeUp} className="grid gap-3 sm:grid-cols-2">
            {[
              {
                title: "For donors",
                body: "Control availability, see verified nearby needs without exposing your address, and keep a complete donation history.",
                icon: HeartHandshake,
              },
              {
                title: "For families",
                body: "Raise a structured request, upload a prescription, and follow a real status timeline instead of calling around.",
                icon: HeartPulse,
              },
              {
                title: "For Red Cross",
                body: "Verify requests, manage inventory with expiry alerts, coordinate camps and leave a complete audit trail.",
                icon: Building2,
              },
              {
                title: "For hospitals",
                body: "Submit requests, view reported partner stock, track dispatch and confirm receipt against the same records.",
                icon: Hospital,
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-border bg-card p-5">
                <item.icon className="size-5 text-primary" />
                <h3 className="mt-3 text-[14px] font-bold">{item.title}</h3>
                <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">{item.body}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-5 sm:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Our commitment</p>
              <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
                Never claim stock is available unless the database confirms it. Never show
                a status update to the wrong person. Never let a browser choose an
                administrative role. Never present demo records as live inventory.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="border-t border-border bg-muted/25">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-20">
          <motion.div {...fadeUp}>
            <SectionHeading
              eyebrow="Contact us"
              title="Talk to the LifeLink team"
              description="Questions about the buildathon prototype, verification workflow or a partnership? Send a message — it is stored in the shared database for review."
            />
            <div className="mt-6 space-y-3">
              {[
                { icon: Mail, label: "Email", value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
                { icon: Phone, label: "Phone", value: CONTACT_PHONE, href: `tel:${CONTACT_PHONE.replace(/\s/g, "")}` },
                { icon: MapPin, label: "Base", value: "Bengaluru, Karnataka, India" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary">
                    <item.icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
                    {item.href ? (
                      <a href={item.href} className="text-[12px] font-semibold hover:text-primary">{item.value}</a>
                    ) : (
                      <p className="text-[12px] font-semibold">{item.value}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[10.5px] leading-5 text-amber-900">
              <strong>Contact configuration:</strong> these details come from
              <code className="mx-1 rounded bg-white/60 px-1">VITE_LIFELINK_CONTACT_EMAIL</code>
              and <code className="mx-1 rounded bg-white/60 px-1">VITE_LIFELINK_CONTACT_PHONE</code>.
              Replace them with real, monitored contacts before production use.
            </p>
          </motion.div>

          <motion.div {...fadeUp} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Send a message</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">No sensitive patient details, please.</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-teal-800">
                <ShieldCheck className="size-2.5" /> Validated form
              </span>
            </div>
            <ContactForm />
          </motion.div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
