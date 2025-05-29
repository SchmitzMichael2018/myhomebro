import { useEffect, useState, useMemo } from 'react';
import api from '../api';

export default function AgreementSection() {
  const [agreements, setAgreements] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [actionId, setActionId] = useState(null);

  const fetchAgreements = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get('/projects/agreements/');
      setAgreements(data);
    } catch (err) {
      console.error('Fetch error:', err);
      setError("Failed to load agreements. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgreements(); }, []);

  const filteredAgreements = useMemo(() => {
    let filtered = agreements;
    if (filter === 'signed') filtered = agreements.filter((a) => a.signed_by_contractor && a.signed_by_homeowner);
    if (filter === 'unsigned') filtered = agreements.filter((a) => !(a.signed_by_contractor && a.signed_by_homeowner));
    if (searchTerm) {
      filtered = filtered.filter((a) =>
        (a.project_title || a.project_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (a.homeowner?.name || a.homeowner_name || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return filtered;
  }, [agreements, filter, searchTerm]);

  const handleSign = async (id) => {
    setActionId(id);
    try {
      // DRF: POST to /agreements/:id/sign/
      await api.post(`/projects/agreements/${id}/sign/`);
      await fetchAgreements();
      alert('✅ Agreement signed successfully.');
    } catch (err) {
      console.error('Failed to sign:', err);
      alert('❌ Error signing agreement.');
    } finally {
      setActionId(null);
    }
  };

  const handleFundEscrow = async (id) => {
    setActionId(id);
    try {
      await api.post(`/projects/agreements/${id}/fund_escrow/`);
      await fetchAgreements();
      alert('✅ Escrow funded successfully.');
    } catch (err) {
      console.error('Funding error:', err);
      alert('❌ Error funding escrow.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-gray-800">Agreements</h2>
        <div className="flex space-x-4">
          <input
            type="text"
            placeholder="Search by project or homeowner..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border px-3 py-1 rounded"
          />
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
      </div>

      {loading ? (
        <div className="text-center text-gray-500">Loading agreements...</div>
      ) : error ? (
        <div className="text-center text-red-500">{error}</div>
      ) : filteredAgreements.length === 0 ? (
        <div className="text-center text-gray-500">No agreements found.</div>
      ) : (
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
            {filteredAgreements.map((a) => (
              <tr key={a.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2">{a.project_title || a.project_name || "-"}</td>
                <td className="px-4 py-2">{a.homeowner?.name || a.homeowner_name || "-"}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-1 rounded ${
                      (a.signed_by_contractor && a.signed_by_homeowner)
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {(a.signed_by_contractor && a.signed_by_homeowner)
                      ? 'Signed'
                      : 'Unsigned'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-1 rounded ${
                      a.escrow_funded ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {a.escrow_funded ? 'Funded' : 'Pending'}
                  </span>
                </td>
                <td className="px-4 py-2 space-x-2">
                  {!(a.signed_by_contractor && a.signed_by_homeowner) && (
                    <button
                      onClick={() => handleSign(a.id)}
                      className="text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded"
                      disabled={actionId === a.id}
                      aria-label={`Sign agreement for ${a.project_title || a.project_name || "-"}`}
                    >
                      {actionId === a.id ? "Signing..." : "Sign"}
                    </button>
                  )}
                  {(a.signed_by_contractor && a.signed_by_homeowner && !a.escrow_funded) && (
                    <button
                      onClick={() => handleFundEscrow(a.id)}
                      className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded"
                      disabled={actionId === a.id}
                      aria-label={`Fund escrow for ${a.project_title || a.project_name || "-"}`}
                    >
                      {actionId === a.id ? "Funding..." : "Fund Escrow"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}







