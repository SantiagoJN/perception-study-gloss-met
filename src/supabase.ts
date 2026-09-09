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

export type AssignedStimulus = {
  study_session_id: string;
  stimulus_id: number;
  file_name: string;
  public_path: string;
  trial_number: number;
};

export type SubmittedRating = {
  stimulus_id: number;
  glossiness: number;
  metallicness: number;
  response_time_ms: number;
};

export type SubmittedInitialRating = {
  stimulus: string;
  trial_number: number;
  glossiness: number;
  metallicness: number;
  response_time_ms: number;
};

declare global {
  interface Window {
    USER_STUDY_CONFIG?: {
      supabaseUrl?: string;
      supabasePublishableKey?: string;
      stimulusBaseUrl?: string;
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

export async function claimStudyAssignment(
  identifiers: ProlificIdentifiers,
  attributeOrder: string,
  demographics: StudyDemographics,
) {
  const { enabled } = runtimeConfig();
  if (!enabled || !identifiers.participantId || !identifiers.sessionId) {
    return null;
  }
  return callRpc<AssignedStimulus[]>('claim_study_assignment', {
    p_participant_id: identifiers.participantId,
    p_study_id: identifiers.studyId,
    p_prolific_session_id: identifiers.sessionId,
    p_attribute_order: attributeOrder,
    p_demographics: demographics,
  });
}

export async function submitStudySession(
  studySessionId: string,
  participantId: string,
  initialRatings: SubmittedInitialRating[],
  ratings: SubmittedRating[],
) {
  return callRpc<boolean>('submit_study_session', {
    p_study_session_id: studySessionId,
    p_participant_id: participantId,
    p_initial_responses: initialRatings,
    p_responses: ratings,
  });
}
