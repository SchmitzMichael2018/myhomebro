// src/components/MilestoneStatCard.jsx
export default function MilestoneStatCard({ label, data, icon, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl shadow p-6 hover:shadow-lg transition-shadow duration-300 w-full cursor-pointer"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-lg font-semibold text-gray-700">
          {label} <span className="text-blue-600">({data.count})</span>
        </div>
        <div className="text-2xl">{icon}</div>
      </div>
      <div className="text-xl font-bold text-green-600">
        ${data.total.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}




  