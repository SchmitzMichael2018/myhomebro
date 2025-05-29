import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import React, { useMemo } from "react";

export default React.memo(function EarningsChart({ invoices }) {
  const chartData = useMemo(() => {
    // Only count paid invoices as earnings
    const paidInvoices = invoices.filter(inv => inv.status === "paid");
    const monthlyTotals = paidInvoices.reduce((acc, invoice) => {
      // Defensive: Prefer created_at, fallback to updated_at or today
      const rawDate = invoice.created_at || invoice.updated_at || new Date().toISOString();
      const date = new Date(rawDate);
      const month = date.toLocaleString("default", { month: "short", year: "numeric" });
      const amount = parseFloat(invoice.amount_due) || 0;

      if (!acc[month]) acc[month] = 0;
      acc[month] += amount;
      return acc;
    }, {});

    // Sort months chronologically (Jan, Feb, Mar, ...)
    const sortedEntries = Object.entries(monthlyTotals).sort(
      ([a], [b]) => new Date(`1 ${a}`) - new Date(`1 ${b}`)
    );

    return sortedEntries.map(([month, total]) => ({
      month,
      total: Number(total.toFixed(2)),
    }));
  }, [invoices]);

  return (
    <div className="w-full bg-white rounded-2xl shadow-md px-6 pt-6 pb-10">
      <h2 className="text-lg font-semibold text-gray-700 mb-4">Earnings Overview</h2>
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis
              domain={[0, 'auto']}
              tickFormatter={(value) => `$${value.toLocaleString()}`}
              label={{ value: "Earnings ($)", angle: -90, position: "insideLeft", offset: -10 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                borderRadius: "8px",
                borderColor: "#e2e8f0",
                padding: "10px",
              }}
              labelStyle={{ fontWeight: 600 }}
              formatter={(value) => `$${value.toFixed(2)}`}
              labelFormatter={(label) => `Month: ${label}`}
            />
            <Bar
              dataKey="total"
              fill="#2563eb"
              radius={[4, 4, 0, 0]}
              animationDuration={800}
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-center text-gray-500">No earnings data available.</p>
      )}
    </div>
  );
});



  