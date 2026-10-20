import { SiteFooter } from "@/components/lifelink/SiteFooter";
import { SiteHeader } from "@/components/lifelink/SiteHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { dashboardPathForRole, hasDashboardRole, ROLE_CARDS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  Droplets,
  HeartHandshake,
  Hospital,
  LockKeyhole,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { Link } from "react-router";

const icons = {
  donor: HeartHandshake,
  requestor: Droplets,
  red_cross: Building2,
  hospital: Hospital,
} as const;

const accents = {
  crimson: "bg-primary/8 text-primary border-primary/20",
  navy: "bg-foreground/[0.05] text-foreground border-foreground/15",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
} as const;

export default function SignupRole() {
  const { isAuthenticated, user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,oklch(0.96_0.03_22),transparent_35%),radial-gradient(circle_at_95%_15%,oklch(0.95_0.025_190),transparent_30%)]" />
        <div aria-hidden className="absolute inset-0 bg-grid opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-2xl"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.055] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
              <UserRound className="size-3" />
              Step 1 of 2 · Choose your role
            </span>
            <h1 className="mt-5 text-balance font-display text-[36px] font-extrabold leading-[1.05] tracking-tight sm:text-[46px]">
              How will you use <span className="text-primary">LifeLink?</span>
            </h1>
            <p className="mt-4 max-w-xl text-[14px] leading-7 text-muted-foreground">
              Your role determines the workspace, permissions and data you can access.
              The backend validates every role assignment — it never trusts the browser
              selection alone.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-[11.5px] leading-5 text-muted-foreground">
              <LockKeyhole className="size-4 shrink-0 text-primary" />
              Donor and requestor accounts are self-service. Red Cross and hospital
              accounts register their organization during sign-up, linked on the server
              to your verified email.
            </div>
            {isAuthenticated && (
              <p className="mt-3 text-[11.5px] text-muted-foreground">
                Signed in as <strong className="text-foreground">{user?.name ?? user?.email ?? "your account"}</strong>.{" "}
                {hasDashboardRole(user?.role) ? (
                  <>
                    You can continue with a role, or{" "}
                    <Link to={dashboardPathForRole(user?.role)} className="font-semibold text-primary hover:underline">
                      open your dashboard
                    </Link>.
                  </>
                ) : (
                  "Choose a role below to finish setting up your account."
                )}
              </p>
            )}
          </motion.div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {ROLE_CARDS.map((card, index) => {
              const Icon = icons[card.role as keyof typeof icons] ?? Stethoscope;
              return (
                <motion.div
                  key={card.role}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.08 * index }}
                >
                  <div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/25 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <span className={cn("flex size-11 items-center justify-center rounded-2xl border", accents[card.accent])}>
                        <Icon className="size-5" />
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
                        {card.tagline}
                      </span>
                    </div>
                    <h2 className="mt-4 text-[18px] font-bold">{card.title}</h2>
                    <p className="mt-1.5 flex-1 text-[12.5px] leading-6 text-muted-foreground">
                      {card.description}
                    </p>
                    <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
                      <Link
                        to={dashboardPathForRole(card.role)}
                        className="text-[11px] font-medium text-muted-foreground hover:text-primary"
                      >
                        View dashboard
                      </Link>
                      <Button asChild size="sm" className="gap-1.5">
                        <Link to={card.href}>
                          Continue
                          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-[11.5px] leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-600" />
              Every account is verified by email code. Staff accounts are linked to a
              verified organization and every inventory or status change is audit logged.
            </p>
            <Button asChild variant="ghost" size="sm" className="w-fit gap-1.5 text-[11.5px]">
              <Link to="/login">Already registered? Log in <ArrowRight className="size-3" /></Link>
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
