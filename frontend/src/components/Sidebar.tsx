import { NavLink } from "react-router-dom";
import "./Dashboard_siderbar.css";

type User = {
  name: string;
  avatarUrl?: string;
};

const mockUser: User = {
  name: "SPIO User",
};

export default function Sidebar() {
  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebarHeader">
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
