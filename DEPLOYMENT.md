# Deployment checklist

## Active response backend: Cloudflare Worker + D1

- Worker: `perception-study-api`
- Endpoint: `https://perception-study-api.bunnysantiago.workers.dev`
- D1 database: `perception-study-results` (`e08124e3-d9b0-4841-8899-edde9147842e`, EU jurisdiction)
- Private result fallback: R2 bucket `perception-study-results-fallback` (EU jurisdiction)
- Source and migration: `cloudflare-worker/`

Apply migrations and deploy with the commands in `cloudflare-worker/README.md`.
The `SESSION_SIGNING_SECRET` must remain a Worker secret. Generate participant
credentials with `cloudflare-worker/scripts/generate-credentials.mjs`; store its
plaintext CSV only in `private/credentials/`, and import only `credentials.sql`
into D1. The GitHub Pages workflow writes the Worker endpoint to runtime
`config.js`. Production task URLs must include `PROLIFIC_PID`, `STUDY_ID` and
`SESSION_ID`.

The Supabase instructions later in this document describe the legacy design and
are not part of the active deployment.

Final submissions and attention-test screen-outs are written to D1 first. If
that final D1 operation fails with a server error, the Worker automatically
stores and confirms a complete CSV in the private fallback bucket before the
frontend displays success. The fallback bucket must remain private and must
never share the public stimulus hostname. See `cloudflare-worker/README.md` for
the object format and recovery procedure.

## 1. Upload the 3,600 anonymous renders to Cloudflare R2

Dataset v7 is already prepared for an opaque deployment. Run
`datasetv7/upload_cloudflare.sh` from the dataset workspace: it hard-links the
3,600 files from `datasetv7/renders_anon` into
`material-constancy-r2-staging` under their final SHA-256 object names. Upload
the contents of that staging directory without renaming them. Do not upload
`datasetv7/render_name_mapping.csv` or anything under the study's
`private/deployment` directory.

After regenerating study manifests, run `npm run
prepare:cloudflare-manifests`; it verifies and replaces every descriptive image
path with the exact final Cloudflare object filename.

Do not upload the original filenames: they reveal the material identity used by
the matching task.

1. Create an R2 bucket, for example `material-constancy-stimuli`.
2. Create an R2 S3 API token restricted to Object Read & Write for that bucket.
   Keep the access-key ID and secret locally; never commit or paste them into
   GitHub.
3. Configure an rclone S3 remote with provider `Cloudflare`, region `auto`, and
   endpoint:

   ```text
   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

4. Create or refresh the hard-link staging directory from the workspace root:

   ```bash
   bash datasetv7/upload_cloudflare.sh
   ```

5. Upload the staged PNGs. This example places them at the bucket root; add a
   remote prefix if desired and include the same prefix in
   `STIMULUS_BASE_URL`:

   ```bash
   rclone copy material-constancy-r2-staging \
     cloudflare:material-constancy-stimuli \
     --include '*.png' --progress --transfers 12 --checkers 24
   ```

   The copy is resumable and the staging directory contains no descriptive
   filenames.

6. Connect a public custom domain for the production study. Cloudflare's
   `r2.dev` URL is suitable for testing but is rate-limited and documented as a
   non-production endpoint. Check that an opaque object opens in a private
   browser window:

   ```text
   https://<PUBLIC_R2_HOST>/<sha256>.png
   ```

7. Add an R2 CORS rule allowing `GET` and `HEAD` from the exact GitHub Pages
   origin. Use the public custom-domain object-directory URL—not the S3 API
   endpoint—as the GitHub Actions repository variable `STIMULUS_BASE_URL`,
   without a trailing slash. The deployment workflow deliberately rejects an
   empty value and any `r2.dev` hostname.

8. Create a Cache Rule for that hostname with **Cache eligibility: Eligible
   for cache**. Use a long Edge TTL because stimulus object keys are immutable;
   enable Smart Tiered Cache under Cache → Tiered Cache. After verifying the
   custom hostname, disable the bucket's Public Development URL so that the
   uncached `r2.dev` path cannot bypass the production path.

## 2. Legacy Supabase setup (not used by the current study)

1. Create a new Supabase project.
2. Open SQL Editor and run `supabase_setup.sql` in full.
3. In Table Editor, open `constancy_pairs`, choose **Import data from CSV**, and
   import `supabase_seeds/constancy_pairs.csv`.
4. Import `supabase_seeds/constancy_reference_sets.csv` into
   `constancy_reference_sets`.
5. Verify the seed:

   ```sql
   select count(*) as pairs from public.constancy_pairs;
   select count(*) as reference_sets from public.constancy_reference_sets;
   ```

   Expected results: 2,400 and 1,200.

6. From the project's **Connect** dialog (or Settings → API Keys), copy the
   Project URL and a `sb_publishable_...` key. A publishable key is designed for
   browser code; never use a secret/service-role key here.

7. Keep the seed CSVs local. They contain the study ground truth and are already
   excluded from Git by `.gitignore`.

## 3. Connect GitHub Pages

In GitHub → `perception-study-gloss-met` → Settings → Secrets and variables →
Actions → Variables, create `STIMULUS_BASE_URL` with the production R2 custom
domain (for example `https://stimuli.example.org`). Supabase variables are no
longer used by the current Worker+D1 frontend.

