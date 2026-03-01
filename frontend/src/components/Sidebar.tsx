import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "../api/login.author.api";
import "./Sidebar.css";

type User = {
  name: string;
  avatarUrl?: string;
};

const mockUser: User = {
  name: "SPIO User",
};

type SidebarProps = {
  onToggleHide: () => void;
};

export default function Sidebar({ onToggleHide }: SidebarProps) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/login");
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebarHeader">
        <button
          className="sidebarHideBtn"
          type="button"
          onClick={onToggleHide}
          aria-label="Hide sidebar"
        >
          <span className="hamburger" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>

        <div className="avatar">
          {mockUser.avatarUrl ? (
            <img src={mockUser.avatarUrl} alt="avatar" />
          ) : (
            <span>{mockUser.name[0]}</span>
          )}
        </div>

        <div className="userName">{mockUser.name}</div>

        <div className="searchBox">
          <input placeholder="Search" />
        </div>
      </div>

      {/* Menu */}
      <nav className="menu">
        <NavLink to="/dashboard" className="menuItem">
          Dashboard
        </NavLink>

        <NavLink to="/courses" className="menuItem">
          Courses
        </NavLink>

        <NavLink to="/visualisation" className="menuItem">
          Visualisation
        </NavLink>

        <NavLink to="/settings" className="menuItem">
          Settings
        </NavLink>
      </nav>

      {/* Footer */}
      <div className="sidebarFooter">
        <NavLink to="/login" className="signOut">
          Sign out
        </NavLink>
      </div>
    </aside>
  );
}
