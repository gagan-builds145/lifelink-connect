import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SiteFooter } from "@/components/lifelink/SiteFooter";
import { SiteHeader } from "@/components/lifelink/SiteHeader";
import { DemoBadge, EmptyState } from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { CITIES, formatDate } from "@/lib/blood";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarHeart,
  CheckCircle2,
  Clock3,
  Droplets,
  FlaskConical,
  HeartHandshake,
  Info,
  Loader2,
  MapPin,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

export default function DonationCamps() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [city, setCity] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const camps = useQuery(api.camps.listPublic, {
    city: city === "all" ? undefined : city,
  });
  const registrations = useQuery(
    api.camps.myRegistrations,
    isAuthenticated ? {} : "skip",
  );
  const register = useMutation(api.camps.register);
  const cancel = useMutation(api.camps.cancelRegistration);
  const seedDemo = useMutation(api.demo.seed);

  const registrationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const reg of registrations ?? []) map.set(String(reg.campId), reg.status);
    return map;
  }, [registrations]);

  const upcoming = (camps ?? []).filter((c) => c.status !== "completed" && c.status !== "cancelled");
  const past = (camps ?? []).filter((c) => c.status === "completed" || c.status === "cancelled");
  const demoPresent = (camps ?? []).some((c) => c.isDemo);

  const handleRegister = async (campId: string, title: string) => {
    if (!isAuthenticated) {
      navigate("/login?returnTo=%2Fdonation-camps");
      return;
    }
    setBusy(campId);
    try {
      await register({ campId: campId as Id<"bloodCamps"> });
      toast.success("Registration confirmed", {
        description: `${title} · bring a photo ID. Final eligibility is assessed on site.`,
      });
    } catch (err) {
      toast.error("Could not register", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async (campId: string) => {
    setBusy(campId);
    try {
      await cancel({ campId: campId as Id<"bloodCamps"> });
      toast("Registration cancelled");
    } catch (err) {
      toast.error("Could not cancel", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const result = await seedDemo({});
      toast("Demo network ready", {
        description: result.seeded
          ? "Labelled demo camps and stock are now visible."
          : "Demo records were already loaded and labelled.",
      });
    } catch (err) {
      toast.error("Could not load demo data", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,oklch(0.96_0.03_22),transparent_38%),radial-gradient(circle_at_88%_25%,oklch(0.95_0.025_190),transparent_32%)]" />
          <div aria-hidden className="absolute inset-0 bg-grid opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />
          <div className="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="max-w-2xl">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                <CalendarHeart className="size-3.5" /> Donation camps
              </p>
              <h1 className="mt-3 text-balance font-display text-[36px] font-extrabold leading-[1.06] tracking-tight sm:text-[46px]">
                Give an hour. <span className="text-primary">Give someone a future.</span>
              </h1>
              <p className="mt-4 text-[14px] leading-7 text-muted-foreground">
                Register at a verified donation camp near you. Capacity is live from the
                shared database, and an actual donation is recorded only by authorized staff
                after on-site screening.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/signup/donor"><HeartHandshake className="size-4 text-primary" /> Become a donor</Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/blood-search"><Droplets className="size-4 text-primary" /> Blood availability</Link>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[12px] font-semibold">{upcoming.length} upcoming camp(s)</p>
              {demoPresent && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-amber-800">
                  <FlaskConical className="size-2.5" /> Includes Demo Data
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="h-9 w-[150px] text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cities</SelectItem>
                  {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-[10.5px]" onClick={() => void loadDemo()} disabled={demoBusy}>
                {demoBusy ? <Loader2 className="size-3 animate-spin" /> : <FlaskConical className="size-3" />}
                Load demo camps
              </Button>
            </div>
          </div>

          {camps === undefined ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading camps…
            </div>
          ) : camps.length === 0 ? (
            <EmptyState
              icon={CalendarHeart}
              title="No donation camps published"
              description="Verified organizations publish camps here. Try another city or load the labelled demo network to preview the listing."
              action={<Button size="sm" variant="outline" className="gap-1.5" onClick={() => void loadDemo()} disabled={demoBusy}><FlaskConical className="size-3.5" /> Load demo camps</Button>}
              className="mt-4 bg-card"
            />
          ) : (
            <>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {upcoming.map((camp) => {
                  const regStatus = registrationMap.get(String(camp._id));
                  const registered = regStatus === "registered" || regStatus === "donated";
                  const full = camp.registered >= camp.capacity;
                  return (
                    <div key={camp._id} className="rounded-2xl border border-border bg-card p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h2 className="text-[14px] font-bold leading-5">{camp.title}</h2>
                            {camp.isDemo && <DemoBadge />}
                          </div>
                          <p className="mt-0.5 text-[10.5px] text-muted-foreground">{camp.organizationName}</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-teal-800">
                          {camp.status}
                        </span>
                      </div>
                      <p className="mt-3 text-[11.5px] leading-5 text-muted-foreground">{camp.description}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-muted/25 p-3">
                        <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                          <CalendarHeart className="size-3 text-primary" /> {formatDate(camp.date)}
                        </p>
                        <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                          <Clock3 className="size-3 text-primary" /> {camp.startTime}–{camp.endTime}
                        </p>
                        <p className="col-span-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                          <MapPin className="size-3 text-primary" /> {camp.venue}, {camp.city}
                        </p>
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1"><Users className="size-3" /> {camp.registered}/{camp.capacity} registered</span>
                          <span>{Math.max(0, camp.capacity - camp.registered)} place(s) left</span>
                        </div>
                        <Progress value={(camp.registered / camp.capacity) * 100} className="mt-1.5 h-1.5" />
                      </div>
                      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                        <p className="flex-1 text-[10px] text-muted-foreground">{camp.organizer}</p>
                        {regStatus === "donated" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[9.5px] font-bold text-teal-800">
                            <CheckCircle2 className="size-3" /> Donation recorded
                          </span>
                        ) : registered ? (
                          <Button size="sm" variant="outline" className="h-8 text-[10.5px]" disabled={busy === camp._id} onClick={() => void handleCancel(camp._id)}>
                            {busy === camp._id && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                            Cancel registration
                          </Button>
                        ) : (
                          <Button size="sm" className="h-8 text-[10.5px]" disabled={full || busy === camp._id} onClick={() => void handleRegister(camp._id, camp.title)}>
                            {busy === camp._id ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <HeartHandshake className="mr-1.5 size-3" />}
                            {full ? "Camp full" : "Register"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {past.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-[14px] font-bold">Past camps</h2>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
                    {past.map((camp) => (
                      <div key={camp._id} className="flex flex-col gap-1 border-b border-border p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[12px] font-semibold">{camp.title}</p>
                          <p className="text-[10.5px] text-muted-foreground">{camp.venue}, {camp.city} · {formatDate(camp.date)}</p>
                        </div>
                        <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{camp.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <section className="mt-8 grid gap-3 lg:grid-cols-3">
            {[
              { title: "Before you arrive", body: "Eat a normal meal, drink water, and bring a government photo ID. Avoid alcohol beforehand.", icon: Info },
              { title: "On the day", body: "A health questionnaire, haemoglobin check and vitals are part of screening. Medical staff decide eligibility.", icon: ShieldCheck },
              { title: "After donating", body: "Rest briefly, take the provided refreshments, and follow the center's aftercare advice. Do not drive if you feel unwell.", icon: HeartHandshake },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-border bg-card p-4">
                <item.icon className="size-4 text-primary" />
                <p className="mt-2 text-[12px] font-bold">{item.title}</p>
                <p className="mt-1 text-[10.5px] leading-5 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </section>

          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl text-[11px] leading-5 text-muted-foreground">
              <strong className="text-foreground">Medical note:</strong> general guidance only.
              Final donor eligibility is determined by qualified medical personnel. LifeLink
              never records a donation until authorized staff verify it.
            </p>
            <Button asChild size="sm" className="w-fit shrink-0 gap-1.5">
              <Link to="/signup/donor">Create donor account <ArrowRight className="size-3.5" /></Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
