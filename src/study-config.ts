export const TOTAL_STIMULI_POOL = 2_880;
export const TARGET_LABELS_PER_STIMULUS = 10;
export const MAIN_RATINGS_PER_SESSION = 80;
export const INITIAL_RATINGS_PER_SESSION = 4;

export const TOTAL_TARGET_RATINGS =
  TOTAL_STIMULI_POOL * TARGET_LABELS_PER_STIMULUS;

export const EXPECTED_PARTICIPANT_SESSIONS =
  TOTAL_TARGET_RATINGS / MAIN_RATINGS_PER_SESSION;

// The deployed preview uses the bundled sample list. A later server-side
// assignment step can replace that list while preserving these study totals.
