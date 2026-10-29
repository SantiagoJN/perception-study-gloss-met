# Material constancy user study

Web application for studying glossiness and metallicness constancy across
changes in object geometry and illumination.

<!-- 
## Current production architecture

GitHub Pages serves the static study and Cloudflare R2 serves the stimuli. Direct
task links first validate the Prolific URL identifiers plus a generated username
and password through `perception-study-api`. That Worker is the only public writer
to the EU D1 database `perception-study-results`; the browser never receives D1
credentials. The final screen is shown only after D1 confirms the complete set of
trial rows and returns a receipt. `/testing` is enabled only on localhost, the
approved development tunnel, and the GitHub Pages host; it downloads a CSV.

The root URL shows consent, demographics, the glossiness/metallicness guide, and
a chooser for one independent task:

1. pair identity using `Probably different`, `Unsure`, and `Probably same`;
   independent glossiness and metallicness comparisons are always visible and
   required, including when the material identity answer is `Probably same`;
2. two-alternative reference matching: a central reference with a black border,
   option A on the left and option B on the right;
3. in-context matching between two groups that share either geometry or
   illumination, with that condition changed between groups;
3.2. two-option in-context matching: the exact Test-2 reference and A/B
   alternatives, embedded in the contextual probe scenes used by Test 3;
4. multiple matching: selection of up to two same-material images from a
   6-candidate, 2 x 3 grid. Setup sampling and the current candidate banks
   remain unchanged; the UI temporarily shows six shuffled candidates per setup.

Each finalized 600-trial bank is partitioned once into twelve immutable sets of
50 experimental trials in `public/fixed_trial_groups.json`. Every set contains
25 trials from either task-specific binary condition and a rotating
12/12/13/13 split across easy, medium-easy, medium-hard and hard. Across all
twelve sets, every difficulty occurs exactly 150 times and every source trial
occurs exactly once. Trial order, pair A/B placement and Test-4 candidate order
remain randomized per participant, but set membership is fixed. Responses are
autosaved locally while the study is in
progress, then submitted to D1 with timing, training, demographic, Prolific and
client metadata. A CSV remains available as a researcher/debugging backup.
Demographic information is also checkpointed to D1 as soon as the participant
continues past that form, before any instructions or trials are shown. The
completion and screen-out submissions update the same fields again.
If the final D1 write fails with a server error, the Worker automatically saves
and confirms the full result as a CSV object in the private EU R2 bucket
`perception-study-results-fallback`. The participant sees a pseudonymous `r2-`
receipt only after that confirmation. If both remote stores or the network are
unavailable, the participant can still download the full CSV and is instructed
to email it to `s.jimenez@unizar.es` with subject `Prolific results`. The local
fallback `Done` action is enabled only after the CSV has been downloaded and
then opens a thank-you screen that does not claim remote success.

Production sessions add five fixed sentinel trials to every task at displayed
positions 2, 4, 8, 12 and 15. They are additional trials, so the experimental
set and its balances remain unchanged. Every production task therefore has 55
displayed trials: 50 experimental trials plus five sentinels. Rows are marked by
`assignment_set`, `is_sentinel` and `sentinel_id` in the CSV; the assigned set is
also stored with every D1 response. Sentinels are never inserted in
`/testing` or `?testing=1`. The canonical configuration is
`stimulus_generation/sentinels/config.json`; publish and validate it with
`python3 scripts/publish_sentinel_trials.py`.

A sentinel is failed when any of its evaluated component responses is incorrect.
Test 1 always checks material identity and checks the configured appearance
attribute(s); unevaluated glossiness or metallicness responses are still stored but
do not affect screening. Tests 2, 3 and 3.2 check their single forced choice; Test 4
checks the selected/not-selected state of all six candidates. Tests 1–3 are
screened out immediately after the second failed
sentinel. Test 4 permits two failed sentinels and screens out after the third.
The browser stops presenting trials, and the Worker independently
re-evaluates the submitted sentinel responses before recording the partial
response set. D1 stores `screened_out`, the timestamp, the number of sentinel
trials and subquestions evaluated, the number of failed sentinels, the reason, and a
screening receipt. Screened-out sessions cannot later be completed by reloading
the page or calling the completion endpoint directly.

