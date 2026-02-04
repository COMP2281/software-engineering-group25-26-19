import { Navigate, Outlet } from "react-router-dom";
import { isLoggedIn } from "../api/authorToken";

export default function ProtectedRoute() {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ info: "Please log in" }} />;
  }
  return <Outlet />;
}
