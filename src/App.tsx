import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Download, Eye, Images, LoaderCircle, Monitor, ScanSearch, Shuffle, SlidersHorizontal, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DemographicsForm, EMPTY_DEMOGRAPHICS, demographicColumns, demographicsCells, demographicsComplete as isDemographicsComplete, demographicsPayload, type Demographics } from './demographics';
import { PairTraining } from './PairTraining';
import { PAIR_TRAINING_EXAMPLES, type PairTrainingAttempt } from './pairTrainingData';
import { ParticipantLogin } from './ParticipantLogin';
import { collectClientMetadata, loginToStudy, readProlificIdentifiers, saveStudyDemographics, screenOutStudy, submitStudy, type AuthenticatedStudySession, type StudyScreenOut, type StudySubmission, type SubmissionTrial } from './study-api';

const ASSET_BASE = import.meta.env.BASE_URL;
const SELECTION_DISPLAY_COUNT = 6;
const MAX_SELECTIONS = 2;
type Stage = 'invalid' | 'login' | 'welcome' | 'resume' | 'demographics' | 'explanation' | 'chooser' | 'instructions' | 'training' | 'study' | 'submitting' | 'screening' | 'screened_out' | 'complete';
type StudyType = 'forcedChoice' | 'pairJudgment' | 'sceneMatching' | 'selection';
type InhouseCredentials = { username: string; password: string; runId: string };
type RelativeChoice = 'a' | 'same' | 'b' | '';
type DifficultyLevel = 'easy' | 'medium_easy' | 'medium_hard' | 'hard';
type TrialDifficulty = DifficultyLevel | 'sentinel';
type SentinelMetadata = { isSentinel?: boolean; sentinelId?: string; assignmentSet?: string };
type ManifestPair = { pair_id: string; image_path_a: string; image_path_b: string; stratum: string };
type PairTrial = SentinelMetadata & { pairId: string; stratum: string; canonicalPathA: string; canonicalPathB: string; displayPathA: string; displayPathB: string; swapped: boolean; sameMaterialLikelihood: number | null; glossChoice: RelativeChoice; metalChoice: RelativeChoice; responseTimeMs?: number };
type ForcedChoiceManifestTrial = { trial_id: string; difficulty_level: DifficultyLevel; reference: SelectionImage; options: [SelectionImage, SelectionImage]; correct_option?: 'A' | 'B' };
type ForcedChoiceTrial = SentinelMetadata & Omit<ForcedChoiceManifestTrial, 'difficulty_level'> & { difficulty_level: TrialDifficulty; selectedOption: 'A' | 'B' | ''; responseTimeMs?: number };
type SceneMatchingManifestTrial = { trial_id: string; difficulty_level?: DifficultyLevel; shared_factor: 'geometry' | 'illumination'; target_label: 'R' | 'A' | 'B' | 'C' | 'D'; first_scene: SelectionImage[]; second_scene: SelectionImage[] };
type SceneMatchingTrial = SentinelMetadata & Omit<SceneMatchingManifestTrial, 'difficulty_level'> & { difficulty_level?: TrialDifficulty; selectedOption: 1 | 2 | 3 | 4 | null; responseTimeMs?: number };
type SceneMatchingTrainingExample = Omit<SceneMatchingManifestTrial, 'trial_id'> & { training_id: string; correct_option: 1 | 2 | 3 | 4 };
type SceneTrainingAttempt = { trainingId: string; selectedOption: 1 | 2 | 3 | 4; correct: boolean; attemptedAt: string };
type SelectionImage = { image_id: string; image_path: string; thumbnail_path?: string; material_id?: string; group_id?: string; geometry_id?: string; environment_id?: string };
type SelectionCandidate = SelectionImage & { candidate_id: string; is_same_material?: boolean; role?: string; difficulty_score?: number };
type SelectionManifestTrial = { trial_id: string; difficulty_level?: DifficultyLevel; reference_source_type: 'measured' | 'svbrdf' | 'datasetv9'; reference: SelectionImage; candidates: SelectionCandidate[]; positive_count?: number; profile?: string };
type SelectionTrial = SentinelMetadata & Omit<SelectionManifestTrial, 'difficulty_level'> & { difficulty_level?: TrialDifficulty; selectedCandidateIds: string[]; responseTimeMs?: number };
type SentinelConfig = {
  positions: number[];
  tests: {
    test1: Array<{ sentinel_id: string; image_a: string; image_b: string; physical_relation: 'same_material' | 'different_material' }>;
    test2: Array<{ sentinel_id: string; reference: string; solution: string; confounder: string; correct_option: 'A' | 'B' }>;
    test3: Array<{ sentinel_id: string; reference_scene: string; question_scene: string; shared_factor: 'geometry' | 'illumination'; correct_option: 1 | 2 | 3 }>;
    test4: Array<{ sentinel_id: string; reference: string; candidates: Array<{ role: 'solution' | 'confounder'; image_path: string }> }>;
  };
};
type FixedTrialGroup = { set_id: string; trial_ids: string[] };
type FixedTrialGroupsManifest = {
  schema_version: number;
  seed: string;
  group_count: number;
  group_size: number;
  tests: Record<'test1' | 'test2' | 'test3' | 'test4', { id_field: string; groups: FixedTrialGroup[] }>;
};
type FixedTrialAssignment = { setId: string; trialIds: string[] };
type SessionMetadata = { participantId: string; sessionId: string; startedAt: string; userAgent: string; screenWidth: number; screenHeight: number };
type TestingGroundTruth = {
  pairs: Record<string, 1 | 5>;
  forced_choices: Record<string, 'A' | 'B'>;
  scene_matches: Record<string, 1 | 2 | 3 | 4>;
  selections: Record<string, string[]>;
};
type StoredProgress = {
  schemaVersion: 1;
  studyType: StudyType;
  index: number;
  metadata: SessionMetadata;
  consentedAt: string;
  demographics: Demographics;
  demographicsSkipped: boolean;
  pairTrainingAttempts: PairTrainingAttempt[];
  sceneTrainingAttempts: SceneTrainingAttempt[];
  pairTrials: PairTrial[];
  forcedChoiceTrials: ForcedChoiceTrial[];
  sceneMatchingTrials: SceneMatchingTrial[];
  selectionTrials: SelectionTrial[];
};

const IDENTITY_OPTIONS = [{ value: 1, label: 'Probably different' }, { value: 3, label: 'Unsure' }, { value: 5, label: 'Probably same' }];
const TEST_COPY = {
  forcedChoice: { title: 'Reference matching', detail: 'Choose which of two options is made of the same underlying material as a reference image.' },
  pairJudgment: { title: 'Pair comparison', detail: 'Judge whether two objects share a material, and compare their glossiness and metallicness independently.' },
  sceneMatching: { title: 'In-context matching', detail: 'Match one reference object to one of three candidates across two scenes rendered under different geometry or illumination conditions.' },
  selection: { title: 'Multiple matching', detail: 'For each reference, inspect 6 candidates and select up to two objects that appear to have the same underlying material.' },
} satisfies Record<StudyType, { title: string; detail: string }>;
const INHOUSE_STUDY_ORDER: StudyType[] = ['pairJudgment', 'forcedChoice', 'sceneMatching', 'selection'];
const STUDY_SESSION_SUFFIX: Record<StudyType, string> = { pairJudgment: 't1', forcedChoice: 't2', sceneMatching: 't3', selection: 't4' };
const REDIRECT_TEST_KEYS: Record<StudyType, string> = { pairJudgment: 'test1', forcedChoice: 'test2', sceneMatching: 'test3', selection: 'test4' };
function sentinelScreenOutThreshold(type: StudyType) {
  return type === 'selection' ? 3 : 2;
}
const PAIR_SENTINEL_ANSWERS = new Map<string, { sameMaterialLikelihood: number; canonicalGlossChoice: number; canonicalMetalChoice: number }>([
  ['SENTINEL_T1_01', { sameMaterialLikelihood: 1, canonicalGlossChoice: -1, canonicalMetalChoice: 0 }],
  ['SENTINEL_T1_02', { sameMaterialLikelihood: 1, canonicalGlossChoice: -1, canonicalMetalChoice: -1 }],
  ['SENTINEL_T1_03', { sameMaterialLikelihood: 5, canonicalGlossChoice: 0, canonicalMetalChoice: 0 }],
  ['SENTINEL_T1_04', { sameMaterialLikelihood: 1, canonicalGlossChoice: 1, canonicalMetalChoice: -1 }],
  ['SENTINEL_T1_05', { sameMaterialLikelihood: 5, canonicalGlossChoice: 0, canonicalMetalChoice: 0 }],
]);
const FORCED_SENTINEL_ANSWERS = new Map<string, 'A' | 'B'>([
  ['SENTINEL_T2_01', 'A'], ['SENTINEL_T2_02', 'B'], ['SENTINEL_T2_03', 'A'], ['SENTINEL_T2_04', 'B'], ['SENTINEL_T2_05', 'A'],
]);
const SCENE_SENTINEL_ANSWERS = new Map<string, number>([
  ['SENTINEL_T3_01', 1],
  ['SENTINEL_T3_02', 2],
  ['SENTINEL_T3_03', 3],
  ['SENTINEL_T3_04', 2],
  ['SENTINEL_T3_05', 1],
]);

