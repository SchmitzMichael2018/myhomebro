import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import AppointmentDateTimeControls from './AppointmentDateTimeControls.jsx';
import {
  appointmentTimeOptions,
  FALLBACK_APPOINTMENT_INCREMENT_MINUTES,
  friendlyTimeZone,
  nextAppointmentIncrement,
  normalizeAppointmentWallTime,
  validateFutureAppointment,
  zonedParts,
  zonedWallTimeToIso,
} from '../lib/appointmentTime.js';

const labels = {
  schedule: 'Schedule appointment',
  propose: 'Propose another time',
  reschedule: 'Reschedule appointment',
  decline: 'Decline request',
  cancel: 'Cancel appointment',
  complete: 'Mark appointment completed',
  no_show: 'Mark no-show',
  confirm: 'Confirm appointment',
};

export default function AppointmentActionDialog({
  open,
  action,
  appointment,
  defaults = {},
  onClose,
  onSubmit,
}) {
  const increment =
    Number(
      appointment?.scheduling_increment_minutes ||
        defaults.scheduling_increment_minutes
    ) || FALLBACK_APPOINTMENT_INCREMENT_MINUTES;
  const minimumLeadMinutes =
    Number(
      appointment?.minimum_lead_minutes || defaults.minimum_lead_minutes
    ) || 0;
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [timeError, setTimeError] = useState('');
  const [timeNotice, setTimeNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const timeRef = useRef(null);
  const needsTime = ['schedule', 'propose', 'reschedule'].includes(action);
  const needsReason = ['decline', 'cancel', 'reschedule'].includes(action);

  useEffect(() => {
    if (!open) return;
    const timeZone =
      appointment?.timezone ||
      defaults.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      'America/Chicago';
    const scheduledDate = appointment?.scheduled_start
      ? new Date(appointment.scheduled_start)
      : null;
    const initial =
      scheduledDate && scheduledDate > new Date()
        ? normalizeAppointmentWallTime({
            ...zonedParts(scheduledDate, timeZone),
            incrementMinutes: increment,
          })
        : nextAppointmentIncrement({
            timeZone,
            incrementMinutes: increment,
            minimumLeadMinutes,
          });
    setForm({
      date: initial.date,
      time: initial.time,
      duration_minutes:
        appointment?.duration_minutes || Math.max(60, increment),
      timezone: timeZone,
      appointment_type:
        appointment?.appointment_type ||
        defaults.appointment_type ||
        (defaults.service_location ? 'in_person' : 'phone_call'),
      service_location:
        appointment?.service_location || defaults.service_location || '',
      notes: appointment?.notes || '',
      reason: '',
    });
    setError('');
    setTimeError('');
    setTimeNotice('');
    setSubmitting(false);
  }, [
    open,
    action,
    appointment?.id,
    defaults.appointment_type,
    defaults.service_location,
    defaults.timezone,
    increment,
    minimumLeadMinutes,
  ]);

  const futureValidation =
    needsTime && form.date && form.time && form.timezone
      ? validateFutureAppointment({
          date: form.date,
          time: form.time,
          timeZone: form.timezone,
          minimumLeadMinutes,
        })
      : { valid: !needsTime };
  const confirmInvalid =
    action === 'confirm' && appointment?.scheduled_start
      ? new Date(appointment.scheduled_start).getTime() <=
        Date.now() + minimumLeadMinutes * 60000
      : false;
  const minimumDate = form.timezone
    ? zonedParts(new Date(), form.timezone).date
    : '';
  const timeOptions = useMemo(
    () => form.date && form.timezone
      ? appointmentTimeOptions({ date: form.date, timeZone: form.timezone, incrementMinutes: increment, minimumLeadMinutes })
      : [],
    [form.date, form.timezone, increment, minimumLeadMinutes]
  );

  useEffect(() => {
    if (!open || !needsTime || !form.date || !form.time || !form.timezone)
      return;
    const validation = validateFutureAppointment({
      date: form.date,
      time: form.time,
      timeZone: form.timezone,
      minimumLeadMinutes,
    });
    setTimeError(
      validation.valid
        ? ''
        : validation.error || 'Choose a future appointment date and time.'
    );
  }, [
    open,
    needsTime,
    form.date,
    form.time,
    form.timezone,
    form.appointment_type,
    form.duration_minutes,
    minimumLeadMinutes,
  ]);

  useEffect(() => {
    if (!open || !needsTime || !form.date || form.date < minimumDate || !timeOptions.length) return;
    if (!timeOptions.some((option) => option.value === form.time)) {
      setForm((current) => ({ ...current, time: timeOptions[0].value }));
      setTimeNotice(`Start time changed to ${timeOptions[0].label}. Review the new time before submitting.`);
      setTimeError('Review the newly selected start time.');
    }
  }, [open, needsTime, form.date, form.time, minimumDate, timeOptions]);

  const change = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const normalizeTime = () => {
    const normalized = normalizeAppointmentWallTime({
      date: form.date,
      time: form.time,
      incrementMinutes: increment,
    });
    if (!normalized.valid) {
      setTimeError('Choose a valid start time.');
      return false;
    }
    setTimeError('');
    if (normalized.changed) {
      setForm((current) => ({
        ...current,
        date: normalized.date,
        time: normalized.time,
      }));
      setTimeNotice(
        `Start time adjusted to ${normalized.time} on ${normalized.date} to match ${increment}-minute increments.`
      );
    } else setTimeNotice('');
    return normalized;
  };
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (confirmInvalid) {
      setError('Choose a future appointment date and time.');
      return;
    }
    if (needsReason && !form.reason?.trim()) {
      setError('A reason is required.');
      return;
    }
    if (needsTime && (!form.date || !form.time)) {
      setTimeError('Choose a date and start time.');
      timeRef.current?.focus();
      return;
    }
    const normalized = needsTime
      ? normalizeAppointmentWallTime({
          date: form.date,
          time: form.time,
          incrementMinutes: increment,
        })
      : null;
    if (needsTime && (!normalized.valid || normalized.changed)) {
      normalizeTime();
      setTimeError(
        `Start time must use ${increment}-minute increments. Review the adjusted time, then submit again.`
      );
      timeRef.current?.focus();
      return;
    }
    const future = needsTime
      ? validateFutureAppointment({
          date: form.date,
          time: form.time,
          timeZone: form.timezone,
          minimumLeadMinutes,
        })
      : { valid: true };
    if (!future.valid) {
      setTimeError(
        future.error || 'Choose a future appointment date and time.'
      );
      timeRef.current?.focus();
      return;
    }
    if (needsTime && Number(form.duration_minutes) % increment) {
      setError(`Duration must use ${increment}-minute increments.`);
      return;
    }
    if (
      needsTime &&
      form.appointment_type === 'in_person' &&
      !form.service_location?.trim()
    ) {
      setError('A service location is required for an in-person appointment.');
      return;
    }
    let scheduledStart;
    try {
      scheduledStart = needsTime
        ? zonedWallTimeToIso(form.date, form.time, form.timezone)
        : undefined;
    } catch (conversionError) {
      setTimeError(conversionError.message);
      timeRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...form,
        scheduled_start: scheduledStart,
        duration_minutes: Number(form.duration_minutes),
      });
      onClose();
    } catch (requestError) {
      const payload = requestError?.response?.data;
      if (payload?.scheduled_start) {
        setTimeError(payload.scheduled_start[0]);
        timeRef.current?.focus();
      } else
        setError(
          payload?.detail ||
            Object.values(payload || {})
              .flat()
              .find(Boolean) ||
            requestError?.message ||
            'The appointment could not be updated.'
        );
    } finally {
      setSubmitting(false);
    }
  };

  const control =
    'mt-1 min-h-11 w-full rounded-lg border-slate-500 bg-white text-slate-950';
  return (
    <Modal
      visible={open}
      onClose={submitting ? undefined : onClose}
      title={labels[action] || 'Appointment'}
      testId="appointment-action-dialog"
      overlayClassName="bg-slate-950/80 p-3"
      containerClassName="mx-3 max-h-[calc(100dvh-1.5rem)] max-w-xl rounded-2xl border border-slate-700 bg-[#071d3d] text-white"
      bodyClassName="max-h-[calc(100dvh-6rem)] p-5"
    >
      <form onSubmit={submit} className="space-y-4">
        {appointment && ['propose', 'reschedule'].includes(action) ? (
          <p className="rounded-xl bg-white/10 p-3 text-sm">
            Current time:{' '}
            {new Date(appointment.scheduled_start).toLocaleString()}
          </p>
        ) : null}
        {needsTime ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="appointment-type" className="text-sm font-bold">
                Appointment type
              </label>
              <select
                id="appointment-type"
                value={form.appointment_type || ''}
                onChange={change('appointment_type')}
                className={control}
              >
                <option value="phone_call">Phone call</option>
                <option value="video_call">Video call</option>
                <option value="in_person">In person</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="appointment-duration"
                className="text-sm font-bold"
              >
                Duration
              </label>
              <select
                id="appointment-duration"
                value={form.duration_minutes || 60}
                onChange={change('duration_minutes')}
                className={control}
              >
                {[increment, 30, 45, 60, 90, 120]
                  .filter(
                    (v, index, values) =>
                      v % increment === 0 && values.indexOf(v) === index
                  )
                  .map((v) => (
                    <option key={v} value={v}>
                      {v} minutes
                    </option>
                  ))}
              </select>
            </div>
            <AppointmentDateTimeControls
              dateId="appointment-date"
              timeId="appointment-start-time"
              date={form.date || ''}
              time={form.time || ''}
              minimumDate={minimumDate}
              options={timeOptions}
              increment={increment}
              error={timeError}
              notice={timeNotice}
              onDateChange={(event) => {
                const value = event.target.value;
                setForm((current) => ({ ...current, date: value }));
                setTimeError(value ? '' : 'Choose a future appointment date and time.');
                setTimeNotice('');
              }}
              onTimeChange={(event) => {
                setForm((current) => ({ ...current, time: event.target.value }));
                setTimeError('');
                setTimeNotice('');
              }}
              timeRef={timeRef}
              controlClassName={control}
              helperClassName="text-sky-100"
              errorClassName="text-rose-200"
              noticeClassName="text-emerald-200"
            />
            <div className="sm:col-span-2">
              <label
                htmlFor="appointment-timezone"
                className="text-sm font-bold"
              >
                Time zone
              </label>
              <select
                id="appointment-timezone"
                value={form.timezone || ''}
                onChange={change('timezone')}
                className={control}
              >
                {[
                  form.timezone,
                  'America/Chicago',
                  'America/New_York',
                  'America/Denver',
                  'America/Los_Angeles',
                ]
                  .filter((v, i, a) => v && a.indexOf(v) === i)
                  .map((zone) => (
                    <option key={zone} value={zone}>
                      {friendlyTimeZone(zone)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="appointment-location"
                className="text-sm font-bold"
              >
                {form.appointment_type === 'in_person'
                  ? 'Service location'
                  : 'Service location (optional)'}
              </label>
              <input
                id="appointment-location"
                value={form.service_location || ''}
                onChange={change('service_location')}
                className={control}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="appointment-notes" className="text-sm font-bold">
                Notes (optional)
              </label>
              <textarea
                id="appointment-notes"
                value={form.notes || ''}
                onChange={change('notes')}
                className={`${control} min-h-24`}
              />
            </div>
          </div>
        ) : null}
        {needsReason ? (
          <div>
            <label htmlFor="appointment-reason" className="text-sm font-bold">
              Reason
            </label>
            <textarea
              id="appointment-reason"
              data-autofocus
              value={form.reason || ''}
              onChange={change('reason')}
              className={`${control} min-h-24`}
            />
          </div>
        ) : null}
        {action === 'cancel' ? (
          <p className="text-sm text-rose-100">
            This releases the reserved time and keeps the appointment in
            history.
          </p>
        ) : null}
        {confirmInvalid ? (
          <div role="alert" className="rounded-lg bg-rose-950 p-3 text-sm text-rose-100">
            Choose a future appointment date and time. Propose another time instead of confirming this request.
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            data-testid="appointment-dialog-error"
            className="rounded-lg bg-rose-950 p-3 text-sm text-rose-100"
          >
            {error}
          </div>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-11 rounded-xl border border-white/30 px-4 font-bold"
          >
            Keep appointment
          </button>
          <button
            type="submit"
            disabled={submitting || confirmInvalid || (needsTime && !futureValidation.valid)}
            className={`min-h-11 rounded-xl px-4 font-bold text-white disabled:opacity-50 ${['decline', 'cancel', 'no_show'].includes(action) ? 'bg-rose-700' : 'bg-sky-700'}`}
          >
            {submitting ? 'Working…' : labels[action]}
          </button>
        </div>
      </form>
    </Modal>
  );
}
