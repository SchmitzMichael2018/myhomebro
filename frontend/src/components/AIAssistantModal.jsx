// src/components/AIAssistantModal.jsx
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function AIAssistantModal({ open, onClose, section, avatar }) {
  const [messages, setMessages] = useState([
    { from: "ai", text: "Hi, I’m your HomeBro Assistant! How can I help you today?" },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  }, [open, messages.length]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    setMessages((msgs) => [...msgs, { from: "user", text: input }]);
    setInput("");
    const response = await fetch("/api/projects/ai-chat/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input, section }),
    });
    const data = await response.json();
    setMessages((msgs) => [...msgs, { from: "ai", text: data.reply }]);
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50"
        >
          <motion.div
            initial={{ y: 100, scale: 0.95 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 100, scale: 0.95 }}
            transition={{ duration: 0.28, type: "spring" }}
            className="bg-white/40 backdrop-blur-xl w-full max-w-xl rounded-t-3xl md:rounded-3xl shadow-2xl p-8 flex flex-col border border-blue-100"
          >
            <div className="flex justify-between items-center mb-4">
              <div className="font-bold text-blue-700 text-2xl flex items-center gap-3">
                <img src={avatar} alt="AI" className="w-16 h-16 rounded-full border-2 border-blue-200 shadow" />
                HomeBro AI
              </div>
              <button
                onClick={onClose}
                className="text-2xl text-blue-800 hover:bg-blue-50 rounded-full px-3 transition"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto mb-4 max-h-[420px]">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`mb-4 flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`px-6 py-4 rounded-2xl shadow text-lg max-w-[80%] flex items-center gap-3 ${
                      msg.from === "ai"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-yellow-200 text-blue-900"
                    }`}
                  >
                    {msg.from === "ai" && (
                      <img src={avatar} alt="AI" className="w-12 h-12 rounded-full border-2 border-blue-200 shadow mr-3" />
                    )}
                    <span>{msg.text}</span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="flex gap-3 mt-2">
              <input
                type="text"
                className="flex-1 px-6 py-4 text-lg rounded-2xl border border-blue-200 focus:border-blue-500 focus:outline-none transition"
                placeholder="Ask me anything..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                autoFocus
              />
              <motion.button
                onClick={sendMessage}
                className="bg-blue-600 text-white text-lg font-bold rounded-2xl px-6 py-4 shadow hover:bg-blue-700 active:scale-95 transition"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.98 }}
              >
                Send
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}





