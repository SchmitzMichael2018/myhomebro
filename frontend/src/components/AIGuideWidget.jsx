import { useState } from "react";
import { motion } from "framer-motion";
import AIAssistantModal from "./AIAssistantModal";

// Map route paths to context-aware greetings
const contextMessages = {
  "/dashboard": "Hi! Want an overview of your dashboard? Just ask!",
  "/agreements": "Managing agreements is easy. Need a walkthrough?",
  "/agreements/new": "Let's set up a new agreement. I can guide you.",
  "/invoices": "Let me help you track and release payments.",
  "/wizard": "I can walk you through the agreement wizard step by step.",
  "/": "Hi, I’m your HomeBro Assistant! Click me for help, walkthroughs, or any question.",
};

export default function AIGuideWidget({ section = "/" }) {
  const [showBubble, setShowBubble] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const message = contextMessages[section] || contextMessages["/"];

  return (
    <>
      <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end select-none">
        <motion.img
          src="/ai_avatar.png"
          alt="HomeBro AI"
          className="rounded-full shadow-2xl border-4 border-blue-300 bg-white cursor-pointer"
          style={{ width: 96, height: 96, objectFit: "cover" }}
          animate={{ y: [0, -12, 0] }}
          transition={{ duration: 0.7, repeat: Infinity }}
          onClick={() => setModalOpen(true)}
          title="Click to chat!"
        />

        {showBubble && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ duration: 0.25 }}
            className="bg-white/95 text-blue-900 rounded-2xl shadow-xl px-6 py-5 mt-4 mb-2 max-w-md text-lg font-semibold"
          >
            <div className="mb-1 flex items-center">
              <img
                src="/ai_avatar.png"
                alt="AI"
                className="inline-block rounded-full w-14 h-14 mr-4 border-2 border-blue-200 shadow"
              />
              {message}
            </div>
            <button
              onClick={() => setShowBubble(false)}
              className="text-sm text-blue-600 mt-3 hover:underline focus:outline-none"
            >
              Hide
            </button>
          </motion.div>
        )}
      </div>
      <AIAssistantModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        section={section}
        avatar="/ai_avatar.png"
      />
    </>
  );
}






