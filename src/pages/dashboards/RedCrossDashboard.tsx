import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import {
  BloodGroupChip,
  DemoBadge,
  DemoDataBanner,
  EmptyState,
  StatCard,
  StatusBadge,
  UrgencyBadge,
} from "@/components/lifelink/ui-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  BLOOD_GROUPS,
  CITIES,
  COMPONENTS,
  COMPONENT_LABELS,
  STATUS_LABELS,
  URGENCIES,
  URGENCY_LABELS,
  formatDate,
  formatDateTime,
  formatRelative,
  type Component,
  type RequestStatus,
} from "@/lib/blood";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarHeart,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Droplets,
  FileClock,
  History,
  Info,
  Loader2,
  MapPin,
  PackagePlus,
  Plus,
  Search,
  ShieldCheck,
  Siren,
  Sparkles,
  Truck,
  UserRound,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type Tab = "overview" | "requests" | "inventory" | "camps" | "donors" | "audit";

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function AddStockDialog({
  open,
  onOpenChange,
  organizationName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationName: string;
}) {
  const addStock = useMutation(api.inventory.addStock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    bloodGroup: "O+",
    component: "red_cells" as Component,
    unitsAvailable: "5",
    collectionDate: today(),
    expiryDate: plusDays(35),
    storageLocation: "Cold room A · 2–6 °C",
    batchRef: "",
    lowStockThreshold: "3",
  });

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await addStock({
        bloodGroup: form.bloodGroup as (typeof BLOOD_GROUPS)[number],
        component: form.component,
        unitsAvailable: Number(form.unitsAvailable),
        collectionDate: form.collectionDate,
        expiryDate: form.expiryDate,
        storageLocation: form.storageLocation,
        batchRef: form.batchRef.trim() || undefined,
        lowStockThreshold: Number(form.lowStockThreshold),
      });
      toast.success("Stock added", {
        description: "The collection and inventory ledger were updated in one transaction.",
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add stock.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add verified stock</DialogTitle>
          <DialogDescription>
            This creates a verified batch for {organizationName}. Every addition is written
            to the audit log and movement ledger.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Blood group</Label>
            <Select value={form.bloodGroup} onValueChange={(v) => setForm((p) => ({ ...p, bloodGroup: v }))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Component</Label>
            <Select value={form.component} onValueChange={(v) => setForm((p) => ({ ...p, component: v as Component }))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{COMPONENTS.map((c) => <SelectItem key={c} value={c}>{COMPONENT_LABELS[c]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock-units">Units available</Label>
            <Input id="stock-units" type="number" min={1} max={20} value={form.unitsAvailable} onChange={(e) => setForm((p) => ({ ...p, unitsAvailable: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock-threshold">Low-stock threshold</Label>
            <Input id="stock-threshold" type="number" min={0} value={form.lowStockThreshold} onChange={(e) => setForm((p) => ({ ...p, lowStockThreshold: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock-collected">Collection date</Label>
            <Input id="stock-collected" type="date" max={today()} value={form.collectionDate} onChange={(e) => setForm((p) => ({ ...p, collectionDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock-expiry">Expiry date</Label>
            <Input id="stock-expiry" type="date" min={today()} value={form.expiryDate} onChange={(e) => setForm((p) => ({ ...p, expiryDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="stock-location">Storage location</Label>
            <Input id="stock-location" value={form.storageLocation} onChange={(e) => setForm((p) => ({ ...p, storageLocation: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="stock-batch">Batch reference (optional)</Label>
            <Input id="stock-batch" value={form.batchRef} onChange={(e) => setForm((p) => ({ ...p, batchRef: e.target.value }))} placeholder="Auto-generated if left blank" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
            Add to inventory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  batch,
  onClose,
  onDone,
}: {
  batch: { _id: Id<"inventory">; bloodGroup: string; component: string; batchRef: string; free: number } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const recordMovement = useMutation(api.inventory.recordMovement);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<"issue" | "expiry" | "collection">("issue");
  const [units, setUnits] = useState("1");
  const [note, setNote] = useState("");

  return (
    <Dialog open={batch != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record stock movement</DialogTitle>
          <DialogDescription>
            {batch ? `${batch.batchRef} · ${batch.bloodGroup} ${COMPONENT_LABELS[batch.component as Component] ?? batch.component} · ${batch.free} free unit(s)` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Movement type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="issue">Issue / manual removal</SelectItem>
                <SelectItem value="expiry">Expired units removed</SelectItem>
                <SelectItem value="collection">Additional collection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="move-units">Units</Label>
            <Input id="move-units" type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="move-note">Reason / note</Label>
            <Textarea id="move-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required for the audit trail" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !batch || note.trim().length < 3}
            className="gap-2"
            onClick={async () => {
              if (!batch) return;
              setBusy(true);
              try {
                await recordMovement({ inventoryId: batch._id, type, units: Number(units), note });
                toast.success("Movement recorded");
                onClose();
                onDone();
              } catch (err) {
                toast.error("Could not record movement", { description: err instanceof Error ? err.message : "Try again." });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Droplets className="size-4" />}
            Record movement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createCamp = useMutation(api.camps.createCamp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    venue: "",
    city: "Pune",
    date: plusDays(14),
    startTime: "09:00",
    endTime: "15:00",
    capacity: "60",
    organizer: "",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Publish a donation camp</DialogTitle>
          <DialogDescription>Published camps appear on the public camps page with live capacity count.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="camp-title">Camp title</Label>
            <Input id="camp-title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Community donation drive" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="camp-desc">Description</Label>
            <Textarea id="camp-desc" rows={2} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-date">Date</Label>
            <Input id="camp-date" type="date" min={today()} value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-capacity">Capacity</Label>
            <Input id="camp-capacity" type="number" min={5} max={1000} value={form.capacity} onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-start">Start time</Label>
            <Input id="camp-start" type="time" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-end">End time</Label>
            <Input id="camp-end" type="time" value={form.endTime} onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="camp-venue">Venue</Label>
            <Input id="camp-venue" value={form.venue} onChange={(e) => setForm((p) => ({ ...p, venue: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>City</Label>
            <Select value={form.city} onValueChange={(v) => setForm((p) => ({ ...p, city: v }))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="camp-organizer">Organizer</Label>
            <Input id="camp-organizer" value={form.organizer} onChange={(e) => setForm((p) => ({ ...p, organizer: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy}
            className="gap-2"
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await createCamp({
                  title: form.title,
                  description: form.description,
                  venue: form.venue,
                  city: form.city,
                  date: form.date,
                  startTime: form.startTime,
                  endTime: form.endTime,
                  capacity: Number(form.capacity),
                  organizer: form.organizer,
                });
                toast.success("Camp published");
                onOpenChange(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not publish camp.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarHeart className="size-4" />}
            Publish camp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampRegistrationsDialog({
  camp,
  onClose,
}: {
  camp: { _id: Id<"bloodCamps">; title: string } | null;
  onClose: () => void;
}) {
  const registrations = useQuery(
    api.camps.registrationsForCamp,
    camp ? { campId: camp._id } : "skip",
  );
  const recordDonation = useMutation(api.camps.recordCampDonation);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <Dialog open={camp != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Camp registrations</DialogTitle>
          <DialogDescription>{camp?.title ?? ""} · record a donation only after on-site screening.</DialogDescription>
        </DialogHeader>
        {registrations === undefined ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading registrations…
          </div>
        ) : registrations.length === 0 ? (
          <EmptyState icon={Users} title="No registrations yet" description="Registrations from donors appear here." />
        ) : (
          <div className="space-y-2">
            {registrations.map((reg) => (
              <div key={reg._id} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[12px] font-semibold">{reg.name}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {reg.donorId ?? "No donor profile"} · {reg.bloodGroup ?? "—"} · {reg.phone ?? "contact protected"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[9.5px] font-bold uppercase text-muted-foreground">{reg.status}</span>
                  {reg.status === "registered" && (
                    <Button
                      size="sm"
                      className="h-8 text-[10.5px]"
                      disabled={busy === reg._id}
                      onClick={async () => {
                        setBusy(reg._id);
                        try {
                          await recordDonation({
                            campId: camp!._id,
                            registrationId: reg._id,
                            component: "whole_blood",
                            units: 1,
                          });
                          toast.success("Donation recorded");
                        } catch (err) {
                          toast.error("Could not record donation", { description: err instanceof Error ? err.message : "Try again." });
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === reg._id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                      Record 1 unit
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordDonationDialog({
  donor,
  onClose,
}: {
  donor: { _id: Id<"donorProfiles">; donorId: string; fullName: string; bloodGroup: string } | null;
  onClose: () => void;
}) {
  const recordDonation = useMutation(api.donors.recordDonation);
  const [busy, setBusy] = useState(false);
  const [component, setComponent] = useState<Component>("whole_blood");
  const [units, setUnits] = useState("1");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");

  return (
    <Dialog open={donor != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a donation</DialogTitle>
          <DialogDescription>
            {donor ? `${donor.donorId} · ${donor.fullName} · ${donor.bloodGroup}` : ""}. The 90-day interval is checked server-side.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Component</Label>
            <Select value={component} onValueChange={(v) => setComponent(v as Component)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{COMPONENTS.map((c) => <SelectItem key={c} value={c}>{COMPONENT_LABELS[c]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="donation-units">Units</Label>
              <Input id="donation-units" type="number" min={1} max={2} value={units} onChange={(e) => setUnits(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="donation-date">Date</Label>
              <Input id="donation-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="donation-note">Note (optional)</Label>
            <Textarea id="donation-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            className="gap-2"
            onClick={async () => {
              if (!donor) return;
              setBusy(true);
              try {
                await recordDonation({
                  donorProfileId: donor._id,
                  component,
                  units: Number(units),
                  donationDate: date,
                  note: note.trim() || undefined,
                });
                toast.success("Donation recorded");
                onClose();
              } catch (err) {
                toast.error("Could not record donation", { description: err instanceof Error ? err.message : "Try again." });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Record donation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RedCrossDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [windowDays, setWindowDays] = useState(30);
  const [requestFilter, setRequestFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [requestSearch, setRequestSearch] = useState("");
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [moveBatch, setMoveBatch] = useState<{ _id: Id<"inventory">; bloodGroup: string; component: string; batchRef: string; free: number } | null>(null);
  const [campOpen, setCampOpen] = useState(false);
  const [campRegs, setCampRegs] = useState<{ _id: Id<"bloodCamps">; title: string } | null>(null);
  const [donationDonor, setDonationDonor] = useState<{ _id: Id<"donorProfiles">; donorId: string; fullName: string; bloodGroup: string } | null>(null);
  const [donorGroup, setDonorGroup] = useState("all");
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);

  const me = useQuery(api.profiles.me);
  const analytics = useQuery(api.stats.staffAnalytics, { windowDays });
  const alerts = useQuery(api.inventory.alerts);
  const requests = useQuery(api.requests.listForStaff, {});
  const inventory = useQuery(api.inventory.listForOrg, {});
  const transactions = useQuery(api.inventory.transactions, {});
  const camps = useQuery(api.camps.listForOrg, {});
  const donors = useQuery(api.donors.directory, {
    bloodGroup: donorGroup === "all" ? undefined : (donorGroup as (typeof BLOOD_GROUPS)[number]),
  });
  const audit = useQuery(api.stats.auditTrail, { limit: 60 });
  const updateStatus = useMutation(api.requests.updateStatus);
  const updateCampStatus = useMutation(api.camps.updateCampStatus);

  const org = me?.organization;
  const demoPresent = analytics?.demoDataPresent || (requests ?? []).some((r) => r.isDemo);

  const filteredRequests = useMemo(() => {
    const search = requestSearch.trim().toLowerCase();
    return (requests ?? [])
      .filter((r) => (requestFilter === "all" ? true : r.status === requestFilter))
      .filter((r) => (urgencyFilter === "all" ? true : r.urgency === urgencyFilter))
      .filter((r) => (search ? [r.requestId, r.hospitalName, r.city, r.patientRef].join(" ").toLowerCase().includes(search) : true));
  }, [requests, requestFilter, urgencyFilter, requestSearch]);

  const navItems = [
    { key: "overview", label: "Overview & analytics", icon: BarChart3 },
    { key: "requests", label: "Request verification", icon: ClipboardCheck, badge: analytics?.kpis.pendingVerification },
    { key: "inventory", label: "Blood inventory", icon: Droplets, badge: alerts?.lowStock.length },
    { key: "camps", label: "Donation camps", icon: CalendarHeart },
    { key: "donors", label: "Donors & donations", icon: Users },
    { key: "audit", label: "Audit trail", icon: FileClock },
  ];

  const startReview = async (id: Id<"bloodRequests">, requestId: string) => {
    setVerifyBusy(id);
    try {
      await updateStatus({ id, status: "under_verification", note: "Document review started by Red Cross staff." });
      toast.success(`Request ${requestId} moved to verification`);
    } catch (err) {
      toast.error("Could not update request", { description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setVerifyBusy(null);
    }
  };

  return (
    <DashboardShell
      roleLabel="Red Cross Society"
      roleKey={org?.orgId ?? "Staff workspace"}
      title="Red Cross dashboard"
      subtitle={
        org
          ? `${org.name} · verified ${org.city} branch. Requests, inventory, camps and donor records share one database with hospitals and requestors.`
          : "Your branch profile is being prepared."
      }
      items={navItems}
      active={tab}
      onSelect={(key) => setTab(key as Tab)}
      demoData={demoPresent}
      accentIcon={Building2}
      quickLinks={[
        { label: "Public blood search", href: "/blood-search", icon: Search },
        { label: "Public camps page", href: "/donation-camps", icon: CalendarHeart },
        { label: "Network organizations", href: "/signup", icon: Building2 },
      ]}
    >
      {demoPresent && <DemoDataBanner />}

      {tab === "overview" && (
        <div className="mt-4 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Registered donors" value={analytics?.kpis.donors ?? "—"} hint="Network-wide donor profiles" icon={Users} />
            <StatCard label="Verified available units" value={analytics?.kpis.verifiedUnits ?? "—"} hint="Unexpired, unreserved, verified batches" icon={Droplets} tone="teal" />
            <StatCard label="Pending verification" value={analytics?.kpis.pendingVerification ?? "—"} hint="Requests waiting for review" icon={Clock3} tone="amber" />
            <StatCard label="Approved" value={analytics?.kpis.approved ?? "—"} hint="Reserved or ready to dispatch" icon={CheckCircle2} />
            <StatCard label="Fulfilled" value={analytics?.kpis.fulfilled ?? "—"} hint="Completed across the network" icon={ShieldCheck} tone="primary" />
            <StatCard label="Upcoming camps" value={analytics?.kpis.upcomingCamps ?? "—"} hint="Published and open" icon={CalendarHeart} />
          </div>

          {alerts && (alerts.lowStock.length > 0 || alerts.expiring.length > 0) && (
            <div className="grid gap-3 lg:grid-cols-2">
              <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <h2 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-amber-900">
                  <AlertTriangle className="size-3.5" /> Low-stock alerts
                </h2>
                <div className="mt-2.5 space-y-1.5">
                  {alerts.lowStock.slice(0, 4).map((item) => (
                    <p key={item._id} className="flex items-center justify-between gap-2 rounded-lg bg-white/60 px-2.5 py-1.5 text-[11px]">
                      <span className="font-semibold text-amber-950">{item.bloodGroup} · {COMPONENT_LABELS[item.component as Component]}</span>
                      <span className="text-amber-800">{item.free} free / threshold {item.lowStockThreshold}</span>
                    </p>
                  ))}
                  {alerts.lowStock.length === 0 && <p className="text-[11px] text-amber-800">No low-stock batches.</p>}
                </div>
              </section>
              <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
                <h2 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-rose-900">
                  <Clock3 className="size-3.5" /> Expiring within 10 days
                </h2>
                <div className="mt-2.5 space-y-1.5">
                  {alerts.expiring.slice(0, 4).map((item) => (
                    <p key={item._id} className="flex items-center justify-between gap-2 rounded-lg bg-white/60 px-2.5 py-1.5 text-[11px]">
                      <span className="font-semibold text-rose-950">{item.bloodGroup} · {COMPONENT_LABELS[item.component as Component]}</span>
                      <span className="text-rose-800">expires {formatDate(item.expiryDate)}</span>
                    </p>
                  ))}
                  {alerts.expiring.length === 0 && <p className="text-[11px] text-rose-800">No batches near expiry.</p>}
                </div>
              </section>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-[14px] font-bold">Request &amp; donation trend</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Shared database activity, last {windowDays} days.</p>
                </div>
                <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
                  <SelectTrigger className="h-8 w-[130px] text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="14">Last 14 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="60">Last 60 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-4 h-[220px] w-full">
                {analytics ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.trend} barGap={2}>
                      <CartesianGrid vertical={false} stroke="oklch(0.9 0.01 250)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={24} />
                      <ChartTooltip
                        contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid oklch(0.9 0.01 250)" }}
                        labelStyle={{ fontWeight: 700 }}
                      />
                      <Bar dataKey="requests" name="Requests" fill="oklch(0.525 0.205 24)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="donations" name="Donations" fill="oklch(0.38 0.07 255)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading analytics…
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-primary" /> Requests created</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-[oklch(0.38_0.07_255)]" /> Donations recorded</span>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[14px] font-bold">Request status mix</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">All shared requests in scope.</p>
              <div className="mt-3 space-y-2.5">
                {analytics?.statusCounts.map((item) => {
                  const total = analytics.statusCounts.reduce((s, x) => s + x.count, 0) || 1;
                  return (
                    <div key={item.status}>
                      <div className="flex items-center justify-between text-[10.5px]">
                        <span className="text-muted-foreground">{STATUS_LABELS[item.status as RequestStatus]}</span>
                        <span className="font-semibold">{item.count}</span>
                      </div>
                      <Progress value={(item.count / total) * 100} className="mt-1 h-1.5" />
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[14px] font-bold">Verified stock by group</h2>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {analytics?.groupStock.map((item) => (
                  <div key={item.bloodGroup} className="rounded-xl border border-border bg-background p-2.5 text-center">
                    <p className="font-display text-[13px] font-extrabold text-primary">{item.bloodGroup}</p>
                    <p className="mt-0.5 text-[15px] font-bold">{item.units}</p>
                    <p className="text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground">units</p>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-bold">Recent audit events</h2>
                <Button variant="ghost" size="sm" className="h-7 text-[10.5px]" onClick={() => setTab("audit")}>View trail</Button>
              </div>
              <div className="mt-3 space-y-2">
                {(audit ?? []).slice(0, 5).map((entry) => (
                  <div key={entry._id} className="flex items-start gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold">{entry.action}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{entry.detail}</p>
                    </div>
                    <span className="shrink-0 text-[9px] text-muted-foreground">{formatRelative(entry.createdAt)}</span>
                  </div>
                ))}
                {audit && audit.length === 0 && <p className="py-4 text-center text-[11px] text-muted-foreground">No audit entries yet.</p>}
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-[14px] font-bold">Request verification queue</h2>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  Shared hospital and requestor requests. Review the document, then verify,
                  reject with a reason, reserve stock and dispatch from the request page.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={requestSearch} onChange={(e) => setRequestSearch(e.target.value)} placeholder="Search ID, hospital, city" className="h-9 w-[200px] pl-8 text-[11.5px]" />
                </div>
                <Select value={requestFilter} onValueChange={setRequestFilter}>
                  <SelectTrigger className="h-9 w-[150px] text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {["pending", "under_verification", "approved", "dispatched", "received", "fulfilled", "rejected", "cancelled"].map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s as RequestStatus]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
                  <SelectTrigger className="h-9 w-[130px] text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All urgency</SelectItem>
                    {URGENCIES.map((u) => <SelectItem key={u} value={u}>{URGENCY_LABELS[u]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {requests === undefined ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading requests…</div>
            ) : filteredRequests.length === 0 ? (
              <EmptyState icon={ClipboardCheck} title="No requests in this view" description="Adjust the filters, or wait for a new verified request to arrive." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request</TableHead>
                      <TableHead>Requirement</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Needed by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Next action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequests.map((r) => (
                      <TableRow key={r._id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <BloodGroupChip group={r.bloodGroup} size="sm" />
                            <div>
                              <p className="text-[11.5px] font-semibold">{r.requestId}</p>
                              <p className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
                                {r.isDemo && <DemoBadge className="scale-90" />}
                                {formatRelative(r.createdAt)}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-[11px] font-medium">{COMPONENT_LABELS[r.component as Component]}</p>
                          <p className="text-[9.5px] text-muted-foreground">{r.units} unit(s)</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-[11px]">{r.hospitalName}</p>
                          <p className="text-[9.5px] text-muted-foreground">{r.city} · {r.source}</p>
                        </TableCell>
                        <TableCell className="text-[10.5px] text-muted-foreground">{formatDateTime(r.requiredBy)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={r.status} />
                            <UrgencyBadge urgency={r.urgency} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {r.status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px]"
                                disabled={verifyBusy === r._id}
                                onClick={() => void startReview(r._id as Id<"bloodRequests">, r.requestId)}
                              >
                                {verifyBusy === r._id ? <Loader2 className="size-3 animate-spin" /> : <FileClock className="size-3" />}
                                Review
                              </Button>
                            )}
                            <Button asChild size="sm" variant={r.status === "pending" ? "ghost" : "default"} className="h-7 text-[10px]">
                              <Link to={`/requests/${r._id}`}>Open</Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "inventory" && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[14px] font-bold">Shared blood inventory</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Verified batches only. Reservations are transactional; negative inventory is impossible.
              </p>
            </div>
            <Button size="sm" className="w-fit gap-1.5" onClick={() => setAddStockOpen(true)}>
              <Plus className="size-3.5" /> Add stock
            </Button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {inventory === undefined ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading inventory…</div>
            ) : inventory.length === 0 ? (
              <EmptyState icon={Droplets} title="No inventory batches yet" description="Add the first verified batch after a collection, or load demo data to explore the screens." action={<Button size="sm" onClick={() => setAddStockOpen(true)}>Add stock</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch / group</TableHead>
                      <TableHead>Component</TableHead>
                      <TableHead>Stock</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Storage</TableHead>
                      <TableHead>Flags</TableHead>
                      <TableHead className="text-right">Movement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map((item) => (
                      <TableRow key={item._id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <BloodGroupChip group={item.bloodGroup} size="sm" />
                            <div>
                              <p className="text-[11px] font-semibold">{item.batchRef}</p>
                              <p className="text-[9.5px] text-muted-foreground">{item.verified ? "Verified" : "Unverified"} · updated {formatRelative(item.lastUpdated)}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-[11px]">{COMPONENT_LABELS[item.component as Component]}</TableCell>
                        <TableCell>
                          <p className="text-[11px] font-medium">{item.unitsAvailable} total</p>
                          <p className="text-[9.5px] text-muted-foreground">{item.unitsReserved} reserved · {item.free} free</p>
                        </TableCell>
                        <TableCell>
                          <p className={`text-[11px] ${item.isExpiring || item.isExpired ? "font-semibold text-primary" : ""}`}>{formatDate(item.expiryDate)}</p>
                          <p className="text-[9.5px] text-muted-foreground">{item.isExpired ? "expired" : `${item.expiryDays} day(s)`}</p>
                        </TableCell>
                        <TableCell className="text-[10.5px] text-muted-foreground">{item.storageLocation}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.isLowStock && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-bold text-amber-800">LOW</span>}
                            {item.isExpiring && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[8.5px] font-bold text-rose-800">EXPIRING</span>}
                            {item.isExpired && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[8.5px] font-bold text-rose-900">EXPIRED</span>}
                            {!item.isLowStock && !item.isExpiring && !item.isExpired && <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[8.5px] font-bold text-teal-800">OK</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setMoveBatch(item)}>Record</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border p-4">
              <h2 className="text-[14px] font-bold">Movement ledger</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">Every collection, reservation, dispatch and adjustment is attributed and timestamped.</p>
            </div>
            {transactions === undefined ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading ledger…</div>
            ) : transactions.length === 0 ? (
              <p className="p-6 text-center text-[11.5px] text-muted-foreground">No movements recorded yet.</p>
            ) : (
              <div className="max-h-[320px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Blood / component</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((t) => (
                      <TableRow key={t._id}>
                        <TableCell className="text-[10.5px] font-semibold uppercase">{t.type}</TableCell>
                        <TableCell className="text-[11px]">{t.units > 0 ? `+${t.units}` : t.units}</TableCell>
                        <TableCell className="text-[10.5px]">{t.bloodGroup} · {COMPONENT_LABELS[t.component as Component]}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-[10.5px] text-muted-foreground">{t.note ?? "—"}</TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">{formatDateTime(t.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "camps" && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[14px] font-bold">Donation camp management</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">Publish camps, monitor registrations and record verified donations on site.</p>
            </div>
            <Button size="sm" className="w-fit gap-1.5" onClick={() => setCampOpen(true)}>
              <Plus className="size-3.5" /> Create camp
            </Button>
          </div>
          {camps === undefined ? (
            <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading camps…</div>
          ) : camps.length === 0 ? (
            <EmptyState icon={CalendarHeart} title="No camps created yet" description="Publish a camp to open public registration and staff-side donation recording." action={<Button size="sm" onClick={() => setCampOpen(true)}>Create camp</Button>} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {camps.map((camp) => (
                <div key={camp._id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-[13px] font-bold">{camp.title}</h3>
                        {camp.isDemo && <DemoBadge />}
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">{camp.venue}, {camp.city}</p>
                    </div>
                    <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">{camp.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/30 p-2">
                      <p className="text-[13px] font-bold">{formatDate(camp.date)}</p>
                      <p className="text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">Date</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-2">
                      <p className="text-[13px] font-bold">{camp.registered}/{camp.capacity}</p>
                      <p className="text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">Registered</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-2">
                      <p className="text-[13px] font-bold">{camp.startTime}–{camp.endTime}</p>
                      <p className="text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">Time</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                    <Button size="sm" variant="outline" className="h-8 text-[10.5px]" onClick={() => setCampRegs({ _id: camp._id, title: camp.title })}>
                      Registrations
                    </Button>
                    <Select
                      value={camp.status}
                      onValueChange={async (v) => {
                        try {
                          await updateCampStatus({ campId: camp._id, status: v as "upcoming" | "ongoing" | "completed" | "cancelled" });
                          toast.success("Camp status updated");
                        } catch (err) {
                          toast.error("Could not update camp", { description: err instanceof Error ? err.message : "Try again." });
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 w-[130px] text-[10.5px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upcoming">Upcoming</SelectItem>
                        <SelectItem value="ongoing">Ongoing</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "donors" && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[14px] font-bold">Registered donors</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Contact details are visible only when the donor opted in. The address is never shown.
              </p>
            </div>
            <Select value={donorGroup} onValueChange={setDonorGroup}>
              <SelectTrigger className="h-9 w-[150px] text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All blood groups</SelectItem>
                {BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {donors === undefined ? (
              <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading donors…</div>
            ) : donors.length === 0 ? (
              <EmptyState icon={Users} title="No donor profiles yet" description="Donors appear here after registration. They control availability and contact sharing." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Donor</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead>Interval guidance</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead className="text-right">Record</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {donors.map((donor) => (
                      <TableRow key={donor._id}>
                        <TableCell>
                          <p className="text-[11.5px] font-semibold">{donor.fullName}</p>
                          <p className="text-[9.5px] text-muted-foreground">{donor.donorId}</p>
                        </TableCell>
                        <TableCell><BloodGroupChip group={donor.bloodGroup} size="sm" /></TableCell>
                        <TableCell className="text-[11px]">{donor.city}</TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${donor.available ? "bg-teal-50 text-teal-800" : "bg-muted text-muted-foreground"}`}>
                            {donor.available ? "Available" : "Paused"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <p className="text-[10.5px]">{donor.guidance.label}</p>
                          <p className="text-[9px] text-muted-foreground">{donor.guidance.detail.slice(0, 52)}…</p>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">{donor.phone ?? "Protected"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setDonationDonor(donor)}>Donation</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "audit" && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-[14px] font-bold">Audit trail</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Inventory, request, organization and donation changes. Actor roles are recorded;
              sensitive medical details are intentionally not duplicated here.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card">
            {audit === undefined ? (
              <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading audit log…</div>
            ) : audit.length === 0 ? (
              <EmptyState icon={FileClock} title="No audit events yet" description="Status changes and inventory movements will appear here with their actor role and timestamp." />
            ) : (
              <ScrollArea className="max-h-[560px]">
                <ol className="divide-y divide-border">
                  {audit.map((entry) => (
                    <li key={entry._id} className="flex gap-3 p-4">
                      <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
                        <History className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[11.5px] font-semibold">{entry.action}</p>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">{entry.actorRole}</span>
                          {entry.isDemo && <DemoBadge />}
                        </div>
                        <p className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">{entry.detail}</p>
                        <p className="mt-0.5 text-[9.5px] text-muted-foreground/70">{entry.entityType} · {entry.entityId} · {formatDateTime(entry.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            )}
          </div>
        </div>
      )}

      <AddStockDialog open={addStockOpen} onOpenChange={setAddStockOpen} organizationName={org?.name ?? "your branch"} />
      <MovementDialog batch={moveBatch} onClose={() => setMoveBatch(null)} onDone={() => undefined} />
      <CampDialog open={campOpen} onOpenChange={setCampOpen} />
      <CampRegistrationsDialog camp={campRegs} onClose={() => setCampRegs(null)} />
      <RecordDonationDialog donor={donationDonor} onClose={() => setDonationDonor(null)} />
    </DashboardShell>
  );
}
