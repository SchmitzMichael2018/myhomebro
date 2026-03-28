import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';

import api from '../api';

const EMPTY_FORM = {
  full_name: '',
  phone: '',
  email: '',
  project_address: '',
  project: '',
  notes: '',
};

function formatPhoneInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function hasFormData(form) {
  return Object.values(form || {}).some((value) => String(value || '').trim());
}

function buildPayload(form) {
  return {
    full_name: String(form.full_name || '').trim(),
    phone: String(form.phone || '').trim(),
    email: String(form.email || '').trim(),
    project_address: String(form.project_address || '').trim(),
    notes: [String(form.project || '').trim(), String(form.notes || '').trim()]
      .filter(Boolean)
      .join('\n\n'),
  };
}

export default function QuickAddLeadModal({
  endpoint = '/projects/contractor/public-leads/',
  renderFab = true,
  open,
  defaultOpen = false,
  initialForm = null,
  onOpenChange,
  onCreated,
  onClose,
  fabLabel = 'Quick Add Lead',
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState(EMPTY_FORM);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? open : internalOpen;
  const nameInputRef = useRef(null);
  const phoneInputRef = useRef(null);
  const modalTitleId = useId();
  const appliedPrefillSignatureRef = useRef('');

  function setOpenState(nextValue) {
    if (!isControlled) {
      setInternalOpen(nextValue);
    }
    onOpenChange?.(nextValue);
    if (!nextValue) {
      onClose?.();
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setErrors({});
    setDetailsOpen(false);
  }

  function requestClose() {
    if (submitting) return;
    if (hasFormData(form)) {
      const confirmed = window.confirm(
        'Discard this lead capture? Your entered details will be lost.'
      );
      if (!confirmed) return;
    }
    resetForm();
    setOpenState(false);
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 140);

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    const nextPrefill = initialForm && typeof initialForm === 'object' ? initialForm : null;
    if (!nextPrefill) return;
    const signature = JSON.stringify(nextPrefill);
    if (signature === appliedPrefillSignatureRef.current) return;
    appliedPrefillSignatureRef.current = signature;
    setForm((prev) => ({
      ...prev,
      full_name: prev.full_name || String(nextPrefill.full_name || '').trim(),
      phone: prev.phone || formatPhoneInput(nextPrefill.phone || ''),
      email: prev.email || String(nextPrefill.email || '').trim(),
      project_address: prev.project_address || String(nextPrefill.project_address || '').trim(),
      project: prev.project || String(nextPrefill.project || '').trim(),
      notes: prev.notes || String(nextPrefill.notes || '').trim(),
    }));
    if (
      String(nextPrefill.email || '').trim() ||
      String(nextPrefill.project_address || '').trim() ||
      String(nextPrefill.project || '').trim() ||
      String(nextPrefill.notes || '').trim()
    ) {
      setDetailsOpen(true);
    }
  }, [initialForm]);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  }

  function validateForm() {
    const nextErrors = {};
    if (!String(form.full_name || '').trim()) {
      nextErrors.full_name = 'Name is required.';
    }
    const phoneDigits = String(form.phone || '').replace(/\D/g, '');
    if (!phoneDigits) {
      nextErrors.phone = 'Phone is required.';
    } else if (phoneDigits.length < 10) {
      nextErrors.phone = 'Enter a full phone number.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submitLead(event) {
    event?.preventDefault();
    if (!validateForm()) return;

    try {
      setSubmitting(true);
      const { data } = await api.post(endpoint, buildPayload(form));
      toast.success('Lead added to your inbox.');
      onCreated?.(data);
      resetForm();
      setOpenState(false);
    } catch (err) {
      const responseData = err?.response?.data || {};
      setErrors({
        full_name: responseData?.full_name?.[0] || '',
        phone: responseData?.phone?.[0] || '',
        email: responseData?.email?.[0] || '',
      });
      toast.error(
        responseData?.non_field_errors?.[0] ||
          responseData?.detail ||
          responseData?.email?.[0] ||
          responseData?.phone?.[0] ||
          'Failed to create lead.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {renderFab ? (
        <button
          type="button"
          data-testid="quick-add-lead-button"
          onClick={() => setOpenState(true)}
          className="fixed bottom-5 right-4 z-40 inline-flex h-14 items-center justify-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white shadow-lg shadow-slate-900/30 transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 md:bottom-6 md:right-6"
        >
          <Plus className="h-5 w-5" />
          <span className="sm:hidden">{fabLabel}</span>
          <span className="hidden sm:inline">{fabLabel}</span>
        </button>
      ) : null}

      <AnimatePresence>
        {isOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Close quick add lead"
              className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[1px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={requestClose}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={modalTitleId}
              data-testid="quick-add-lead-sheet"
              className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-xl rounded-t-[28px] border border-slate-200 bg-white shadow-2xl"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 360, damping: 34, mass: 0.9 }}
            >
              <form onSubmit={submitLead} className="flex max-h-[88vh] flex-col">
                <div className="flex items-center justify-between px-4 pt-3">
                  <div className="mx-auto h-1.5 w-14 rounded-full bg-slate-300" />
                  <button
                    type="button"
                    onClick={requestClose}
                    className="absolute right-4 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="overflow-y-auto px-4 pb-28 pt-3">
                  <div className="mb-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      Warm Lead
                    </div>
                    <h2 id={modalTitleId} className="mt-2 text-xl font-bold text-slate-900">
                      Quick Add Lead
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Capture the contact now. Fill in the rest later or send an intake form.
                    </p>
                  </div>

                  <div data-testid="manual-lead-form" className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-800">
                        Homeowner name
                      </label>
                      <input
                        ref={nameInputRef}
                        data-testid="quick-add-lead-name"
                        value={form.full_name}
                        onChange={(e) => updateField('full_name', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            phoneInputRef.current?.focus();
                          }
                        }}
                        autoComplete="name"
                        enterKeyHint="next"
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                        placeholder="Full name"
                      />
                      {errors.full_name ? (
                        <div className="mt-1 text-sm text-rose-600">{errors.full_name}</div>
                      ) : null}
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-800">
                        Phone
                      </label>
                      <input
                        ref={phoneInputRef}
                        data-testid="quick-add-lead-phone"
                        value={form.phone}
                        onChange={(e) => updateField('phone', formatPhoneInput(e.target.value))}
                        inputMode="tel"
                        autoComplete="tel"
                        enterKeyHint="done"
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                        placeholder="(555) 555-5555"
                      />
                      {errors.phone ? (
                        <div className="mt-1 text-sm text-rose-600">{errors.phone}</div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50">
                      <button
                        type="button"
                        data-testid="quick-add-lead-more-toggle"
                        onClick={() => setDetailsOpen((prev) => !prev)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-900">More details</div>
                          <div className="text-xs text-slate-500">
                            Email, address, project details, and notes
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-slate-600">
                          {detailsOpen ? 'Hide' : 'Add'}
                        </span>
                      </button>

                      <AnimatePresence initial={false}>
                        {detailsOpen ? (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden border-t border-slate-200"
                          >
                            <div className="space-y-4 px-4 py-4">
                              <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-800">
                                  Email
                                </label>
                                <input
                                  data-testid="quick-add-lead-email"
                                  value={form.email}
                                  onChange={(e) => updateField('email', e.target.value)}
                                  inputMode="email"
                                  autoComplete="email"
                                  className="w-full rounded-2xl border border-slate-300 px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                                  placeholder="name@example.com"
                                />
                                {errors.email ? (
                                  <div className="mt-1 text-sm text-rose-600">{errors.email}</div>
                                ) : null}
                              </div>

                              <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-800">
                                  Address
                                </label>
                                <input
                                  data-testid="quick-add-lead-address"
                                  value={form.project_address}
                                  onChange={(e) => updateField('project_address', e.target.value)}
                                  autoComplete="street-address"
                                  className="w-full rounded-2xl border border-slate-300 px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                                  placeholder="123 Main St"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-800">
                                  Project
                                </label>
                                <input
                                  data-testid="quick-add-lead-project"
                                  value={form.project}
                                  onChange={(e) => updateField('project', e.target.value)}
                                  className="w-full rounded-2xl border border-slate-300 px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                                  placeholder="Kitchen remodel, roof repair, bath update..."
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-800">
                                  Notes
                                </label>
                                <textarea
                                  data-testid="quick-add-lead-notes"
                                  value={form.notes}
                                  onChange={(e) => updateField('notes', e.target.value)}
                                  rows={4}
                                  className="w-full rounded-2xl border border-slate-300 px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                                  placeholder="Referral details, timeline, follow-up plan, or anything you want to remember."
                                />
                              </div>
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur">
                  <button
                    type="submit"
                    data-testid="manual-lead-save"
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-4 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submitting ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Creating Lead...
                      </>
                    ) : (
                      'Create Lead'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
