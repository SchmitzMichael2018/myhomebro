import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function StripeRedirectNotice() {
  const navigate = useNavigate();

  useEffect(() => {
    // Simulate a post-redirect success notice and auto-redirect
    const timer = setTimeout(() => {
      navigate('/dashboard'); // change this to your desired post-redirect page
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>Stripe Redirect</h2>
      <p>Thank you! You're being redirected...</p>
    </div>
  );
}
