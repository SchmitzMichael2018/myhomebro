// src/pages/Chat.jsx

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function Chat() {
  const { id: conversationId } = useParams();
  const { user } = useAuth();

  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageBody, setMessageBody] = useState('');
  const [loading, setLoading] = useState(true);

  const bottomRef = useRef(null);

  // --- Data Fetching ---
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch conversation details and initial messages concurrently
      const [convoRes, messagesRes] = await Promise.all([
        api.get(`/chat/conversations/${conversationId}/`),
        api.get(`/chat/conversations/${conversationId}/messages/`)
      ]);
      setConversation(convoRes.data);
      setMessages(messagesRes.data);
    } catch (err) {
      toast.error("Failed to load chat history.");
      console.error('Failed to load chat data:', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // --- Load initial messages on mount or conversation change ---
  useEffect(() => {
    loadInitialData();
  }, [conversationId, loadInitialData]);

  // --- Poll for new messages every 10 seconds ---
  useEffect(() => {
    const interval = setInterval(() => {
      loadInitialData();
    }, 10000); // 10 seconds

    return () => clearInterval(interval);
  }, [conversationId, loadInitialData]);

  // --- Auto-scroll to bottom when messages change ---
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Send Message via HTTP API ---
  const handleSend = async () => {
    const trimmedMessage = messageBody.trim();
    if (!trimmedMessage) {
      return;
    }

    try {
      // Send the message via API POST
      const res = await api.post(`/chat/conversations/${conversationId}/messages/`, {
        text: trimmedMessage,
      });
      setMessages((prevMessages) => [...prevMessages, res.data]);
      setMessageBody('');
      // Optionally re-fetch all messages for accuracy
      // await loadInitialData();
    } catch (err) {
      toast.error("Failed to send message.");
      console.error('Failed to send message:', err);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return <div className="p-6 text-center">Loading chat...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-gray-100">
      <header className="px-6 py-4 bg-white border-b sticky top-0 z-10">
        <h2 className="text-xl font-semibold text-gray-800">
          {conversation ? `Chat for: ${conversation.project_title}` : `Chat #${conversationId}`}
        </h2>
        <p className="text-sm text-gray-500">With: {conversation?.homeowner_name}</p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const isMine = msg.sender === user?.id;
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-md px-4 py-2 rounded-lg shadow-sm ${
                isMine ? 'bg-blue-600 text-white' : 'bg-white text-gray-800'
              }`}
              >
                {!isMine && (
                  <div className="text-xs font-bold mb-1 text-blue-700">{msg.sender_name}</div>
                )}
                <div className="whitespace-pre-wrap text-sm">{msg.text}</div>
                <div className={`text-right text-xxs mt-1 ${isMine ? 'text-blue-200' : 'text-gray-400'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <footer className="px-4 py-3 bg-white border-t">
        <div className="flex items-center">
          <textarea
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message…"
            className="flex-1 border rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
          />
          <button
            onClick={handleSend}
            className="ml-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
