import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function EarningsChart({ invoices }) {
  // Group earnings by month
  const monthlyTotals = invoices.reduce((acc, invoice) => {
    const date = new Date(invoice.created_at || invoice.updated_at);
    const month = date.toLocaleString('default', { month: 'short', year: 'numeric' });
    const amount = parseFloat(invoice.amount_due);

    if (!acc[month]) acc[month] = 0;
    acc[month] += amount;
    return acc;
  }, {});

  const chartData = Object.entries(monthlyTotals).map(([month, total]) => ({
    month,
    total: Number(total.toFixed(2)),
  }));

  return (
    <div className="w-full bg-white rounded-2xl shadow-md px-6 pt-6 pb-10">
      <h2 className="text-lg font-semibold text-gray-700 mb-4">Earnings Overview</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              borderColor: '#e2e8f0',
            }}
            labelStyle={{ fontWeight: 600 }}
            formatter={(value) => `$${value.toFixed(2)}`}
          />
          <Bar dataKey="total" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

  