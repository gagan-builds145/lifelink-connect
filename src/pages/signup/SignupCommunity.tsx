import { SignupFrame } from "@/components/lifelink/SignupFrame";
import { Button } from "@/components/ui/button";
import { ArrowRight, Droplets, HeartHandshake, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

const choices = [
  {
    href: "/signup/donor",
    title: "I want to donate",
    description:
      "Add a donor profile with your blood group, availability and contact-sharing preferences.",
    icon: HeartHandshake,
  },
  {
    href: "/signup/requestor",
    title: "I need blood",
    description:
      "Add requestor access so you can submit and track a verified blood request for a patient.",
    icon: Droplets,
  },
] as const;

export default function SignupCommunity() {
  return (
    <SignupFrame
      eyebrow="Community registration"
      title="One account for giving and receiving"
      description="Donor and blood requestor capabilities now share a single verified account. Start with either profile and add the other whenever you need it."
      asideTitle="One role. Both sides of the network."
      asideBody="Whether you are donating or requesting blood, your identity, privacy settings and verification stay in one place."
    >
      <div className="space-y-3">
        {choices.map((choice) => {
          const Icon = choice.icon;
          return (
            <div
              key={choice.href}
              className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/25"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/8 text-primary">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-bold">{choice.title}</h2>
                  <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                    {choice.description}
                  </p>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" className="mt-3 w-full justify-between gap-2">
                <Link to={choice.href}>
                  Continue
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          );
        })}

        <div className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-[10.5px] leading-5 text-teal-900">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Both profiles use the same server-verified role. Neither profile can be used to
            access hospital, Red Cross or administrator controls.
          </p>
        </div>
      </div>
    </SignupFrame>
  );
}
