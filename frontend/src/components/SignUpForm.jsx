// src/components/SignUpForm.jsx

import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function SignUpForm() {
  const navigate = useNavigate();
  const nameRef = useRef(null);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    passwordConfirm: "",
    businessName: "",
    phone: "",
    skills: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  const validateForm = () => {
    if (formData.password !== formData.passwordConfirm) {
      return "❌ Passwords do not match.";
    }
    if (formData.password.length < 8) {
      return "❌ Password must be at least 8 characters.";
    }
    if (!/^\d{10}$/.test(formData.phone)) {
      return "❌ Please enter a valid 10-digit phone number.";
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      setLoading(false);
      return;
    }

    try {
      const response = await api.post("/accounts/auth/contractor-register/", {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        business_name: formData.businessName,
        phone: formData.phone,
        skills: formData.skills,
      });

      if (response.status === 201) {
        const { access, refresh } = response.data;
        localStorage.setItem("access", access);
        localStorage.setItem("refresh", refresh);
        navigate("/onboarding/redirect");
      }
    } catch (err) {
      console.error("Registration Error:", err);
      if (err.response) {
        setError(`❌ ${err.response.data?.error || err.response.data?.detail || "Registration failed. Please try again."}`);
      } else {
        setError("❌ Network error. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-blue-50 to-blue-100">
      <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md">
        <h2 className="text-3xl font-bold text-blue-700 mb-6 text-center">Contractor Sign Up</h2>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4">
            <input ref={nameRef} name="name" value={formData.name} onChange={handleChange} placeholder="Full Name" required className="input-field" />
            <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="Email" required className="input-field" />
            <div className="relative">
              <input type={showPassword ? "text" : "password"} name="password" value={formData.password} onChange={handleChange} placeholder="Password" required className="input-field" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-600" tabIndex={-1}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <input type="password" name="passwordConfirm" value={formData.passwordConfirm} onChange={handleChange} placeholder="Confirm Password" required className="input-field" />
            <input name="phone" value={formData.phone} onChange={handleChange} placeholder="Phone (10 digits)" required className="input-field" pattern="\d{10}" />
            <input name="businessName" value={formData.businessName} onChange={handleChange} placeholder="Business Name (optional)" className="input-field" />
            <input name="skills" value={formData.skills} onChange={handleChange} placeholder="Skills (optional)" className="input-field" />
          </div>

          <button type="submit" disabled={loading} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition duration-300">
            {loading ? "Signing Up..." : "Sign Up"}
          </button>

          {error && <p className="text-red-500 text-center mt-4">{error}</p>}
        </form>
      </div>
    </div>
  );
}