After D1 confirms either a successful completion or a screen-out record, the
browser shows the corresponding status screen and asks the participant to click
the destination configured for that test in
`public/completion_redirects.txt` or `public/screen_out_redirects.txt`. Each file
has one `testN=URL` entry. URLs may be absolute or relative to the deployed study
root. The fallback values currently point to `preview`; edit only the values to
install the final Prolific completion and custom-screening URLs. In-house
sessions are not redirected between their four consecutive tasks.
The screen-out page also displays a manual Prolific code from
`public/screen_out_codes.txt`, with one independently editable `testN=CODE`
entry. The successful-completion page uses the equivalent
`public/completion_codes.txt`. Both pages provide a Prolific button, a selectable
code and a copy-to-clipboard control.

The participant questionnaire has three sections: Demographic information
(sex assigned at birth, gender identity, and completed education), Vision
(normal or corrected-to-normal vision), and Background and experience (multiple
selections, with an exclusive None option). Self-described gender and Other
education require a short text answer. Age, native language, English task proficiency, and country
of origin are temporarily removed; their implementation remains commented in
`src/demographics.tsx` for possible restoration. All four CSV exports use the same demographic
columns; background experience is a JSON array. Hidden text answers are cleared
when their parent choice changes. The privacy notice describes aggregate
analysis/reporting, not irreversible anonymization of raw browser/CSV records.
Run `node scripts/test_demographics.mjs` for questionnaire validation/export checks.

Pair comparison begins with three mandatory training pairs from `public/tutorial`:
yellow low/low versus high/high (different, B glossy, B metallic), blue high-gloss/
low-metal versus low-gloss/high-metal (different, A glossy, B metallic), and two
copies of yellow low-gloss/high-metal (same, same, same). All three answers must
be checked and correct to advance. Every incorrect answer receives an
attribute-specific retry question and a short visual cue without revealing the
correct option. Training responses are
logged separately from experimental trials. Every checked combination records
the example and attempt numbers, the three selected answers, correctness,
response time, help-button openings, and an ISO timestamp. The chronological
array is autosaved immediately and exported as `pair_training_attempts_json`
on each test-2 CSV row. Experimental trial numbering and timing still begin
after training.
Run `node scripts/test_pair_training.mjs` for exhaustive training-answer checks.

The appearance guide presents eight images from the dataset's `tutorial` folder:
four golden T01 examples for glossiness and four blue T02 examples for metallicness.
Each attribute has Low/High columns with two stacked samples, keeping the other
attribute aligned across the rows. The public copies live in `public/tutorial`.

### Direct participant links

| Route | Task | Trials |
| --- | --- | ---: |
| `/test1_pair_comparison` | Pair comparison | 55 (50 + 5 sentinels) |
| `/test2_2afc` | Reference matching | 55 (50 + 5 sentinels) |
| `/test3_matching` | In-context matching | 55 (50 + 5 sentinels) |
| `/test3.2_matching2` | Two-option in-context matching | 55 (50 + 5 sentinels) |
| `/test4_mm` | Multiple matching | 55 (50 + 5 sentinels) |

`/inhouse` signs in with the internal `gilab-inhouse` flow automatically and
opens the normal welcome screen. It then continues through consent and the
extended in-house demographic questionnaire before running all four tests.

Each direct link first requests the username supplied through Prolific, then
starts consent, demographics, the appearance guide and that task's instruction
screen. The participant enters only the username; the generated Prolific files
repeat it as the password for import compatibility. Its session trials are selected on
page load. The first trial is preloaded before the task starts, then the current
and next two trials are preloaded while the participant advances. All five
participant tests use WebP thumbnails in their normal layouts: square material
renders are 512 x 512, while the Test 3 reference and question composites are
768 x 256 and 1152 x 256 respectively. Test 3.2 uses 768 x 256 references and
896 x 256 two-option question scenes. Opening the zoom view still loads the
original full-resolution PNG. If a thumbnail is temporarily absent from R2,
the browser falls back to its original PNG instead of blocking the study.

Generate the complete thumbnail set from the external dataset checkout with:

```bash
python3 scripts/generate_datasetv9_thumbnails.py
```

The generated directories (not committed to this frontend repository) are:

- `../datasetv9/thumbnails/` (8100 square renders);
- `../datasetv9/groups4/thumbnails/` (1200 Test 3 composites from `renders3`);
- `../datasetv9/groups4/sentinels_thumbnails/` (10 Test 3 sentinel composites);
- `../datasetv9/groups3/thumbnails/` (1200 Test 3.2 composites);
- `../datasetv9/groups3/sentinels_thumbnails/` (10 Test 3.2 sentinel composites).