function createId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function normalizedLoginName(value: string) {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim().toLowerCase();
}
function inhouseSessionId(runId: string, type: StudyType) { return `${runId}-${STUDY_SESSION_SUFFIX[type]}`; }
function inhouseRunId(fallback: string) {
  const key = 'material-constancy-inhouse-run-id';
  const stored = sessionStorage.getItem(key)?.trim();
  if (stored) return stored;
  sessionStorage.setItem(key, fallback);
  return fallback;
}
function readSessionMetadata(prolificPid: string): SessionMetadata {
  const participantId = prolificPid || new URLSearchParams(location.search).get('participant')?.trim() || `anonymous-${createId()}`;
  return { participantId, sessionId: createId(), startedAt: new Date().toISOString(), userAgent: navigator.userAgent, screenWidth: screen.width, screenHeight: screen.height };
}
function progressStorageKey(sessionId: string) { return `material-constancy-progress-${sessionId}`; }
function directStudyType(): StudyType | null {
  const segments = location.pathname.replace(/\/+$/, '').split('/');
  const route = segments[segments.length - 1];
  return ({ test1_pair_comparison: 'pairJudgment', test2_2afc: 'forcedChoice', test3_matching: 'sceneMatching', test4_mm: 'selection' } as Record<string, StudyType>)[route ?? ''] ?? null;
}
function isTestingRoute() { return location.pathname.replace(/\/+$/, '').endsWith('/testing'); }
function isPreviewRoute() { return location.pathname.replace(/\/+$/, '').endsWith('/preview'); }
function isInhouseRoute() { return location.pathname.replace(/\/+$/, '').endsWith('/inhouse'); }
function isLocalDevelopmentHost() { return ['localhost', '127.0.0.1', '::1'].includes(location.hostname); }
const REMOTE_TESTING_HOSTS = new Set([
  'investigation-rocket-however-territory.trycloudflare.com',
  'santiagojn.github.io',
]);
function isTestingHost() { return isLocalDevelopmentHost() || REMOTE_TESTING_HOSTS.has(location.hostname); }
function isTestingMode() { return isTestingHost() && (isTestingRoute() || new URLSearchParams(location.search).get('testing') === '1'); }
function trialCount(type: StudyType) {
  if (isPreviewRoute()) return 50;
  if (!isTestingMode()) return 50;
  const parameter = new URLSearchParams(location.search).get('trials');
  const requested = parameter === null && isTestingRoute() ? 8 : Number(parameter);
  if (type === 'selection' || type === 'sceneMatching') return Number.isInteger(requested) && requested >= 1 && requested <= 50 ? requested : 8;
  return Number.isInteger(requested) && (requested === 50 || requested >= 8 && requested <= 48 && requested % 8 === 0) ? requested : 8;
}
function hashSeed(text: string) { let value = 2166136261; for (let i = 0; i < text.length; i += 1) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); } return value >>> 0; }
function rng(seed: number) { let state = seed >>> 0; return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; }; }
function shuffle<T>(items: T[], random: () => number) { const out = [...items]; for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }
function assetUrl(path: string) { return ASSET_BASE + path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/'); }
function manifestUrl(path: string) {
  const version = window.USER_STUDY_CONFIG?.deploymentVersion?.trim();
  const url = assetUrl(path);
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}
function stimulusUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const configuredBase = window.USER_STUDY_CONFIG?.stimulusBaseUrl?.trim().replace(/\/$/, '');
  const encodedPath = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  if (/^(datasetv\d+\/|datasetv9\/groups4\/)/.test(path.replace(/^\/+/, ''))) {
    return configuredBase ? `${configuredBase}/${encodedPath}` : assetUrl(path);
  }
  return configuredBase ? `${configuredBase}/${encodedPath}` : assetUrl(`stimuli/${path}`);
}
function studyImageUrl(path: string) {
  return /^(datasetv\d+\/|datasetv9\/groups4\/)/.test(path.replace(/^\/+/, '')) ? stimulusUrl(path) : assetUrl(path);
}
function thumbnailPath(path: string) {
  const normalized = path.replace(/^\/+/, '');
  const webp = normalized.replace(/\.[^./]+$/, '.webp');
  if (normalized.startsWith('datasetv9/renders/')) return webp.replace('datasetv9/renders/', 'datasetv9/thumbnails/');
  if (normalized.startsWith('datasetv9/groups4/renders3/')) return webp.replace('datasetv9/groups4/renders3/', 'datasetv9/groups4/thumbnails/');
  if (normalized.startsWith('datasetv9/groups4/sentinels/')) return webp.replace('datasetv9/groups4/sentinels/', 'datasetv9/groups4/sentinels_thumbnails/');
  return path;
}
function ThumbnailImage({ path, originalPath = path, alt }: { path: string; originalPath?: string; alt: string }) {
  const thumbnail = studyImageUrl(thumbnailPath(path));
  const original = studyImageUrl(originalPath);
  return <img src={thumbnail} alt={alt} onError={(event) => {
    if (event.currentTarget.src === original) return;
    event.currentTarget.onerror = null;
    event.currentTarget.src = original;
  }} />;
}
async function configuredTestEntry(filename: string, type: StudyType, description: string) {
  const response = await fetch(manifestUrl(filename), { cache: 'no-store' });
  if (!response.ok) throw new Error(`The ${description} configuration could not be loaded.`);
  const entries = new Map<string, string>();
  for (const rawLine of (await response.text()).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    entries.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const value = entries.get(REDIRECT_TEST_KEYS[type]);
  if (!value) throw new Error(`No ${description} is configured for ${REDIRECT_TEST_KEYS[type]}.`);
  if (/REPLACE_|(?:^|\/)preview\/?$/i.test(value)) throw new Error(`The ${description} for ${REDIRECT_TEST_KEYS[type]} is still a placeholder.`);
  return value;
}
async function configuredRedirect(type: StudyType, outcome: 'completion' | 'screen_out') {
  const description = outcome === 'completion' ? 'completion redirect' : 'screen-out redirect';
  const filename = outcome === 'completion' ? 'completion_redirects.txt' : 'screen_out_redirects.txt';
  const destination = await configuredTestEntry(filename, type, description);
  const url = new URL(destination, document.baseURI);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The configured redirect must use HTTP or HTTPS.');
  return url.href;
}
async function configuredOutcomeCode(type: StudyType, outcome: 'completion' | 'screen_out') {
  const description = outcome === 'completion' ? 'Prolific completion code' : 'Prolific screen-out code';
  const filename = outcome === 'completion' ? 'completion_codes.txt' : 'screen_out_codes.txt';
  const code = await configuredTestEntry(filename, type, description);
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(code)) throw new Error(`The configured ${description} is invalid.`);
  return code;
}
function selectionDisplayPath(image: SelectionImage) { return image.thumbnail_path ?? image.image_path; }
async function preloadImage(url: string, attempts = 3, timeoutMs = 20_000) {
  let failure: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        const finish = (callback: () => void) => { window.clearTimeout(timer); image.onload = null; image.onerror = null; callback(); };
        const timer = window.setTimeout(() => finish(() => reject(new Error(`Timed out while preloading ${url}`))), timeoutMs);
        image.onload = () => finish(resolve);
        image.onerror = () => finish(() => reject(new Error(`Could not preload ${url}`)));
        image.src = url;
      });
      return;
    } catch (cause) { failure = cause; if (attempt < attempts) await new Promise((resolve) => window.setTimeout(resolve, attempt * 250)); }
  }
  throw failure;
}
async function preloadImages(urls: string[]) {
  const unique = [...new Set(urls)]; let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, unique.length) }, async () => { while (next < unique.length) { await preloadImage(unique[next++]); } }));
}
async function preloadStudyImages(paths: string[]) {
  const unique = [...new Set(paths)]; let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, unique.length) }, async () => {
    while (next < unique.length) {
      const path = unique[next++];
      const thumbnail = studyImageUrl(thumbnailPath(path));
      const original = studyImageUrl(path);
      try {
        await preloadImage(thumbnail, 1, 10_000);
      } catch (cause) {
        if (thumbnail === original) throw cause;
        console.warn(`Thumbnail unavailable; using the original image for ${path}.`, cause);
        await preloadImage(original);
      }
    }
  }));
}
function selectPairs(pairs: ManifestPair[], count: number, seed: string): PairTrial[] {
  const random = rng(hashSeed(seed)); const strata = new Map<string, ManifestPair[]>();
  pairs.forEach((pair) => strata.set(pair.stratum, [...(strata.get(pair.stratum) ?? []), pair]));
  if (strata.size !== 8) throw new Error(`Expected 8 strata, found ${strata.size}.`);
  if (count % 8) throw new Error('Pair-comparison sessions must balance all four difficulty levels and both material relations.');
  const levels: DifficultyLevel[] = ['easy', 'medium_easy', 'medium_hard', 'hard'];
  const perLevel = count / levels.length;
  const samePerLevel = perLevel / 2;
  const quotas = levels.flatMap((level) => [
    [`same_material:${level}`, samePerLevel] as const,
    [`different_material:${level}`, perLevel - samePerLevel] as const,
  ]);
  if (quotas.some(([stratum]) => !strata.has(stratum))) throw new Error('The pair manifest does not contain the expected relation/difficulty strata.');
  const selected = quotas.flatMap(([stratum, quota]) => {
    const entries = strata.get(stratum) ?? [];
    if (entries.length < quota) throw new Error(`The ${stratum} stratum has too few pairs.`);
    return shuffle(entries, random).slice(0, quota);
  });
  return shuffle(selected, random).map((pair) => {
    const swapped = random() < .5;
    return { pairId: pair.pair_id, stratum: pair.stratum, canonicalPathA: pair.image_path_a, canonicalPathB: pair.image_path_b, displayPathA: swapped ? pair.image_path_b : pair.image_path_a, displayPathB: swapped ? pair.image_path_a : pair.image_path_b, swapped, sameMaterialLikelihood: null, glossChoice: '', metalChoice: '' };
  });
}
function selectSets(entries: SelectionManifestTrial[], count: number, seed: string): SelectionTrial[] {
  if (entries.length < count) throw new Error(`Only ${entries.length} selection trials exist; ${count} were requested.`);
  const random = rng(hashSeed(seed));
  if (entries.some((entry) => entry.reference_source_type === 'datasetv9')) {
    const levels: DifficultyLevel[] = ['easy', 'medium_easy', 'medium_hard', 'hard'];
    if (count % levels.length) throw new Error('Multiple-matching sessions must contain an equal number of trials from all four difficulty levels.');
    const each = count / levels.length;
    const selected = levels.flatMap((level) => {
      const options = entries.filter((entry) => entry.difficulty_level === level);
      if (options.length < each) throw new Error(`Only ${options.length} ${level} multiple-matching trials exist.`);
      return shuffle(options, random).slice(0, each);
    });
    return shuffle(selected, random).map((entry) => {
      if (entry.candidates.length < SELECTION_DISPLAY_COUNT || new Set(entry.candidates.map((c) => c.candidate_id)).size !== entry.candidates.length) throw new Error(`${entry.trial_id} must contain at least ${SELECTION_DISPLAY_COUNT} unique candidates.`);
      return { ...entry, candidates: shuffle(entry.candidates, random).slice(0, SELECTION_DISPLAY_COUNT), selectedCandidateIds: [] };
    });
  }
  const svbrdfCount = Math.min(3, count);
  const svbrdfs = shuffle(entries.filter((entry) => entry.reference_source_type === 'svbrdf'), random).slice(0, svbrdfCount);
  const measured = shuffle(entries.filter((entry) => entry.reference_source_type === 'measured'), random).slice(0, count - svbrdfCount);
  if (svbrdfs.length !== svbrdfCount || measured.length !== count - svbrdfCount) throw new Error('The selection manifest cannot provide the required measured/SVBRDF balance.');
  return shuffle([...svbrdfs, ...measured], random).map((entry) => {
    if (entry.candidates.length !== 18 || new Set(entry.candidates.map((c) => c.candidate_id)).size !== 18) throw new Error(`${entry.trial_id} must contain 18 unique candidates.`);
    return { ...entry, candidates: shuffle(entry.candidates, random).slice(0, SELECTION_DISPLAY_COUNT), selectedCandidateIds: [] };
  });
}
function selectForcedChoices(entries: ForcedChoiceManifestTrial[], count: number, seed: string): ForcedChoiceTrial[] {
  if (entries.length < count) throw new Error(`Only ${entries.length} reference-matching trials exist; ${count} were requested.`);
  const random = rng(hashSeed(seed));
  const levels: ForcedChoiceManifestTrial['difficulty_level'][] = ['easy', 'medium_easy', 'medium_hard', 'hard'];
  if (count % levels.length) throw new Error('Reference-matching sessions must contain an equal number of trials from all four difficulty levels.');
  const each = count / levels.length;
  const selected = levels.flatMap((level) => {
    const options = entries.filter((entry) => entry.difficulty_level === level);
    if (options.length < each) throw new Error(`Only ${options.length} ${level} reference-matching trials exist.`);
    return shuffle(options, random).slice(0, each);
  });
  return shuffle(selected, random).map((entry) => ({ ...entry, selectedOption: '' }));
}
function selectSceneMatches(entries: SceneMatchingManifestTrial[], count: number, seed: string): SceneMatchingTrial[] {
  const requested = Math.min(entries.length, count);
  const random = rng(hashSeed(seed));
  const cells: Array<[DifficultyLevel, 'geometry' | 'illumination']> = [
    ['easy', 'geometry'], ['medium_easy', 'illumination'],
    ['medium_hard', 'geometry'], ['hard', 'illumination'],
    ['easy', 'illumination'], ['medium_easy', 'geometry'],
    ['medium_hard', 'illumination'], ['hard', 'geometry'],
  ];
  const quotas = Array.from({ length: cells.length }, () => Math.floor(requested / cells.length));
  for (let index = 0; index < requested % cells.length; index += 1) quotas[index] += 1;
  const selected = cells.flatMap(([level, factor], index) => {
    const options = entries.filter((entry) => entry.difficulty_level === level && entry.shared_factor === factor);
    if (options.length < quotas[index]) throw new Error(`The in-context manifest lacks ${level}/${factor} trials.`);
    return shuffle(options, random).slice(0, quotas[index]);
  });
  if (selected.length !== requested) throw new Error('The in-context manifest cannot provide the requested difficulty/change balance.');
  return shuffle(selected, random).map((entry) => ({ ...entry, selectedOption: null }));
}
const FIXED_GROUP_TEST_KEYS: Record<StudyType, 'test1' | 'test2' | 'test3' | 'test4'> = {
  pairJudgment: 'test1',
  forcedChoice: 'test2',
  sceneMatching: 'test3',
  selection: 'test4',
};
async function loadFixedTrialGroup(type: StudyType, assignmentSeed: string): Promise<FixedTrialAssignment> {
  const response = await fetch(manifestUrl('fixed_trial_groups.json'), { cache: 'no-store' });
  if (!response.ok) throw new Error('The fixed participant sets are unavailable.');
  const manifest = await response.json() as FixedTrialGroupsManifest;
  const groups = manifest.tests?.[FIXED_GROUP_TEST_KEYS[type]]?.groups;
  if (!Array.isArray(groups) || groups.length !== manifest.group_count || manifest.group_size !== 50) throw new Error('The fixed participant-set manifest is invalid.');
  const encodedBatch = /^batch:set_(\d{2})(?::|$)/.exec(assignmentSeed);
  let groupIndex: number;
  if (encodedBatch) {
    groupIndex = Number(encodedBatch[1]) - 1;
    if (groupIndex < 0 || groupIndex >= groups.length) throw new Error('The username is assigned to an invalid participant batch.');
  } else {
    groupIndex = hashSeed(`${manifest.seed}:${assignmentSeed}`) % groups.length;
  }
  const group = groups[groupIndex];
  if (!group || group.trial_ids.length !== manifest.group_size || new Set(group.trial_ids).size !== manifest.group_size) throw new Error('The assigned participant set is incomplete.');
  return { setId: group.set_id, trialIds: group.trial_ids };
}
function fixedRows<T>(entries: T[], trialIds: string[], id: (entry: T) => string): T[] {
  const byId = new Map(entries.map((entry) => [id(entry), entry]));
  const selected = trialIds.map((trialId) => byId.get(trialId));
  if (selected.some((entry) => entry === undefined)) throw new Error('A fixed participant set references a missing trial.');
  return selected as T[];
}
function materializeFixedPairs(entries: ManifestPair[], assignment: FixedTrialAssignment, seed: string): PairTrial[] {
  const random = rng(hashSeed(`${seed}:fixed-pairs`));
  return shuffle(fixedRows(entries, assignment.trialIds, (entry) => entry.pair_id), random).map((pair) => {
    const swapped = random() < .5;
    return { pairId: pair.pair_id, stratum: pair.stratum, canonicalPathA: pair.image_path_a, canonicalPathB: pair.image_path_b, displayPathA: swapped ? pair.image_path_b : pair.image_path_a, displayPathB: swapped ? pair.image_path_a : pair.image_path_b, swapped, sameMaterialLikelihood: null, glossChoice: '', metalChoice: '', assignmentSet: assignment.setId };
  });
}
function materializeFixedForcedChoices(entries: ForcedChoiceManifestTrial[], assignment: FixedTrialAssignment, seed: string): ForcedChoiceTrial[] {
  const random = rng(hashSeed(`${seed}:fixed-forced`));
  return shuffle(fixedRows(entries, assignment.trialIds, (entry) => entry.trial_id), random).map((entry) => ({ ...entry, selectedOption: '', assignmentSet: assignment.setId }));
}
function materializeFixedSceneMatches(entries: SceneMatchingManifestTrial[], assignment: FixedTrialAssignment, seed: string): SceneMatchingTrial[] {
  const random = rng(hashSeed(`${seed}:fixed-scenes`));
  return shuffle(fixedRows(entries, assignment.trialIds, (entry) => entry.trial_id), random).map((entry) => ({ ...entry, selectedOption: null, assignmentSet: assignment.setId }));
}
function materializeFixedSets(entries: SelectionManifestTrial[], assignment: FixedTrialAssignment, seed: string): SelectionTrial[] {
  const random = rng(hashSeed(`${seed}:fixed-selection`));
  return shuffle(fixedRows(entries, assignment.trialIds, (entry) => entry.trial_id), random).map((entry) => {
    if (entry.candidates.length < SELECTION_DISPLAY_COUNT || new Set(entry.candidates.map((candidate) => candidate.candidate_id)).size !== entry.candidates.length) throw new Error(`${entry.trial_id} must contain at least ${SELECTION_DISPLAY_COUNT} unique candidates.`);
    return { ...entry, candidates: shuffle(entry.candidates, random).slice(0, SELECTION_DISPLAY_COUNT), selectedCandidateIds: [], assignmentSet: assignment.setId };
  });
}
function insertSentinels<T>(regular: T[], sentinels: T[], positions: number[]): T[] {
  if (sentinels.length !== positions.length || new Set(positions).size !== positions.length || positions.some((position) => !Number.isInteger(position) || position < 1 || position > regular.length + sentinels.length)) throw new Error('The sentinel positions are invalid.');
  const result = [...regular];
  [...positions].sort((a, b) => a - b).forEach((position, index) => result.splice(position - 1, 0, sentinels[index]));
  return result;
}
function sentinelImage(sentinelId: string, role: string, imagePath: string): SelectionImage {
  return { image_id: `${sentinelId}_${role}`, image_path: imagePath };
}
function pairSentinels(config: SentinelConfig, seed: string): PairTrial[] {
  const random = rng(hashSeed(`${seed}:sentinel-pairs`));
  return config.tests.test1.map((item) => {
    const swapped = random() < .5;
    return { pairId: item.sentinel_id, sentinelId: item.sentinel_id, isSentinel: true, stratum: `sentinel:${item.physical_relation}`, canonicalPathA: item.image_a, canonicalPathB: item.image_b, displayPathA: swapped ? item.image_b : item.image_a, displayPathB: swapped ? item.image_a : item.image_b, swapped, sameMaterialLikelihood: null, glossChoice: '', metalChoice: '' };
  });
}
function forcedChoiceSentinels(config: SentinelConfig): ForcedChoiceTrial[] {
  return config.tests.test2.map((item) => {
    const solution = sentinelImage(item.sentinel_id, 'solution', item.solution);
    const confounder = sentinelImage(item.sentinel_id, 'confounder', item.confounder);
    return { trial_id: item.sentinel_id, sentinelId: item.sentinel_id, isSentinel: true, difficulty_level: 'sentinel', reference: sentinelImage(item.sentinel_id, 'reference', item.reference), options: item.correct_option === 'A' ? [solution, confounder] : [confounder, solution], correct_option: item.correct_option, selectedOption: '' };
  });
}
function sceneMatchingSentinels(config: SentinelConfig): SceneMatchingTrial[] {
  return config.tests.test3.map((item) => ({
    trial_id: item.sentinel_id,
    sentinelId: item.sentinel_id,
    isSentinel: true,
    difficulty_level: 'sentinel',
    shared_factor: item.shared_factor,
    target_label: 'R',
    first_scene: [sentinelImage(item.sentinel_id, 'reference_scene', item.reference_scene)],
    second_scene: [sentinelImage(item.sentinel_id, 'question_scene', item.question_scene)],
    selectedOption: null,
  }));
}
function selectionSentinels(config: SentinelConfig, seed: string): SelectionTrial[] {
  const random = rng(hashSeed(`${seed}:sentinel-selection`));
  return config.tests.test4.map((item) => {
    const candidates = item.candidates.map((candidate, index) => ({
      ...sentinelImage(item.sentinel_id, `candidate_${index + 1}`, candidate.image_path),
      candidate_id: `${item.sentinel_id}_candidate_${index + 1}`,
      role: candidate.role,
      is_same_material: candidate.role === 'solution',
    }));
    return { trial_id: item.sentinel_id, sentinelId: item.sentinel_id, isSentinel: true, difficulty_level: 'sentinel', reference_source_type: 'datasetv9', reference: sentinelImage(item.sentinel_id, 'reference', item.reference), candidates: shuffle(candidates, random), positive_count: candidates.filter((candidate) => candidate.is_same_material).length, profile: 'sentinel', selectedCandidateIds: [] };
  });
}
async function loadSentinelConfig(): Promise<SentinelConfig> {
  const response = await fetch(manifestUrl('sentinel_trials.json'), { cache: 'no-store' });
  if (!response.ok) throw new Error('Sentinel trials are unavailable.');
  const config = await response.json() as SentinelConfig;
  if (!Array.isArray(config.positions) || config.positions.length !== 5 || Object.values(config.tests).some((setups) => setups.length !== 5)) throw new Error('The sentinel configuration is incomplete.');
  return config;
}
function csvCell(value: unknown) { const text = value == null ? '' : String(value); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function canonicalRelative(choice: RelativeChoice, swapped: boolean) { if (!choice) return ''; if (choice === 'same') return 0; return choice === 'a' ? (swapped ? 1 : -1) : (swapped ? -1 : 1); }
function saveCsv(columns: string[], rows: unknown[][], metadata: SessionMetadata, type: StudyType) {
  const blob = new Blob([[columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `material-constancy-${type}-${metadata.sessionId}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadPairs(trials: PairTrial[], trainingAttempts: PairTrainingAttempt[], demographics: Demographics, skipped: boolean, metadata: SessionMetadata, inhouse = false, assignedBatch = '') {
  const columns = ['participant_id', 'session_id', 'study_type', 'inhouse', 'assigned_batch', 'study_started_at', 'completed_at', 'trial_number', 'pair_id', 'is_sentinel', 'sentinel_id', 'assignment_set', 'stratum', 'canonical_image_a', 'canonical_image_b', 'swapped', 'same_material_likelihood_1_different_5_same', 'relative_glossiness_b_minus_a', 'relative_metallicness_b_minus_a', 'response_time_ms', 'pair_training_attempts_json', ...demographicColumns(inhouse), 'screen_width', 'screen_height', 'user_agent'];
  const completedAt = new Date().toISOString();
  const trainingJson = JSON.stringify(trainingAttempts);
  saveCsv(columns, trials.map((t, i) => [metadata.participantId, metadata.sessionId, 'pairJudgment', inhouse, assignedBatch, metadata.startedAt, completedAt, i + 1, t.pairId, Boolean(t.isSentinel), t.sentinelId ?? '', t.assignmentSet ?? '', t.stratum, t.canonicalPathA, t.canonicalPathB, t.swapped, t.sameMaterialLikelihood, canonicalRelative(t.glossChoice, t.swapped), canonicalRelative(t.metalChoice, t.swapped), t.responseTimeMs ?? 0, trainingJson, ...demographicsCells(demographics, skipped, inhouse), metadata.screenWidth, metadata.screenHeight, metadata.userAgent]), metadata, 'pairJudgment');
}
function downloadForcedChoices(trials: ForcedChoiceTrial[], demographics: Demographics, skipped: boolean, metadata: SessionMetadata, inhouse = false, assignedBatch = '') {
  const columns = ['participant_id', 'session_id', 'study_type', 'inhouse', 'assigned_batch', 'study_started_at', 'completed_at', 'trial_number', 'trial_id', 'is_sentinel', 'sentinel_id', 'assignment_set', 'difficulty_level', 'reference_image_id', 'reference_image_path', 'option_a_image_id', 'option_a_image_path', 'option_b_image_id', 'option_b_image_path', 'selected_option', 'response_time_ms', ...demographicColumns(inhouse), 'screen_width', 'screen_height', 'user_agent'];
  const completedAt = new Date().toISOString();
  saveCsv(columns, trials.map((t, i) => [metadata.participantId, metadata.sessionId, 'forcedChoice', inhouse, assignedBatch, metadata.startedAt, completedAt, i + 1, t.trial_id, Boolean(t.isSentinel), t.sentinelId ?? '', t.assignmentSet ?? '', t.difficulty_level, t.reference.image_id, t.reference.image_path, t.options[0].image_id, t.options[0].image_path, t.options[1].image_id, t.options[1].image_path, t.selectedOption, t.responseTimeMs ?? 0, ...demographicsCells(demographics, skipped, inhouse), metadata.screenWidth, metadata.screenHeight, metadata.userAgent]), metadata, 'forcedChoice');
}
function downloadSceneMatches(trials: SceneMatchingTrial[], demographics: Demographics, skipped: boolean, metadata: SessionMetadata, inhouse = false, assignedBatch = '') {
  const columns = ['participant_id', 'session_id', 'study_type', 'inhouse', 'assigned_batch', 'study_started_at', 'completed_at', 'trial_number', 'trial_id', 'is_sentinel', 'sentinel_id', 'assignment_set', 'shared_factor', 'target_label', 'first_scene_image_ids_json', 'second_scene_image_ids_json', 'selected_option', 'response_time_ms', ...demographicColumns(inhouse), 'screen_width', 'screen_height', 'user_agent'];
  const completedAt = new Date().toISOString();
  saveCsv(columns, trials.map((t, i) => [metadata.participantId, metadata.sessionId, 'sceneMatching', inhouse, assignedBatch, metadata.startedAt, completedAt, i + 1, t.trial_id, Boolean(t.isSentinel), t.sentinelId ?? '', t.assignmentSet ?? '', t.shared_factor, t.target_label, JSON.stringify(t.first_scene.map((image) => image.image_id)), JSON.stringify(t.second_scene.map((image) => image.image_id)), t.selectedOption, t.responseTimeMs ?? 0, ...demographicsCells(demographics, skipped, inhouse), metadata.screenWidth, metadata.screenHeight, metadata.userAgent]), metadata, 'sceneMatching');
}
function downloadSets(trials: SelectionTrial[], demographics: Demographics, skipped: boolean, metadata: SessionMetadata, inhouse = false, assignedBatch = '') {
  const columns = ['participant_id', 'session_id', 'study_type', 'inhouse', 'assigned_batch', 'study_started_at', 'completed_at', 'trial_number', 'trial_id', 'is_sentinel', 'sentinel_id', 'assignment_set', 'reference_image_id', 'reference_image_path', 'candidate_order_json', 'selected_candidate_ids_json', 'selected_count', 'response_time_ms', ...demographicColumns(inhouse), 'screen_width', 'screen_height', 'user_agent'];
  const completedAt = new Date().toISOString();
  saveCsv(columns, trials.map((t, i) => [metadata.participantId, metadata.sessionId, 'selection', inhouse, assignedBatch, metadata.startedAt, completedAt, i + 1, t.trial_id, Boolean(t.isSentinel), t.sentinelId ?? '', t.assignmentSet ?? '', t.reference.image_id, t.reference.image_path, JSON.stringify(t.candidates.map((c) => c.candidate_id)), JSON.stringify(t.selectedCandidateIds), t.selectedCandidateIds.length, t.responseTimeMs ?? 0, ...demographicsCells(demographics, skipped, inhouse), metadata.screenWidth, metadata.screenHeight, metadata.userAgent]), metadata, 'selection');
}

function submissionTrials(type: StudyType, pairs: PairTrial[], forced: ForcedChoiceTrial[], scenes: SceneMatchingTrial[], sets: SelectionTrial[]): SubmissionTrial[] {
  if (type === 'pairJudgment') return pairs.map((trial, index) => ({
    trialNumber: index + 1, trialId: trial.pairId, responseTimeMs: trial.responseTimeMs ?? 0, isSentinel: Boolean(trial.isSentinel), sentinelId: trial.sentinelId,
    response: { assignmentSet: trial.assignmentSet, stratum: trial.stratum, canonicalPathA: trial.canonicalPathA, canonicalPathB: trial.canonicalPathB, displayPathA: trial.displayPathA, displayPathB: trial.displayPathB, swapped: trial.swapped, sameMaterialLikelihood: trial.sameMaterialLikelihood, glossChoice: trial.glossChoice, metalChoice: trial.metalChoice, canonicalGlossChoice: canonicalRelative(trial.glossChoice, trial.swapped), canonicalMetalChoice: canonicalRelative(trial.metalChoice, trial.swapped) },
  }));
  if (type === 'forcedChoice') return forced.map((trial, index) => ({
    trialNumber: index + 1, trialId: trial.trial_id, responseTimeMs: trial.responseTimeMs ?? 0, isSentinel: Boolean(trial.isSentinel), sentinelId: trial.sentinelId,
    response: { assignmentSet: trial.assignmentSet, difficultyLevel: trial.difficulty_level, reference: trial.reference, options: trial.options, selectedOption: trial.selectedOption },
  }));
  if (type === 'sceneMatching') return scenes.map((trial, index) => ({
    trialNumber: index + 1, trialId: trial.trial_id, responseTimeMs: trial.responseTimeMs ?? 0, isSentinel: Boolean(trial.isSentinel), sentinelId: trial.sentinelId,
    response: { assignmentSet: trial.assignmentSet, difficultyLevel: trial.difficulty_level, sharedFactor: trial.shared_factor, targetLabel: trial.target_label, firstScene: trial.first_scene, secondScene: trial.second_scene, selectedOption: trial.selectedOption },
  }));
  return sets.map((trial, index) => ({
    trialNumber: index + 1, trialId: trial.trial_id, responseTimeMs: trial.responseTimeMs ?? 0, isSentinel: Boolean(trial.isSentinel), sentinelId: trial.sentinelId,
    response: { assignmentSet: trial.assignmentSet, difficultyLevel: trial.difficulty_level, referenceSourceType: trial.reference_source_type, reference: trial.reference, candidates: trial.candidates, selectedCandidateIds: trial.selectedCandidateIds, selectedCount: trial.selectedCandidateIds.length, positiveCount: trial.positive_count, profile: trial.profile },
  }));
}

function sentinelFailureCount(type: StudyType, trials: SubmissionTrial[]) {
  return trials.filter((trial) => trial.isSentinel).reduce((total, trial) => total + Number(sentinelFailed(type, trial)), 0);
}

function sentinelFailed(type: StudyType, trial: SubmissionTrial) {
  const response = trial.response;
  if (type === 'pairJudgment') {
    const expected = PAIR_SENTINEL_ANSWERS.get(trial.sentinelId ?? '');
    if (!expected) return false;
    return [
      Number(response.sameMaterialLikelihood) !== expected.sameMaterialLikelihood,
      Number(response.canonicalGlossChoice) !== expected.canonicalGlossChoice,
      Number(response.canonicalMetalChoice) !== expected.canonicalMetalChoice,
    ].some(Boolean);
  }
  if (type === 'forcedChoice') {
    return response.selectedOption !== FORCED_SENTINEL_ANSWERS.get(trial.sentinelId ?? '');
  }
  if (type === 'sceneMatching') {
    return Number(response.selectedOption) !== SCENE_SENTINEL_ANSWERS.get(trial.sentinelId ?? '');
  }
  const candidates = Array.isArray(response.candidates)
    ? response.candidates as Array<{ candidate_id?: unknown; is_same_material?: unknown }>
    : [];
  const selected = new Set(Array.isArray(response.selectedCandidateIds) ? response.selectedCandidateIds.map(String) : []);
  return candidates.some((candidate) => selected.has(String(candidate.candidate_id)) !== (candidate.is_same_material === true));
}

function TutorialExamples({ attribute }: { attribute: 'glossiness' | 'metallicness' }) {
  const levels = ['low', 'high'] as const;
  const isGlossiness = attribute === 'glossiness';
  const group = isGlossiness ? 't01' : 't02';
  return <div className="tutorial-examples" aria-label={`${attribute} comparisons`}>
    {levels.map((varyingLevel) => <section key={varyingLevel} className="tutorial-example-column" aria-label={`${varyingLevel} ${attribute}`}>
      <h3>{varyingLevel === 'low' ? 'Low' : 'High'} {attribute}</h3>
      <div className="tutorial-column-images">{levels.map((fixedLevel) => {
        const gloss = isGlossiness ? varyingLevel : fixedLevel;
        const metal = isGlossiness ? fixedLevel : varyingLevel;
        return <figure key={fixedLevel}><img src={assetUrl(`tutorial/${group}_gloss_${gloss}_metallic_${metal}.png`)} alt={`${gloss} glossiness, ${metal} metallicness`} /><figcaption className="sr-only">{gloss} glossiness, {metal} metallicness</figcaption></figure>;
      })}</div>
    </section>)}
  </div>;
}

function TestingAnswerButton({ visible, ready, shown, onToggle }: { visible: boolean; ready: boolean; shown: boolean; onToggle: () => void }) {
  if (!visible) return null;
  return <button className="testing-answer-button" disabled={!ready} onClick={onToggle}><Eye />{ready ? shown ? 'Hide correct answer' : 'Show correct answer' : 'Loading answers…'}</button>;
}
function ProlificOutcomeOptions({ url, code, copied, onCopy }: { url: string; code: string; copied: boolean; onCopy: () => void }) {
  if (!url && !code) return null;
  return <div className="screen-out-options"><p>To return to Prolific, either click the button below or copy the following code and enter it directly in Prolific.</p>{url && <a className="outcome-action-button" href={url}>Continue to Prolific <ArrowRight /></a>}{code && <div className="prolific-code"><span>Prolific code</span><div className="prolific-code-row"><strong>{code}</strong><button type="button" onClick={onCopy}>{copied ? 'Copied' : 'Copy code'}</button></div></div>}</div>;
}
function RelativeQuestion({ attribute, value, onChange }: { attribute: 'more glossy' | 'more metallic'; value: RelativeChoice; onChange: (value: RelativeChoice) => void }) {
  return <fieldset className="pair-question"><legend>Which surface appears <strong>{attribute}</strong>?</legend><RadioGroup value={value} onValueChange={(next) => onChange(next as RelativeChoice)} className="three-choice-scale">{[{ value: 'a', label: 'A' }, { value: 'same', label: 'Approximately same' }, { value: 'b', label: 'B' }].map((option) => <label className="scale-choice" key={option.value}><RadioGroupItem value={option.value} /><span>{option.label}</span></label>)}</RadioGroup></fieldset>;
}

function CompositeSceneFigure({ image, labels, selectedOption, correctOption, showCorrectAnswer, onSelect, onZoom }: { image: SelectionImage; labels: string[]; selectedOption?: 1 | 2 | 3 | 4 | null; correctOption?: 1 | 2 | 3 | 4; showCorrectAnswer?: boolean; onSelect?: (option: 1 | 2 | 3 | 4) => void; onZoom: () => void }) {
  const positions = labels.length === 3 ? [26.667, 50, 73.333] : labels.length === 1 ? [50] : labels.map((_, index) => (index + .5) * 100 / labels.length);
  return <figure className="composite-scene-sample">
    <button className="composite-scene-image-button" onClick={onZoom}><ThumbnailImage path={selectionDisplayPath(image)} originalPath={image.image_path} alt="Material comparison scene" /></button>
    <div className="composite-scene-overlays" aria-hidden={!onSelect}>{labels.map((label, index) => {
      const option = (index + 1) as 1 | 2 | 3 | 4;
      return <button key={label} type="button" className="composite-scene-label" data-selected={selectedOption === option || undefined} data-correct={showCorrectAnswer && correctOption === option || undefined} style={{ left: `${positions[index]}%` }} disabled={!onSelect} onClick={() => onSelect?.(option)}>{label}</button>;
    })}</div>
  </figure>;
}

export default function App() {
  const directTesting = isTestingMode(); const previewMode = isPreviewRoute(); const inhouseRoute = isInhouseRoute(); const assignedStudyType = inhouseRoute ? 'pairJudgment' : directStudyType();
  const prolific = useMemo(readProlificIdentifiers, []);
  const prolificIdentifierCount = Object.values(prolific).filter(Boolean).length;
  const participantLinkValid = !assignedStudyType || inhouseRoute || prolificIdentifierCount === 3;
  const initialClientMetadata = useMemo(collectClientMetadata, []);
  const metadata = useMemo(() => readSessionMetadata(prolific.prolificPid), [prolific.prolificPid]);
  const [stage, setStage] = useState<Stage>(directTesting ? 'chooser' : previewMode ? 'welcome' : assignedStudyType && participantLinkValid ? 'login' : 'invalid'); const [studyType, setStudyType] = useState<StudyType | null>(assignedStudyType);
  const [authSession, setAuthSession] = useState<AuthenticatedStudySession | null>(null);
  const inhouseCredentials = useRef<InhouseCredentials | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<StudySubmission | null>(null);
  const [pendingScreenOut, setPendingScreenOut] = useState<StudyScreenOut | null>(null);
  const [submissionError, setSubmissionError] = useState('');
  const [demographicsSaving, setDemographicsSaving] = useState(false);
  const [demographicsSaveError, setDemographicsSaveError] = useState('');
  const [redirectError, setRedirectError] = useState('');
  const [outcomeUrl, setOutcomeUrl] = useState('');
  const [outcomeCode, setOutcomeCode] = useState('');
  const [outcomeCodeCopied, setOutcomeCodeCopied] = useState(false);
  const [receiptId, setReceiptId] = useState('');
  const [resultStorage, setResultStorage] = useState<'d1' | 'r2' | ''>('');
  const [resumeIndex, setResumeIndex] = useState(0);
  const [consented, setConsented] = useState(false); const [consentedAt, setConsentedAt] = useState(''); const [demographics, setDemographics] = useState(EMPTY_DEMOGRAPHICS); const [demographicsSkipped, setDemographicsSkipped] = useState(directTesting);
  const [pairTrials, setPairTrials] = useState<PairTrial[]>([]); const [forcedChoiceTrials, setForcedChoiceTrials] = useState<ForcedChoiceTrial[]>([]); const [sceneMatchingTrials, setSceneMatchingTrials] = useState<SceneMatchingTrial[]>([]); const [selectionTrials, setSelectionTrials] = useState<SelectionTrial[]>([]); const [index, setIndex] = useState(0);
  const [pairTrainingAttempts, setPairTrainingAttempts] = useState<PairTrainingAttempt[]>([]);
  const [sceneTrainingAttempts, setSceneTrainingAttempts] = useState<SceneTrainingAttempt[]>([]);
  const [trainingExamples, setTrainingExamples] = useState<SceneMatchingTrainingExample[]>([]); const [trainingIndex, setTrainingIndex] = useState(0); const [trainingChoice, setTrainingChoice] = useState<1 | 2 | 3 | 4 | null>(null); const [trainingRevealed, setTrainingRevealed] = useState(false); const [trainingIncorrect, setTrainingIncorrect] = useState(false);
  const [preparing, setPreparing] = useState(false); const [prepared, setPrepared] = useState(false); const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false); const [lightboxPath, setLightboxPath] = useState(''); const [selectionLimitNotice, setSelectionLimitNotice] = useState(false); const trialStartedAt = useRef(0); const selectionLimitTimer = useRef<number | null>(null);
  const originalStartedAt = useRef(metadata.startedAt);
  const restoredSessionId = useRef('');
  const [testingGroundTruth, setTestingGroundTruth] = useState<TestingGroundTruth | null>(null); const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);
  const preparationId = useRef(0); const automaticPreparationStarted = useRef(false);
  const testingMode = isTestingMode();
  const inhouse = authSession?.inhouse === true;
  const assignedBatch = authSession?.assignmentBatch ?? '';
  const inhouseTaskIndex = studyType ? INHOUSE_STUDY_ORDER.indexOf(studyType) : -1;
  const demographicsComplete = isDemographicsComplete(demographics, inhouse);
  const currentPair = pairTrials[index]; const currentForcedChoice = forcedChoiceTrials[index]; const currentSceneMatching = sceneMatchingTrials[index]; const currentSelection = selectionTrials[index];
  const correctPairAnswer = currentPair ? testingGroundTruth?.pairs[currentPair.pairId] : undefined;
  const correctForcedChoice = currentForcedChoice ? testingGroundTruth?.forced_choices[currentForcedChoice.trial_id] : undefined;
  const correctSceneMatch = currentSceneMatching ? testingGroundTruth?.scene_matches[currentSceneMatching.trial_id] : undefined;
  const correctSelectionIds = new Set(currentSelection ? testingGroundTruth?.selections[currentSelection.trial_id] ?? [] : []);
  const activeCount = studyType === 'selection' ? selectionTrials.length : studyType === 'sceneMatching' ? sceneMatchingTrials.length : studyType === 'forcedChoice' ? forcedChoiceTrials.length : pairTrials.length;
  const pairComplete = Boolean(currentPair && currentPair.sameMaterialLikelihood !== null && currentPair.glossChoice && currentPair.metalChoice);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll<HTMLButtonElement>('.attribute-help-button:not([aria-label])').forEach((button) => {
      button.setAttribute('aria-label', 'Information about material, glossiness and metallicness');
    });
  }, [stage, index, trainingIndex]);
  useEffect(() => {
    // Keep the original asset URL out of the browser's ordinary image context
    // menu. This is deliberately a usability deterrent rather than a security
    // boundary: the URL remains available to someone inspecting network traffic.
    const isProtectedStimulus = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest('.study-shell img')) return true;
      const imageButton = target.closest('.study-shell button');
      return Boolean(imageButton?.querySelector('img'));
    };
    const preventContextMenu = (event: MouseEvent) => {
      if (isProtectedStimulus(event.target)) event.preventDefault();
    };
    const preventImageDrag = (event: DragEvent) => {
      if (isProtectedStimulus(event.target)) event.preventDefault();
    };
    document.addEventListener('contextmenu', preventContextMenu, true);
    document.addEventListener('dragstart', preventImageDrag, true);
    return () => {
      document.removeEventListener('contextmenu', preventContextMenu, true);
      document.removeEventListener('dragstart', preventImageDrag, true);
    };
  }, []);
  useEffect(() => {
    const initialType = authSession?.inhouse ? studyType : assignedStudyType;
    if (!initialType || (!directTesting && !authSession) || automaticPreparationStarted.current) return;
    automaticPreparationStarted.current = true;
    void prepare(initialType, authSession?.assignmentSeed);
  }, [assignedStudyType, authSession, directTesting, studyType]);
  useEffect(() => {
    if (!prepared || !authSession || !studyType || restoredSessionId.current === authSession.sessionId || authSession.alreadyCompleted || authSession.screenedOut) return;
    restoredSessionId.current = authSession.sessionId;
    try {
      const serialized = localStorage.getItem(progressStorageKey(authSession.sessionId));
      if (!serialized) return;
      const saved = JSON.parse(serialized) as Partial<StoredProgress>;
      if (saved.schemaVersion !== 1 || saved.studyType !== studyType || !Number.isInteger(saved.index) || Number(saved.index) < 0) return;
      const preparedIds = studyType === 'pairJudgment' ? pairTrials.map((trial) => trial.pairId)
        : studyType === 'forcedChoice' ? forcedChoiceTrials.map((trial) => trial.trial_id)
          : studyType === 'sceneMatching' ? sceneMatchingTrials.map((trial) => trial.trial_id)
            : selectionTrials.map((trial) => trial.trial_id);
      const restoredIds = studyType === 'pairJudgment' ? saved.pairTrials?.map((trial) => trial.pairId)
        : studyType === 'forcedChoice' ? saved.forcedChoiceTrials?.map((trial) => trial.trial_id)
          : studyType === 'sceneMatching' ? saved.sceneMatchingTrials?.map((trial) => trial.trial_id)
            : saved.selectionTrials?.map((trial) => trial.trial_id);
      if (!restoredIds?.length || restoredIds.length !== preparedIds.length || new Set(restoredIds).size !== restoredIds.length || restoredIds.some((id) => !preparedIds.includes(id))) return;
      if (saved.pairTrials) setPairTrials(saved.pairTrials);
      if (saved.forcedChoiceTrials) setForcedChoiceTrials(saved.forcedChoiceTrials);
      if (saved.sceneMatchingTrials) setSceneMatchingTrials(saved.sceneMatchingTrials);
      if (saved.selectionTrials) setSelectionTrials(saved.selectionTrials);
      if (saved.demographics) setDemographics(saved.demographics);
      setDemographicsSkipped(saved.demographicsSkipped === true);
      setPairTrainingAttempts(saved.pairTrainingAttempts ?? []);
      setSceneTrainingAttempts(saved.sceneTrainingAttempts ?? []);
      setConsented(true);
      setConsentedAt(saved.consentedAt || new Date().toISOString());
      originalStartedAt.current = saved.metadata?.startedAt || metadata.startedAt;
      const nextIndex = Math.min(Number(saved.index), restoredIds.length - 1);
      setResumeIndex(nextIndex);
      setStage('resume');
    } catch (cause) {
      console.warn('Stored study progress could not be restored.', cause);
    }
  }, [prepared, authSession, studyType, pairTrials, forcedChoiceTrials, sceneMatchingTrials, selectionTrials, metadata.startedAt]);
  useEffect(() => {
    if (!directTesting) return;
    let cancelled = false;
    void fetch(manifestUrl('testing_ground_truth.json'), { cache: 'no-store' })
      .then((response) => { if (!response.ok) throw new Error('Testing answers are unavailable.'); return response.json() as Promise<TestingGroundTruth>; })
      .then((answers) => { if (!cancelled) setTestingGroundTruth(answers); })
      .catch((cause) => console.error('Could not load testing ground truth.', cause));
    return () => { cancelled = true; };
  }, [directTesting]);
  useEffect(() => { if (!lightboxPath) return; const old = document.body.style.overflow; const close = (event: KeyboardEvent) => event.key === 'Escape' && setLightboxPath(''); document.body.style.overflow = 'hidden'; addEventListener('keydown', close); return () => { document.body.style.overflow = old; removeEventListener('keydown', close); }; }, [lightboxPath]);
  useEffect(() => () => { if (selectionLimitTimer.current !== null) window.clearTimeout(selectionLimitTimer.current); }, []);
  useEffect(() => {
    if (stage !== 'study' || studyType !== 'selection') return;
    const windowTrials = selectionTrials.slice(index, index + 3);
    const paths = windowTrials.flatMap((trial) => [selectionDisplayPath(trial.reference), ...trial.candidates.map(selectionDisplayPath)]);
    void preloadStudyImages(paths).catch((cause) => console.warn('A look-ahead thumbnail could not be preloaded after retries.', cause));
  }, [stage, studyType, index]);
  useEffect(() => {
    if (stage !== 'study' || studyType !== 'sceneMatching') return;
    const paths = sceneMatchingTrials.slice(index, index + 3).flatMap((trial) => [...trial.first_scene, ...trial.second_scene].map(selectionDisplayPath));
    void preloadStudyImages(paths).catch((cause) => console.warn('An in-context thumbnail could not be preloaded after retries.', cause));
  }, [stage, studyType, index, sceneMatchingTrials]);
  useEffect(() => {
    if (stage !== 'study' || studyType !== 'forcedChoice') return;
    const paths = forcedChoiceTrials.slice(index, index + 3).flatMap((trial) => [trial.reference.image_path, ...trial.options.map((option) => option.image_path)]);
    void preloadStudyImages(paths).catch((cause) => console.warn('A reference-matching thumbnail could not be preloaded after retries.', cause));
  }, [stage, studyType, index, forcedChoiceTrials]);
  useEffect(() => {
    if (stage !== 'study' || studyType !== 'pairJudgment') return;
    const paths = pairTrials.slice(index, index + 3).flatMap((trial) => [trial.displayPathA, trial.displayPathB]);
    void preloadStudyImages(paths).catch((cause) => console.warn('A pair thumbnail could not be preloaded after retries.', cause));
  }, [stage, studyType, index, pairTrials]);
  useEffect(() => {
    if (stage !== 'study' || !studyType) return;
    persistProgress(index);
  }, [stage, studyType, index, pairTrials, forcedChoiceTrials, sceneMatchingTrials, selectionTrials, pairTrainingAttempts, sceneTrainingAttempts]);

  async function prepare(type: StudyType, assignmentSeedOverride?: string) {
    const requestId = ++preparationId.current;
    // Production assignments come from the credential stored in D1. Preview
    // and testing always use set_01; short testing sessions are balanced
    // subsets of that same fixed set rather than draws from the full bank.
    const sampleMode = testingMode || previewMode;
    const assignmentSeed = sampleMode ? 'batch:set_01:preview-testing' : assignmentSeedOverride ?? authSession?.assignmentSeed ?? metadata.sessionId;
    const sampleSeed = `${assignmentSeed}:${metadata.sessionId}:${type}`;
    setPreparing(true); setPrepared(false); setError('');
    try {
      const [sentinelConfig, fixedAssignment] = await Promise.all([
        directTesting ? Promise.resolve(null) : loadSentinelConfig(),
        loadFixedTrialGroup(type, assignmentSeed),
      ]);
      if (type === 'selection') {
        const response = await fetch(manifestUrl('selection_trials.json'), { cache: 'no-store' });
        if (!response.ok) throw new Error('Selection trials are not available yet. Generate them after datasetv7 and G90 are complete.');
        const payload = await response.json() as { trials?: SelectionManifestTrial[] } | SelectionManifestTrial[]; const entries = Array.isArray(payload) ? payload : payload.trials ?? [];
        const requested = trialCount(type);
        const fixedEntries = fixedRows(entries, fixedAssignment.trialIds, (entry) => entry.trial_id);
        let selected = sampleMode && requested < fixedAssignment.trialIds.length ? selectSets(fixedEntries, requested, sampleSeed) : materializeFixedSets(entries, fixedAssignment, sampleSeed);
        if (sentinelConfig) selected = insertSentinels(selected, selectionSentinels(sentinelConfig, sampleSeed), sentinelConfig.positions);
        if (fixedAssignment) selected = selected.map((trial) => ({ ...trial, assignmentSet: fixedAssignment.setId }));
        const paths = selected.slice(0, 1).flatMap((t) => [selectionDisplayPath(t.reference), ...t.candidates.map(selectionDisplayPath)]); await preloadStudyImages(paths); if (requestId !== preparationId.current) return; setSelectionTrials(selected);
      } else if (type === 'forcedChoice') {
        const response = await fetch(manifestUrl('forced_choice_trials.json'), { cache: 'no-store' });
        if (!response.ok) throw new Error('Reference-matching trials are unavailable.');
        const payload = await response.json() as { trials: ForcedChoiceManifestTrial[] };
        const requested = trialCount(type);
        const fixedEntries = fixedRows(payload.trials, fixedAssignment.trialIds, (entry) => entry.trial_id);
        let selected = sampleMode && requested < fixedAssignment.trialIds.length ? selectForcedChoices(fixedEntries, requested, sampleSeed) : materializeFixedForcedChoices(payload.trials, fixedAssignment, sampleSeed);
        if (sentinelConfig) selected = insertSentinels(selected, forcedChoiceSentinels(sentinelConfig), sentinelConfig.positions);
        if (fixedAssignment) selected = selected.map((trial) => ({ ...trial, assignmentSet: fixedAssignment.setId }));
        const paths = selected.slice(0, 1).flatMap((trial) => [trial.reference.image_path, ...trial.options.map((option) => option.image_path)]);
        await preloadStudyImages(paths); if (requestId !== preparationId.current) return; setForcedChoiceTrials(selected);
      } else if (type === 'sceneMatching') {
        const [response, trainingResponse] = await Promise.all([
          fetch(manifestUrl('scene_matching_trials.json'), { cache: 'no-store' }),
          fetch(manifestUrl('scene_matching_training.json'), { cache: 'no-store' }),
        ]);
        if (!response.ok) throw new Error('Four-material trials are unavailable.');
        if (!trainingResponse.ok) throw new Error('Training examples are unavailable.');
        const payload = await response.json() as { trials: SceneMatchingManifestTrial[] };
        const trainingPayload = await trainingResponse.json() as { examples: SceneMatchingTrainingExample[] };
        const examples = trainingPayload.examples;
        if (!Array.isArray(examples) || examples.length !== 4 || examples.some((example) => example.target_label !== 'R' || example.first_scene.length !== 1 || example.second_scene.length !== 1 || example.correct_option < 1 || example.correct_option > 3)) {
          throw new Error('The training examples are incomplete.');
        }
        const requested = trialCount(type);
        const fixedEntries = fixedRows(payload.trials, fixedAssignment.trialIds, (entry) => entry.trial_id);
        let selected = sampleMode && requested < fixedAssignment.trialIds.length ? selectSceneMatches(fixedEntries, requested, sampleSeed) : materializeFixedSceneMatches(payload.trials, fixedAssignment, sampleSeed);
        if (sentinelConfig) selected = insertSentinels(selected, sceneMatchingSentinels(sentinelConfig), sentinelConfig.positions);
        if (fixedAssignment) selected = selected.map((trial) => ({ ...trial, assignmentSet: fixedAssignment.setId }));
        const paths = [...selected.slice(0, 1), ...examples].flatMap((trial) => [...trial.first_scene, ...trial.second_scene].map(selectionDisplayPath));
        await preloadStudyImages(paths); if (requestId !== preparationId.current) return; setSceneMatchingTrials(selected); setTrainingExamples(examples);
      } else {
        const response = await fetch(manifestUrl('study_pairs.json'), { cache: 'no-store' }); if (!response.ok) throw new Error('The local pair manifest is unavailable.');
        const entries = await response.json() as ManifestPair[];
        const requested = trialCount(type);
        const fixedEntries = fixedRows(entries, fixedAssignment.trialIds, (entry) => entry.pair_id);
        let selected = sampleMode && requested < fixedAssignment.trialIds.length ? selectPairs(fixedEntries, requested, sampleSeed) : materializeFixedPairs(entries, fixedAssignment, sampleSeed);
        if (sentinelConfig) selected = insertSentinels(selected, pairSentinels(sentinelConfig, sampleSeed), sentinelConfig.positions);
        if (fixedAssignment) selected = selected.map((trial) => ({ ...trial, assignmentSet: fixedAssignment.setId }));
        const studyPaths = selected.slice(0, 1).flatMap((t) => [t.displayPathA, t.displayPathB]);
        await Promise.all([preloadStudyImages(studyPaths), preloadImages(PAIR_TRAINING_EXAMPLES.flatMap((example) => [assetUrl(example.imageA), assetUrl(example.imageB)]))]); if (requestId !== preparationId.current) return; setPairTrials(selected);
      }
      setPrepared(true);
    } catch (cause) { if (requestId === preparationId.current) setError(cause instanceof Error ? cause.message : 'The study could not be prepared.'); } finally { if (requestId === preparationId.current) setPreparing(false); }
  }
  function choose(type: StudyType) { setShowCorrectAnswer(false); setStudyType(type); setStage('instructions'); void prepare(type); }
  async function nextAvailableInhouseSession(startIndex: number, credentials: InhouseCredentials) {
    const completed: StudyType[] = [];
    let lastAuthenticated: AuthenticatedStudySession | null = null;
    for (let position = startIndex; position < INHOUSE_STUDY_ORDER.length; position += 1) {
      const type = INHOUSE_STUDY_ORDER[position];
      const authenticated = await loginToStudy({
        username: credentials.username,
        password: credentials.password,
        prolific,
        studyType: type,
        clientSessionId: inhouseSessionId(credentials.runId, type),
        inhouseRunId: credentials.runId,
        startedAt: metadata.startedAt,
        clientMetadata: initialClientMetadata,
      });
      lastAuthenticated = authenticated;
      if (!authenticated.inhouse) throw new Error('The in-house study account could not be verified.');
      if (!authenticated.alreadyCompleted && !authenticated.screenedOut) return { authenticated, type, completed, lastAuthenticated };
      completed.push(type);
    }
    return { authenticated: null, type: null, completed, lastAuthenticated };
  }
  async function login(username: string, password: string) {
    if (!assignedStudyType) throw new Error('This link does not identify a study task.');
    if (normalizedLoginName(username) === 'gilab-inhouse') {
      const credentials = { username, password, runId: inhouseRunId(metadata.sessionId) };
      inhouseCredentials.current = credentials;
      const next = await nextAvailableInhouseSession(0, credentials);
      if (!next.authenticated || !next.type) {
        setAuthSession(next.lastAuthenticated);
        setStudyType(INHOUSE_STUDY_ORDER[INHOUSE_STUDY_ORDER.length - 1]);
        setReceiptId('All four tests stored');
        setStage('complete');
        return;
      }
      setStudyType(next.type);
      setAuthSession(next.authenticated);
      setReceiptId(next.authenticated.screenOutReceiptId ?? '');
      if (next.authenticated.screenedOut) {
        setStage('screening');
        await showOutcomeScreen(next.type, 'screen_out');
      } else setStage('welcome');
      return;
    }
    const authenticated = await loginToStudy({ username, password, prolific, studyType: assignedStudyType, clientSessionId: metadata.sessionId, startedAt: metadata.startedAt, clientMetadata: initialClientMetadata });
    setAuthSession(authenticated);
    if (authenticated.screenedOut) {
      setReceiptId(authenticated.screenOutReceiptId ?? '');
      setStage('screening');
      await showOutcomeScreen(assignedStudyType, 'screen_out');
      return;
    }
    if (authenticated.alreadyCompleted) {
      if (!authenticated.receiptId) throw new Error('The study is already complete, but its receipt could not be loaded. Please contact the study organiser.');
      setReceiptId(authenticated.receiptId);
      setStage('submitting');
      await showOutcomeScreen(assignedStudyType, 'completion');
      return;
    }
    setStage('welcome');
  }
  function start() { if (!prepared) return; setIndex(0); if (studyType === 'pairJudgment') { setStage('training'); return; } if (studyType === 'sceneMatching') { setTrainingIndex(0); setTrainingChoice(null); setTrainingRevealed(false); setTrainingIncorrect(false); setStage('training'); return; } trialStartedAt.current = performance.now(); setStage('study'); }
  function persistProgress(nextIndex: number, nextPairs = pairTrials, nextForced = forcedChoiceTrials, nextScene = sceneMatchingTrials, nextSets = selectionTrials, nextTraining = pairTrainingAttempts, nextDemographicsSkipped = demographicsSkipped) {
    if (!studyType) return;
    const sessionId = authSession?.sessionId ?? metadata.sessionId;
    const stored: StoredProgress = {
      schemaVersion: 1,
      studyType,
      index: nextIndex,
      metadata: { ...metadata, sessionId, startedAt: originalStartedAt.current },
      consentedAt: consentedAt || new Date().toISOString(),
      demographics,
      demographicsSkipped: nextDemographicsSkipped,
      pairTrainingAttempts: nextTraining,
      sceneTrainingAttempts,
      pairTrials: nextPairs,
      forcedChoiceTrials: nextForced,
      sceneMatchingTrials: nextScene,
      selectionTrials: nextSets,
    };
    try { localStorage.setItem(progressStorageKey(sessionId), JSON.stringify(stored)); }
    catch (cause) { console.warn('Study progress could not be stored locally.', cause); }
  }
  async function continueFromDemographics(skipped: boolean) {
    setDemographicsSkipped(skipped);
    setDemographicsSaveError('');
    persistProgress(0, pairTrials, forcedChoiceTrials, sceneMatchingTrials, selectionTrials, pairTrainingAttempts, skipped);
    if (directTesting || previewMode) { setStage('explanation'); return; }
    if (!authSession || !studyType) { setDemographicsSaveError('Your authenticated session is missing. Please sign in again.'); return; }
    setDemographicsSaving(true);
    try {
      await saveStudyDemographics(authSession.token, {
        schemaVersion: '2026-10-20.5',
        sessionId: authSession.sessionId,
        studyType,
        consented: true,
        consentedAt: consentedAt || new Date().toISOString(),
        demographicsSkipped: skipped,
        demographics: demographicsPayload(demographics, inhouse),
        clientMetadata: collectClientMetadata(),
      });
      setStage('explanation');
    } catch (cause) {
      setDemographicsSaveError(cause instanceof Error ? cause.message : 'The demographic information could not be saved. Please try again.');
    } finally {
      setDemographicsSaving(false);
    }
  }
  function advanceTraining() { if (!trainingRevealed || trainingChoice !== trainingExamples[trainingIndex]?.correct_option) return; if (trainingIndex + 1 < trainingExamples.length) { setTrainingIndex((value) => value + 1); setTrainingChoice(null); setTrainingRevealed(false); setTrainingIncorrect(false); return; } setIndex(0); trialStartedAt.current = performance.now(); setStage('study'); }
  function checkSceneTrainingAnswer() {
    const example = trainingExamples[trainingIndex];
    if (!example || trainingChoice === null) return;
    const correct = trainingChoice === example.correct_option;
    setSceneTrainingAttempts((attempts) => [...attempts, { trainingId: example.training_id, selectedOption: trainingChoice, correct, attemptedAt: new Date().toISOString() }]);
    if (correct) setTrainingRevealed(true);
    else setTrainingIncorrect(true);
  }
  function recordPairTrainingAttempt(attempt: PairTrainingAttempt) {
    setPairTrainingAttempts((current) => {
      const next = [...current, attempt];
      persistProgress(index, pairTrials, forcedChoiceTrials, sceneMatchingTrials, selectionTrials, next);
      return next;
    });
  }
  function updatePair(update: Partial<PairTrial>) { setPairTrials((all) => all.map((trial, i) => i === index ? { ...trial, ...update } : trial)); }
  function clearSelectionLimitNotice() { setSelectionLimitNotice(false); if (selectionLimitTimer.current !== null) { window.clearTimeout(selectionLimitTimer.current); selectionLimitTimer.current = null; } }
  function showSelectionLimitNotice() { clearSelectionLimitNotice(); setSelectionLimitNotice(true); selectionLimitTimer.current = window.setTimeout(() => { setSelectionLimitNotice(false); selectionLimitTimer.current = null; }, 2200); }
  function toggleCandidate(id: string) {
    if (!currentSelection) return;
    const alreadySelected = currentSelection.selectedCandidateIds.includes(id);
    if (!alreadySelected && currentSelection.selectedCandidateIds.length >= MAX_SELECTIONS) { showSelectionLimitNotice(); return; }
    setSelectionTrials((all) => all.map((trial, i) => i === index ? { ...trial, selectedCandidateIds: alreadySelected ? trial.selectedCandidateIds.filter((value) => value !== id) : [...trial.selectedCandidateIds, id] } : trial));
  }
  function downloadCurrent() {
    if (studyType === 'selection') downloadSets(selectionTrials, demographics, demographicsSkipped, metadata, inhouse, assignedBatch);
    else if (studyType === 'sceneMatching') downloadSceneMatches(sceneMatchingTrials, demographics, demographicsSkipped, metadata, inhouse, assignedBatch);
    else if (studyType === 'forcedChoice') downloadForcedChoices(forcedChoiceTrials, demographics, demographicsSkipped, metadata, inhouse, assignedBatch);
    else downloadPairs(pairTrials, pairTrainingAttempts, demographics, demographicsSkipped, metadata, inhouse, assignedBatch);
  }
  async function showOutcomeScreen(type: StudyType, outcome: 'completion' | 'screen_out') {
    const configurationErrors: string[] = [];
    setOutcomeUrl('');
    setOutcomeCode('');
    setOutcomeCodeCopied(false);
    try {
      setOutcomeUrl(await configuredRedirect(type, outcome));
    } catch (cause) {
      configurationErrors.push(cause instanceof Error ? cause.message : 'The configured redirect could not be opened.');
    }
    try {
      setOutcomeCode(await configuredOutcomeCode(type, outcome));
    } catch (cause) {
      configurationErrors.push(cause instanceof Error ? cause.message : 'The configured Prolific code could not be loaded.');
    }
    setRedirectError(configurationErrors.join(' '));
    setStage(outcome === 'completion' ? 'complete' : 'screened_out');
  }
  async function copyOutcomeCode() {
    if (!outcomeCode) return;
    try {
      await navigator.clipboard.writeText(outcomeCode);
      setOutcomeCodeCopied(true);
    } catch {
      const field = document.createElement('textarea');
      field.value = outcomeCode;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      setOutcomeCodeCopied(copied);
    }
  }
  async function uploadSubmission(submission: StudySubmission) {
    if (!authSession) { setSubmissionError('Your authenticated session is missing. Download the local backup and contact the study organiser.'); return; }
    const submittedSession = authSession;
    setSubmissionError('');
    try {
      const result = await submitStudy(submittedSession.token, submission);
      setReceiptId(result.receiptId);
      setResultStorage(result.storage ?? (result.fallbackStored ? 'r2' : 'd1'));
      localStorage.removeItem(progressStorageKey(submittedSession.sessionId));
      if (result.screenedOut) {
        setPendingSubmission(null);
        await showOutcomeScreen(submission.studyType as StudyType, 'screen_out');
        return;
      }
      if (submittedSession.inhouse) {
        const credentials = inhouseCredentials.current;
        if (!credentials) throw new Error('The in-house study credentials are no longer available. Reload the page and sign in again to continue.');
        const completedType = submission.studyType as StudyType;
        const currentPosition = INHOUSE_STUDY_ORDER.indexOf(completedType);
        const next = await nextAvailableInhouseSession(currentPosition + 1, credentials);
        if (next.authenticated && next.type) {
          setAuthSession(next.authenticated);
          setStudyType(next.type);
          setIndex(0);
          setShowHelp(false);
          setShowCorrectAnswer(false);
          setTrainingIndex(0);
          setTrainingChoice(null);
          setTrainingRevealed(false);
          setTrainingIncorrect(false);
          await prepare(next.type, next.authenticated.assignmentSeed);
          setPendingSubmission(null);
          setStage('instructions');
          return;
        }
      }
      setPendingSubmission(null);
      if (submittedSession.inhouse) setStage('complete');
      else await showOutcomeScreen(submission.studyType as StudyType, 'completion');
    } catch (cause) {
      setSubmissionError(cause instanceof Error ? cause.message : 'The responses could not be uploaded. Please try again.');
    }
  }
  async function uploadScreenOut(submission: StudyScreenOut) {
    if (!authSession) { setSubmissionError('Your authenticated session is missing. Please contact the study organiser.'); return; }
    setSubmissionError('');
    try {
      const result = await screenOutStudy(authSession.token, submission);
      setReceiptId(result.receiptId);
      setResultStorage(result.storage ?? (result.fallbackStored ? 'r2' : 'd1'));
      localStorage.removeItem(progressStorageKey(authSession.sessionId));
      setPendingScreenOut(null);
      await showOutcomeScreen(submission.studyType as StudyType, 'screen_out');
    } catch (cause) {
      setSubmissionError(cause instanceof Error ? cause.message : 'The screen-out record could not be uploaded. Please try again.');
    }
  }
  function advance(nextPairs: PairTrial[], nextForced: ForcedChoiceTrial[], nextScene: SceneMatchingTrial[], nextSets: SelectionTrial[]) {
    persistProgress(Math.min(index + 1, Math.max(0, activeCount - 1)), nextPairs, nextForced, nextScene, nextSets); setShowHelp(false); setShowCorrectAnswer(false); clearSelectionLimitNotice();
    if (studyType && !directTesting && !previewMode) {
      const answeredTrials = submissionTrials(studyType, nextPairs, nextForced, nextScene, nextSets).slice(0, index + 1);
      if (!inhouse && sentinelFailureCount(studyType, answeredTrials) >= sentinelScreenOutThreshold(studyType)) {
        const screening: StudyScreenOut = { schemaVersion: '2026-10-20.5', sessionId: authSession?.sessionId ?? metadata.sessionId, studyType, startedAt: originalStartedAt.current, screenedOutAt: new Date().toISOString(), consented: true, consentedAt: consentedAt || new Date().toISOString(), assignmentBatch: assignedBatch, inhouse, studyRunId: authSession?.studyRunId ?? undefined, demographicsSkipped, demographics: demographicsPayload(demographics, inhouse), trainingAttempts: studyType === 'pairJudgment' ? pairTrainingAttempts : studyType === 'sceneMatching' ? sceneTrainingAttempts : [], trials: answeredTrials, clientMetadata: collectClientMetadata() };
        setPendingScreenOut(screening);
        setStage('screening');
        void uploadScreenOut(screening);
        return;
      }
    }
    if (studyType && previewMode) {
      const answeredTrials = submissionTrials(studyType, nextPairs, nextForced, nextScene, nextSets).slice(0, index + 1);
      if (sentinelFailureCount(studyType, answeredTrials) >= sentinelScreenOutThreshold(studyType)) {
        setStage('screening');
        void showOutcomeScreen(studyType, 'screen_out');
        return;
      }
    }
    if (index === activeCount - 1) {
      if (directTesting || previewMode) {
        if (studyType === 'selection') downloadSets(nextSets, demographics, demographicsSkipped, metadata, inhouse, assignedBatch);
        else if (studyType === 'sceneMatching') downloadSceneMatches(nextScene, demographics, demographicsSkipped, metadata, inhouse, assignedBatch);
        else if (studyType === 'forcedChoice') downloadForcedChoices(nextForced, demographics, demographicsSkipped, metadata, inhouse, assignedBatch);
        else downloadPairs(nextPairs, pairTrainingAttempts, demographics, demographicsSkipped, metadata, inhouse, assignedBatch);
        setStage('complete');
        return;
      }
      if (!studyType) return;
      const submission: StudySubmission = { schemaVersion: '2026-10-20.5', sessionId: authSession?.sessionId ?? metadata.sessionId, studyType, startedAt: originalStartedAt.current, completedAt: new Date().toISOString(), consented: true, consentedAt: consentedAt || new Date().toISOString(), assignmentBatch: assignedBatch, inhouse, studyRunId: authSession?.studyRunId ?? undefined, demographicsSkipped, demographics: demographicsPayload(demographics, inhouse), trainingAttempts: studyType === 'pairJudgment' ? pairTrainingAttempts : studyType === 'sceneMatching' ? sceneTrainingAttempts : [], trials: submissionTrials(studyType, nextPairs, nextForced, nextScene, nextSets), clientMetadata: collectClientMetadata() };
      setPendingSubmission(submission);
      setStage('submitting');
      void uploadSubmission(submission);
    }
    else { setIndex((value) => value + 1); trialStartedAt.current = performance.now(); }
  }
  function elapsedFor(previousMs?: number) { return (previousMs ?? 0) + Math.round(performance.now() - trialStartedAt.current); }
  function nextPair() { if (!pairComplete) return; const next = pairTrials.map((trial, i) => i === index ? { ...trial, responseTimeMs: elapsedFor(trial.responseTimeMs) } : trial); setPairTrials(next); advance(next, forcedChoiceTrials, sceneMatchingTrials, selectionTrials); }
  function nextForcedChoice() { if (!currentForcedChoice?.selectedOption) return; const next = forcedChoiceTrials.map((trial, i) => i === index ? { ...trial, responseTimeMs: elapsedFor(trial.responseTimeMs) } : trial); setForcedChoiceTrials(next); advance(pairTrials, next, sceneMatchingTrials, selectionTrials); }
  function nextSceneMatching() { if (!currentSceneMatching?.selectedOption) return; const next = sceneMatchingTrials.map((trial, i) => i === index ? { ...trial, responseTimeMs: elapsedFor(trial.responseTimeMs) } : trial); setSceneMatchingTrials(next); advance(pairTrials, forcedChoiceTrials, next, selectionTrials); }
  function nextSet() { if (!currentSelection) return; const next = selectionTrials.map((trial, i) => i === index ? { ...trial, responseTimeMs: elapsedFor(trial.responseTimeMs) } : trial); setSelectionTrials(next); advance(pairTrials, forcedChoiceTrials, sceneMatchingTrials, next); }
  function previous() {
    if (!index) return;
    const elapsed = Math.round(performance.now() - trialStartedAt.current);
    if (studyType === 'pairJudgment') setPairTrials((trials) => trials.map((trial, i) => i === index ? { ...trial, responseTimeMs: (trial.responseTimeMs ?? 0) + elapsed } : trial));
    else if (studyType === 'forcedChoice') setForcedChoiceTrials((trials) => trials.map((trial, i) => i === index ? { ...trial, responseTimeMs: (trial.responseTimeMs ?? 0) + elapsed } : trial));
    else if (studyType === 'sceneMatching') setSceneMatchingTrials((trials) => trials.map((trial, i) => i === index ? { ...trial, responseTimeMs: (trial.responseTimeMs ?? 0) + elapsed } : trial));
    else if (studyType === 'selection') setSelectionTrials((trials) => trials.map((trial, i) => i === index ? { ...trial, responseTimeMs: (trial.responseTimeMs ?? 0) + elapsed } : trial));
    setIndex((value) => value - 1); setShowHelp(false); setShowCorrectAnswer(false); clearSelectionLimitNotice(); trialStartedAt.current = performance.now();
  }

  if (stage === 'invalid') return <main className="study-shell complete-shell"><section className="complete-card"><CircleHelp className="submission-error-icon" /><p className="eyebrow">Study access</p><h1>Open a valid study link</h1><p className="lead">Use the preview, testing, or participant link supplied by the study organiser.</p></section></main>;

  if (stage === 'login') return <ParticipantLogin mode={inhouseRoute ? 'inhouse' : 'prolific'} studyTitle={assignedStudyType ? TEST_COPY[assignedStudyType].title : null} onLogin={login} />;

  if (stage === 'resume') return <main className="study-shell complete-shell"><section className="complete-card"><Check className="success-icon" /><p className="eyebrow">Progress recovered</p><h1>Continue your study</h1><p className="lead">Your saved responses were found in this browser. You can continue from trial {resumeIndex + 1}.</p><div className="complete-actions"><Button onClick={() => { setIndex(resumeIndex); trialStartedAt.current = performance.now(); setStage('study'); }}>Continue <ArrowRight /></Button><Button variant="outline" onClick={() => { if (authSession) localStorage.removeItem(progressStorageKey(authSession.sessionId)); setIndex(0); setStage('welcome'); }}>Start again</Button></div></section></main>;

  if (stage === 'welcome') return <main className="study-shell welcome-shell"><section className="welcome-card"><div className="study-mark" aria-hidden="true"><span /><span /><span /></div><div className="tutorial-heading card-title-heading"><h1>Visual Perception Study</h1><p>{inhouse ? 'Complete material appearance study' : assignedStudyType ? `${TEST_COPY[assignedStudyType].title} test` : 'Thank you for taking part in this material appearance study.'}</p></div><div className="attention-callout"><Eye /><div><h2>Please read carefully and stay attentive</h2><p>You will judge surface materials across changes in shape and illumination.</p></div></div><div className="study-facts"><div><strong className="fact-value">{inhouse ? '≈ 30 min' : assignedStudyType === 'pairJudgment' ? '≈ 7 min' : assignedStudyType ? '≈ 8 min' : '≈ 7–8 min'}</strong><span className="fact-label">Estimated completion time</span></div><div><strong className="fact-value">{inhouse ? '4 tasks' : assignedStudyType ? '1 task' : '4 tasks'}</strong><span className="fact-label">{inhouse ? 'Completed one after another' : assignedStudyType ? TEST_COPY[assignedStudyType].title : 'Choose one after the guide'}</span></div><div><Monitor /><span className="fact-label">Desktop or laptop</span></div></div><div className="instructions compact-instructions"><h2>Before you begin</h2><ul><li>Use a desktop or laptop in a normally lit room.</li><li>Set your screen to a comfortable, clearly visible brightness.</li><li>Do not refresh or close the page while completing the study.</li></ul></div><label className="consent-row"><Checkbox checked={consented} onCheckedChange={(checked) => { const accepted = checked === true; setConsented(accepted); setConsentedAt(accepted ? new Date().toISOString() : ''); }} /><span>I voluntarily agree to participate. I understand that my responses will be stored under a study identifier and used for academic research. The restricted Prolific linkage is retained only for study administration and data-quality checks.</span></label><Button className="primary-action" size="lg" disabled={!consented} onClick={() => setStage('demographics')}>Continue <ArrowRight /></Button></section></main>;

  if (stage === 'demographics') return <main className="study-shell demographics-shell"><section className="welcome-card demographics-card"><div className="tutorial-heading card-title-heading"><h1>Participant information</h1><p>{inhouse ? 'This in-house form collects contact and extended demographic information for internal study administration and analysis.' : 'We collect participant information to support future analyses of the user study results. Responses will be analysed and reported in aggregate, without identifying individual participants. Please do not include your name or other identifying details in free-text answers.'}</p></div><DemographicsForm values={demographics} onChange={setDemographics} inhouse={inhouse} />{demographicsSaveError && <p className="demographics-save-error" role="alert">{demographicsSaveError}</p>}<div className="demographics-actions"><Button variant="ghost" size="lg" disabled={demographicsSaving} onClick={() => setStage('welcome')}><ArrowLeft /> Back</Button><div className="demographics-forward-actions">{testingMode && <Button variant="outline" size="lg" disabled={demographicsSaving} onClick={() => void continueFromDemographics(true)}>Skip for testing</Button>}<Button size="lg" disabled={!demographicsComplete || demographicsSaving} onClick={() => void continueFromDemographics(false)}>{demographicsSaving ? <><LoaderCircle className="is-spinning" /> Saving…</> : <>Continue <ArrowRight /></>}</Button></div></div></section></main>;

  if (stage === 'explanation') return <main className="study-shell explanation-shell"><header className="page-header"><div><span className="brand-dot" /> {assignedStudyType ? `${TEST_COPY[assignedStudyType].title} test` : 'Material constancy'}</div><span>Appearance guide</span></header><section className="explanation-content"><div className="tutorial-heading appearance-guide-heading"><h1>Glossiness and metallicness</h1><p>These are separate appearance attributes. Compare the low and high examples, and use the visual cues below throughout the study.</p></div>
    <article className="attribute-card"><div className="attribute-copy"><p className="eyebrow">Attribute 1</p><h2>Glossiness</h2><p>Glossiness describes how clearly and strongly a surface reflects its surroundings. Glossy materials tend to show sharp, concentrated highlights or recognizable reflections; less glossy materials show broader, softer reflections.</p><p className="cue"><Eye /><span>Look at the <strong>sharpness and definition</strong> of highlights and reflections. Brightness alone does not mean a material is glossy.</span></p></div><TutorialExamples attribute="glossiness" /></article>
    <article className="attribute-card"><div className="attribute-copy"><p className="eyebrow">Attribute 2</p><h2>Metallicness</h2><p>Metallicness describes how metal-like the surface response appears. Metals often have tinted reflections, strong bright–dark contrast and darker regions away from reflected lights; non-metals usually retain a more visible diffuse body color.</p><p className="cue"><Eye /><span>Look for <strong>tinted reflections and characteristic bright–dark contrast</strong>. A material can be highly glossy without being metallic, and a metal can be relatively rough.</span></p></div><TutorialExamples attribute="metallicness" /></article>
    <div className="explanation-actions"><Button variant="ghost" size="lg" onClick={() => setStage('demographics')}><ArrowLeft /> Back</Button><Button size="lg" onClick={() => setStage(assignedStudyType ? 'instructions' : 'chooser')}>{assignedStudyType ? 'Continue to test' : 'Choose a test'} <ArrowRight /></Button></div></section></main>;

  if (stage === 'chooser') return <main className="study-shell tutorial-shell"><header className="page-header"><div><span className="brand-dot" /> Material constancy</div><span>Test selection</span></header><section className="tutorial-content"><div className="tutorial-heading chooser-heading"><h1>Choose a test</h1></div><div className="test-choice-grid">
    <button className="test-choice-card" onClick={() => choose('pairJudgment')}><span className="test-number">1</span><SlidersHorizontal /><h2>{TEST_COPY.pairJudgment.title}</h2><p>{TEST_COPY.pairJudgment.detail}</p><strong>Identity, glossiness and metallicness</strong></button>
    <button className="test-choice-card" onClick={() => choose('forcedChoice')}><span className="test-number">2</span><ScanSearch /><h2>{TEST_COPY.forcedChoice.title}</h2><p>{TEST_COPY.forcedChoice.detail}</p><strong>One reference + two alternatives</strong></button>
    <button className="test-choice-card" onClick={() => choose('sceneMatching')}><span className="test-number">3</span><Shuffle /><h2>{TEST_COPY.sceneMatching.title}</h2><p>{TEST_COPY.sceneMatching.detail}</p><strong>One reference + three candidates</strong></button>
    <button className="test-choice-card" onClick={() => choose('selection')}><span className="test-number">4</span><Images /><h2>{TEST_COPY.selection.title}</h2><p>{TEST_COPY.selection.detail}</p><strong>One reference + 6 candidates</strong></button>
  </div><div className="explanation-actions"><Button variant="ghost" size="lg" onClick={() => setStage('explanation')}><ArrowLeft /> Back</Button></div></section></main>;

  if (stage === 'instructions' && studyType) return <main className="study-shell tutorial-shell"><header className="page-header"><div><span className="brand-dot" /> {TEST_COPY[studyType].title} test</div><span>{inhouse ? `Test ${inhouseTaskIndex + 1} of ${INHOUSE_STUDY_ORDER.length}` : 'Instructions'}</span></header><section className="tutorial-content task-instructions-content"><div className="tutorial-heading"><h1>{TEST_COPY[studyType].title}</h1><p>{TEST_COPY[studyType].detail}</p></div><div className="selected-test-instructions"><h2>{studyType === 'selection' ? 'Select every matching candidate' : studyType === 'sceneMatching' ? 'Track one material across two scenes' : 'Compare materials, not scenes'}</h2>{studyType === 'forcedChoice' && <p>Select the image (A or B) showing an object made of the same material as the reference image. Please note that the object shape and the illumination may be different across the images. Try to focus on the material</p>}{studyType === 'pairJudgment' && <><p>For every pair, answer all three questions:</p><ol><li>Do A and B have the same underlying material?</li><li>Which surface appears more glossy?</li><li>Which surface appears more metallic?</li></ol><p>Judge the two appearance attributes independently, even if you think the materials are probably the same. Choose “Approximately same” when neither surface appears more glossy or more metallic.</p><p>You will begin with three training examples. You must answer all three questions correctly in each example before continuing.</p></>}{studyType === 'sceneMatching' && <><p>Scene 1 contains one reference object and two contextual probes. Scene 2 contains three numbered candidates and two contextual probes made from the same respective materials as the probes in Scene 1. Find the candidate made of the same material as the reference.</p><p>You will begin with four training examples. These answers are not recorded.</p><ul><li>Only geometry or illumination changes between scenes.</li><li>The lateral probes provide additional information about that change.</li><li>Focus on material identity rather than direct pixel similarity.</li></ul></>}{studyType === 'selection' && <><p>The reference appears on the left and 6 candidates appear in a 2 × 3 grid. One or two candidates may have the same material as the reference.</p><ul><li>Select <u>up to two</u> candidates that appear to match the reference.</li><li>A highlighted border and check mark indicate selection.</li><li>Click a selected image again to deselect it.</li><li>Shape and illumination can differ substantially.</li></ul></>}</div><div className="preload-status">{preparing ? <LoaderCircle className="is-spinning" /> : prepared ? <Check /> : <CircleHelp />}<div><strong>{prepared ? 'Images ready' : preparing ? 'Preparing study images' : 'Study not ready'}</strong><span>{preparing ? 'Please wait while the images are prepared.' : prepared ? 'You can start the test.' : error}</span></div>{error && <Button variant="outline" onClick={() => void prepare(studyType)}>Try again</Button>}</div><div className="explanation-actions">{!(inhouse && inhouseTaskIndex > 0) && <Button variant="ghost" size="lg" onClick={() => setStage(assignedStudyType ? 'explanation' : 'chooser')}><ArrowLeft /> {assignedStudyType ? 'Back to guide' : 'Choose another test'}</Button>}<Button size="lg" disabled={!prepared || preparing} onClick={start}>Start test <ArrowRight /></Button></div></section></main>;

  if (stage === 'submitting') return <main className="study-shell complete-shell"><section className="complete-card submission-card">{!submissionError ? <><LoaderCircle className="submission-spinner is-spinning" /><p className="eyebrow">Saving responses</p><h1>Please wait</h1><p className="lead">{inhouse && inhouseTaskIndex < INHOUSE_STUDY_ORDER.length - 1 ? `We are securely storing test ${inhouseTaskIndex + 1} before loading the next one.` : 'We are securely storing your completed study. Do not close this page.'}</p></> : <><CircleHelp className="submission-error-icon" /><p className="eyebrow">Upload not confirmed</p><h1>Your responses are still safe in this browser</h1><p className="lead" role="alert">{submissionError}</p><p className="submission-help">Keep this page open and try the upload again. You may also download a local backup, but the study will only be marked complete after Cloudflare confirms the full response set.</p><div className="complete-actions"><Button disabled={!pendingSubmission} onClick={() => pendingSubmission && void uploadSubmission(pendingSubmission)}>Try upload again</Button><Button variant="outline" onClick={downloadCurrent}><Download /> Download backup CSV</Button></div></>}</section></main>;

  if (stage === 'screening') return <main className="study-shell complete-shell"><section className="complete-card submission-card">{!submissionError ? <><LoaderCircle className="submission-spinner is-spinning" /><p className="eyebrow">Saving responses</p><h1>Please wait</h1><p className="lead">We are recording your responses. Do not close this page.</p></> : <><CircleHelp className="submission-error-icon" /><p className="eyebrow">Upload not confirmed</p><h1>Your responses are still safe in this browser</h1><p className="lead" role="alert">{submissionError}</p><div className="complete-actions"><Button disabled={!pendingScreenOut} onClick={() => pendingScreenOut && void uploadScreenOut(pendingScreenOut)}>Try upload again</Button></div></>}</section></main>;

  if (stage === 'screened_out') return <main className="study-shell complete-shell"><section className="complete-card"><CircleHelp className="submission-error-icon" /><p className="eyebrow">Attention test failed</p><h1>You did not pass the attention test</h1><p className="lead">Your responses did not meet the study’s attention-check requirements, so you cannot continue this test. {resultStorage === 'r2' ? 'The responses completed so far have been secured in the private backup storage because the primary database was unavailable.' : 'The responses completed so far have been recorded.'}</p>{!inhouse && <ProlificOutcomeOptions url={outcomeUrl} code={outcomeCode} copied={outcomeCodeCopied} onCopy={() => void copyOutcomeCode()} />}{redirectError && !inhouse && <p className="lead" role="alert">{redirectError}</p>}{receiptId && <p className="submission-receipt"><span>{resultStorage === 'r2' ? 'Private backup receipt' : 'Screening receipt'}</span><strong>{receiptId}</strong></p>}</section></main>;

  if (stage === 'complete' && studyType) return <main className="study-shell complete-shell"><section className="complete-card"><div className="success-icon"><Check /></div><p className="eyebrow">{inhouse ? 'Study complete' : 'Test complete'}</p><h1>Thank you for taking part</h1><p className="lead">{inhouse ? 'All four tests have been completed and their responses have been stored successfully.' : directTesting ? 'Testing session complete. A local CSV has been downloaded.' : previewMode ? 'Preview session complete. A local CSV has been downloaded.' : resultStorage === 'r2' ? 'Your responses have been uploaded and confirmed in secure private backup storage because the primary database was temporarily unavailable.' : 'Your responses have been uploaded and confirmed successfully.'}</p>{!inhouse && !directTesting && !previewMode && <ProlificOutcomeOptions url={outcomeUrl} code={outcomeCode} copied={outcomeCodeCopied} onCopy={() => void copyOutcomeCode()} />}{redirectError && <p className="lead" role="alert">{redirectError}</p>}</section></main>;

  if (stage === 'training' && studyType === 'pairJudgment') return <PairTraining attempts={pairTrainingAttempts} onAttempt={recordPairTrainingAttempt} onBack={() => setStage('instructions')} onComplete={() => { setIndex(0); trialStartedAt.current = performance.now(); setStage('study'); }} />;

  if (stage === 'training' && studyType === 'sceneMatching') {
    const example = trainingExamples[trainingIndex];
    if (!example) return null;
    const compositeTraining = example.first_scene.length === 1 && example.second_scene.length === 1;
    const trainingContext = example.shared_factor === 'illumination' ? 'Objects share their geometry while the illumination changes between scenes.' : 'Geometry differs while illumination stays the same.';
    return <main className="study-shell constancy-study-shell scene-matching-study-shell training-study-shell">
      <header className="trial-header"><div><span className="brand-dot" /> {TEST_COPY.sceneMatching.title} test</div><div className="trial-header-actions"><span className="training-badge">Training</span><span>Example {trainingIndex + 1} of {trainingExamples.length}</span></div></header>
      <Progress className="study-progress" value={(trainingIndex + 1) / trainingExamples.length * 100} />
      <section className="scene-matching-layout">
        <div className="scene-matching-heading"><h1>Which object in Scene 2 has the same material as the reference R?</h1><p className="training-context">{trainingContext} <span className="training-note">This is training. Your answer here will not be included in the study data.</span></p></div>
        {compositeTraining ? <div className="composite-scenes-card">
          <div className="scene-strip scene-strip-composite"><div className="scene-strip-label"><strong>Scene 1</strong><span>Reference</span></div><CompositeSceneFigure image={example.first_scene[0]} labels={['R']} onZoom={() => setLightboxPath(example.first_scene[0].image_path)} /></div>
          <div className="scene-strip scene-strip-composite"><div className="scene-strip-label"><strong>Scene 2</strong><span>Choose one</span></div><CompositeSceneFigure image={example.second_scene[0]} labels={['1', '2', '3']} selectedOption={trainingChoice} correctOption={example.correct_option} showCorrectAnswer={trainingRevealed} onSelect={(option) => { if (!trainingRevealed) { setTrainingChoice(option); setTrainingIncorrect(false); } }} onZoom={() => setLightboxPath(example.second_scene[0].image_path)} /></div>
        </div> : <>
          <div className="scene-strip"><div className="scene-strip-label"><strong>Scene 1</strong><span>Reference objects</span></div>{example.first_scene.map((image, imageIndex) => <figure key={image.image_id} className={'scene-sample ' + ('ABCD'[imageIndex] === example.target_label ? 'is-target' : '')}><button onClick={() => setLightboxPath(image.image_path)}><ThumbnailImage path={selectionDisplayPath(image)} originalPath={image.image_path} alt={`Object ${'ABCD'[imageIndex]}`} /></button><figcaption>{'ABCD'[imageIndex]}</figcaption></figure>)}</div>
          <div className="scene-strip"><div className="scene-strip-label"><strong>Scene 2</strong><span>Choose one</span></div>{example.second_scene.map((image, imageIndex) => { const option = (imageIndex + 1) as 1 | 2 | 3 | 4; return <button key={image.image_id} className="scene-sample scene-option" data-selected={trainingChoice === option || undefined} data-correct={trainingRevealed && example.correct_option === option || undefined} aria-pressed={trainingChoice === option} disabled={trainingRevealed} onClick={() => { setTrainingChoice(option); setTrainingIncorrect(false); }}><ThumbnailImage path={selectionDisplayPath(image)} originalPath={image.image_path} alt={`Option ${option}`} /><span>{option}</span>{trainingChoice === option && <span className="candidate-check"><Check /></span>}</button>; })}</div>
        </>}
      </section>
      <footer className="constancy-actions training-constancy-actions"><Button variant="ghost" onClick={() => { if (trainingIndex === 0) setStage('instructions'); else { setTrainingIndex((value) => value - 1); setTrainingChoice(null); setTrainingRevealed(false); setTrainingIncorrect(false); } }}><ArrowLeft /> Back</Button><div className="training-footer-feedback" aria-live="polite">{trainingRevealed && <div className="training-feedback" role="status"><strong>Correct!</strong> The reference and option {example.correct_option} show the same material, even though {example.shared_factor === 'illumination' ? 'the lighting has changed.' : 'the shape has changed.'}</div>}{trainingIncorrect && <div className="training-feedback training-feedback-error" role="alert">Incorrect. Please reread the instructions and select your answer again.</div>}</div>{trainingRevealed ? <Button onClick={advanceTraining}>{trainingIndex + 1 === trainingExamples.length ? 'Begin test' : 'Next example'} <ArrowRight /></Button> : <Button disabled={trainingChoice === null} onClick={checkSceneTrainingAnswer}>Check answer <ArrowRight /></Button>}</footer>
      {lightboxPath && <button className={`image-lightbox${compositeTraining && lightboxPath === example.second_scene[0]?.image_path ? ' image-lightbox-wide' : ''}`} onClick={() => setLightboxPath('')}><img src={studyImageUrl(lightboxPath)} alt="Enlarged material" /><span>Click to close</span></button>}
    </main>;
  }
  if (stage !== 'study' || !studyType || !activeCount) return null;
  const progress = (index + 1) / activeCount * 100;
  if (studyType === 'forcedChoice' && currentForcedChoice) return <main className="study-shell constancy-study-shell"><header className="trial-header"><div><span className="brand-dot" /> {TEST_COPY.forcedChoice.title} test</div><div className="trial-header-actions"><span>Trial {index + 1} of {activeCount}</span><TestingAnswerButton visible={directTesting} ready={Boolean(testingGroundTruth)} shown={showCorrectAnswer} onToggle={() => setShowCorrectAnswer((value) => !value)} /></div></header><Progress className="study-progress" value={progress} /><section className="reference-trial-layout"><div className="reference-heading"><h1>Which image shows the same material as the reference?</h1><p>Select the image (A or B) showing an object made of the same material as the reference image. Please note that the object shape and the illumination may be different across the images. Try to focus on the material.</p></div><div className="reference-workspace"><figure className="reference-sample"><button onClick={() => setLightboxPath(currentForcedChoice.reference.image_path)}><ThumbnailImage path={currentForcedChoice.reference.image_path} alt="Reference material" /></button><figcaption>Reference</figcaption></figure><div className="candidate-grid forced-choice-grid">{currentForcedChoice.options.map((option, optionIndex) => { const label = optionIndex === 0 ? 'A' : 'B'; const selected = currentForcedChoice.selectedOption === label; return <button key={option.image_id} className="candidate-card forced-choice-card" data-selected={selected || undefined} data-correct={showCorrectAnswer && correctForcedChoice === label || undefined} aria-pressed={selected} onClick={() => setForcedChoiceTrials((all) => all.map((trial, i) => i === index ? { ...trial, selectedOption: label } : trial))}><ThumbnailImage path={option.image_path} alt={`Option ${label}`} /><span>{label}</span>{selected && <span className="candidate-check"><Check /></span>}</button>; })}</div></div></section><footer className="constancy-actions"><Button variant="ghost" disabled={!index} onClick={previous}><ArrowLeft /> Back</Button><Button disabled={!currentForcedChoice.selectedOption} onClick={nextForcedChoice}>{index === activeCount - 1 ? 'Finish test' : 'Next trial'} <ArrowRight /></Button></footer>{lightboxPath && <button className="image-lightbox" onClick={() => setLightboxPath('')}><img src={stimulusUrl(lightboxPath)} alt="Enlarged reference" /><span>Click to close</span></button>}</main>;

  if (studyType === 'sceneMatching' && currentSceneMatching) {
    const compositeScene = currentSceneMatching.first_scene.length === 1 && currentSceneMatching.second_scene.length === 1;
    return <main className="study-shell constancy-study-shell scene-matching-study-shell"><header className="trial-header"><div><span className="brand-dot" /> {TEST_COPY.sceneMatching.title} test</div><div className="trial-header-actions"><span>Trial {index + 1} of {activeCount}</span><TestingAnswerButton visible={directTesting} ready={Boolean(testingGroundTruth)} shown={showCorrectAnswer} onToggle={() => setShowCorrectAnswer((value) => !value)} /></div></header><Progress className="study-progress" value={progress} /><section className="scene-matching-layout"><div className="scene-matching-heading"><h1>Which object in Scene 2 has the same material as the reference R?</h1><p>Select which object from Scene 2 (1, 2, or 3) is made from the same material as R in Scene 1.</p></div>{compositeScene ? <div className="composite-scenes-card">
      <div className="scene-strip scene-strip-composite"><div className="scene-strip-label"><strong>Scene 1</strong><span>Reference</span></div><CompositeSceneFigure image={currentSceneMatching.first_scene[0]} labels={['R']} onZoom={() => setLightboxPath(currentSceneMatching.first_scene[0].image_path)} /></div>
      <div className="scene-strip scene-strip-composite"><div className="scene-strip-label"><strong>Scene 2</strong><span>Choose one</span></div><CompositeSceneFigure image={currentSceneMatching.second_scene[0]} labels={['1', '2', '3']} selectedOption={currentSceneMatching.selectedOption} correctOption={correctSceneMatch} showCorrectAnswer={showCorrectAnswer} onSelect={(option) => setSceneMatchingTrials((all) => all.map((trial, i) => i === index ? { ...trial, selectedOption: option } : trial))} onZoom={() => setLightboxPath(currentSceneMatching.second_scene[0].image_path)} /></div>
    </div> : <>
      <div className="scene-strip"><div className="scene-strip-label"><strong>Scene 1</strong><span>Reference objects</span></div>{currentSceneMatching.first_scene.map((image, imageIndex) => <figure key={image.image_id} className={"scene-sample " + (`${'ABCD'[imageIndex]}` === currentSceneMatching.target_label ? 'is-target' : '')}><button onClick={() => setLightboxPath(image.image_path)}><ThumbnailImage path={selectionDisplayPath(image)} originalPath={image.image_path} alt={`Object ${'ABCD'[imageIndex]}`} /></button><figcaption>{'ABCD'[imageIndex]}</figcaption></figure>)}</div>
      <div className="scene-strip"><div className="scene-strip-label"><strong>Scene 2</strong><span>Choose one</span></div>{currentSceneMatching.second_scene.map((image, imageIndex) => { const option = (imageIndex + 1) as 1 | 2 | 3 | 4; const selected = currentSceneMatching.selectedOption === option; return <button key={image.image_id} className="scene-sample scene-option" data-selected={selected || undefined} data-correct={showCorrectAnswer && correctSceneMatch === option || undefined} aria-pressed={selected} onClick={() => setSceneMatchingTrials((all) => all.map((trial, i) => i === index ? { ...trial, selectedOption: option } : trial))}><ThumbnailImage path={selectionDisplayPath(image)} originalPath={image.image_path} alt={`Option ${option}`} /><span>{option}</span>{selected && <span className="candidate-check"><Check /></span>}</button>; })}</div>
    </>}</section><footer className="constancy-actions"><Button variant="ghost" disabled={!index} onClick={previous}><ArrowLeft /> Back</Button><Button disabled={!currentSceneMatching.selectedOption} onClick={nextSceneMatching}>{index === activeCount - 1 ? 'Finish test' : 'Next trial'} <ArrowRight /></Button></footer>{lightboxPath && <button className={`image-lightbox${compositeScene && lightboxPath === currentSceneMatching.second_scene[0]?.image_path ? ' image-lightbox-wide' : ''}`} onClick={() => setLightboxPath('')}><img src={studyImageUrl(lightboxPath)} alt="Enlarged material" /><span>Click to close</span></button>}</main>;
  }

  if (studyType === 'selection' && currentSelection) return <main className="study-shell constancy-study-shell selection-study-shell"><header className="trial-header"><div><span className="brand-dot" /> {TEST_COPY.selection.title} test</div><div className="trial-header-actions"><span>Trial {index + 1} of {activeCount}</span><TestingAnswerButton visible={directTesting} ready={Boolean(testingGroundTruth)} shown={showCorrectAnswer} onToggle={() => setShowCorrectAnswer((value) => !value)} /></div></header><Progress className="study-progress" value={progress} /><section className="selection-trial-layout"><div className="selection-heading"><h1>Which candidates have the same material as the reference?</h1><p>Select all that apply. <u>You can select up to two.</u> Click a selected candidate again to deselect it.</p></div><div className="selection-workspace"><aside className="selection-reference-column"><h2>Reference</h2><figure className="selection-reference"><button onClick={() => setLightboxPath(currentSelection.reference.image_path)} aria-label="Enlarge reference image"><ThumbnailImage path={selectionDisplayPath(currentSelection.reference)} originalPath={currentSelection.reference.image_path} alt="Reference material" /></button><figcaption><ZoomIn /> Click to enlarge</figcaption></figure><div className="selection-counter"><strong>{currentSelection.selectedCandidateIds.length}</strong><span>selected</span></div></aside><div className="selection-candidate-grid" role="group" aria-label="Candidate material images">{currentSelection.candidates.map((candidate, candidateIndex) => { const selected = currentSelection.selectedCandidateIds.includes(candidate.candidate_id); return <button key={candidate.candidate_id} className="selection-candidate" data-selected={selected || undefined} data-correct={showCorrectAnswer && correctSelectionIds.has(candidate.candidate_id) || undefined} aria-pressed={selected} aria-label={`Candidate ${candidateIndex + 1}${selected ? ', selected' : ''}`} onClick={() => toggleCandidate(candidate.candidate_id)}><ThumbnailImage path={selectionDisplayPath(candidate)} originalPath={candidate.image_path} alt={`Candidate ${candidateIndex + 1}`} />{selected && <span className="candidate-check"><Check /></span>}</button>; })}</div></div></section><footer className="constancy-actions"><Button variant="ghost" disabled={!index} onClick={previous}><ArrowLeft /> Back</Button><Button onClick={nextSet}>{index === activeCount - 1 ? 'Finish test' : `Confirm ${currentSelection.selectedCandidateIds.length} selection${currentSelection.selectedCandidateIds.length === 1 ? '' : 's'}`} <ArrowRight /></Button></footer>{selectionLimitNotice && <div className="selection-limit-toast" role="status" aria-live="polite"><CircleHelp /><span>You have already selected the maximum of 2 images.</span></div>}{lightboxPath && <button className="image-lightbox" onClick={() => setLightboxPath('')}><img src={studyImageUrl(lightboxPath)} alt="Enlarged reference" /><span>Click to close</span></button>}</main>;

  if (!currentPair) return null;
  return <main className="study-shell constancy-study-shell"><header className="trial-header"><div><span className="brand-dot" /> {TEST_COPY.pairJudgment.title} test</div><div className="trial-header-actions"><span>Trial {index + 1} of {activeCount}</span><TestingAnswerButton visible={directTesting} ready={Boolean(testingGroundTruth)} shown={showCorrectAnswer} onToggle={() => setShowCorrectAnswer((value) => !value)} /></div></header><Progress className="study-progress" value={progress} /><section className="pair-trial-layout"><div className="pair-images-panel">{[{ label: 'A', path: currentPair.displayPathA }, { label: 'B', path: currentPair.displayPathB }].map((image) => <figure key={image.label}><button onClick={() => setLightboxPath(image.path)}><ThumbnailImage path={image.path} alt={`Material ${image.label}`} /></button><figcaption>{image.label}</figcaption></figure>)}<p className="zoom-reminder"><ZoomIn /> Click either image to enlarge it.</p></div><div className="pair-response-panel"><div className="ratings-title-row"><div><h1>Compare A and B</h1></div><button className="attribute-help-button" aria-expanded={showHelp} onClick={() => setShowHelp((v) => !v)}><CircleHelp /></button></div>{showHelp && <div className="inline-help-window"><p><strong>Underlying material:</strong> physical surface reflectance, independent of object shape or lighting. Note that two different materials can share a similar color or chromatic pattern while differing in glossiness or metallic appearance.</p><p><strong>Glossiness:</strong> strength and clarity of specular reflections.</p><p><strong>Metallicness:</strong> metal-like reflection structure, color tinting and bright–dark contrast.</p></div>}<fieldset className="pair-question identity-question"><legend>Do these objects have the same underlying material?</legend><RadioGroup value={currentPair.sameMaterialLikelihood?.toString() ?? ''} onValueChange={(value) => updatePair({ sameMaterialLikelihood: Number(value) })} className="identity-scale compact-identity-scale">{IDENTITY_OPTIONS.map((option) => <label className="scale-choice" data-correct={showCorrectAnswer && correctPairAnswer === option.value || undefined} key={option.value}><RadioGroupItem value={String(option.value)} /><span>{option.label}</span></label>)}</RadioGroup></fieldset><div className="pair-attributes"><RelativeQuestion attribute="more glossy" value={currentPair.glossChoice} onChange={(glossChoice) => updatePair({ glossChoice })} /><RelativeQuestion attribute="more metallic" value={currentPair.metalChoice} onChange={(metalChoice) => updatePair({ metalChoice })} /></div></div></section><footer className="constancy-actions"><Button variant="ghost" disabled={!index} onClick={previous}><ArrowLeft /> Back</Button><Button disabled={!pairComplete} onClick={nextPair}>{index === activeCount - 1 ? 'Finish test' : 'Next trial'} <ArrowRight /></Button></footer>{lightboxPath && <button className="image-lightbox" onClick={() => setLightboxPath('')}><img src={stimulusUrl(lightboxPath)} alt="Enlarged material" /><span>Click to close</span></button>}</main>;
}
