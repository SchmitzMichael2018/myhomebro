// src/components/ContractorSection.jsx

import React, { useState, useMemo } from "react";
import EarningsChart from "./EarningsChart";
import StatCard from "./StatCard";
import ContractorProfile from "./ContractorProfile";

export default function ContractorSection({ section, invoices }) {
  return (
    <div className="bg-white rounded-2xl shadow-md p-6">
      <h2 className="text-2xl font-bold mb-6 text-gray-700">
        {section === "Dashboard" ? "Welcome back 👋" : section}
      </h2>
      {renderSectionContent(section, invoices)}
    </div>
  );
}

function renderSectionContent(section, invoices) {
  switch (section) {
    case "Dashboard":
      return <DashboardSection invoices={invoices} />;
    case "Agreements":
      return <AgreementsSection />;
    case "Invoices":
      return <InvoicesSection invoices={invoices} />;
    case "Earnings":
      return <EarningsSection invoices={invoices} />;
    case "Calendar":
      return <CalendarSection />;
    case "Customers":
      return <CustomersSection />;
    case "Disputes":
      return <DisputesSection />;
    case "My Profile":
      return <ProfileSection />;
    case "Send Message":
      return <SendMessageSection />;
    default:
      console.warn(`Unhandled section: ${section}`);
      return <p className="text-gray-500">Select a section to view details.</p>;
  }
}

function DashboardSection({ invoices }) {
  const totalInvoices = invoices.length;
  const paidInvoices = invoices.filter((inv) => inv.status === "paid").length;
  const unpaidInvoices = invoices.filter((inv) => inv.status !== "paid").length;
  const totalAmount = invoices
    .filter((inv) => inv.status === "paid")
    .reduce((acc, inv) => acc + (parseFloat(inv.amount_due) || 0), 0)
    .toFixed(2);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard label="Total Invoices" value={totalInvoices} icon="📟" />
        <StatCard label="Paid Invoices" value={paidInvoices} icon="✅" />
        <StatCard label="Unpaid Invoices" value={unpaidInvoices} icon="❌" />
        <StatCard label="Total Earnings" value={`$${totalAmount}`} icon="💵" />
      </div>
      <EarningsChart invoices={invoices} />
    </>
  );
}

function AgreementsSection() {
  return (
    <div>
      <button
        className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg mb-4"
        aria-label="Create new agreement"
        onClick={() => alert("New agreement feature coming soon!")}
      >
        + New Agreement
      </button>
      <p className="text-gray-500">List of agreements will go here.</p>
    </div>
  );
}

function InvoicesSection({ invoices }) {
  return (
    <div>
      <p className="mb-4">List of invoices will go here.</p>
      {invoices.length > 0 ? (
        <ul className="space-y-2">
          {invoices.map((inv) => (
            <li key={inv.id} className="p-2 border rounded">
              <strong>{inv.project_title || inv.project_name}</strong> - $
              {parseFloat(inv.amount_due).toFixed(2)} ({inv.status})
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500">No invoices available.</p>
      )}
    </div>
  );
}

function EarningsSection({ invoices }) {
  return <EarningsChart invoices={invoices} />;
}

function CalendarSection() {
  return <p className="text-gray-500 italic">Calendar functionality coming soon!</p>;
}

function CustomersSection() {
  return <p className="text-gray-500 italic">Customer management page coming soon!</p>;
}

function DisputesSection() {
  return <p className="text-gray-500 italic">Dispute resolution center coming soon!</p>;
}

function ProfileSection() {
  return <ContractorProfile />;
}

function SendMessageSection() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setStatus("✅ Message sent successfully.");
    } catch (error) {
      setStatus("❌ Failed to send message. Please try again.");
    } finally {
      setLoading(false);
      setSubject("");
      setMessage("");
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit} aria-label="Send Message Form">
      <input
        type="text"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        required
      />
      <textarea
        placeholder="Message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 h-32"
        required
      ></textarea>
      <button
        type="submit"
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg"
        disabled={loading}
      >
        {loading ? "Sending..." : "Send"}
      </button>
      {status && <p className="text-sm mt-2">{status}</p>}
    </form>
  );
}