Upload them to R2 under those same object prefixes before publishing the
frontend. Re-running the command is incremental; use `--force` only when every
thumbnail must be rebuilt.

The root route no longer enters the study. The unrestricted chooser is available
only at `/preview`; `/testing` remains available for interface checks on the
explicitly approved development and GitHub Pages hosts. The direct
links do not expose testing controls or correct answers. The current flow, CSV fields, task
banks, and entry points are recorded in `supabase_seeds/manifest.json` under
`current_study`; the original top-level keys describe the previous Supabase
seed generation.

Because `/testing` is explicitly enabled on GitHub Pages, its separate
`testing_ground_truth.json` answer map is intentionally public. Participant
routes never load or display it, and regular manifests are still stripped of
correct-answer fields and sensitive image metadata before deployment. Do not
share the `/testing` URL with study participants.

The submission client has the public Worker endpoint compiled as a safe default:
`https://perception-study-api.bunnysantiago.workers.dev`. `public/config.js` may
override it for staging, but a missing or stale runtime config can no longer
disable D1 submission.

Production mode does not expose testing controls and ignores trial-count query
overrides. Each production username encodes its assigned `set_01` through
`set_12` in the authenticated `assignmentSeed`; legacy seeds still use a
reproducible hash. URL parameters cannot override the authenticated batch. The
same set number never contains the
same inherited family in Tests 2, 3 and 4, preventing repeated base/extended
setups if one participant opens those three tasks with a consistent group.
Append `?testing=1` to show the demographic skip and enable the
`trials` override; a skip is recorded as `demographics_skipped` in the CSV.
Both `/preview` and `/testing` are pinned to `set_01`. Preview presents its full
50-trial set; `testing?trials=N` draws a reproducible balanced subset from that
same first batch, never from the other eleven batches. These examples come
exclusively from the same finalized manifests used by participant routes; no
separate hand-picked testing stimuli are used. Correct-answer overlays are regenerated from those exact manifests
with:

```bash
python3 scripts/generate_testing_ground_truth.py
```

Regenerate and validate the immutable production partition after changing any
of the four 600-trial manifests with:

```bash
python3 scripts/build_fixed_trial_groups.py
```

Audit copies, a flat assignment CSV, balance tables and the complete validation
report are stored in `stimulus_generation/fixed_trial_groups_v1/`.

Generate a fresh private credential bank only when the current one must be
replaced:

```bash
python3 scripts/generate_fixed_batch_credentials.py
```

The current bank is stored in the gitignored directory
`private/credentials/fixed_batches_v1/`. It contains the fixed-batch participant
credentials, two universal internal accounts (`gilab-inhouse` and
`gilab-testing`), the D1 import SQL, a complete credential-to-batch mapping and
one Prolific-ready TXT file per test. Never publish or commit this directory.

Anonymous Prolific entry uses a separate internal-only pool. It currently has
3,000 credentials per test, distributed as exactly 250 credentials for each of
the 12 batches. Extend it without changing existing allocations with:

```bash
python3 scripts/extend_anonymous_credentials.py \
  --target-per-test 3000 --tag <unique-tag>
```

Import only the extension SQL produced under
`private/credentials/fixed_batches_v1/anonymous_v1/extensions/<unique-tag>/`.

Generate the browser manifest and build the app with:

```bash
../mining_pairs_v2/.venv/bin/python scripts/generate_local_study_manifest.py
../mining_pairs_v2/.venv/bin/python scripts/generate_new_task_trials.py
npm run build
python3 server.py --host 127.0.0.1 --port 8020
```

For short interface tests, append `?testing=1&trials=8` to the URL. Accepted values are
multiples of eight from 8 to 80; the default remains 40.

For the four-material and multiple-matching tasks,
`?testing=1&trials=N` accepts 1 through 120 and defaults to 20. Multiple
matching sessions of at least three trials contain exactly three SVBRDF
references.

### Generate reference and four-material trials

```bash
../mining_pairs_v2/.venv/bin/python scripts/generate_new_task_trials.py
```

