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
        // If tokens returned, log in the user automatically (optional, user-friendly)
        const { access, refresh } = response.data;
        if (access && refresh) {
          localStorage.setItem('access', access);
          localStorage.setItem('refresh', refresh);
          navigate("/dashboard");
        } else {
          alert("✅ Account created! Please log in.");
          navigate("/signin");
        }
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
            <input
              ref={nameRef}
              type="text"
              name="name"
              placeholder="Full Name"
              value={formData.name}
              onChange={handleChange}
              required
              className="input-field"
              aria-label="Full Name"
            />
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={formData.email}
              onChange={handleChange}
              required
              className="input-field"
              aria-label="Email"
              autoComplete="email"
            />
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Password (min 8 characters)"
                value={formData.password}
                onChange={handleChange}
                required
                className="input-field"
                aria-label="Password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-blue-600"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            <input
              type="password"
              name="passwordConfirm"
              placeholder="Confirm Password"
              value={formData.passwordConfirm}
              onChange={handleChange}
              required
              className="input-field"
              aria-label="Confirm Password"
              autoComplete="new-password"
            />

            <input
              type="tel"
              name="phone"
              placeholder="Phone Number (10 digits)"
              value={formData.phone}
              onChange={handleChange}
              required
              className="input-field"
              pattern="\d{10}"
              aria-label="Phone Number"
            />

            <input
              type="text"
              name="businessName"
              placeholder="Business Name (Optional)"
              value={formData.businessName}
              onChange={handleChange}
              className="input-field"
              aria-label="Business Name"
            />

            <input
              type="text"
              name="skills"
              placeholder="Skills (Optional - e.g., Plumbing, Electrical)"
              value={formData.skills}
              onChange={handleChange}
              className="input-field"
              aria-label="Skills"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2 mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition duration-300 flex items-center justify-center"
            disabled={loading}
            aria-busy={loading ? "true" : undefined}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path d="M4 12a8 8 0 018-8v8h8a8 8 0 01-8 8z" fill="currentColor"></path>
                </svg>
                Signing Up...
              </>
            ) : (
              "Sign Up"
            )}
          </button>

          {error && <p className="text-red-500 text-center mt-4">{error}</p>}
        </form>
      </div>
    </div>
  );
}



