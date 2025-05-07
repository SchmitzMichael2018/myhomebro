// src/components/ContractorSection.jsx
import EarningsChart from "./EarningsChart";

export default function ContractorSection({ section, invoices }) {
  if (section === "Dashboard") {
    const totalInvoices = invoices.length;
    const paidInvoices = invoices.filter(inv => inv.is_paid).length;
    const unpaidInvoices = invoices.filter(inv => !inv.is_paid).length;
    const totalAmount = invoices.reduce((acc, inv) => acc + (parseFloat(inv.amount_due) || 0), 0).toFixed(2);

    return (
      <div>
        <h2 className="text-2xl font-bold mb-6 text-gray-700">Welcome back 👋</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard label="Total Invoices" value={totalInvoices} icon="🧾" />
          <StatCard label="Paid Invoices" value={paidInvoices} icon="✅" />
          <StatCard label="Unpaid Invoices" value={unpaidInvoices} icon="❌" />
          <StatCard label="Total Earnings" value={`$${totalAmount}`} icon="💵" />
        </div>

        <div className="bg-white rounded-2xl shadow-md p-6">
          <EarningsChart invoices={invoices} />
        </div>
      </div>
    );
  }

  if (section === "Agreements") {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-700">Agreements</h2>
        <button className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg mb-4">
          + New Agreement
        </button>
        <p>List of agreements will go here.</p>
      </div>
    );
  }

  if (section === "Invoices") {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-700">Invoices</h2>
        <p>List of invoices will go here.</p>
      </div>
    );
  }

  if (section === "Earnings") {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-700">Earnings Overview</h2>
        <EarningsChart invoices={invoices} />
      </div>
    );
  }

  if (section === "Calendar") {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-700">Calendar</h2>
        <p>Calendar functionality coming soon!</p>
      </div>
    );
  }

  if (section === "Customers") {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-700">Customers</h2>
        <p>Customer management page coming soon!</p>
      </div>
    );
  }

  if (section === "Disputes") {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-700">Disputes</h2>
        <p>Dispute resolution center coming soon!</p>
      </div>
    );
  }

  if (section === "My Profile") {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-700">My Profile</h2>
        <p>Profile management coming soon!</p>
      </div>
    );
  }

  if (section === "Send Message") {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-700">Send Message</h2>
        <form className="space-y-4">
          <input
            type="text"
            placeholder="Subject"
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            placeholder="Message"
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 h-32"
          ></textarea>
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg"
          >
            Send
          </button>
        </form>
      </div>
    );
  }

  return null;
}

// Small stat card component
function StatCard({ label, value, icon }) {
  return (
    <div className="bg-white rounded-2xl shadow-md p-6 flex flex-col items-center hover:shadow-lg transition-shadow duration-300">
      <div className="text-4xl mb-2">{icon}</div>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-800">{value}</div>
    </div>
  );
}
