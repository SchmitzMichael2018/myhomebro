import React, { useRef } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';

export default function AppointmentDateTimeControls({
  dateId,
  timeId,
  date,
  time,
  minimumDate,
  options,
  increment,
  error,
  notice,
  onDateChange,
  onTimeChange,
  controlClassName,
  helperClassName,
  errorClassName,
  noticeClassName,
  dateContainerClassName = '',
  timeContainerClassName = '',
  timeRef,
  dateTestId,
  timeTestId,
}) {
  const dateRef = useRef(null);
  const feedbackId = `${timeId}-feedback`;
  const helperId = `${timeId}-help`;

  const openPicker = () => {
    const input = dateRef.current;
    if (!input) return;
    input.focus();
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        /* Browser security fallback below. */
      }
    }
    input.click();
  };

  return (
    <>
      <div className={dateContainerClassName}>
        <label htmlFor={dateId} className="text-sm font-bold">
          Date
        </label>
      <div className="relative mt-1">
          <input
          ref={dateRef}
          id={dateId}
          data-autofocus
          data-testid={dateTestId || `${dateId}-input`}
            type="date"
            min={minimumDate}
            value={date}
            onChange={onDateChange}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? feedbackId : undefined}
            className={`${controlClassName} mt-0 pr-14 [&::-webkit-calendar-picker-indicator]:opacity-0`}
          />
          <button
            type="button"
            aria-label="Choose appointment date"
            onClick={openPicker}
            className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-r-lg text-current opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
          >
            <CalendarDays aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className={timeContainerClassName}>
        <label htmlFor={timeId} className="text-sm font-bold">
          Start time
        </label>
        <div className="relative mt-1">
        <select
          ref={timeRef}
            id={timeId}
          data-testid={timeTestId || `${timeId}-select`}
            value={time}
            onChange={onTimeChange}
            aria-invalid={Boolean(error)}
            aria-describedby={`${helperId}${error || notice ? ` ${feedbackId}` : ''}`}
            className={`${controlClassName} mt-0 appearance-none pr-12`}
          >
            {options.length ? (
              options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            ) : (
              <option value="">No valid times available</option>
            )}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 opacity-70"
          />
        </div>
        <p id={helperId} className={`mt-1 text-xs ${helperClassName}`}>
          Appointments begin in {increment}-minute increments.
        </p>
        {error ? (
          <p
            id={feedbackId}
            role="alert"
            className={`mt-1 text-xs font-bold ${errorClassName}`}
          >
            {error}
          </p>
        ) : notice ? (
          <p
            id={feedbackId}
            className={`mt-1 text-xs font-bold ${noticeClassName}`}
          >
            {notice}
          </p>
        ) : null}
      </div>
    </>
  );
}
