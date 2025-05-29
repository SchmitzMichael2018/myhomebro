export default function AgreementReviewStep({ data, onBack, onSubmit }) {
  const {
    homeownerName,
    homeownerEmail,
    projectName,
    projectAddress,
    milestones = [],
    milestoneTotalCost = 0,
    milestoneTotalDuration = "00:00:00",
  } = data;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto mt-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Step 3: Review & Submit</h2>

      <div className="space-y-4 text-gray-700">
        <div className="border-b pb-4">
          <h3 className="text-lg font-semibold">Homeowner Information</h3>
          <p><strong>Name:</strong> {homeownerName}</p>
          <p><strong>Email:</strong> {homeownerEmail}</p>
        </div>

        <div className="border-b pb-4 mt-4">
          <h3 className="text-lg font-semibold">Project Details</h3>
          <p><strong>Project Name:</strong> {projectName}</p>
          <p><strong>Address:</strong> {projectAddress || "—"}</p>
        </div>

        <div className="border-b pb-4 mt-4">
          <h3 className="text-lg font-semibold">Milestones</h3>
          {milestones.length === 0 ? (
            <p className="italic text-gray-500">No milestones added.</p>
          ) : (
            <table className="w-full text-sm mt-2 border">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-2 py-1 text-left">#</th>
                  <th className="px-2 py-1 text-left">Title</th>
                  <th className="px-2 py-1 text-left">Amount</th>
                  <th className="px-2 py-1 text-left">Start</th>
                  <th className="px-2 py-1 text-left">End</th>
                  <th className="px-2 py-1 text-left">Duration</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1">{i + 1}</td>
                    <td className="px-2 py-1">{m.title}</td>
                    <td className="px-2 py-1">
                      {parseFloat(m.amount).toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })}
                    </td>
                    <td className="px-2 py-1">{m.start_date}</td>
                    <td className="px-2 py-1">{m.completion_date}</td>
                    <td className="px-2 py-1">
                      {`${m.days}d ${m.hours}h ${m.minutes}m`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4">
          <h3 className="text-lg font-semibold">Pricing Summary</h3>
          <p>
            <strong>Total Cost:</strong>{" "}
            {parseFloat(milestoneTotalCost).toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}
          </p>
          <p>
            <strong>Total Duration:</strong> {milestoneTotalDuration}
          </p>
          <p>
            <strong>Milestone Count:</strong> {milestones.length}
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2 bg-gray-300 rounded hover:bg-gray-400 transition"
          aria-label="Go Back to Previous Step"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onSubmit(data)}
          className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
          aria-label="Submit Agreement"
        >
          Submit Agreement
        </button>
      </div>
    </div>
  );
}



  