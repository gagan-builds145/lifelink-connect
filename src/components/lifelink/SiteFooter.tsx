import { ArrowUpRight, HeartPulse, MapPin, Phone, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { LifeLinkLogo } from "./Logo";

const columns = [
  {
    title: "Platform",
    links: [
      { label: "Find blood", href: "/blood-search" },
      { label: "Donation camps", href: "/donation-camps" },
      { label: "Become a donor", href: "/signup/donor" },
      { label: "Request blood", href: "/auth?returnTo=%2Frequestor%2Fdashboard" },
    ],
  },
  {
    title: "Network",
    links: [
      { label: "Red Cross dashboard", href: "/red-cross/dashboard" },
      { label: "Hospital dashboard", href: "/hospital/dashboard" },
      { label: "How matching works", href: "/#how-it-works" },
      { label: "Our services", href: "/#services" },
    ],
  },
  {
    title: "Legal & safety",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of use", href: "/terms" },
      { label: "Safety disclaimer", href: "/terms#safety" },
      { label: "About LifeLink", href: "/#about" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-[oklch(0.21_0.035_258)] text-white/80">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.35fr_2fr]">
          <div>
            <LifeLinkLogo onDark />
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/60">
              One shared, verified blood network connecting donors, requestors,
              Red Cross branches, hospitals and participating blood banks.
            </p>
            <div className="mt-6 space-y-2.5 text-sm">
              <p className="flex items-center gap-2.5 text-white/70">
                <Phone className="size-4 text-primary" />
                +91 20 2550 1000 <span className="text-white/35">(demo contact)</span>
              </p>
              <p className="flex items-center gap-2.5 text-white/70">
                <MapPin className="size-4 text-primary" />
                Pune &amp; Mumbai, Maharashtra, India
              </p>
              <p className="flex items-center gap-2.5 text-white/70">
                <HeartPulse className="size-4 text-primary" />
                Emergency coordination: contact the nearest verified hospital
              </p>
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {columns.map((column) => (
              <div key={column.title}>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
                  {column.title}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.href}
                        className="group inline-flex items-center gap-1 text-[13.5px] text-white/70 transition-colors hover:text-white"
                      >
                        {link.label}
                        <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 text-[12px] leading-5 text-white/45 lg:flex-row lg:items-start lg:justify-between">
          <p className="max-w-3xl">
            <strong className="text-white/70">Safety notice:</strong> LifeLink is
            an advisory coordination platform, not a medical provider. Blood
            compatibility, donor eligibility, screening and final issue are
            confirmed only by qualified medical professionals. Demo Data is
            clearly labelled and is never live verified inventory.
          </p>
          <p className="flex shrink-0 items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            © {new Date().getFullYear()} LifeLink
          </p>
        </div>
      </div>
    </footer>
  );
}
