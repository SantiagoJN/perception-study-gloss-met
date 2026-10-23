# Cloudflare study API

This Worker is the only public writer for the study database. GitHub Pages never
receives a D1 credential and never writes to D1 directly.

## Resources

- Worker: `perception-study-api`
- D1: `perception-study-results` (EU jurisdiction)
- D1 binding: `DB`
- Private R2 fallback: `perception-study-results-fallback` (EU jurisdiction)
- R2 binding: `RESULTS_FALLBACK`
- Required Worker secret: `SESSION_SIGNING_SECRET`

## Deploy and migrate

Run from the repository root:

```bash
npx wrangler d1 migrations apply perception-study-results --remote --config cloudflare-worker/wrangler.jsonc
npx wrangler deploy --config cloudflare-worker/wrangler.jsonc
```

Set `SESSION_SIGNING_SECRET` with `wrangler secret put`; never put it in source.

## Private result fallback

D1 remains the primary and canonical result store. If the final `/submit` or
`/screen-out` D1 write throws or returns a server error (HTTP 5xx), the Worker
automatically validates the signed session, complete payload and attention
checks again, then writes one CSV object to the private R2 bucket. Client or
validation errors (HTTP 4xx) are never hidden by the fallback.

The object key is deterministic and pseudonymous:

```text
fallback-results/<study-type>/<sha256-session-prefix>-<outcome>.csv
```

The Worker never returns success until an R2 `head` confirms the payload hash
and row count. A retry of the same payload is idempotent; a different payload
for the same session is rejected instead of overwriting the first backup. The
CSV includes demographics, training attempts, client metadata, attention-check
summary and every trial response. Cells beginning with spreadsheet formula
characters are escaped.

Keep this bucket private: do not enable its `r2.dev` URL and do not attach a
custom public domain. To retrieve a known object from an authenticated shell:

```bash
npx wrangler r2 object get \
  perception-study-results-fallback/fallback-results/<study-type>/<object>.csv \
  --remote --jurisdiction eu --file recovered-result.csv
```

You can also browse and download objects in Cloudflare Dashboard → R2 Object
Storage → `perception-study-results-fallback`. The participant-facing receipt
starts with `r2-`, which makes the corresponding fallback easy to identify.
R2 backups are not imported into D1 automatically; reconcile them after an
incident, preserving the receipt and payload hash to avoid duplicates.

## Fixed participant credentials

The current study uses 12 fixed batches per test and 170 usernames per test:
14 usernames in ten batches and 15 usernames in two batches. Generate the
initial private bank from the repository root with:

```bash
python3 scripts/generate_fixed_batch_credentials.py
npx wrangler d1 execute perception-study-results --remote --config cloudflare-worker/wrangler.jsonc --file private/credentials/fixed_batches_v1/credentials.sql
```

Additional credentials are appended without invalidating the existing bank by
running `scripts/extend_fixed_batch_credentials.py` with a unique tag. The
script refreshes the merged Prolific TXT/CSV files and writes extension-only SQL
under `private/credentials/fixed_batches_v1/extensions/<tag>/` for import into
D1.

The `/anon` routes use a separate internal-only credential pool, currently
containing 3,000 entries per test and 250 per fixed batch. Extend that pool
without changing any existing allocation with:

```bash
python3 scripts/extend_anonymous_credentials.py \
  --target-per-test 3000 --tag <unique-tag>
```

Import only the generated extension SQL from
`private/credentials/fixed_batches_v1/anonymous_v1/extensions/<unique-tag>/`.

The generated directory contains a complete CSV/JSON mapping and one TXT per
test in Prolific's `username,password` format. The two values are deliberately
identical because the web asks participants only for their username. These
plaintext files remain gitignored and private. D1 receives only PBKDF2-SHA256
hashes with individual random salts. With
`REQUIRE_PROLIFIC_IDENTIFIERS=true` (the production default), regular
credentials require the complete `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID`
tuple. The session records whether access came from Prolific or an internal
account.

`gilab-inhouse` and `gilab-testing` are internal accounts and do not require
Prolific parameters. `/inhouse` asks for the internal password instead of
logging in automatically. Rotate that password before recruitment and keep it
inside GiLab.

Generate a rotation without printing the password to the terminal, then apply
the private SQL file to D1:

```bash
node cloudflare-worker/scripts/rotate-internal-credential.mjs gilab-inhouse private/credentials/internal
npx wrangler d1 execute perception-study-results --remote --config cloudflare-worker/wrangler.jsonc --file private/credentials/internal/inhouse-password.sql
```

Each new `gilab-inhouse` browser session is assigned a random fixed batch from
`set_01` through `set_12`; re-authenticating that same session preserves the
assignment. Its demographic form additionally requires name, email, age,
native language, English proficiency and country of origin. D1 records both
`assignment_batch` and `inhouse` on the session. The Worker allowlists the
extended fields only for authenticated `gilab-inhouse` sessions, so they are
never stored for Prolific participants even if a client submits them.

The in-house frontend runs all four tests in order after a single demographic
form. Each test has its own D1 session and is submitted before the next test is
loaded. The four sessions share a server-recorded `study_run_id` and the same
deterministically random batch, which makes interrupted runs resumable after
signing in again in the same browser tab. Prolific sessions remain single-test
sessions and are unaffected by this sequence.

## Stored data

- `access_credentials`: username, salted hash, assigned test and fixed seed.
- `participant_mappings`: credential-to-Prolific mapping.
- `study_sessions`: assigned batch, in-house flag, explicit consent and timestamp, demographic checkpoint, client/server metadata, upload receipt, explicit final outcome, and sentinel screen-out state/trial/subquestion counts. `sentinel_failures` counts whole failed sentinels (a sentinel fails when any component response is wrong).
- `trial_responses`: one JSON record per trial, including time and sentinel data.
- `login_attempts`: rate-limit data; IP addresses are stored only as keyed hashes.

Tests 1–3 screen out a regular participant on the second failed sentinel. Test
4 permits two failed sentinels and screens out on the third. Internal in-house
sessions record sentinel scores but are not screened out.

## View an exported database

On Windows, double-click `tools/view-results.cmd`. The viewer opens the newest
SQL export found in `backups/` or `Y:\VLM-user-study-results\prolific`. It loads
the dump into an in-memory SQLite database and never changes the SQL file or D1.

You can also open a specific export or print a terminal summary:

```powershell
python tools/view_d1_export.py "backups\results-YYYY-MM-DD_HH-mm-ss.sql"
python tools/view_d1_export.py --summary
```

The GUI provides table counts, paginated and searchable contents, full selected
row values with formatted JSON, and each table's SQL schema.
