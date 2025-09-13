import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FileSignature,
  ListChecks,
  Receipt,
  BarChart3,
  CalendarDays,
  Scale,
  CreditCard,
  LogOut,
} from "lucide-react";

function Item({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => "mhb-sb-link" + (isActive ? " active" : "")}
      title={label}
    >
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const logout = () => {
    try {
      localStorage.removeItem("access");
      localStorage.removeItem("refresh");
    } catch {}
    navigate("/", { replace: true });
  };

  return (
    <aside className="mhb-sidebar">
      {/* Header with larger framed logo */}
      <div className="mhb-sb-header">
        <div className="mhb-logo-frame mhb-sb-logo">
          <img src="/static/assets/myhomebro_logo.png" alt="MyHomeBro" />
        </div>
        <div>
          <div className="mhb-sb-title">MyHomeBro</div>
          <div className="mhb-sb-badge">CONTRACTOR</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="mhb-sb-nav">
        <Item to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        <Item to="/customers" icon={Users} label="Customers" />
        <Item to="/agreements" icon={FileSignature} label="Agreements" />
        <Item to="/milestones" icon={ListChecks} label="Milestones" />
        <Item to="/invoices" icon={Receipt} label="Invoices" />
        <Item to="/analytics" icon={BarChart3} label="Business Analytics" />
        <Item to="/calendar" icon={CalendarDays} label="Calendar" />
        <Item to="/disputes" icon={Scale} label="Disputes" />
        <Item to="/stripe-onboarding" icon={CreditCard} label="Stripe Onboarding" />
      </nav>

      {/* Footer */}
      <div className="mhb-sb-footer">
        <button className="mhb-sb-logout" onClick={logout}>
          <LogOut size={16} />
          <span style={{ marginLeft: 8 }}>Logout</span>
        </button>
      </div>
    </aside>
  );
}
