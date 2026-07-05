import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";

function safeText(value) {
  return String(value ?? "").trim();
}

function contractorKey(contractor) {
  return safeText(contractor?.id || contractor?.directory_entry_id || contractor?.contractor_id || contractor?.business_name);
}

function formatSlot(slot) {
  const date = slot?.date ? new Date(`${slot.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  return [slot?.appointment_type_label, date, slot?.time, `${slot?.duration_minutes || 0} min`].filter(Boolean).join(" - ");
}

export default function EstimateSlotPicker({
  contractors = [],
  preferences = {},
  onChange,
  variant = "light",
  testId = "estimate-slot-picker",
}) {
  const [availability, setAvailability] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const selected = useMemo(() => (Array.isArray(contractors) ? contractors : []).filter((row) => row?.contractor_id), [contractors]);
  const isDark = variant === "portal";

  useEffect(() => {
    let active = true;
    selected.forEach(async (contractor) => {
      const key = contractorKey(contractor);
      if (!key || availability[key] || loading[key]) return;
      setLoading((current) => ({ ...current, [key]: true }));
      try {
        const { data } = await api.get("/projects/public-intake/estimate-availability/", {
          params: { contractor_id: contractor.contractor_id, directory_entry_id: contractor.directory_entry_id },
        });
        if (!active) return;
        setAvailability((current) => ({ ...current, [key]: data }));
      } catch (error) {
        if (!active) return;
        setErrors((current) => ({ ...current, [key]: error?.response?.data?.detail || "Availability could not be loaded." }));
      } finally {
        if (active) setLoading((current) => ({ ...current, [key]: false }));
      }
    });
    return () => {
      active = false;
    };
  }, [selected, availability, loading]);

  if (!selected.length) return null;

  const panelClass = isDark
    ? "rounded-2xl border border-sky-300/30 bg-sky-300/10 p-4 text-slate-100"
    : "rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-slate-900";
  const cardClass = isDark
    ? "rounded-xl border border-slate-700 bg-slate-950/70 p-3"
    : "rounded-xl border border-indigo-100 bg-white p-3";
  const optionClass = isDark
    ? "flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
    : "flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800";

  function updatePreference(key, next) {
    onChange?.({ ...preferences, [key]: next });
  }

  return (
    <section className={panelClass} data-testid={testId}>
      <div className="text-sm font-bold">Preferred Estimate</div>
      <p className={`mt-1 text-sm ${isDark ? "text-slate-300" : "text-indigo-900/80"}`}>
        We found available estimate times for this contractor. Your requested estimate appointment is awaiting contractor confirmation.
      </p>
      <div className="mt-4 space-y-3">
        {selected.map((contractor) => {
          const key = contractorKey(contractor);
          const pref = preferences[key] || { preference: "contact_later" };
          const slots = availability[key]?.slots || availability[key]?.results || [];
          return (
            <div key={key} className={cardClass} data-testid={`estimate-slot-picker-contractor-${key}`}>
              <div className="font-semibold">{contractor.business_name || "Selected contractor"}</div>
              {loading[key] ? <p className="mt-2 text-sm">Loading estimate availability...</p> : null}
              {errors[key] ? <p className="mt-2 text-sm text-rose-300">{errors[key]}</p> : null}
              {!loading[key] && !slots.length ? (
                <p className={`mt-2 text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                  No estimate availability has been published yet.
                </p>
              ) : null}
              <div className="mt-3 space-y-2">
                {slots.slice(0, 6).map((slot) => (
                  <label key={slot.slot_id} className={optionClass}>
                    <input
                      type="radio"
                      name={`estimate-slot-${key}`}
                      checked={pref.preference === "slot" && pref.scheduled_start === slot.scheduled_start}
                      onChange={() =>
                        updatePreference(key, {
                          preference: "slot",
                          scheduled_start: slot.scheduled_start,
                          appointment_type: slot.appointment_type,
                          duration_minutes: slot.duration_minutes,
                          timezone: slot.timezone,
                        })
                      }
                      data-testid={`estimate-slot-option-${key}`}
                    />
                    <span>{formatSlot(slot)}</span>
                  </label>
                ))}
                <label className={optionClass}>
                  <input
                    type="radio"
                    name={`estimate-slot-${key}`}
                    checked={pref.preference === "flexible"}
                    onChange={() => updatePreference(key, { preference: "flexible" })}
                    data-testid={`estimate-slot-flexible-${key}`}
                  />
                  <span>I'm flexible</span>
                </label>
                <label className={optionClass}>
                  <input
                    type="radio"
                    name={`estimate-slot-${key}`}
                    checked={pref.preference === "contact_later" || !pref.preference}
                    onChange={() => updatePreference(key, { preference: "contact_later" })}
                    data-testid={`estimate-slot-contact-later-${key}`}
                  />
                  <span>Contact me to schedule later</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
