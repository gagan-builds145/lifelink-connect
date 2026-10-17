import type { ReactNode } from "react";
import { AuthCard } from "./AuthCard";
import { AuthShell } from "./AuthShell";
import { SignupGate } from "./SignupGate";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

export function SignupFrame({
  eyebrow,
  title,
  description,
  asideTitle,
  asideBody,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  asideTitle: string;
  asideBody: string;
  children: ReactNode;
}) {
  return (
    <AuthShell variant="video" eyebrow={eyebrow} asideTitle={asideTitle} asideBody={asideBody}>
      <AuthCard>
        <Link
          to="/signup"
          className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3" />
          Change role
        </Link>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-display text-[28px] font-extrabold leading-tight">
          {title}
        </h1>
        <p className="mt-2 text-[12.5px] leading-6 text-muted-foreground">{description}</p>
        <div className="mt-5">
          <SignupGate>{children}</SignupGate>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
