// src/pages/ConversationList.jsx

import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import toast from 'react-hot-toast';
import api from "../api";

export default function ConversationList() {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/chat/conversations/");
      setConversations(data);
    } catch (err) {
      const errorMsg = "Failed to load conversations.";
      setError(errorMsg);
      toast.error(errorMsg);
      console.error("Fetch conversations error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const renderContent = () => {
    if (loading) {
      return <p className="text-center text-gray-500 py-10">Loading conversations...</p>;
    }
    if (error) {
      return <p className="text-center text-red-500 py-10">{error}</p>;
    }
    if (conversations.length === 0) {
      return <p className="text-center text-gray-500 py-10">You have no conversations yet.</p>;
    }
    return (
      <ul className="space-y-3">
        {conversations.map((c) => (
          <li key={c.id} className="bg-white p-4 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-semibold text-gray-800">{c.project_title}</p>
                <p className="text-gray-500 text-sm">With Homeowner: {c.homeowner_name}</p>
              </div>
              <Link
                // Corrected to use the `/chat/:id` route from App.jsx
                to={`/chat/${c.id}`}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2 rounded-lg transition-transform hover:scale-105"
              >
                Open Chat
              </Link>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Your Conversations</h1>
        <button
            onClick={fetchConversations}
            disabled={loading}
            className="text-blue-600 text-sm hover:underline disabled:text-gray-400"
        >
            Refresh
        </button>
      </div>
      {renderContent()}
    </div>
  );
}