Then rerun **Deploy GitHub Pages** under Actions, or push a commit to `main`.

Standard GitHub Pages currently serves its own HTML cache policy (observed as
`Cache-Control: max-age=600`), which this repository cannot override. The build
therefore uses content-hashed JS/CSS, a Git-SHA query on `config.js`, and the
same deployment version on manifest requests. A participant may still receive
the previous *coherent* release for up to about ten minutes. Deploy at least
ten minutes before recruitment, then verify all four public routes in a fresh
private browser before opening the Prolific study.

The Pages workflow is intentionally fail-closed: it runs lint, Worker tests,
manifest/config validators and both browser E2E suites, then sanitizes and
validates the exact artifact. It refuses to publish if `STIMULUS_BASE_URL` is
missing, uses `r2.dev`, exposes Supabase configuration or retains answer fields
inside participant manifests. The separate `/testing` answer map is published
intentionally so that the approved GitHub Pages testing route can display its
answer overlays; do not distribute that route to participants.

## 4. Cloudflare capacity before recruitment

Cloudflare documents the R2 free allowance as 10 million Class-B reads per
month with free egress. The anonymous credential pool contains 3,000 slots per
test, but preallocating a slot does not generate R2 traffic; only actual study
sessions do. Monitor real recruitment volume and cache hit rate rather than the
pool size. The important R2 production risk is the variable throttle on
`r2.dev`, so do not recruit until the custom domain is active and the public
development URL has been disabled.

The response API is also comfortably below the Workers Free request allowance
(100,000 requests/day), but D1 Free permits only 100,000 rows written/day.
Every completed participant writes 55 trial rows, plus session, demographic,
login and index updates. A same-day launch of most or all credentials can
approach or exceed the D1 write allowance because indexes also count as row
writes. For the definitive study, use Workers Paid (which removes D1's daily
free-tier cap) or strictly stagger recruitment across days while monitoring
**D1 → perception-study-results → Metrics → Row Metrics**. Workers Paid is the
recommended option because a quota failure at final submission is more costly
than the small subscription fee.

Before launch:

1. Confirm the R2 custom hostname reports **Active** and that a real stimulus
   returns `200` from a private browser.
2. Create a Cache Rule for that hostname with cache eligibility enabled and a
   long Edge TTL; enable Smart Tiered Cache.
3. Disable the bucket's `r2.dev` public development URL.
4. Set the GitHub Actions variable `STIMULUS_BASE_URL` to the custom hostname,
   without a trailing slash.
5. Apply every D1 migration and deploy the Worker before publishing the
   frontend.
6. Confirm that the Worker deployment lists both `DB` and `RESULTS_FALLBACK`
   bindings, and that `perception-study-results-fallback` has no public
   development URL or custom domain.
7. Confirm the completion and screen-out code for each of the four separate
   Prolific studies; shared values are valid only if Prolific was deliberately
   configured that way.
8. Deploy at least ten minutes early and complete one end-to-end pilot account
   per test while checking D1 receipts and Row Metrics.

## 5. Legacy Supabase pre-launch reset (not for the current D1)

This SQL belongs to the inactive Supabase design above. Never run it against
`perception-study-results`. Run it only on the legacy Supabase project and only
when no participant is active:

```sql
begin;

truncate table
  public.constancy_pair_responses,
  public.constancy_reference_responses,
  public.constancy_pair_assignments,
  public.constancy_reference_assignments,
  public.constancy_sessions;

update public.constancy_pairs
set completed_labels = 0, reserved_labels = 0;

update public.constancy_reference_sets
set completed_labels = 0, reserved_labels = 0;

commit;
```
