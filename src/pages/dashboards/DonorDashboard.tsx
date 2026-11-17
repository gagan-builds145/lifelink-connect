import { Navigate, useLocation } from "react-router";

/**
 * Legacy route. Donor functionality is now the Donate Blood section of the
 * unified community dashboard, so old links land there instead of a separate
 * workspace.
 */
export default function DonorDashboard() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("section", "donate");
  return <Navigate to={`/community/dashboard?${params.toString()}`} replace />;
}
