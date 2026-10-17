import { SiteFooter } from "@/components/lifelink/SiteFooter";
import { SiteHeader } from "@/components/lifelink/SiteHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Droplets, HeartPulse, Search } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,oklch(0.96_0.03_22),transparent_45%)]" />
        <div aria-hidden className="absolute inset-0 bg-grid opacity-25" />
        <div className="relative mx-auto flex min-h-[62vh] w-full max-w-3xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
          <div className="relative flex size-20 items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-primary/20 pulse-ring" />
            <svg viewBox="0 0 48 48" className="size-16 animate-float-slow" aria-hidden>
              <defs>
                <linearGradient id="notfound-drop" x1="10" y1="4" x2="38" y2="44" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#d4293f" />
                  <stop offset="1" stopColor="#8d1024" />
                </linearGradient>
              </defs>
              <path d="M24 3.5c5.9 8.5 15 17.8 15 26.8a15 15 0 1 1-30 0C9 21.3 18.1 12 24 3.5Z" fill="url(#notfound-drop)" />
              <path d="M20.2 26.1h2.8v-2.8h2.8v2.8h2.8v2.8h-2.8v2.8h-2.8v-2.8h-2.8v-2.8Z" fill="white" />
            </svg>
          </div>
          <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">404 · Page not found</p>
          <h1 className="mt-2 text-balance font-display text-[38px] font-extrabold leading-tight tracking-tight sm:text-[46px]">
            This lead didn't reach a page.
          </h1>
          <p className="mt-3 max-w-md text-[13.5px] leading-6 text-muted-foreground">
            The route may have moved, or the link may be incomplete. The blood network is
            still one click away.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2.5">
            <Button asChild className="gap-2"><Link to="/"><ArrowLeft className="size-4" /> Back to home</Link></Button>
            <Button asChild variant="outline" className="gap-2"><Link to="/blood-search"><Search className="size-4 text-primary" /> Find blood</Link></Button>
            <Button asChild variant="outline" className="gap-2"><Link to="/donation-camps"><HeartPulse className="size-4 text-primary" /> Donation camps</Link></Button>
          </div>
          <p className="mt-6 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <Droplets className="size-3 text-primary" />
            If a link from inside the app is broken, report it through the contact form.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
