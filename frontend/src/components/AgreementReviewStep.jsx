// src/components/AgreementReviewStep.jsx
export default function AgreementReviewStep({ data, onBack, onSubmit }) {
    const {
      homeownerName,
      homeownerEmail,
      projectName,
      projectAddress,
      startDate,
      endDate,
      milestoneCount,
      totalPrice,
    } = data;
  
    const perMilestone = (parseFloat(totalPrice) / milestoneCount).toFixed(2);
  
    return (
      <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto mt-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Step 3: Review & Submit</h2>
  
        <div className="space-y-2 text-gray-700">
          <p><strong>Homeowner:</strong> {homeownerName} ({homeownerEmail})</p>
          <p><strong>Project:</strong> {projectName}</p>
          <p><strong>Address:</strong> {projectAddress || "—"}</p>
          <p><strong>Start:</strong> {startDate} &nbsp;&nbsp; <strong>End:</strong> {endDate}</p>
          <p><strong>Milestones:</strong> {milestoneCount}</p>
          <p><strong>Total Price:</strong> ${parseFloat(totalPrice).toLocaleString()}</p>
          <p><strong>Each Milestone:</strong> ${perMilestone}</p>
        </div>
  
        <div className="mt-6 flex justify-between">
          <button onClick={onBack} className="px-6 py-2 bg-gray-300 rounded">
            Back
          </button>
          <button
            onClick={() => onSubmit(data)}
            className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Submit Agreement
          </button>
        </div>
      </div>
    );
  }
  