This reproducibly creates 120 reference-matching trials while preserving the
existing provisional four-material bank unless
`--regenerate-scene-matching` is passed. In reference matching, one option
matches the reference material and the distractor comes from the same curated
group. A and B may share a scene or differ in geometry, illumination, or both.
The options are selected from the
existing foreground descriptors using the signed material-appearance distance
gap `different − same`. Large positive gaps are easy and gaps near zero are
hard. The bank contains exactly 30 `easy`, 30 `medium_easy`, 30 `medium_hard`
and 30 `hard` triplets, and a 40-trial session samples ten from each level.
The matching and distractor options are no longer forced to share a scene:
the 120-trial bank contains 30 cases each where their geometry and illumination
are both equal, only geometry changes, only illumination changes, or both
change. Their relation to the reference may also vary.
In in-context matching, each curated group supplies
four one-to-one material correspondences across two scene conditions. Half of
the trials change geometry while illumination remains fixed for all eight
images; the other half change illumination while geometry remains fixed. The
four lettered samples therefore share one exact scene condition and the four
numbered samples share the other.

Test 3 begins with two interactive, explicitly labelled training examples before
trial 1. The first uses low-gloss, low-metallic SVBRDFs from G90, G91, G92 and
G94 on spheres under two illuminations; the second uses the same materials
under fixed illumination with `bumpiness_1` above and `ridges_0` below.
Training answers are explained immediately and are not written to the CSV.
Rebuild these examples with
`python3 scripts/generate_scene_matching_training.py` when the private name
mapping and datasetv7 renders are available.

Scored-trial manifests contain opaque image names and no correctness labels. Private
ground truth and provenance are stored under
`stimulus_generation/new_tasks_v1/`. Current scored composites use the external
`datasetv9/groups4/thumbnails/` directory described above.

### Generate the 18-candidate selection sets

This command requires the completed G90 renders and both
`datasetv7/PNG_COMPLETE` and `mining_pairs_v2/COMPLETE` markers:

```bash
mining_pairs_v2/.venv/bin/python \
  perception-study-gloss-met/scripts/generate_selection_trials.py
```

The script enforces those completion markers and exits without writing partial
results if either is absent. It reuses `mining_pairs_v2` pair scores and creates
400 reproducible setups with 18 unique candidates each. Every setup contains
all eight requested physical-type × difficulty combinations:

- same-material/easy;
- same-material/medium-easy;
- same-material/medium-hard;
- same-material/hard;
- different-material/easy;
- different-material/medium-easy;
- different-material/medium-hard;
- different-material/hard.

Different-material candidates remain restricted to the reference's curated
group. The four levels are strict, non-overlapping within-reference quartiles.
The number of true matches alternates evenly between 4 and 5 (200 setups each):
four are necessary to guarantee one same-material candidate at every level,
while the fifth preserves some uncertainty about the answer count.
Reference materials occur six or seven times each, candidate-image reuse is
capped at eight, and reuse of the exact reference image is explicitly forbidden
and validated. Reuse and per-material caps are never relaxed. Preferred
change-type substitutions are retained in the private audit table and counted
in provenance. The automatic difficulty values remain unvalidated mining
heuristics.

The current frontend uses the shared 512 px WebP files in
`datasetv9/thumbnails/`. Before starting the selection task the browser loads
only the first trial, then progressively preloads the current and next two
trials with three retries per image. The original 1024 px PNG is requested only
for the zoom view.

Outputs:

- `public/selection_trials.json`: browser manifest without material labels or
  correctness flags;
- `stimulus_generation/selection_v1/selection_trials_ground_truth.csv`: private
  join table containing identities, roles, scores and ground truth;
- `stimulus_generation/selection_v1/trial_composition.csv`: per-trial role
  counts;
- `stimulus_generation/selection_v1/provenance.json`: full configuration,
  source hashes and output hash.
- `../datasetv9/thumbnails/*.webp`: shared grid/reference thumbnails generated
  by `generate_datasetv9_thumbnails.py`.

### Audit the Test #4 setups

The private audit viewer at `/test4_setups/` displays one setup per row: the
reference is on the left and the candidates are separated into same-material
(correct) and different-material (incorrect) columns. Each column is ordered
left-to-right by ascending automatic `difficulty_score`. It exposes ground
truth and real material names for dataset inspection, so it must not be used as
a participant-facing study route.

Regenerate its joined manifest after changing the Test #4 bank:

```bash
../mining_pairs_v2/.venv/bin/python scripts/generate_test4_audit_viewer.py
npm run build
```

