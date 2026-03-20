import React from "react";

function Pill({ active, children }) {
  return (
    <span
      className={[
        "ml-auto rounded-full px-2 py-0.5 text-[11px] font-extrabold",
        active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function Item({ active, label, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full rounded-xl px-3 py-2 text-left text-sm font-extrabold transition",
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "bg-white text-slate-900 hover:bg-slate-50 border border-black/10",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span>{label}</span>
        {badge !== undefined && badge !== null ? <Pill active={active}>{badge}</Pill> : null}
      </div>
    </button>
  );
}

export default function AdminSidebar({
  activeTab,
  setActiveTab,
  counts = {},
  isLoading = false,
}) {
  return (
    <aside className="w-full md:w-[260px]">
      <div className="rounded-2xl border border-black/10 bg-white/70 p-4 shadow-sm">
        <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
          Admin
        </div>
        <div className="mt-1 text-lg font-extrabold text-slate-900">
          Control Panel
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Item
            active={activeTab === "overview"}
            label="Overview"
            onClick={() => setActiveTab("overview")}
          />
          <Item
            active={activeTab === "goals"}
            label="Goals"
            onClick={() => setActiveTab("goals")}
            badge="CEO"
          />

          <div className="my-2 h-px bg-black/10" />

          <Item
            active={activeTab === "contractors"}
            label="Contractors"
            onClick={() => setActiveTab("contractors")}
            badge={isLoading ? "…" : (counts.contractors ?? 0)}
          />
          <Item
            active={activeTab === "homeowners"}
            label="Customers"
            onClick={() => setActiveTab("homeowners")}
            badge={isLoading ? "…" : (counts.homeowners ?? 0)}
          />
          <Item
            active={activeTab === "agreements"}
            label="Agreements"
            onClick={() => setActiveTab("agreements")}
            badge={isLoading ? "…" : (counts.agreements ?? 0)}
          />
          <Item
            active={activeTab === "disputes"}
            label="Disputes"
            onClick={() => setActiveTab("disputes")}
            badge={isLoading ? "…" : (counts.disputes ?? 0)}
          />

          <div className="my-2 h-px bg-black/10" />

          <Item
            active={activeTab === "support"}
            label="Support Tools"
            onClick={() => setActiveTab("support")}
          />
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 border border-black/5">
          <div className="font-extrabold text-slate-900">Tip</div>
          <div className="mt-1">
            Use <b>Goals</b> to track your $300k target using
            <b> actual platform fees</b> (receipts).
          </div>
        </div>
      </div>
    </aside>
  );
}
