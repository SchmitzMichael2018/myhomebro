import assert from 'node:assert/strict';
import {
  buildClarificationAwareMilestoneDraft,
} from '../src/lib/milestoneDraftShaping.js';
import rules from '../../shared/milestone_shaping_rules.json' with { type: 'json' };

function titles(rows) {
  return rows.map((row) => row.title);
}

for (const testCase of rules.regressionCases ?? []) {
  const rows = buildClarificationAwareMilestoneDraft(testCase.input ?? {});
  const rowTitles = titles(rows);

  if (Array.isArray(testCase.expectedTitles)) {
    assert.deepEqual(rowTitles, testCase.expectedTitles, `${testCase.id}: titles`);
  }

  for (const missingTitle of testCase.expectedMissingTitles ?? []) {
    assert.equal(rowTitles.includes(missingTitle), false, `${testCase.id}: missing ${missingTitle}`);
  }

  for (const expectation of testCase.expectedDescriptionIncludes ?? []) {
    const row = rows.find((candidate) => candidate.title === expectation.title);
    assert.ok(row, `${testCase.id}: row exists for ${expectation.title}`);
    assert.equal(
      row.description.includes(expectation.text),
      true,
      `${testCase.id}: description includes expected text for ${expectation.title}`
    );
  }

  if (typeof testCase.expectedAllAmounts === 'number') {
    assert.equal(
      rows.every((row) => row.amount === testCase.expectedAllAmounts),
      true,
      `${testCase.id}: amounts`
    );
  }
}

console.log('milestone-draft-shaping smoke: PASS');
