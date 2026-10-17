import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireRole } from "@/components/lifelink/RequireRole";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword.tsx"));
const SignupRole = lazy(() => import("./pages/SignupRole.tsx"));
const SignupDonor = lazy(() => import("./pages/signup/SignupDonor.tsx"));
const SignupRequestor = lazy(() => import("./pages/signup/SignupRequestor.tsx"));
const SignupRedCross = lazy(() => import("./pages/signup/SignupRedCross.tsx"));
const SignupHospital = lazy(() => import("./pages/signup/SignupHospital.tsx"));
const DashboardRedirect = lazy(() => import("./pages/DashboardRedirect.tsx"));
const DonorDashboard = lazy(() => import("./pages/dashboards/DonorDashboard.tsx"));
const RequestorDashboard = lazy(() => import("./pages/dashboards/RequestorDashboard.tsx"));
const RedCrossDashboard = lazy(() => import("./pages/dashboards/RedCrossDashboard.tsx"));
const HospitalDashboard = lazy(() => import("./pages/dashboards/HospitalDashboard.tsx"));
const RequestDetail = lazy(() => import("./pages/RequestDetail.tsx"));
const BloodSearch = lazy(() => import("./pages/BloodSearch.tsx"));
const DonationCamps = lazy(() => import("./pages/DonationCamps.tsx"));
const Privacy = lazy(() => import("./pages/Privacy.tsx"));
const Terms = lazy(() => import("./pages/Terms.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

function RouteLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.05]">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Loading LifeLink
      </p>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">LifeLink hit a runtime error</p>
            <p className="mt-2 break-words text-xs text-muted-foreground">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-border p-2 text-left text-[10px] leading-4 text-muted-foreground/80">
                {this.state.stack}
              </pre>
            )}
            <a
              href="/"
              className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              Return to home
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function RouteSyncer() {
  const location = useLocation();

  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname, location.hash]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />

              {/* Authentication */}
              <Route path="/auth" element={<AuthPage redirectAfterAuth="/dashboard" />} />
              <Route path="/login" element={<AuthPage redirectAfterAuth="/dashboard" />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/signup" element={<SignupRole />} />
              <Route path="/signup/donor" element={<SignupDonor />} />
              <Route path="/signup/requestor" element={<SignupRequestor />} />
              <Route path="/signup/red-cross" element={<SignupRedCross />} />
              <Route path="/signup/hospital" element={<SignupHospital />} />

              {/* Role-aware entry + dashboards */}
              <Route
                path="/dashboard"
                element={
                  <RequireAuth
                    redirectImmediately
                    title="Sign in to open your workspace"
                    description="Your donor, requestor, Red Cross or hospital dashboard is tied to your verified role."
                  >
                    <DashboardRedirect />
                  </RequireAuth>
                }
              />
              <Route
                path="/donor/dashboard"
                element={
                  <RequireAuth
                    redirectImmediately
                    title="Sign in to your donor dashboard"
                    description="Availability, compatible verified requests, camps and donation history live here."
                  >
                    <RequireRole roles={["donor"]}>
                      <DonorDashboard />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/requestor/dashboard"
                element={
                  <RequireAuth
                    redirectImmediately
                    title="Sign in to your requestor dashboard"
                    description="Submit a blood request and track its verification, reservation and dispatch status."
                  >
                    <RequireRole roles={["requestor"]}>
                      <RequestorDashboard />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/red-cross/dashboard"
                element={
                  <RequireAuth
                    redirectImmediately
                    title="Authorized Red Cross staff only"
                    description="Verification, inventory, camps, donor records and the audit trail require a verified Red Cross account."
                  >
                    <RequireRole roles={["red_cross", "admin"]}>
                      <RedCrossDashboard />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/hospital/dashboard"
                element={
                  <RequireAuth
                    redirectImmediately
                    title="Verified hospital staff only"
                    description="Hospital requests, dispatch tracking and receipt confirmation require a verified hospital account."
                  >
                    <RequireRole roles={["hospital"]}>
                      <HospitalDashboard />
                    </RequireRole>
                  </RequireAuth>
                }
              />

              {/* Protected records */}
              <Route
                path="/requests/:id"
                element={
                  <RequireAuth
                    redirectImmediately
                    title="Sign in to view this request"
                    description="Request records are restricted to the owner, authorized Red Cross staff and the hospital involved."
                  >
                    <RequestDetail />
                  </RequireAuth>
                }
              />

              {/* Public-safe pages */}
              <Route path="/blood-search" element={<BloodSearch />} />
              <Route path="/donation-camps" element={<DonationCamps />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
