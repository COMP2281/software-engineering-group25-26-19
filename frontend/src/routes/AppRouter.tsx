import { Routes, Route, Navigate } from "react-router-dom";

import LoginPage from "../pages/LoginPage";
import Dashboard from "../pages/Dashboard";
import ProtectedRoute from "./ProtectedRoute";
import CoursesPage from "../pages/Courses";
import Visualisation from "../pages/Visualisation";



export default function AppRouter() {
  return (
    <Routes>
      {/* 登录页 */}
      <Route path="/login" element={<LoginPage />} />

      {/* 需要登陆才能访问 */}
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/courses" element={<CoursesPage />} />

        <Route path="/visualisation" element={<Visualisation />} />
      </Route>

      {/* 默认跳转 */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
