# Material constancy user study

Static GitHub Pages application for studying glossiness and metallicness
constancy across changes in object geometry and illumination.

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

Follow [DEPLOYMENT.md](DEPLOYMENT.md). The GitHub workflow injects these
repository secrets into the static build:

- `SUPABASE_URL`;
- `SUPABASE_PUBLISHABLE_KEY`;
- `STIMULUS_BASE_URL`.

Never use or expose a Supabase service-role key in this static website.
