// frontend/src/components/LoginModal.jsx
import React from 'react';
import LoginForm from './LoginForm.jsx';

export default function LoginModal({ onClose, onLoginSuccess }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-sm bg-white/90 p-8 rounded-xl shadow-lg relative backdrop-blur-sm">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-2xl text-gray-400 hover:text-gray-600"
          aria-label="Close"
        >
          &times;
        </button>
        <LoginForm isModal onLogin={onLoginSuccess} />
      </div>
    </div>
  );
}
