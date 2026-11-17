import { Navigate, useLocation } from "react-router";

/**
 * Legacy route. Requestor functionality is now the Request Blood section of the
 * unified community dashboard.
 */
export default function RequestorDashboard() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("section", "request");
  return <Navigate to={`/community/dashboard?${params.toString()}`} replace />;
}
