# User study

Static GitHub Pages build of the glossiness and metallicness perception study.

The study constants are centralized in `src/study-config.ts`. The current
deployment uses bundled preview stimuli and retains support for the Prolific URL
parameters `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID` so server-side balanced
assignment and durable result submission can be connected later.
