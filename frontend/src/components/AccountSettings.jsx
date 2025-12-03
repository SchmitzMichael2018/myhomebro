// frontend/src/components/AccountSettings.jsx
// v2025-11-28 — Account & Login with Show/Hide Password icons

import React, { useState } from "react";
import api from "../api";

const fieldClass =
  "form-control block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

const labelClass = "block text-sm font-semibold mb-1";

function ErrorText({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

function SuccessText({ message }) {
  if (!message) return null;
  return <p className="mt-2 text-sm font-semibold text-green-600">{message}</p>;
}

// Generic password input with show/hide
function PasswordInput({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <label className={labelClass}>{label}</label>
      <input
        type={show ? "text" : "password"}
        className={`${fieldClass} pr-12`}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />

      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-slate-500 hover:text-slate-800"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export default function AccountSettings() {
  // Email change state
  const [currentEmailPassword, setCurrentEmailPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [confirmNewEmail, setConfirmNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setEmailError("");
    setEmailSuccess("");

    if (!newEmail || !confirmNewEmail) {
      setEmailError("Please enter and confirm your new email.");
      return;
    }
    if (newEmail.trim() !== confirmNewEmail.trim()) {
      setEmailError("New email and confirmation do not match.");
      return;
    }
    if (!currentEmailPassword) {
      setEmailError("Please enter your current password.");
      return;
    }

    try {
      setEmailLoading(true);
      const r = await api.post("/accounts/change-email/", {
        current_password: currentEmailPassword,
        new_email: newEmail.trim(),
      });

      if (r?.data?.email) {
        setEmailSuccess("Your email address has been updated.");
      } else {
        setEmailSuccess("Email updated successfully.");
      }

      setNewEmail("");
      setConfirmNewEmail("");
      setCurrentEmailPassword("");
    } catch (err) {
      const data = err.response?.data;
      const msg =
        data?.detail ||
        data?.non_field_errors?.[0] ||
        data?.current_password?.[0] ||
        data?.new_email?.[0] ||
        "Unable to update email.";
      setEmailError(msg);
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    try {
      setPasswordLoading(true);
      await api.post("/accounts/change-password/", {
        old_password: currentPassword,
        new_password: newPassword,
        new_password_confirm: confirmNewPassword,
      });

      setPasswordSuccess("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      const data = err.response?.data;
      const msg =
        data?.detail ||
        data?.non_field_errors?.[0] ||
        data?.old_password?.[0] ||
        data?.new_password?.[0] ||
        "Unable to update password.";
      setPasswordError(msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="mt-6 max-w-3xl">
      <div className="rounded-lg bg-white p-4 shadow">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">Account & Login</h2>
        <p className="mb-4 text-sm text-gray-600">
          Update the email and password you use to sign in to MyHomeBro.
        </p>

        {/* EMAIL CHANGE */}
        <div className="mb-8 border-b border-gray-200 pb-6">
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Change Email / Username
          </h3>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>New Email Address</label>
              <input
                type="email"
                className={fieldClass}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>

            <div>
              <label className={labelClass}>Confirm New Email Address</label>
              <input
                type="email"
                className={fieldClass}
                value={confirmNewEmail}
                onChange={(e) => setConfirmNewEmail(e.target.value)}
              />
            </div>

            <PasswordInput
              label="Current Password"
              value={currentEmailPassword}
              onChange={(e) => setCurrentEmailPassword(e.target.value)}
              placeholder="Enter your current password"
            />

            <ErrorText message={emailError} />
            <SuccessText message={emailSuccess} />

            <button
              type="submit"
              disabled={emailLoading}
              className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-400"
            >
              {emailLoading ? "Saving…" : "Update Email"}
            </button>
          </form>
        </div>

        {/* PASSWORD CHANGE */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-800">Change Password</h3>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <PasswordInput
              label="Current Password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
            />

            <PasswordInput
              label="New Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
            />

            <PasswordInput
              label="Confirm New Password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder="Repeat new password"
            />

            <ErrorText message={passwordError} />
            <SuccessText message={passwordSuccess} />

            <button
              type="submit"
              disabled={passwordLoading}
              className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-400"
            >
              {passwordLoading ? "Saving…" : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
