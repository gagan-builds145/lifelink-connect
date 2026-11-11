import { SiteFooter } from "@/components/lifelink/SiteFooter";
import { SiteHeader } from "@/components/lifelink/SiteHeader";
import { Button } from "@/components/ui/button";
import { dashboardPathForRole, ROLE_CARDS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  Droplets,
  HeartHandshake,
  Hospital,
  Stethoscope,
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
            <h1 className="text-balance font-display text-[36px] font-extrabold leading-[1.05] tracking-tight sm:text-[46px]">
              Choose Your <span className="text-primary">Role</span>
            </h1>
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

          <div className="mt-8 flex justify-center sm:justify-end">
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
