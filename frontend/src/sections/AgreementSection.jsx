import { useEffect, useState } from 'react';

export default function AgreementSection() {
  const [agreements, setAgreements] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('access');

  useEffect(() => {
    const fetchAgreements = async () => {
      setLoading(true);
      try {
        const res = await fetch('http://127.0.0.1:8080/api/projects/agreements/', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch agreements');
        const data = await res.json();
        setAgreements(data);
      } catch (err) {
        console.error('Fetch error:', err);
        setAgreements([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAgreements();
  }, [token]);

  const filtered = agreements.filter((a) =>
    filter === 'all' ? true : filter === 'signed' ? a.is_signed : !a.is_signed
  );

  const handleSign = async (id) => {
    try {
      const res = await fetch(`http://127.0.0.1:8080/api/projects/agreements/${id}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_signed: true }),
      });
      if (res.ok) {
        setAgreements((prev) =>
          prev.map((a) => (a.id === id ? { ...a, is_signed: true } : a))
        );
      }
    } catch (err) {
      console.error('Failed to sign:', err);
    }
  };

  const handleFundEscrow = async (id) => {
    try {
      const res = await fetch(`http://127.0.0.1:8080/api/projects/agreements/${id}/fund_escrow/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setAgreements((prev) =>
          prev.map((a) => (a.id === id ? { ...a, escrow_funded: true } : a))
        );
        alert('Escrow funded.');
      } else {
        alert('Failed to fund escrow.');
      }
    } catch (err) {
      console.error('Funding error:', err);
      alert('Funding error.');
    }
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-gray-800">Agreements</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="signed">Signed</option>
          <option value="unsigned">Unsigned</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center text-gray-500">Loading agreements...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-500">No agreements found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border rounded-lg overflow-hidden text-sm">
            <thead className="bg-gray-100 text-gray-600">
              <tr>
                <th className="py-2 px-4 text-left">Project</th>
                <th className="py-2 px-4 text-left">Homeowner</th>
                <th className="py-2 px-4 text-left">Signed</th>
                <th className="py-2 px-4 text-left">Escrow</th>
                <th className="py-2 px-4 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2">{a.project_name}</td>
                  <td className="px-4 py-2">{a.homeowner_name}</td>
                  <td className="px-4 py-2">
                    {a.is_signed ? (
                      <span className="text-green-600 font-semibold">Signed</span>
                    ) : (
                      <span className="text-yellow-600 font-semibold">Unsigned</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {a.escrow_funded ? (
                      <span className="text-green-700 font-semibold">Yes</span>
                    ) : (
                      <span className="text-red-500 font-semibold">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2 space-x-2">
                    {/* Show Sign button if unsigned */}
                    {!a.is_signed && (
                      <button
                        onClick={() => handleSign(a.id)}
                        className="text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded"
                      >   
                         Sign
                       </button>
                    )}

  {/* Show escrow status if signed */}
  {a.is_signed && !a.escrow_funded && (
    <span className="text-yellow-600 font-medium">Awaiting Escrow</span>
  )}
  {a.escrow_funded && (
    <span className="text-green-600 font-medium">Escrow Funded</span>
  )}

  {/* Always show Edit button */}
  <button
    onClick={() => alert('Edit form coming soon')}
    className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded"
  >
    Edit
  </button>
</td>


                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}





