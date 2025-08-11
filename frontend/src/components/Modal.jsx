// src/components/Modal.jsx
import React from 'react';

/**
 * A simple modal dialog component using Tailwind CSS.
 *
 * Props:
 * - visible: boolean to show/hide the modal
 * - title: string title displayed in the header
 * - children: React nodes to render as modal body
 * - onClose: function to call when closing the modal
 */
export default function Modal({ visible, title, children, onClose }) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black bg-opacity-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-gray-500 hover:text-gray-700 focus:outline-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {children}
        </div>
      </div>
    </div>
  );
}
