import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/pairTrainingData.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { PAIR_TRAINING_EXAMPLES: examples, pairTrainingCorrect: correct, pairTrainingComplete: complete, pairTrainingFeedback: feedback } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
assert.equal(examples.length, 3);
assert.deepEqual(examples.map(e => e.expected), [{ identity: '1', gloss: 'b', metal: 'b' }, { identity: '1', gloss: 'a', metal: 'b' }, { identity: '5', gloss: 'same', metal: 'same' }]);
assert.equal(examples[0].imageA, 'tutorial/t01_gloss_low_metallic_low.png');
assert.equal(examples[0].imageB, 'tutorial/t01_gloss_high_metallic_high.png');
assert.equal(examples[1].imageA, 'tutorial/t02_gloss_high_metallic_low.png');
assert.equal(examples[1].imageB, 'tutorial/t02_gloss_low_metallic_high.png');
assert.equal(examples[2].imageA, 'tutorial/t01_gloss_low_metallic_high.png');
assert.equal(examples[2].imageA, examples[2].imageB);
for (const [index, example] of examples.entries()) {
  assert.equal(correct(index, example.expected), true);
  assert.deepEqual(feedback(index, example.expected), []);
  for (const identity of ['', '1', '3', '5']) for (const gloss of ['', 'a', 'b', 'same']) for (const metal of ['', 'a', 'b', 'same']) {
    const answers = { identity, gloss, metal };
    assert.equal(correct(index, answers), identity === example.expected.identity && gloss === example.expected.gloss && metal === example.expected.metal);
    assert.equal(complete(answers), Boolean(identity && gloss && metal));
  }
}
assert.match(feedback(1, { identity: '1', gloss: 'b', metal: 'b' })[0], /Is Image B really more glossy than Image A/);
assert.match(feedback(1, { identity: '1', gloss: 'a', metal: 'a' })[0], /Is Image A really more metallic than Image B/);
assert.equal(feedback(1, { identity: '1', gloss: 'b', metal: 'a' }).length, 2);
assert.match(feedback(1, { identity: '1', gloss: 'same', metal: 'b' })[0], /approximately equally glossy/);
const allWrong = feedback(0, { identity: '5', gloss: 'a', metal: 'a' });
assert.equal(allWrong.length, 3);
assert.match(allWrong[0], /same underlying material/);
assert.match(allWrong[1], /sharpness and definition/);
assert.match(allWrong[2], /tinted reflections/);
assert.equal(allWrong.some(message => message.includes('Press the information button and answer again.')), false);
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /'pair_training_attempts_json'/);
assert.match(app, /JSON\.stringify\(trainingAttempts\)/);
assert.match(app, /pairTrainingAttempts: next/);
assert.match(app, /downloadPairs\(nextPairs, pairTrainingAttempts/);
const trainingComponent = readFileSync(new URL('../src/PairTraining.tsx', import.meta.url), 'utf8');
for (const field of ['exampleId', 'exampleNumber', 'attemptNumber', 'identity', 'gloss', 'metal', 'correct', 'responseTimeMs', 'helpOpenCount', 'checkedAt']) assert.match(trainingComponent, new RegExp(field));
console.log('All three pair training examples, 192 response combinations, and targeted feedback passed.');