The viewer validates all 400 setups, 18 unique candidates per setup, exclusion
of the exact reference image, presence of all eight material/difficulty
combinations, and the balanced 4--5 correct-answer distribution before it
writes `public/test4_setups/setups.json`.

After generation, rebuild the frontend. `server.py` serves both local
`datasetv6/renders` and `datasetv7/renders`, so the generated v7 paths work from
the same origin.

### Cloudflare stimulus deployment

The current dataset-v9 participant manifests still reference the descriptive
object keys that were uploaded to R2. The transparent browser overlay prevents
casual right-click/open-image use, and the production sanitizer removes answer
fields and image metadata, but neither mechanism hides a URL from browser
developer tools. Full filename anonymity therefore requires uploading a v9
copy under opaque immutable keys and rewriting every production manifest (or
serving authenticated opaque aliases from a Worker). Do not describe the
current v9 deployment as cryptographically anonymous.

The older dataset-v7 anonymization workflow produced final SHA-256 filenames
with `datasetv7/upload_cloudflare.sh`. Its private iteration files are kept in
`private/deployment/`:

- `render_name_mapping.csv`: random dataset-v7 name to original filename;
- `cloudflare_name_mapping.csv`: uploaded SHA-256 object name, random name and
  original filename;
- `canonical_*.json`: private descriptive copies of the two browser manifests;
- `anonymous_manifest_provenance.json`: counts and hashes of the sanitized
  outputs.

All reverse mappings and canonical manifests are ignored by Git and must not be
published. Back them up separately. `scripts/anonymize_cloudflare_manifests.py`
is dataset-v7-specific and must not be run against the v9 manifests without
first extending and validating its mapping logic. After regenerating browser
manifests, rebuild and let the Pages workflow sanitize the deployment artifact:

```bash
npm run build
```

The checked-in runtime configuration uses the production stimulus origin
`https://stimuli.santiagojn.xyz`. GitHub Pages also requires the repository
variable `STIMULUS_BASE_URL` to contain that production R2 custom domain; the
workflow rejects `r2.dev`. Dataset paths in browser
manifests are appended to that origin, while manifests, tutorials and interface
assets continue to be served by the study itself.

Run the browser-level regression suite with:

```bash
npm run test:e2e
```

It launches a temporary local server and headless Chrome and traverses all four
task interfaces. It also checks the independent pair questions, the
production/testing gate, the multiple-matching SVBRDF balance, the
five-selection cap and reversible deselection.

## Previous Supabase production design (not active in local pilot v1)

Each production session contains 60 trials:

- 40 pair trials, each collecting perceived material identity, relative
  glossiness, and relative metallicness;
- 20 reference-selection trials with one reference and four candidates.

The design uses the 2,400 selected pairs from `mining_pairs_v2`: 1,200
same-material and 1,200 different-material pairs, balanced over four
provisional difficulty strata. Reference trials use a same-material pair as
reference/correct match and the three other materials in the same curated group
as distractors. All four candidates share the correct candidate's geometry and
illumination. Sixty-four selected pairs without three QC-valid distractors are
replaced by eligible reserve pairs.

At ten responses per pair and reference set, both tasks finish after 600
complete sessions. Supabase balances assignments by completed plus reserved
coverage and releases sessions abandoned for more than six hours.

## Generated study data

Run either generator after changing `mining_pairs_v2`:

```powershell
./scripts/generate_constancy_seeds.ps1
```

```bash
python scripts/generate_constancy_seeds.py
```

They create:

- `supabase_seeds/constancy_pairs.csv` — 2,400 pair trials;
- `supabase_seeds/constancy_reference_sets.csv` — 1,200 reference sets;
- `public/constancy_preview.json` — six local testing trials;
- `supabase_seeds/manifest.json` — counts and SHA-256 hashes.
- `cloudflare_upload_manifest.csv` — local mapping from source renders to
  anonymous Cloudflare object keys.

The two seed CSVs and the Cloudflare mapping are intentionally ignored by Git:
they contain physical ground truth. Browser-visible image paths are SHA-256
aliases, so filenames do not reveal which reference candidate is correct.

## Deployment

Follow [DEPLOYMENT.md](DEPLOYMENT.md). The GitHub workflow reads the repository
variable `STIMULUS_BASE_URL` and rejects missing values or `r2.dev` development
URLs. Responses are sent only to the configured Cloudflare Worker+D1 backend;
the active frontend no longer publishes Supabase configuration. -->
