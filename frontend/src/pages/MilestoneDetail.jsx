// src/pages/MilestoneDetail.jsx

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import DateField from '../components/DateField'; // reliable calendar button

// --- Helpers ---------------------------------------------------------------

const formatCurrency = (amount) => {
  const n = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
};

const shallowEqual = (a, b) => {
  const ak = Object.keys(a || {});
  const bk = Object.keys(b || {});
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
};

const pickForm = (m) => ({
  title: m?.title || '',
  amount: (m?.amount ?? '') === null ? '' : (m?.amount ?? ''),
  description: m?.description || '',
  start_date: m?.start_date || '',
  completion_date: m?.completion_date || '',
  completed: !!m?.completed,
});

// --- Component -------------------------------------------------------------

export default function MilestoneDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const draftKey = useMemo(() => `milestoneDraft:${id}`, [id]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [loading, setLoading] = useState(true);
  const [milestone, setMilestone] = useState(null);          // server snapshot
  const [form, setForm] = useState(pickForm(null));          // editable state
  const [error, setError] = useState('');

  const [lastSavedAt, setLastSavedAt] = useState(null);      // Draft timestamp
  const [draftLoaded, setDraftLoaded] = useState(false);     // Banner indicator
  const [autoSaving, setAutoSaving] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});        // inline validation errors

  const titleRef = useRef(null);
  const amountRef = useRef(null);
  const startRef = useRef(null);
  const completionRef = useRef(null);
  const descriptionRef = useRef(null);

  const initialMounted = useRef(true);

  // Fetch from server
  const fetchMilestone = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/milestones/${id}/`);
      setMilestone(data);

      // If a draft exists, prefer it; otherwise load server as form
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.form) {
            setForm({ ...pickForm(data), ...parsed.form });
            setLastSavedAt(parsed.lastSavedAt || null);
            setDraftLoaded(true);
          } else {
            setForm(pickForm(data));
          }
        } catch {
          setForm(pickForm(data));
        }
      } else {
        setForm(pickForm(data));
      }
    } catch (err) {
      setError('Could not load milestone details.');
      toast.error('Could not load milestone details.');
      navigate('/agreements');
    } finally {
      setLoading(false);
    }
  }, [id, draftKey, navigate]);

  useEffect(() => {
    fetchMilestone();
    const beforeUnload = (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchMilestone]);

  // Determine dirtiness vs server snapshot OR existing draft
  const isDirty = useCallback(() => {
    if (!milestone) return false;
    const serverForm = pickForm(milestone);
    return !shallowEqual(
      { ...serverForm, amount: Number(serverForm.amount) || serverForm.amount },
      { ...form,       amount: Number(form.amount) || form.amount }
    );
  }, [milestone, form]);

  // Debounced autosave (silent)
  useEffect(() => {
    if (loading || !milestone) return;
    const t = setTimeout(() => {
      if (!isDirty()) return;
      try {
        const ts = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
        setLastSavedAt(ts);
        setDraftLoaded(true);
        setAutoSaving(true);
        setTimeout(() => setAutoSaving(false), 500);
      } catch {
        // ignore write errors
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [form, isDirty, loading, milestone, draftKey]);

  // Handlers
  const handleField = (field, value) => {
    setForm((prev) => {
      let v = value;
      if (field === 'amount') {
        v = value === '' ? '' : Number(value);
        if (Number.isNaN(v)) v = '';
      }
      if (field === 'completed') v = !!value;
      return { ...prev, [field]: v };
    });
    setFieldErrors((prev) => ({ ...prev, [field]: '' })); // clear field error on change
  };

  const saveDraft = () => {
    try {
      const ts = new Date().toISOString();
      localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
      setLastSavedAt(ts);
      setDraftLoaded(true);
      toast.success('Draft saved.');
    } catch {
      toast.error('Unable to save draft locally.');
    }
  };

  const discardDraft = () => {
    try { localStorage.removeItem(draftKey); } catch {}
    if (milestone) {
      setForm(pickForm(milestone));
      setLastSavedAt(null);
      setDraftLoaded(false);
      setFieldErrors({});
      toast('Draft discarded.');
    }
  };

  const validateForm = () => {
    const errs = {};
    if (!String(form.title || '').trim()) errs.title = 'Title is required';
    if (form.amount !== '' && !Number.isFinite(Number(form.amount))) errs.amount = 'Enter a valid amount';
    if (form.start_date && form.completion_date) {
      if (new Date(form.completion_date) < new Date(form.start_date)) {
        errs.completion_date = 'Completion must be on or after start';
      }
    }
    return errs;
  };

  const scrollToFirstError = (errs) => {
    const order = ['title', 'amount', 'start_date', 'completion_date', 'description'];
    const map = {
      title: titleRef,
      amount: amountRef,
      start_date: startRef,
      completion_date: completionRef,
      description: descriptionRef,
    };
    for (const key of order) {
      if (errs[key]) {
        const node = map[key]?.current;
        if (node && node.scrollIntoView) {
          node.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (node.focus) setTimeout(() => node.focus(), 50);
        }
        break;
      }
    }
  };

  const saveChanges = async () => {
    const errs = validateForm();
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields.');
      scrollToFirstError(errs);
      return;
    }

    try {
      const payload = {
        title: form.title,
        amount: form.amount === '' ? 0 : Number(form.amount),
        description: form.description,
        start_date: form.start_date || null,
        completion_date: form.completion_date || null,
        completed: !!form.completed,
      };
      const { data } = await api.patch(`/milestones/${id}/`, payload);
      setMilestone(data);
      setForm(pickForm(data));
      try { localStorage.removeItem(draftKey); } catch {}
      setLastSavedAt(null);
      setDraftLoaded(false);
      setFieldErrors({});
      toast.success('Milestone saved.');
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join(' | ')
        : 'Failed to save milestone.';
      toast.error(msg || 'Failed to save milestone.');
    }
  };

  const goBack = () => {
    // silent autosave on back
    if (isDirty()) {
      try {
        const ts = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ form, lastSavedAt: ts }));
        setLastSavedAt(ts);
        setDraftLoaded(true);
      } catch {}
    }
    navigate(-1);
  };

  // On first mount after data load: if no draft loaded and form equals server, hide draft banner
  useEffect(() => {
    if (!loading && initialMounted.current) {
      initialMounted.current = false;
      if (!draftLoaded) setLastSavedAt(null);
    }
  }, [loading, draftLoaded]);

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading milestone...</div>;
  }
  if (error || !milestone) return null;

  const serverAmount = milestone?.amount ?? 0;
  const formAmount = form?.amount === '' ? 0 : Number(form?.amount);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={goBack} className="text-sm text-blue-600 hover:underline">
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveDraft}
            className="px-3 py-2 rounded border hover:bg-gray-50"
          >
            Save Draft
          </button>
          <button
            type="button"
            onClick={saveChanges}
            disabled={!isDirty()}
            className={`px-3 py-2 rounded text-white ${
              isDirty() ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'
            }`}
          >
            Save Changes
          </button>
        </div>
      </div>

      {/* Draft banner */}
      {(draftLoaded || lastSavedAt) && (
        <div className="mb-4 p-3 rounded bg-yellow-50 border border-yellow-200 text-yellow-800 flex items-center justify-between">
          <div className="text-sm">
            {draftLoaded ? 'Loaded local draft.' : 'Draft available.'}{' '}
            {lastSavedAt && (
              <span className="opacity-80">
                {autoSaving ? 'Auto-saved ' : 'Last saved '}{new Date(lastSavedAt).toLocaleString()}
              </span>
            )}
          </div>
          <button onClick={discardDraft} className="text-sm underline hover:opacity-80">
            Discard draft
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800">
          {milestone.title || 'Untitled Milestone'}
        </h1>
        <p className="text-gray-500">
          Part of Agreement:{' '}
          <Link
            to={`/agreements/${milestone.agreement}`}
            className="text-blue-600 font-semibold hover:underline"
          >
            {milestone.agreement_title || `Agreement #${milestone.agreement}`}
          </Link>
        </p>
      </div>

      {/* Card */}
      <div className="bg-white p-6 rounded-xl shadow-md space-y-6">
        {/* Amount + Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <div>
            <h3 className="font-semibold text-gray-600 text-sm">Server Amount</h3>
            <p className="text-lg font-bold">{formatCurrency(serverAmount)}</p>
            <div className="mt-3">
              <label className="block text-sm text-gray-600 mb-1">Edit Amount ($)</label>
              <input
                ref={amountRef}
                type="number"
                min="0"
                step="0.01"
                value={form.amount === '' ? '' : form.amount}
                onChange={(e) => handleField('amount', e.target.value)}
                className={`w-full border rounded px-3 py-2 ${fieldErrors.amount ? 'ring-1 ring-red-500' : ''}`}
                placeholder="0.00"
                aria-invalid={!!fieldErrors.amount}
              />
              {fieldErrors.amount && <div className="text-xs text-red-600 mt-1">{fieldErrors.amount}</div>}
              <div className="text-xs text-gray-500 mt-1">Preview: {formatCurrency(formAmount)}</div>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <h3 className="font-semibold text-gray-600 text-sm">Server Status</h3>
            <p className={`font-bold ${milestone.completed ? 'text-green-600' : 'text-yellow-600'}`}>
              {milestone.completed ? '✅ Completed' : '⌛ Incomplete'}
            </p>

            <div className="mt-3 sm:inline-block">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.completed}
                  onChange={(e) => handleField('completed', e.target.checked)}
                />
                Mark as Completed
              </label>
            </div>
          </div>
        </div>

        {/* Title & Description */}
        <div className="border-t pt-4 grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Title</label>
            <input
              ref={titleRef}
              value={form.title}
              onChange={(e) => handleField('title', e.target.value)}
              className={`w-full border rounded px-3 py-2 ${fieldErrors.title ? 'ring-1 ring-red-500' : ''}`}
              placeholder="Milestone title"
              aria-invalid={!!fieldErrors.title}
            />
            {fieldErrors.title && <div className="text-xs text-red-600 mt-1">{fieldErrors.title}</div>}
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Description</label>
            <textarea
              ref={descriptionRef}
              value={form.description}
              onChange={(e) => handleField('description', e.target.value)}
              className="w-full border rounded px-3 py-2"
              rows={4}
              placeholder="What work is included for this milestone?"
            />
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
          <div>
            <h3 className="font-semibold text-gray-600 text-sm mb-1">Start Date</h3>
            <DateField
              value={form.start_date || ''}
              onChange={(e) => handleField('start_date', e.target.value)}
              min={today}
              className={`w-full ${fieldErrors.start_date ? 'ring-1 ring-red-500' : ''}`}
            />
            {fieldErrors.start_date && <div className="text-xs text-red-600 mt-1">{fieldErrors.start_date}</div>}
            {/* Invisible anchor for scrollIntoView */}
            <div ref={startRef} className="sr-only" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-600 text-sm mb-1">Completion Date</h3>
            <DateField
              value={form.completion_date || ''}
              onChange={(e) => handleField('completion_date', e.target.value)}
              min={form.start_date || today}
              className={`w-full ${fieldErrors.completion_date ? 'ring-1 ring-red-500' : ''}`}
            />
            {fieldErrors.completion_date && <div className="text-xs text-red-600 mt-1">{fieldErrors.completion_date}</div>}
            <div ref={completionRef} className="sr-only" />
          </div>
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-between border-t pt-4">
          <button
            type="button"
            onClick={saveDraft}
            className="px-3 py-2 rounded border hover:bg-gray-50"
          >
            Save Draft
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={goBack}
              className="px-3 py-2 rounded border hover:bg-gray-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={saveChanges}
              disabled={!isDirty()}
              className={`px-3 py-2 rounded text-white ${
                isDirty() ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'
              }`}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
