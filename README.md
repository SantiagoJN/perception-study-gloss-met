# User study

Static GitHub Pages build of the glossiness and metallicness perception study.

The study constants are centralized in `src/study-config.ts`. Supabase assigns
exactly 80 main-study stimuli per participant, balances every stimulus toward 10
completed ratings, stores results server-side, and keeps the assigned order
stable if a participant reloads. Six of those stimuli are repeated throughout
the session to measure within-participant consistency, producing 90 total
ratings (4 initial + 80 main + 6 repeated). The four initial images and six
repeated responses are stored separately in `initial_ratings` and
`repeated_ratings`. Gender, age,
computer-graphics knowledge, design/3D-modeling experience, and artistic
experience are stored once per participant in the `study_sessions` table.

The application reads `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID` from the URL.
When those parameters are absent, a tab-scoped anonymous identifier is created
so a normal direct run is still assigned and saved in Supabase. It requests the
assignment as soon as the participant enters the tutorial and preloads all 90
images before enabling the start button. The temporary Testing toggle runs
4 + 10 bundled images locally, does not write to Supabase, and exposes the CSV
download only on its final screen. Normal runs do not retain result data in the
browser.

Deployment configuration is injected by GitHub Actions from these repository
secrets:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (browser-safe; database access is restricted by RLS)
- `STIMULUS_BASE_URL` (public HTTPS base URL containing the 2,880 render files)

Until `STIMULUS_BASE_URL` is configured, the deployed page can be reviewed in
preview/testing mode with its bundled sample images, but a production assignment
cannot preload the complete dataset.
