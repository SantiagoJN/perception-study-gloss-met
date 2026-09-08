# User study

Static GitHub Pages build of the glossiness and metallicness perception study.

The study constants are centralized in `src/study-config.ts`. Supabase assigns
exactly 80 main-study stimuli per participant, balances every stimulus toward 10
completed ratings, stores results server-side, and keeps the assigned order
stable if a participant reloads. The four initial images are stored separately
from the 80 main responses.

The application reads `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID` from the URL.
It requests the assignment as soon as the participant enters the tutorial and
preloads all 84 images before enabling the start button. The temporary Testing
toggle runs 4 + 10 bundled images without writing to Supabase.

Deployment configuration is injected by GitHub Actions from these repository
secrets:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (browser-safe; database access is restricted by RLS)
- `STIMULUS_BASE_URL` (public HTTPS base URL containing the 2,880 render files)

Until `STIMULUS_BASE_URL` is configured, the deployed page can be reviewed in
preview/testing mode with its bundled sample images, but a production assignment
cannot preload the complete dataset.
