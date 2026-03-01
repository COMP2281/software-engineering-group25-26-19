import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import "../components/Sidebar.css";

export default function ProtectedLayout() {
  const [sidebarVisible, setSidebarVisible] = useState(true);

  return (
    <div className={`appShell ${sidebarVisible ? "" : "sidebar-hidden"}`}>
      {sidebarVisible && (
        <Sidebar onToggleHide={() => setSidebarVisible(false)} />
      )}

      {!sidebarVisible && (
        <button
          className="sidebarFloatToggle"
          onClick={() => setSidebarVisible(true)}
        >
          <span className="hamburger">
            <span />
            <span />
            <span />
          </span>
        </button>
      )}

      <Outlet />
    </div>
  );
}
