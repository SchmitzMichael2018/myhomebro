// src/components/LandingPage.jsx
import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import logo from "../assets/myhomebro_logo.png";

console.log("Rendering the REAL LandingPage.jsx!");

const quickPoints = [
  { icon: "🔒", text: "Escrow-secured payments for true peace of mind." },
  { icon: "⚡", text: "Quick contractor sign-up—get paid faster." },
  { icon: "💬", text: "Direct chat between homeowners and contractors." },
  { icon: "👷‍♂️", text: "Bring your own clients, or get matched (coming soon)." },
];

const features = [
  { icon: "⚖️", title: "Dispute Protection", text: "Built-in mediation and escrow so your funds are safe, even if issues arise." },
  { icon: "🗓️", title: "Project Calendar", text: "Track every project and milestone in one place—auto-updated, no paperwork." },
  { icon: "💵", title: "Invoicing & Earnings", text: "Send invoices, get paid, and view earnings—zero paperwork." },
  { icon: "📄", title: "Agreements", text: "Digital agreements with e-signature and milestone scheduling." },
  { icon: "📈", title: "Earnings Report", text: "See all project earnings in one place with downloadable reports." },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, openLogin } = useAuth();

  const handleTopRightSignIn = useCallback((evt) => {
    evt?.preventDefault?.();
    console.log("🔔 Top-right Sign In clicked");
    openLogin();
  }, [openLogin]);

  const handleCtaSignIn = useCallback((evt) => {
    evt?.preventDefault?.();
    console.log("🔔 CTA Sign In clicked");
    openLogin();
  }, [openLogin]);

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-x-hidden bg-gradient-to-br from-blue-900 via-blue-700 to-yellow-400">
      <div className="absolute top-0 right-0 w-full flex justify-end px-8 py-6 z-30">
        {!user ? (
          <>
            <button
              type="button"
              className="mr-6 text-white/90 hover:text-yellow-300 font-semibold text-lg"
              onClick={handleTopRightSignIn}
              aria-label="Sign In"
            >
              Sign In
            </button>
            <button
              type="button"
              className="bg-yellow-400 hover:bg-yellow-500 text-blue-900 font-bold py-2 px-5 rounded-xl shadow transition text-lg"
              onClick={() => navigate("/signup")}
              aria-label="Sign Up"
            >
              Sign Up
            </button>
          </>
        ) : (
          <span className="text-white/90 font-medium text-lg">
            Welcome, {user?.email || "contractor"}
          </span>
        )}
      </div>

      {/* Animated blurred blobs */}
      <motion.div
        className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-yellow-300/40 blur-3xl z-0"
        animate={{ y: [0, 40, 0] }}
        transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-36 right-0 w-96 h-96 rounded-full bg-blue-600/30 blur-3xl z-0"
        animate={{ y: [0, -30, 0] }}
        transition={{ repeat: Infinity, duration: 10, ease: "easeInOut" }}
      />

      {/* Main content */}
      <div className="z-10 flex flex-col items-center w-full max-w-2xl px-4 pt-14">
        <motion.img
          src={logo}
          alt="MyHomeBro Logo"
          className="mx-auto mb-8 w-52 md:w-72 rounded-2xl shadow-2xl bg-white/10 p-3 ring-4 ring-yellow-300/40"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8 }}
        />

        <motion.h1
          className="text-5xl md:text-6xl font-extrabold text-white text-center mb-3 drop-shadow-lg"
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          Welcome to <span className="bg-gradient-to-r from-yellow-300 via-yellow-500 to-blue-300 bg-clip-text text-transparent drop-shadow-md">MyHomeBro</span>
        </motion.h1>

        <motion.p
          className="text-lg md:text-xl text-white/90 text-center mb-2"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          Secure Escrow Payments for Contractors and Homeowners.
        </motion.p>

        <motion.p
          className="font-semibold text-white text-center mb-8"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
        >
          <span className="bg-gradient-to-r from-yellow-200 via-yellow-500 to-blue-100 bg-clip-text text-transparent">
            The easiest way to pay and get paid for home projects.
          </span>
        </motion.p>

        <div className="flex flex-wrap gap-5 justify-center mb-10 w-full">
          {quickPoints.map((pt, i) => (
            <motion.div
              key={i}
              className="bg-white/90 px-6 py-4 rounded-2xl shadow-lg text-blue-900 font-semibold flex items-center gap-3 min-w-[220px] text-base hover:scale-105 transition-transform cursor-pointer"
              whileHover={{ scale: 1.07 }}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 + i * 0.13, duration: 0.5 }}
            >
              <span className="text-2xl">{pt.icon}</span>
              {pt.text}
            </motion.div>
          ))}
        </div>

        <div className="flex gap-6 mb-10">
          <motion.button
            className="bg-yellow-400 hover:bg-yellow-500 text-blue-900 font-bold py-3 px-10 rounded-2xl shadow-xl text-xl transition duration-150 focus:ring-2 focus:ring-yellow-300"
            whileHover={{ scale: 1.08 }}
            onClick={() => navigate("/signup")}
            aria-label="Contractor Sign Up"
          >
            Contractor Sign Up
          </motion.button>
          <motion.button
            className="border-2 border-white/70 text-white hover:bg-blue-800 font-bold py-3 px-10 rounded-2xl text-xl shadow-xl transition duration-150 focus:ring-2 focus:ring-blue-200"
            whileHover={{ scale: 1.08 }}
            onClick={handleCtaSignIn}
            aria-label="Sign In"
          >
            Sign In
          </motion.button>
        </div>
      </div>

      <div className="w-full max-w-6xl mx-auto mt-2 mb-14 px-2">
        <div className="flex gap-7 overflow-x-auto py-4 px-1 scrollbar-thin scrollbar-thumb-blue-200 scrollbar-track-transparent">
          {features.map((feature, idx) => (
            <div
              key={idx}
              className="min-w-[260px] max-w-xs bg-white/95 rounded-2xl shadow-2xl p-7 flex flex-col items-center text-center border border-blue-100 hover:scale-105 transition"
            >
              <span className="text-4xl mb-3">{feature.icon}</span>
              <h3 className="text-xl font-bold mb-2 text-blue-900">{feature.title}</h3>
              <p className="text-blue-800">{feature.text}</p>
            </div>
          ))}
        </div>
      </div>

      <motion.div
        className="w-full flex flex-col items-center gap-2 mt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.95 }}
        transition={{ delay: 1.5 }}
      >
        <div className="flex gap-4 flex-wrap justify-center">
          <span className="bg-white/80 rounded-full px-5 py-2 shadow text-blue-800 font-medium flex items-center gap-2">
            🏆 Trusted by Contractors
          </span>
          <span className="bg-white/80 rounded-full px-5 py-2 shadow text-yellow-700 font-medium flex items-center gap-2">
            ⭐ Secure & Reliable
          </span>
        </div>
      </motion.div>

      <footer className="z-10 mt-8 text-white/80 text-base text-center w-full mb-2 font-medium tracking-wide">
        © {new Date().getFullYear()} MyHomeBro. All rights reserved.
      </footer>
    </div>
  );
}
