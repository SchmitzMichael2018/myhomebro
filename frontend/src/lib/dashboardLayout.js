export const DASHBOARD_LAYOUT = {
  contractor: [
    { id: "focus", component: "DashboardSection", priority: 1, visible: true },
    { id: "state", component: "DashboardSection", priority: 2, visible: true },
    { id: "context", component: "DashboardSection", priority: 3, visible: true },
  ],
  business: [
    { id: "signals", component: "DashboardSection", priority: 1, visible: true },
    { id: "snapshot", component: "DashboardSection", priority: 2, visible: true },
    { id: "deep_dive", component: "DashboardSection", priority: 3, visible: true },
  ],
  admin: [
    { id: "focus", component: "DashboardSection", priority: 1, visible: true },
    { id: "state", component: "DashboardSection", priority: 2, visible: true },
    { id: "context", component: "DashboardSection", priority: 3, visible: true },
  ],
};
