// src/components/Calendar.jsx

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { ClipLoader } from 'react-spinners';
import api from '../api';
import toast from 'react-hot-toast';

// Legend for event types
const CalendarLegend = () => (
  <div className="grid grid-cols-2 gap-4 mb-4 text-sm text-gray-600">
    <div className="flex items-center">
      <span className="w-3 h-3 bg-blue-600 rounded-full mr-2" />
      Agreement
    </div>
    <div className="flex items-center">
      <span className="w-3 h-3 bg-green-600 rounded-full mr-2" />
      Milestone
    </div>
  </div>
);

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCalendarData = async () => {
      setLoading(true);
      setError('');
      try {
        const [agreementsRes, milestonesRes] = await Promise.all([
          api.get('/agreements/calendar/'),
          api.get('/milestones/calendar/'),
        ]);

        const agreementEvents = agreementsRes.data
          .filter(ev => ev.start && ev.end)
          .map(ev => ({
            id: `a-${ev.id}`,
            title: ev.title,
            start: ev.start,
            end: ev.end,
            allDay: true,
            backgroundColor: '#2563EB',
            borderColor: '#1D4ED8',
            textColor: '#FFFFFF',
            extendedProps: {
              type: 'agreement',
              originalId: ev.id,
            },
          }));

        const milestoneEvents = milestonesRes.data
          .filter(ev => ev.start && ev.end)
          .map(ev => ({
            id: `m-${ev.id}`,
            title: ev.title,
            start: ev.start,
            end: ev.end,
            allDay: true,
            backgroundColor: '#059669',
            borderColor: '#047857',
            textColor: '#FFFFFF',
            extendedProps: {
              type: 'milestone',
              originalId: ev.id,
            },
          }));

        setEvents([...agreementEvents, ...milestoneEvents]);
      } catch (err) {
        console.error('Calendar load error:', err);
        setError('Failed to load calendar. Please try again later.');
        toast.error('Could not load calendar data.');
      } finally {
        setLoading(false);
      }
    };

    fetchCalendarData();
  }, []);

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-500 flex flex-col items-center">
        <ClipLoader size={28} color="#2563EB" />
        <span className="mt-2">Loading calendar...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-1 text-gray-800">Project Calendar</h2>
      <p className="text-sm text-gray-500 mb-4">
        Overview of agreements and milestone timelines.
      </p>

      <CalendarLegend />

      <div className="overflow-x-auto">
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          height="auto"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,dayGridWeek',
          }}
          events={events}
          eventClick={({ event }) => {
            const { type, originalId } = event.extendedProps;
            if (type === 'agreement') {
              navigate(`/agreements/${originalId}`);
            } else if (type === 'milestone') {
              navigate(`/milestones/${originalId}`);
            }
          }}
          eventMouseEnter={({ el, event }) => {
            el.setAttribute('title', event.title);
            el.style.cursor = 'pointer';
          }}
          dayCellClassNames={({ date }) => {
            const today = new Date();
            const isToday =
              date.getDate() === today.getDate() &&
              date.getMonth() === today.getMonth() &&
              date.getFullYear() === today.getFullYear();
            return isToday ? ['bg-yellow-100', 'font-semibold'] : [];
          }}
        />
      </div>
    </div>
  );
}
