import assert from 'node:assert/strict';
import {
  buildClarificationAwareMilestoneDraft,
} from '../src/lib/milestoneDraftShaping.js';

function titles(rows) {
  return rows.map((row) => row.title);
}

const defaultKitchenRows = buildClarificationAwareMilestoneDraft({
  projectType: 'Remodel',
  projectSubtype: 'Kitchen Remodel',
  description: 'Kitchen remodel scope',
  clarificationAnswers: {},
});

assert.deepEqual(titles(defaultKitchenRows), [
  'Planning & protection',
  'Demolition & rough-in',
  'Cabinets & surfaces',
  'Fixtures & appliances',
  'Punch list & walkthrough',
]);

const aiKitchenRows = buildClarificationAwareMilestoneDraft({
  projectType: 'Remodel',
  projectSubtype: 'Kitchen Remodel',
  description: 'Kitchen remodel scope',
  clarificationAnswers: {
    layout_changes: 'yes',
    cabinet_scope: 'no',
    finish_scope_notes: 'backsplash and pendant lighting',
  },
  amountMode: 'preserve_base',
  baseMilestones: Array.from({ length: 6 }, () => ({ amount: 0 })),
});

assert.deepEqual(titles(aiKitchenRows), [
  'Planning & protection',
  'Layout review & utility changes',
  'Selective demolition & rough-in',
  'Countertops, surfaces & finishes',
  'Fixtures & appliances',
  'Punch list & walkthrough',
]);
assert.equal(
  aiKitchenRows[4].description.includes('Included finish scope: backsplash and pendant lighting.'),
  true
);
assert.equal(aiKitchenRows.every((row) => row.amount === 0), true);

const aiBathroomRows = buildClarificationAwareMilestoneDraft({
  projectType: 'Remodel',
  projectSubtype: 'Bathroom Remodel',
  description: 'Bathroom remodel scope',
  clarificationAnswers: {
    wet_area_tile: 'no',
  },
  amountMode: 'preserve_base',
  baseMilestones: Array.from({ length: 4 }, () => ({ amount: 0 })),
});

assert.equal(titles(aiBathroomRows).includes('Walls, waterproofing & tile'), false);
assert.equal(titles(aiBathroomRows).includes('Tile & waterproofing finish'), false);
assert.equal(aiBathroomRows.length, 4);

console.log('milestone-draft-shaping smoke: PASS');
