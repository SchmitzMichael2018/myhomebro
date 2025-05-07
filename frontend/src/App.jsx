import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import LoginForm from './LoginForm';
import ContractorDashboard from './ContractorDashboard';
import AgreementList from './pages/AgreementList';
import AgreementDetail from './pages/AgreementDetail';
import AgreementForm from './pages/AgreementForm';
import InvoiceList from './pages/InvoiceList';
import AgreementWizard from './components/AgreementWizard';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('access'));

  if (!token) {
    return <LoginForm onLogin={setToken} />;
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex justify-between items-center p-4 bg-white shadow">
          <div className="text-xl font-bold">MyHomeBro</div>
          <div className="text-gray-600">Welcome, Admin 👋</div>
        </div>
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          <Routes>
            <Route path="/" element={<ContractorDashboard />} />
            <Route path="/agreements" element={<AgreementList />} />
            <Route path="/agreements/:id" element={<AgreementDetail />} />
            <Route path="/agreements/new" element={<AgreementForm token={token} />} />
            <Route path="/create-agreement" element={<AgreementForm token={token} />} />
            <Route path="/invoices" element={<InvoiceList token={token} />} />
            <Route path="/wizard" element={<AgreementWizardWrapper />} /> {/* ✅ New route */}
          </Routes>
        </div>
      </div>
    </div>
  );
}

// ✅ Wizard Wrapper to manage step state (Step 1 only for now)
function AgreementWizardWrapper() {
  const handleWizardNext = (step1Data) => {
    console.log("✅ Step 1 complete. Collected:", step1Data);
    alert("Step 1 complete. You can now proceed to Step 2.");
    // In future: store data in context and move to next step
  };

  return <AgreementWizard onNext={handleWizardNext} />;
}












