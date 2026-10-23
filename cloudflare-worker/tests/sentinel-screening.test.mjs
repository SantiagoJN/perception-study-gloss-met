import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateSentinels, sentinelScreenOutThreshold } from '../src/index.js';

function trial(sentinelId, response) {
  return { sentinelId, response };
}

test('a Test 1 sentinel evaluates only its configured components', () => {
  const correct = trial('SENTINEL_T1_01', {
    sameMaterialLikelihood: 1,
    canonicalGlossChoice: 1,
    canonicalMetalChoice: -1,
  });
  assert.deepEqual(evaluateSentinels('pairJudgment', [correct]), {
    sentinels: 1,
    checks: 2,
    failures: 0,
  });

  const oneWrong = trial('SENTINEL_T1_01', {
    sameMaterialLikelihood: 5,
    canonicalGlossChoice: 1,
    canonicalMetalChoice: -1,
  });
  assert.equal(evaluateSentinels('pairJudgment', [oneWrong]).failures, 1);

  const allWrong = trial('SENTINEL_T1_01', {
    sameMaterialLikelihood: 5,
    canonicalGlossChoice: -1,
    canonicalMetalChoice: 1,
  });
  assert.equal(evaluateSentinels('pairJudgment', [allWrong]).failures, 1);

  const ignoredGloss = trial('SENTINEL_T1_04', {
    sameMaterialLikelihood: 1,
    canonicalGlossChoice: 1,
    canonicalMetalChoice: -1,
  });
  assert.deepEqual(evaluateSentinels('pairJudgment', [ignoredGloss]), {
    sentinels: 1,
    checks: 2,
    failures: 0,
  });
});

test('a Test 4 sentinel contributes one failure even when several candidate decisions are wrong', () => {
  const correct = trial('SENTINEL_T4_01', {
    selectedCandidateIds: ['SENTINEL_T4_01_candidate_1', 'SENTINEL_T4_01_candidate_4'],
  });
  assert.deepEqual(evaluateSentinels('selection', [correct]), {
    sentinels: 1,
    checks: 6,
    failures: 0,
  });

  const severalWrong = trial('SENTINEL_T4_01', {
    selectedCandidateIds: [
      'SENTINEL_T4_01_candidate_2',
      'SENTINEL_T4_01_candidate_3',
      'SENTINEL_T4_01_candidate_5',
    ],
  });
  assert.equal(evaluateSentinels('selection', [severalWrong]).failures, 1);
});

test('two failed sentinels reach the attention-screening threshold', () => {
  const screening = evaluateSentinels('forcedChoice', [
    trial('SENTINEL_T2_01', { selectedOption: 'B' }),
    trial('SENTINEL_T2_02', { selectedOption: 'A' }),
  ]);
  assert.equal(screening.failures, 2);
  assert.equal(screening.checks, 2);
  assert.equal(screening.failures >= sentinelScreenOutThreshold('forcedChoice'), true);
});

test('one failed sentinel remains below the attention-screening threshold', () => {
  const screening = evaluateSentinels('sceneMatching', [
    trial('SENTINEL_T3_01', { selectedOption: 2 }),
    trial('SENTINEL_T3_02', { selectedOption: 2 }),
  ]);
  assert.equal(screening.failures, 1);
  assert.equal(screening.failures >= sentinelScreenOutThreshold('sceneMatching'), false);
});

test('Test 4 allows two failed sentinels and screens out on the third', () => {
  const twoFailures = evaluateSentinels('selection', [
    trial('SENTINEL_T4_01', { selectedCandidateIds: [] }),
    trial('SENTINEL_T4_02', { selectedCandidateIds: [] }),
  ]);
  const threeFailures = evaluateSentinels('selection', [
    trial('SENTINEL_T4_01', { selectedCandidateIds: [] }),
    trial('SENTINEL_T4_02', { selectedCandidateIds: [] }),
    trial('SENTINEL_T4_03', { selectedCandidateIds: [] }),
  ]);
  assert.equal(sentinelScreenOutThreshold('selection'), 3);
  assert.equal(twoFailures.failures, 2);
  assert.equal(twoFailures.failures >= sentinelScreenOutThreshold('selection'), false);
  assert.equal(threeFailures.failures, 3);
  assert.equal(threeFailures.failures >= sentinelScreenOutThreshold('selection'), true);
});
