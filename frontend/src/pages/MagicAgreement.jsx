// src/pages/MagicAgreement.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';
import AgreementDetail from './AgreementDetail';

export default function MagicAgreement() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [initialAgreement, setInitialAgreement] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAgreement = async () => {
      try {
        const { data } = await api.get(`/agreements/access/${token}/`);
        setInitialAgreement(data);
      } catch (err) {
        console.error("Magic link error:", err);
        toast.error("Invalid or expired link. Redirecting to home…", { duration: 3000 });
        setTimeout(() => navigate('/', { replace: true }), 3000);
      } finally {
        setLoading(false);
      }
    };
    fetchAgreement();
  }, [token, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-blue-500">Loading…</p>
      </div>
    );
  }

  if (!initialAgreement) {
    // Redirect handled in catch; render nothing here
    return null;
  }

  return <AgreementDetail initialAgreement={initialAgreement} isMagicLink />;
}
