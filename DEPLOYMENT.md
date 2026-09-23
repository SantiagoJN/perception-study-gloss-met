# Deployment checklist

## 1. Upload the 3,600 renders to Cloudflare R2

First run `scripts/generate_constancy_seeds.ps1`. It creates the local,
Git-ignored `cloudflare_upload_manifest.csv`, which maps descriptive source
filenames to opaque SHA-256 object names. Do not upload the original filenames:
they reveal the material identity used by the reference task.

1. Create an R2 bucket, for example `material-constancy-stimuli`.
2. Create an R2 S3 API token restricted to Object Read & Write for that bucket.
   Keep the access-key ID and secret locally; never commit or paste them into
   GitHub.
3. Configure an rclone S3 remote with provider `Cloudflare`, region `auto`, and
   endpoint:

   ```text
   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

4. If the dataset is on a local NTFS disk, create a hard-link staging directory.
   `DatasetRoot` is the directory that contains the `datasetv6` folder. Put
   `StagingRoot` on the same local disk so this does not duplicate image data:

   ```powershell
   .\scripts\stage_cloudflare_stimuli.ps1 `
     -DatasetRoot "D:\path\containing-datasetv6" `
     -StagingRoot "D:\material-constancy-r2-staging"
   ```

5. Upload the staged `stimuli` directory:

   ```powershell
   rclone copy "D:\material-constancy-r2-staging\stimuli" `
     "cloudflare:material-constancy-stimuli/stimuli" `
     --include "*.png" --progress --transfers 12 --checkers 24
   ```

   If the dataset is on a mapped/network filesystem such as SSHFS, hard links
   are unavailable. Upload directly from the manifest instead:

   ```powershell
   .\scripts\upload_cloudflare_stimuli.ps1 `
     -DatasetRoot "V:\vlm_dataset" `
     -Remote "cloudflare bucket:perception-study-stimuli" `
     -Transfers 8
   ```

   The direct uploader is resumable: rerunning the same command skips objects
   that already exist. It writes any failures to the Git-ignored
   `cloudflare_upload_failures.csv`.

6. Connect a public custom domain for the production study. Cloudflare's
   `r2.dev` URL is suitable for testing but is rate-limited and documented as a
   non-production endpoint. Check that an opaque object opens in a private
   browser window:

   ```text
   https://<PUBLIC_R2_HOST>/stimuli/<sha256>.png
   ```

7. Add an R2 CORS rule allowing `GET` and `HEAD` from the exact GitHub Pages
   origin. Use the public custom-domain URL—not the S3 API endpoint—as GitHub's
   `STIMULUS_BASE_URL` secret, without a trailing slash.

## 2. Create and seed the Supabase project

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
Actions, replace:

- `SUPABASE_URL` with the new Supabase Project URL;
- `SUPABASE_PUBLISHABLE_KEY` with the new publishable/anon key;
- `STIMULUS_BASE_URL` with the public R2 URL or custom domain.

Then rerun **Deploy GitHub Pages** under Actions, or push a commit to `main`.

## 4. Pre-launch reset

Run only when no participant is active:

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
