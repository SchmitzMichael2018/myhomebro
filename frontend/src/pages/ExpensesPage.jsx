// src/pages/ExpensesPage.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import toast from "react-hot-toast";
import api from "../api";

console.log("ExpensesPage.jsx v2025-09-14");

// ---------- helpers ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
const toMoney = (n) =>
  Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function agreementLabel(a) {
  const title = a.project_title || a.title || a.project?.title || "Untitled";
  const homeowner =
    a.homeowner_name ||
    a.project?.homeowner?.full_name ||
    a.project?.homeowner?.name ||
    "";
  return `#${a.id} — ${title}${homeowner ? ` (${homeowner})` : ""}`;
}

function projectFromExpense(e, agreementsMap) {
  // Try direct fields, then nested, then lookup by agreement id
  return (
    e.project_title ||
    e.project?.title ||
    agreementsMap.get(e.agreement)?.project_title ||
    agreementsMap.get(e.agreement)?.title ||
    agreementsMap.get(e.agreement)?.project?.title ||
    "N/A"
  );
}

// ---------- add expense form ----------
const AddExpenseForm = ({ agreements, onAdd, submitting }) => {
  const [form, setForm] = useState({
    agreement: "",
    description: "",
    amount: "",
    incurred_date: todayISO(),
  });

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.agreement) return toast.error("Please select an agreement.");
    if (!form.description.trim()) return toast.error("Add a short description.");
    if (!form.amount || Number(form.amount) <= 0)
      return toast.error("Enter a positive amount.");

    await onAdd({
      agreement: form.agreement,
      description: form.description.trim(),
      amount: Number(form.amount),
      incurred_date: form.incurred_date || todayISO(),
    });

    setForm({
      agreement: "",
      description: "",
      amount: "",
      incurred_date: todayISO(),
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 mb-6 p-4 bg-gray-50 rounded-lg"
    >
      <select
        name="agreement"
        value={form.agreement}
        onChange={onChange}
        className="form-input md:col-span-2"
        required
      >
        <option value="">— Select Agreement —</option>
        {agreements.map((a) => (
          <option key={a.id} value={a.id}>
            {agreementLabel(a)}
          </option>
        ))}
      </select>

      <input
        name="description"
        placeholder="Expense description"
        value={form.description}
        onChange={onChange}
        className="form-input"
        required
      />

      <input
        name="amount"
        type="number"
        step="0.01"
        placeholder="Amount"
        value={form.amount}
        onChange={onChange}
        className="form-input"
        required
      />

      <input
        name="incurred_date"
        type="date"
        value={form.incurred_date}
        onChange={onChange}
        className="form-input"
        required
      />

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 md:col-span-5"
      >
        {submitting ? "Adding…" : "+ Add Expense"}
      </button>
    </form>
  );
};

// ---------- page ----------
export default function ExpensesPage() {
  const [enabled, setEnabled] = useState(true); // false if API not present (404)
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [agreements, setAgreements] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const agreementsMap = useMemo(() => {
    const m = new Map();
    agreements.forEach((a) => m.set(String(a.id), a));
    return m;
  }, [agreements]);

  const fetchAgreements = useCallback(async () => {
    try {
      // Primary (modern) path
      const res = await api.get("/projects/agreements/", { params: { page_size: 100 } });
      const arr = Array.isArray(res.data) ? res.data : res.data?.results || [];
      setAgreements(arr);
    } catch (e) {
      if (e?.response?.status === 404) {
        // Legacy fallback
        const res2 = await api.get("/agreements/");
        const arr2 = Array.isArray(res2.data) ? res2.data : res2.data?.results || [];
        setAgreements(arr2);
        console.warn("Agreements: fell back to /api/agreements/");
      } else {
        console.error(e);
        setAgreements([]);
        toast.error("Failed to load agreements.");
      }
    }
  }, []);

  const fetchExpenses = useCallback(async () => {
    try {
      // Primary (modern) path
      const res = await api.get("/projects/expenses/");
      const arr = Array.isArray(res.data) ? res.data : res.data?.results || [];
      setExpenses(arr);
      setEnabled(true);
    } catch (e) {
      if (e?.response?.status === 404) {
        // Legacy fallback(s)
        try {
          const res2 = await api.get("/expenses/");
          const arr2 = Array.isArray(res2.data) ? res2.data : res2.data?.results || [];
          setExpenses(arr2);
          setEnabled(true);
          console.warn("Expenses: fell back to /api/expenses/.");
        } catch (e2) {
          console.warn("Expenses API not available; hiding table.");
          setExpenses([]);
          setEnabled(false);
        }
      } else {
        console.error(e);
        setExpenses([]);
        toast.error("Failed to load expenses.");
        setEnabled(true);
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([fetchAgreements(), fetchExpenses()]);
    } catch (e) {
      console.error(e);
      setError("Failed to load page data.");
      toast.error("Failed to load page data.");
    } finally {
      setLoading(false);
    }
  }, [fetchAgreements, fetchExpenses]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddExpense = async (form) => {
    setSubmitting(true);
    try {
      // Prefer nested create under the agreement
      try {
        await api.post(`/projects/agreements/${form.agreement}/expenses/`, {
          description: form.description,
          amount: form.amount,
          incurred_date: form.incurred_date,
        });
      } catch (e) {
        if (e?.response?.status === 404) {
          // Try modern flat endpoint with agreement field
          try {
            await api.post(`/projects/expenses/`, {
              agreement: form.agreement,
              description: form.description,
              amount: form.amount,
              incurred_date: form.incurred_date,
            });
          } catch (e2) {
            if (e2?.response?.status === 404) {
              // Legacy fallback
              await api.post(`/expenses/`, {
                agreement: form.agreement,
                description: form.description,
                amount: form.amount,
                // if older backends use "date" instead of "incurred_date", send both
                incurred_date: form.incurred_date,
                date: form.incurred_date,
              });
            } else {
              throw e2;
            }
          }
        } else {
          throw e;
        }
      }

      toast.success("Expense added.");
      await fetchExpenses();
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to add expense.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- render ----------
  if (!enabled) {
    return (
      <div className="p-6">
        <div className="rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-900 p-4">
          <div className="font-semibold">Expenses module unavailable</div>
          <p className="text-sm mt-1">
            Endpoint <code>/api/projects/expenses/</code> was not found on the server. You can enable or add it later; the
            rest of the app will continue to work normally.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Expenses</h1>
        <div className="text-sm text-gray-700">
          Total:&nbsp;
          <span className="font-semibold">
            {toMoney(expenses.reduce((s, x) => s + Number(x.amount || 0), 0))}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <AddExpenseForm agreements={agreements} onAdd={handleAddExpense} submitting={submitting} />
      </div>

      <div className="mt-2 rounded-xl bg-white shadow ring-1 ring-black/5 overflow-x-auto">
        <table className="min-w-[880px] w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Project</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                  No expenses recorded.
                </td>
              </tr>
            ) : (
              expenses.map((e, idx) => (
                <tr key={e.id || idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    {projectFromExpense(e, agreementsMap)}
                  </td>
                  <td className="px-3 py-2">{e.description || e.note || "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {toMoney(e.amount)}
                  </td>
                  <td className="px-3 py-2">
                    {e.incurred_date || e.date || e.created_at || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
