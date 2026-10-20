export type ProlificIdentifiers = {
  prolificPid: string;
  studyId: string;
  sessionId: string;
};

// Public API endpoint, not a secret. Keeping a compiled default makes direct
// route deployments robust when an optional runtime config.js is missing or
// cached; config.js can still override it for staging/local environments.
export const DEFAULT_STUDY_API_BASE_URL = 'https://perception-study-api.bunnysantiago.workers.dev';

export type ClientMetadata = {
  userAgent: string;
  language: string;
  languages: string[];
  platform: string;
  timezone: string;
  timezoneOffsetMinutes: number;
  screenWidth: number;
  screenHeight: number;
  screenAvailableWidth: number;
  screenAvailableHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  colorDepth: number;
  pixelDepth: number;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  maxTouchPoints: number;
  cookieEnabled: boolean;
  doNotTrack: string | null;
  pagePath: string;
  referrerOrigin: string | null;
};

export type AuthenticatedStudySession = {
  token: string;
  sessionId: string;
  studyType: string;
  assignmentSeed: string;
  assignmentBatch?: string | null;
  inhouse: boolean;
  studyRunId?: string | null;
  alreadyCompleted: boolean;
  receiptId?: string | null;
  screenedOut: boolean;
  screenOutReceiptId?: string | null;
  sentinelFailures?: number;
};

export type SubmissionTrial = {
  trialNumber: number;
  trialId: string;
  responseTimeMs: number;
  isSentinel: boolean;
  sentinelId?: string;
  response: Record<string, unknown>;
};

export type StudySubmission = {
  schemaVersion: '2026-10-20.1';
  sessionId: string;
  studyType: string;
  startedAt: string;
  completedAt: string;
  assignmentBatch: string;
  inhouse: boolean;
  studyRunId?: string;
  demographicsSkipped: boolean;
  demographics: Record<string, unknown>;
  trainingAttempts: unknown[];
  trials: SubmissionTrial[];
  clientMetadata: ClientMetadata;
};

export type StudyScreenOut = Omit<StudySubmission, 'completedAt'> & {
  screenedOutAt: string;
};

export type StudyDemographicsCheckpoint = {
  schemaVersion: '2026-10-20.2';
  sessionId: string;
  studyType: string;
  demographicsSkipped: boolean;
  demographics: Record<string, unknown>;
  clientMetadata: ClientMetadata;
};

declare global {
  interface Window {
    USER_STUDY_CONFIG?: {
      supabaseUrl?: string;
      supabasePublishableKey?: string;
      stimulusBaseUrl?: string;
      apiBaseUrl?: string;
      prolificCompletionUrl?: string;
    };
  }

  interface Navigator {
    deviceMemory?: number;
  }
}

export function readProlificIdentifiers(): ProlificIdentifiers {
  const parameters = new URLSearchParams(location.search);
  return {
    prolificPid: parameters.get('PROLIFIC_PID')?.trim() ?? '',
    studyId: parameters.get('STUDY_ID')?.trim() ?? '',
    sessionId: parameters.get('SESSION_ID')?.trim() ?? '',
  };
}

export function hasCompleteProlificIdentifiers(value: ProlificIdentifiers) {
  return Boolean(value.prolificPid && value.studyId && value.sessionId);
}

export function collectClientMetadata(): ClientMetadata {
  let referrerOrigin: string | null = null;
  try { referrerOrigin = document.referrer ? new URL(document.referrer).origin : null; } catch { referrerOrigin = null; }
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: [...navigator.languages],
    platform: navigator.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    screenWidth: screen.width,
    screenHeight: screen.height,
    screenAvailableWidth: screen.availWidth,
    screenAvailableHeight: screen.availHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null,
    deviceMemoryGb: Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory ?? null : null,
    maxTouchPoints: navigator.maxTouchPoints,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    pagePath: location.pathname,
    referrerOrigin,
  };
}

export async function loginToStudy(input: {
  username: string;
  password: string;
  prolific: ProlificIdentifiers;
  studyType: string;
  clientSessionId: string;
  inhouseRunId?: string;
  startedAt: string;
  clientMetadata: ClientMetadata;
}): Promise<AuthenticatedStudySession> {
  return apiRequest('/api/v1/login', input);
}

export async function submitStudy(token: string, submission: StudySubmission): Promise<{ receiptId: string; alreadyStored: boolean; screenedOut?: boolean; sentinelFailures?: number }> {
  return apiRequest('/api/v1/submit', submission, token);
}

export async function saveStudyDemographics(token: string, checkpoint: StudyDemographicsCheckpoint): Promise<{ savedAt: string; alreadyStored: boolean }> {
  return apiRequest('/api/v1/demographics', checkpoint, token);
}

export async function screenOutStudy(token: string, submission: StudyScreenOut): Promise<{ receiptId: string; sentinelFailures: number; sentinelsEvaluated: number; sentinelChecksEvaluated: number; alreadyStored: boolean }> {
  return apiRequest('/api/v1/screen-out', submission, token);
}

async function apiRequest<T>(path: string, payload: unknown, token?: string): Promise<T> {
  const base = window.USER_STUDY_CONFIG?.apiBaseUrl?.trim().replace(/\/$/, '') || DEFAULT_STUDY_API_BASE_URL;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as { error?: string } & T;
    if (!response.ok) throw new Error(body.error || `The study service returned error ${response.status}.`);
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The study service did not respond in time. Please check your connection and try again.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
