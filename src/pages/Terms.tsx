import { SiteFooter } from "@/components/lifelink/SiteFooter";
import { SiteHeader } from "@/components/lifelink/SiteHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
          <ShieldCheck className="size-3.5" />
          Platform terms
        </div>
        <h1 className="mt-3 font-display text-[38px] font-extrabold leading-tight tracking-tight">
          Terms of use
        </h1>
        <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
          By using LifeLink you agree to use it only for lawful, genuine coordination of blood
          donation and requests. These terms are a prototype and require review by legal and
          clinical governance teams before production use.
        </p>

        <Alert id="safety" className="mt-6 border-primary/20 bg-primary/[0.04]">
          <AlertTriangle className="size-4 text-primary" />
          <AlertDescription className="text-[12px] leading-6">
            <strong className="text-foreground">Medical safety disclaimer.</strong> LifeLink
            is an advisory coordination platform, not a medical provider, blood bank or
            emergency service. Donor eligibility, blood compatibility, screening,
            cross-matching, allocation and final issue are decisions of qualified medical
            professionals. Never delay emergency care to use this platform. Call local
            emergency services for an immediate medical emergency.
          </AlertDescription>
        </Alert>

        <div className="mt-8 space-y-7">
          {[
            {
              title: "1. Accounts and roles",
              body: "You must provide accurate information and only create an account for yourself or an organization you are authorized to represent. Donor and requestor roles are self-service. Red Cross and hospital roles require an organization authorization code validated by the server. LifeLink may suspend accounts that misrepresent identity, authorization or clinical need.",
            },
            {
              title: "2. Genuine requests only",
              body: "Blood requests must relate to a genuine patient need and be submitted by the patient, a family member or an authorized representative. Do not submit false emergencies, duplicate requests, or requests intended to harvest donor information. Requests can be rejected or cancelled, and suspicious activity may be reported.",
            },
            {
              title: "3. Clinical responsibility",
              body: "LifeLink does not guarantee that reported stock is available, compatible or suitable. Compatibility shown by the platform is a rules-based advisory based on ABO/Rh and component considerations. Cross-matching, infection screening, patient-specific factors and clinician judgement always take precedence.",
            },
            {
              title: "4. Donor eligibility",
              body: "Registering as a donor does not establish eligibility. Age, weight, haemoglobin, medication, travel, health history and other factors are assessed by qualified staff at the donation center. Donation-interval guidance in the dashboard is advisory and may differ from local policy.",
            },
            {
              title: "5. Privacy and acceptable use",
              body: "Only access records you are authorized to view. Do not scrape, enumerate or publicly disclose donor, patient or prescription information. Do not attempt to bypass role checks, rate limits or file validation. Do not upload malware or unlawful content. Report suspected data exposure through the configured contact.",
            },
            {
              title: "6. Inventory and status accuracy",
              body: "Authorized staff must record only verified stock movements and status changes. LifeLink records reservations, dispatches, receipts and donations transactionally and in an audit trail. Intentional misstatement of stock, receipt or verification status is prohibited.",
            },
            {
              title: "7. Demo Data",
              body: "Sample records are visibly marked Demo Data. They are not live verified inventory and must not be used for real clinical coordination. Demo credentials or authorization codes must be replaced before production deployment.",
            },
            {
              title: "8. Availability and limitation of liability",
              body: "This prototype is provided as-is for demonstration and evaluation. To the maximum extent permitted by law, the project authors are not liable for clinical decisions, unavailable stock, service interruptions or losses arising from use of the prototype. Production deployment requires independent security, clinical and legal review.",
            },
            {
              title: "9. Changes",
              body: "These terms may be updated as the platform evolves. Continued use after an update means you accept the revised terms. Material changes should be communicated to registered users in a production deployment.",
            },
          ].map((section) => (
            <section key={section.title}>
              <h2 className="text-[16px] font-bold tracking-tight">{section.title}</h2>
              <p className="mt-2 text-[12.5px] leading-6 text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-border pt-6 text-[12px]">
          <Link to="/privacy" className="font-semibold text-primary hover:underline">Privacy policy</Link>
          <Link to="/#contact" className="font-semibold text-primary hover:underline">Contact us</Link>
          <Link to="/" className="text-muted-foreground hover:text-primary">Back to home</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
