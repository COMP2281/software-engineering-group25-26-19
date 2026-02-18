import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getToken } from "../api/authorToken";

export default function ProtectedRoute() {
  const token = getToken();
  const location = useLocation();

  if (!token) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          message: "Please log in", from: location.pathname}}
      />
    );
  }

  // if login return to dashboard
  return <Outlet />;
}
