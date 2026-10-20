import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual schema/validation code without rendering its React component.
const source = readFileSync(new URL('../src/demographics.tsx', import.meta.url), 'utf8');
const schema = source.slice(0, source.indexOf('function Choice(')).replace(/^import .*;\r?\n/gm, '');
const javascript = ts.transpileModule(schema, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { EMPTY_DEMOGRAPHICS: empty, demographicsComplete: complete, demographicsCells: cells, demographicColumns: columns, demographicsPayload: payload, toggleExperience } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
assert.equal(complete(empty, false), false);
const valid = { ...empty, sexAssignedAtBirth: 'prefer_not_to_say', genderIdentity: 'prefer_not_to_say', education: 'masters', normalOrCorrectedVision: 'yes', backgroundExperience: ['none'] };
assert.equal(complete(valid, false), true);
for (const [field, answer, details] of [['genderIdentity', 'self_describe', 'genderSelfDescription'], ['education', 'other', 'educationOther']]) {
  assert.equal(complete({ ...valid, [field]: answer }, false), false);
  assert.equal(complete({ ...valid, [field]: answer, [details]: '   ' }, false), false);
  assert.equal(complete({ ...valid, [field]: answer, [details]: 'Example' }, false), true);
}
assert.deepEqual(toggleExperience(['none'], 'photography', true), ['photography']);
assert.deepEqual(toggleExperience(['photography', 'graphic_design'], 'none', true), ['none']);
assert.deepEqual(toggleExperience(['photography'], 'photography', false), []);
assert.equal(complete({ ...valid, backgroundExperience: [] }, false), false);
assert.equal(complete({ ...valid, backgroundExperience: ['none', 'photography'] }, false), false);
assert.equal(columns(false).length, cells(valid, false, false).length);
const exported = Object.fromEntries(columns(false).map((column, i) => [column, cells({ ...valid, genderSelfDescription: 'hidden' }, false, false)[i]]));
assert.equal(exported.gender_self_description, '');
assert.equal(exported.normal_or_corrected_vision, 'yes');
assert.equal(exported.background_experience_json, '["none"]');
for (const privateColumn of ['name', 'email', 'age', 'native_language', 'native_language_other', 'english_proficiency', 'country_of_origin']) assert.equal(columns(false).includes(privateColumn), false);
const inhouse = { ...valid, name: 'Ada Lovelace', email: 'ada@example.org', age: '36', nativeLanguage: 'en', englishProficiency: 'C', countryOfOrigin: 'GB' };
assert.equal(complete(inhouse, true), true);
assert.equal(complete({ ...inhouse, email: 'invalid' }, true), false);
assert.equal(complete({ ...inhouse, age: '17' }, true), false);
assert.equal(columns(true).length, cells(inhouse, false, true).length);
for (const privateField of ['name', 'email', 'age', 'nativeLanguage', 'nativeLanguageOther', 'englishProficiency', 'countryOfOrigin']) {
  assert.equal(Object.hasOwn(payload(valid, false), privateField), false);
  assert.equal(Object.hasOwn(payload(inhouse, true), privateField), true);
}
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.equal((app.match(/\.\.\.demographicColumns\(inhouse\)/g) ?? []).length, 4);
assert.equal((app.match(/\.\.\.demographicsCells\(demographics, skipped, inhouse\)/g) ?? []).length, 4);
console.log('Prolific/in-house demographic validation, privacy filtering, conditional fields and all four CSV schemas passed.');
