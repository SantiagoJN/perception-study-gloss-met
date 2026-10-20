import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const username = String(process.argv[2] ?? '').trim().toLowerCase();
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputDirectory = resolve(projectRoot, process.argv[3] ?? 'private/credentials/internal');
if (!['gilab-inhouse', 'gilab-testing'].includes(username)) {
  throw new Error('Usage: node rotate-internal-credential.mjs gilab-inhouse|gilab-testing [private-output-directory]');
}

const password = randomBytes(24).toString('base64url');
const salt = randomBytes(18);
const iterations = 100000;
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = `UPDATE access_credentials SET password_hash=${quote(hash.toString('base64'))}, password_salt=${quote(salt.toString('base64'))}, password_iterations=${iterations}, active=1, disabled_at=NULL WHERE username=${quote(username)} COLLATE NOCASE;\n`;

mkdirSync(outputDirectory, { recursive: true });
const suffix = username.replace('gilab-', '');
writeFileSync(resolve(outputDirectory, `${suffix}-password.txt`), `${password}\n`, { mode: 0o600 });
writeFileSync(resolve(outputDirectory, `${suffix}-password.sql`), sql, { mode: 0o600 });
console.log(`Generated a new ${username} password and SQL update in ${outputDirectory}. Keep both files private.`);
