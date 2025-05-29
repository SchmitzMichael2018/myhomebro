export default function MilestoneStatCard({
  label,
  data,
  icon = "📊",
  onClick,
  active = false,
}) {
  const count =
    typeof data === "object"
      ? data.count ?? 0
      : typeof data === "number"
      ? data
      : 0;
  const total =
    typeof data === "object"
      ? data.total ?? 0.0
      : typeof data === "number"
      ? data
      : 0.0;

  const colorMap = {
    Completed: "text-green-600 bg-green-50",
    "Pending Approval": "text-yellow-600 bg-yellow-50",
    Approved: "text-blue-600 bg-blue-50",
    Incomplete: "text-red-600 bg-red-50",
    Earned: "text-purple-600 bg-purple-50",
  };
  const colorClass = colorMap[label] || "text-gray-700 bg-white";

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.();
      }}
      className={`rounded-2xl shadow p-6 hover:shadow-lg transition-transform duration-300 w-full cursor-pointer focus:outline-none ${
        active ? "ring-2 ring-blue-600" : ""
      } ${colorClass}`}
      aria-label={`${label} - ${count} items, Total: $${total.toFixed(2)}`}
      role="button"
      tabIndex="0"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-lg font-semibold">
          {label} <span className="text-blue-600">({count})</span>
        </div>
        <div className="text-2xl" title={label}>
          {icon}
        </div>
      </div>
      <div className="text-xl font-bold">
        ${total.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}






  