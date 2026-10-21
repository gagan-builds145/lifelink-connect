import { api } from "@/convex/_generated/api";
import { SiteFooter } from "@/components/lifelink/SiteFooter";
import { SiteHeader } from "@/components/lifelink/SiteHeader";
import {
  BloodGroupChip,
  DemoBadge,
  EmptyState,
  SectionHeading,
  VerifiedBadge,
} from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BLOOD_GROUPS,
  CITIES,
  COMPONENTS,
  COMPONENT_LABELS,
  formatDateTime,
  type Component,
} from "@/lib/blood";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  Clock3,
  Droplets,
  FlaskConical,
  Info,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  Siren,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

export default function BloodSearch() {
  const [params, setParams] = useSearchParams();
  const [group, setGroup] = useState(params.get("group") ?? "all");
  const [component, setComponent] = useState(params.get("component") ?? "all");
  const [city, setCity] = useState(params.get("city") ?? "all");
  const [demoBusy, setDemoBusy] = useState(false);

  const stock = useQuery(api.inventory.publicStock, {
    bloodGroup: group === "all" ? undefined : (group as (typeof BLOOD_GROUPS)[number]),
    component: component === "all" ? undefined : (component as Component),
    city: city === "all" ? undefined : city,
  });
  const organizations = useQuery(api.profiles.publicOrganizations, {
    type: "red_cross",
    city: city === "all" ? undefined : city,
  });
  const banks = useQuery(api.profiles.publicOrganizations, {
    type: "blood_bank",
    city: city === "all" ? undefined : city,
  });
  const hospitals = useQuery(api.profiles.publicOrganizations, {
    type: "hospital",
    city: city === "all" ? undefined : city,
  });
  const seedDemo = useMutation(api.demo.seed);

  const totalUnits = useMemo(
    () => (stock ?? []).reduce((sum, item) => sum + item.units, 0),
    [stock],
  );
  const demoPresent = (stock ?? []).some((s) => s.isDemo);

  const apply = () => {
    const next = new URLSearchParams();
    if (group !== "all") next.set("group", group);
    if (component !== "all") next.set("component", component);
    if (city !== "all") next.set("city", city);
    setParams(next, { replace: true });
  };

  const clear = () => {
    setGroup("all");
    setComponent("all");
    setCity("all");
    setParams({}, { replace: true });
  };

  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const result = await seedDemo({});
      toast("Demo network ready", {
        description: result.seeded
          ? "Labelled demo stock and organizations are now visible. They are not live inventory."
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

  const hasFilters = group !== "all" || component !== "all" || city !== "all";
  const activeOrganizations = (organizations ?? []).length + (banks ?? []).length + (hospitals ?? []).length;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,oklch(0.96_0.03_22),transparent_35%),radial-gradient(circle_at_92%_20%,oklch(0.95_0.025_190),transparent_30%)]" />
          <div aria-hidden className="absolute inset-0 bg-grid opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />
          <div className="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                <ShieldCheck className="size-3.5" />
                Verified sources only
              </p>
              <h1 className="mt-3 max-w-3xl text-balance font-display text-[36px] font-extrabold leading-[1.06] tracking-tight sm:text-[46px]">
                Find reported blood availability, <span className="text-primary">without false promises.</span>
              </h1>
              <p className="mt-4 max-w-2xl text-[14px] leading-7 text-muted-foreground">
                Search verified Red Cross branches, participating blood banks and hospitals
                sharing the LifeLink database. Every result shows when stock was last
                updated. Reported availability is confirmed by the organization before issue.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button asChild className="gap-2">
                  <Link to="/signup/requestor">
                    <Siren className="size-4" /> Request blood
                  </Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/donation-camps">
                    <Droplets className="size-4 text-primary" /> Donation camps
                  </Link>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Blood group</label>
                <Select value={group} onValueChange={setGroup}>
                  <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any group</SelectItem>
                    {BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Component</label>
                <Select value={component} onValueChange={setComponent}>
                  <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any component</SelectItem>
                    {COMPONENTS.map((c) => <SelectItem key={c} value={c}>{COMPONENT_LABELS[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">City</label>
                <Select value={city} onValueChange={setCity}>
                  <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All cities</SelectItem>
                    {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button className="h-10 flex-1 gap-1.5 sm:flex-none" onClick={apply}>
                  <Search className="size-4" /> Search
                </Button>
                {hasFilters && (
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={clear} aria-label="Clear filters">
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Droplets className="size-3.5 text-primary" /> <strong className="text-foreground">{stock ? totalUnits : "—"}</strong> units reported</span>
              <span className="inline-flex items-center gap-1.5"><Building2 className="size-3.5 text-primary" /> <strong className="text-foreground">{activeOrganizations}</strong> verified organization(s)</span>
              {demoPresent && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-amber-800">
                  <FlaskConical className="size-2.5" /> Demo data shown
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[10.5px]" onClick={() => void loadDemo()} disabled={demoBusy}>
                {demoBusy ? <Loader2 className="size-3 animate-spin" /> : <FlaskConical className="size-3" />}
                Load demo network
              </Button>
              <Button asChild size="sm" className="h-8 gap-1.5 text-[10.5px]">
                <Link to="/signup/requestor">Request this blood <ArrowRight className="size-3" /></Link>
              </Button>
            </div>
          </div>

          <div className="mt-5">
            <h2 className="text-[15px] font-bold">Reported stock by verified source</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Verified, unexpired batches with at least one unreserved unit. Public-safe fields only.
            </p>

            {stock === undefined ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching verified sources…
              </div>
            ) : stock.length === 0 ? (
              <EmptyState
                icon={Droplets}
                title="No verified stock matches this search"
                description="LifeLink never invents availability. Try another city or component, or load the labelled demo network to preview the workflow."
                action={<Button size="sm" variant="outline" className="gap-1.5" onClick={() => void loadDemo()} disabled={demoBusy}><FlaskConical className="size-3.5" /> Load demo network</Button>}
                className="mt-4 bg-card"
              />
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {stock.map((item) => (
                  <div key={`${item.organizationId}-${item.bloodGroup}-${item.component}`} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <BloodGroupChip group={item.bloodGroup} />
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[12.5px] font-bold">{item.organizationName}</p>
                            {item.isDemo && <DemoBadge />}
                          </div>
                          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <MapPin className="size-2.5" />
                            {item.city}{item.area ? ` · ${item.area}` : ""} · {item.orgId}
                          </p>
                        </div>
                      </div>
                      <VerifiedBadge />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-muted/25 p-2.5 text-center">
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">Component</p>
                        <p className="mt-0.5 text-[10.5px] font-semibold leading-4">{COMPONENT_LABELS[item.component as Component]}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">Reported</p>
                        <p className="mt-0.5 text-[13px] font-extrabold text-teal-700">{item.units} units</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">Near expiry</p>
                        <p className="mt-0.5 text-[10.5px] font-semibold">{item.earliestExpiry}</p>
                      </div>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Clock3 className="size-3" />
                      Last stock update: {formatDateTime(item.lastUpdated)}
                    </p>
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                      <span className="text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
                        {item.organizationType.replace("_", " ")}
                      </span>
                      <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-[10px]">
                        <Link to="/signup/requestor">Raise a request <ArrowRight className="size-2.5" /></Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <section className="mt-10">
            <SectionHeading
              eyebrow="Authorized network"
              title="Verified organizations"
              description="Official organization contacts are shown for coordination. Donor identities and patient data are never included."
            />
            {organizations === undefined || banks === undefined || hospitals === undefined ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading directory…
              </div>
            ) : activeOrganizations === 0 ? (
              <EmptyState
                icon={Building2}
                title="No verified organizations in this view"
                description="Verified Red Cross branches, blood banks and hospitals will appear here once registered and approved."
                className="mt-4 bg-card"
              />
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...(organizations ?? []), ...(banks ?? []), ...(hospitals ?? [])].map((org) => (
                  <div key={org._id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[12.5px] font-bold">{org.name}</p>
                          {org.isDemo && <DemoBadge />}
                        </div>
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                          {org.type.replace("_", " ")} · {org.orgId}
                        </p>
                      </div>
                      <ShieldCheck className="size-4 shrink-0 text-teal-600" />
                    </div>
                    <div className="mt-3 space-y-1.5 text-[10.5px] text-muted-foreground">
                      <p className="flex items-center gap-1.5"><MapPin className="size-3" />{org.city}{org.area ? ` · ${org.area}` : ""}</p>
                      <p className="flex items-center gap-1.5"><Phone className="size-3" />{org.phone}</p>
                      <p className="flex items-center gap-1.5"><Mail className="size-3" />{org.email}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="mt-8 grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-4">
              <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-primary">
                <Info className="size-3.5" /> What this search does not show
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                It never shows patient identity, prescriptions, donor phone numbers, donor
                addresses or real-time guaranteed stock. Compatibility is advisory; the
                treating hospital and blood bank confirm final issue.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                <Search className="size-3.5 text-primary" /> Need a compatible alternative?
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                A+ patients may receive O−/O+ red cells in specific clinical situations, while
                plasma follows donor-antibody rules (AB plasma is the universal plasma donor).
                Authorized staff use the rules-based matching panel on each request; do not
                self-allocate based on group labels.
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
