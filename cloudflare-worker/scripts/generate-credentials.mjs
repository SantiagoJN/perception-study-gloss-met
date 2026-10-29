import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [inputPath, outputDirectory] = process.argv.slice(2);
if (!inputPath || !outputDirectory) {
  console.error('Usage: node generate-credentials.mjs assignments.json <private-output-directory>');
  process.exit(1);
}

const assignments = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
if (!Array.isArray(assignments) || !assignments.length) throw new Error('assignments.json must contain a non-empty array.');
const studyTypes = new Set(['pairJudgment', 'forcedChoice', 'sceneMatching', 'contextMatching2', 'selection']);
const usernames = new Set();
const seeds = new Set();
const csvRows = [['username', 'password', 'study_type', 'assignment_seed']];
const sqlRows = [];

for (const [index, assignment] of assignments.entries()) {
  const username = String(assignment.username ?? `P${String(index + 1).padStart(5, '0')}`).trim();
  const studyType = String(assignment.study_type ?? '').trim();
  const assignmentSeed = String(assignment.assignment_seed ?? '').trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(username)) throw new Error(`Invalid username at index ${index}.`);
  if (!studyTypes.has(studyType)) throw new Error(`Invalid study_type at index ${index}.`);
  if (!assignmentSeed || assignmentSeed.length > 160) throw new Error(`Invalid assignment_seed at index ${index}.`);
  if (usernames.has(username.toLowerCase()) || seeds.has(assignmentSeed)) throw new Error(`Duplicate username or assignment_seed at index ${index}.`);
  usernames.add(username.toLowerCase());
  seeds.add(assignmentSeed);

  const password = randomBytes(18).toString('base64url');
  const salt = randomBytes(18);
  // Cloudflare Workers WebCrypto currently accepts at most 100,000 PBKDF2
  // iterations. Passwords are also long, random and unique per participant.
  const iterations = 100000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  csvRows.push([username, password, studyType, assignmentSeed]);
  sqlRows.push(`INSERT INTO access_credentials (username, password_hash, password_salt, password_iterations, assigned_study_type, assignment_seed) VALUES (${sql(username)}, ${sql(hash.toString('base64'))}, ${sql(salt.toString('base64'))}, ${iterations}, ${sql(studyType)}, ${sql(assignmentSeed)});`);
}

const output = resolve(outputDirectory);
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'participant_credentials.csv'), csvRows.map((row) => row.map(csv).join(',')).join('\n') + '\n', { mode: 0o600 });
writeFileSync(resolve(output, 'credentials.sql'), sqlRows.join('\n') + '\n', { mode: 0o600 });
console.log(`Generated ${assignments.length} credentials in ${output}. Keep participant_credentials.csv private.`);

function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function csv(value) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
