#!/usr/bin/env node
/** Derive every Test-3.2 manifest relationship from the canonical Test-2 data. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'public', name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(root, 'public', name), `${JSON.stringify(value, null, 2)}\n`);

const forced = read('forced_choice_trials.json').trials;
const contextual = read('context_matching2_trials.json').trials;
if (forced.length !== 600 || contextual.length !== 600) throw new Error('T2 and T3.2 must both contain 600 trials');
for (let index = 0; index < forced.length; index += 1) {
  const expected = `T32_${String(index + 1).padStart(4, '0')}`;
  if (contextual[index].trial_id !== expected || contextual[index].source_test2_trial_id !== forced[index].trial_id) throw new Error(`T2/T3.2 mismatch at ${index}`);
  const expectedCorrect = forced[index].correct_option === 'A' ? 1 : 2;
  if (contextual[index].correct_option !== expectedCorrect) throw new Error(`Answer mismatch at ${expected}`);
}

const fixed = read('fixed_trial_groups.json');
fixed.tests.test3_2 = {
  id_field: 'trial_id',
  groups: fixed.tests.test2.groups.map((group) => ({
    ...group,
    trial_ids: group.trial_ids.map((id) => id.replace(/^T2_/, 'T32_')),
  })),
};
write('fixed_trial_groups.json', fixed);

const sentinels = read('sentinel_trials.json');
const group3 = JSON.parse(fs.readFileSync(path.resolve(root, '..', 'datasetv9', 'groups3', 'sentinels', 'setups.json'), 'utf8')).setups;
sentinels.tests.test3_2 = group3.map((item) => ({
  sentinel_id: item.sentinel_id,
  reference_scene: item.reference_scene,
  question_scene: item.question_scene,
  shared_factor: item.shared_factor,
  correct_option: item.correct_option,
}));
write('sentinel_trials.json', sentinels);

const truth = read('testing_ground_truth.json');
truth.context_matches2 = Object.fromEntries(contextual.map((trial) => [trial.trial_id, trial.correct_option]));
write('testing_ground_truth.json', truth);

console.log('Derived T3.2 fixed groups, sentinels, and testing answers from T2.');
