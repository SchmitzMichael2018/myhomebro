import React, { useEffect, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import api from '../api';

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    api.get('/projects/milestones/calendar/')
      .then(res => {
        // Normalize events for FullCalendar if necessary:
        const normalized = res.data.map(ev => ({
          id: ev.id,
          title: ev.title || 'Milestone',
          start: ev.start_date || ev.due_date,
          end: ev.completion_date || ev.end_date,
          allDay: true,
          // ...spread other event details if needed
          ...ev
        }));
        setEvents(normalized);
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to load calendar events');
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-5xl mx-auto mt-8 bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4">Milestone Calendar</h2>
      {loading ? (
        <p className="text-blue-700">Loading…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <FullCalendar
          plugins={[dayGridPlugin]}
          initialView="dayGridMonth"
          events={events}
          eventClick={({ event }) => setSelectedEvent(event)}
          height={600}
        />
      )}

      {selectedEvent && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm w-full relative">
            <h3 className="text-xl font-bold mb-2">{selectedEvent.title}</h3>
            <p>
              <strong>Start:</strong> {selectedEvent.startStr}
              <br />
              {selectedEvent.end && (
                <>
                  <strong>End:</strong> {selectedEvent.endStr}
                  <br />
                </>
              )}
              {/* Add more milestone fields as needed */}
            </p>
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              aria-label="Close"
            >
              ✖
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

