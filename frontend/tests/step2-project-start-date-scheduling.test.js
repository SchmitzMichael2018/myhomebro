import assert from 'node:assert/strict';
import {
  rescheduleMilestonesFromStartDate,
  shouldPromptForDateReschedule,
} from '../src/components/step2/projectStartDateScheduling.js';

const datedMilestones = [
  { id: 1, start_date: '2026-04-01', completion_date: '2026-04-03' },
  { id: 2, start_date: '2026-04-04', completion_date: '2026-04-06' },
];

assert.equal(shouldPromptForDateReschedule('2026-04-01', '2026-04-01', datedMilestones), false);
assert.equal(shouldPromptForDateReschedule('2026-04-01', '2026-05-10', datedMilestones), true);
assert.equal(shouldPromptForDateReschedule('', '2026-05-10', datedMilestones), true);
assert.equal(shouldPromptForDateReschedule('2026-04-01', '2026-05-10', [{ id: 1 }]), false);

const nextRows = rescheduleMilestonesFromStartDate(
  [
    {
      id: 1,
      title: 'Planning',
      estimated_days: 3,
      start_date: '2026-04-01',
      completion_date: '2026-04-03',
    },
    {
      id: 2,
      title: 'Build',
      estimated_days: 4,
      start_date: '2026-04-04',
      completion_date: '2026-04-07',
    },
    {
      id: 3,
      title: 'Wrap-up',
      start_date: '2026-04-08',
      completion_date: '2026-04-08',
    },
  ],
  '2026-05-10'
);

assert.deepEqual(
  nextRows.map((row) => ({
    id: row.id,
    start_date: row.start_date,
    completion_date: row.completion_date,
    due_date: row.due_date,
  })),
  [
    {
      id: 1,
      start_date: '2026-05-10',
      completion_date: '2026-05-12',
      due_date: '2026-05-12',
    },
    {
      id: 2,
      start_date: '2026-05-13',
      completion_date: '2026-05-16',
      due_date: '2026-05-16',
    },
    {
      id: 3,
      start_date: '2026-05-17',
      completion_date: '2026-05-17',
      due_date: '2026-05-17',
    },
  ]
);

console.log('Step 2 scheduling helper checks passed.');
