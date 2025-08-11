// src/components/BusinessDashboard.jsx

import React, { useEffect, useState, useMemo } from "react";
// ... (imports remain the same)
import api from "../api";

export default function BusinessDashboard() {
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // Add an error state
  // ... (other state remains the same)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Use Promise.all to fetch data in parallel for better performance
        const [invoiceRes, expenseRes] = await Promise.all([
          api.get("/invoices/"),
          api.get("/expenses/")
        ]);
        setInvoices(invoiceRes.data || []);
        setExpenses(expenseRes.data || []);
      } catch (err) {
        console.error("Error loading business data:", err);
        setError("Failed to load dashboard data. Please try refreshing the page.");
        toast.error("Failed to load dashboard data.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // ... (all useMemo hooks are well-implemented and remain the same)

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="p-6 text-center text-red-500">{error}</div>;
  }

  // The rest of the JSX remains the same...
  // ...
}