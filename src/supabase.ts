export type ProlificIdentifiers = {
  participantId: string;
  studyId: string;
  sessionId: string;
};

export type StudyDemographics = {
  gender: string;
  gender_other: string | null;
  age: number;
  computer_graphics_knowledge: string;
  design_modeling_experience: string;
  artistic_experience: string;
};

export type PairAssignment = {
  pair_id: string;
  trial_number: number;
  swap_ab: boolean;
  image_path_a: string;
  image_path_b: string;
};

export type ReferenceAssignment = {
  reference_id: string;
  trial_number: number;
  reference_path: string;
  candidate_order: string[];
};

export type ClaimedSession = {
  study_session_id: string;
  pair_trials: PairAssignment[];
  reference_trials: ReferenceAssignment[];
};

export type SubmittedPairResponse = {
  pair_id: string;
  same_material_likelihood: number;
  relative_glossiness: number;
  relative_metallicness: number;
  response_time_ms: number;
};

export type SubmittedReferenceResponse = {
  reference_id: string;
  candidate_order: string[];
  selected_candidate_path: string;
  response_time_ms: number;
};

declare global {
  interface Window {
    USER_STUDY_CONFIG?: {
      supabaseUrl?: string;
      supabasePublishableKey?: string;
      stimulusBaseUrl?: string;
      prolificCompletionUrl?: string;
    };
  }
}

function runtimeConfig() {
  const config = window.USER_STUDY_CONFIG;
  const url = config?.supabaseUrl?.replace(/\/$/, '') ?? '';
  const key = config?.supabasePublishableKey ?? '';
  return { url, key, enabled: Boolean(url && key) };
}

async function callRpc<T>(name: string, body: Record<string, unknown>) {
  const { url, key } = runtimeConfig();
  if (!url || !key) throw new Error('Supabase is not configured.');
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function claimConstancySession(
  identifiers: ProlificIdentifiers,
  demographics: StudyDemographics,
) {
  const { enabled } = runtimeConfig();
  if (!enabled) throw new Error('Supabase is not configured.');
  return callRpc<ClaimedSession>('claim_constancy_session', {
    p_participant_id: identifiers.participantId,
    p_study_id: identifiers.studyId,
    p_prolific_session_id: identifiers.sessionId,
    p_demographics: demographics,
  });
}

export async function submitConstancySession(
  studySessionId: string,
  participantId: string,
  pairResponses: SubmittedPairResponse[],
  referenceResponses: SubmittedReferenceResponse[],
) {
  return callRpc<boolean>('submit_constancy_session', {
    p_study_session_id: studySessionId,
    p_participant_id: participantId,
    p_pair_responses: pairResponses,
    p_reference_responses: referenceResponses,
  });
}
