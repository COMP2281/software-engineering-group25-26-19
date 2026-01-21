import { Navigate, Outlet } from "react-router-dom";
import { isLoggedIn } from "../api/authorToken";

export default function ProtectedRoute() {
  if (!isLoggedIn()) {
    // 没登录：踢回 login，并带一句提示
    return <Navigate to="/login" replace state={{ info: "Please log in" }} />;
  }
  // 已登录：允许继续访问下面的子路由
  return <Outlet />;
}
