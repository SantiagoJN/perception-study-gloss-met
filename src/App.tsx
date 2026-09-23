'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Download,
  Eye,
  FlaskConical,
  LoaderCircle,
  Monitor,
  ZoomIn,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  claimConstancySession,
  submitConstancySession,
  type ClaimedSession,
  type PairAssignment,
  type ProlificIdentifiers,
  type ReferenceAssignment,
} from '@/supabase';

const PAIR_TRIALS_PER_SESSION = 40;
const REFERENCE_TRIALS_PER_SESSION = 20;
const TEST_PAIR_TRIALS = 4;
const TEST_REFERENCE_TRIALS = 2;
const ASSET_BASE = import.meta.env.BASE_URL;

type Stage = 'welcome' | 'demographics' | 'tutorial' | 'study' | 'complete';
type RelativeChoice = 'a' | 'same' | 'b' | '';

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: () => unknown;
    },
    options?: { signal: AbortSignal },
  ) => void | Promise<void>;
};

type Demographics = {
  gender: string;
  genderOther: string;
  age: string;
  computerGraphicsKnowledge: string;
  designModelingExperience: string;
  artisticExperience: string;
};

type PairTrial = {
  type: 'pair';
  pairId: string;
  canonicalPathA: string;
  canonicalPathB: string;
  displayPathA: string;
  displayPathB: string;
  swapped: boolean;
  sameMaterialLikelihood: number | null;
  glossChoice: RelativeChoice;
  metalChoice: RelativeChoice;
  responseTimeMs?: number;
};

type ReferenceTrial = {
  type: 'reference';
  referenceId: string;
  referencePath: string;
  candidateOrder: string[];
  selectedCandidatePath: string;
  responseTimeMs?: number;
};

type Trial = PairTrial | ReferenceTrial;

type PreviewManifest = {
  pairs: Array<{
    pair_id: string;
    image_path_a: string;
    image_path_b: string;
  }>;
  references: Array<{
    reference_id: string;
    reference_path: string;
    candidate_paths: string[];
  }>;
};

const EMPTY_DEMOGRAPHICS: Demographics = {
  gender: '',
  genderOther: '',
  age: '',
  computerGraphicsKnowledge: '',
  designModelingExperience: '',
  artisticExperience: '',
};

const EXPERIENCE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'basic', label: 'Basic' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'professional', label: 'Professional' },
];

const IDENTITY_OPTIONS = [
  { value: 1, label: 'Definitely same' },
  { value: 2, label: 'Probably same' },
  { value: 3, label: 'Unsure' },
  { value: 4, label: 'Probably different' },
  { value: 5, label: 'Definitely different' },
];

function shuffle<T>(items: T[]) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}

function assetUrl(path: string) {
  return ASSET_BASE + path.replace(/^\/+/, '');
}

function encodeAssetPath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function stimulusUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = window.USER_STUDY_CONFIG?.stimulusBaseUrl
    ?.trim()
    .replace(/\/$/, '');
  if (!base) return assetUrl(encodeAssetPath(path));
  return `${base}/${encodeAssetPath(path)}`;
}

function createAnonymousId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readStudyMetadata(): ProlificIdentifiers {
  const params = new URLSearchParams(window.location.search);
  const participantId = params.get('PROLIFIC_PID')?.trim();
  const sessionId = params.get('SESSION_ID')?.trim();
  if (participantId && sessionId) {
    return {
      participantId,
      studyId: params.get('STUDY_ID')?.trim() || 'prolific-study',
      sessionId,
    };
  }
  const key = 'material-constancy-direct-session';
  let directId = sessionStorage.getItem(key);
  if (!directId) {
    directId = createAnonymousId();
    sessionStorage.setItem(key, directId);
  }
  return {
    participantId: `direct-${directId}`,
    studyId: 'direct-web',
    sessionId: directId,
  };
}

async function preloadImages(urls: string[], onProgress: (count: number) => void) {
  const unique = [...new Set(urls)];
  let next = 0;
  let loaded = 0;
  const workers = Array.from({ length: Math.min(8, unique.length) }, async () => {
    while (next < unique.length) {
      const url = unique[next];
      next += 1;
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Could not preload ${url}`));
        image.src = url;
      });
      loaded += 1;
      onProgress(loaded);
    }
  });
  await Promise.all(workers);
  return unique.length;
}

function pairTrialFromAssignment(item: PairAssignment): PairTrial {
  const swapped = item.swap_ab;
  return {
    type: 'pair',
    pairId: item.pair_id,
    canonicalPathA: item.image_path_a,
    canonicalPathB: item.image_path_b,
    displayPathA: swapped ? item.image_path_b : item.image_path_a,
    displayPathB: swapped ? item.image_path_a : item.image_path_b,
    swapped,
    sameMaterialLikelihood: null,
    glossChoice: '',
    metalChoice: '',
  };
}

function referenceTrialFromAssignment(item: ReferenceAssignment): ReferenceTrial {
  return {
    type: 'reference',
    referenceId: item.reference_id,
    referencePath: item.reference_path,
    candidateOrder: item.candidate_order,
    selectedCandidatePath: '',
  };
}

function buildTrials(claimed: ClaimedSession) {
  return shuffle([
    ...shuffle(claimed.pair_trials).map(pairTrialFromAssignment),
    ...shuffle(claimed.reference_trials).map(referenceTrialFromAssignment),
  ]);
}

function DemographicChoice({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="demographic-field">
      <legend>{legend}</legend>
      <RadioGroup
        aria-label={legend}
        value={value}
        onValueChange={onChange}
        className="demographic-options"
      >
        {options.map((option) => (
          <label key={option.value} className="demographic-option">
            <RadioGroupItem value={option.value} />
            <span>{option.label}</span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

function RelativeQuestion({
  attribute,
  value,
  onChange,
}: {
  attribute: 'glossier' | 'more metallic';
  value: RelativeChoice;
  onChange: (value: RelativeChoice) => void;
}) {
  return (
    <fieldset className="pair-question">
      <legend>
        Which surface appears <strong>{attribute}</strong>?
      </legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as RelativeChoice)}
        className="three-choice-scale"
        aria-label={`Which surface appears ${attribute}?`}
      >
        {[
          { value: 'a', label: 'A' },
          { value: 'same', label: 'Approximately same' },
          { value: 'b', label: 'B' },
        ].map((option) => (
          <label className="scale-choice" key={option.value}>
            <RadioGroupItem value={option.value} />
            <span>{option.label}</span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

function downloadTestingData(
  trials: Trial[],
  demographics: Demographics,
  metadata: ProlificIdentifiers,
) {
  const payload = {
    metadata,
    demographics,
    completedAt: new Date().toISOString(),
    trials,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'material-constancy-test.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [stage, setStage] = useState<Stage>('welcome');
  const [consented, setConsented] = useState(false);
  const [testingMode, setTestingMode] = useState(false);
  const [demographics, setDemographics] = useState(EMPTY_DEMOGRAPHICS);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [index, setIndex] = useState(0);
  const [studySessionId, setStudySessionId] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [preloaded, setPreloaded] = useState(0);
  const [preloadTotal, setPreloadTotal] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [lightboxPath, setLightboxPath] = useState('');
  const metadata = useMemo(readStudyMetadata, []);
  const trialStartedAt = useRef(0);
  const preparationRun = useRef(0);

  const age = Number(demographics.age);
  const demographicsComplete = Boolean(
    demographics.gender &&
      (demographics.gender !== 'other' || demographics.genderOther.trim()) &&
      Number.isInteger(age) &&
      age >= 18 &&
      age <= 100 &&
      demographics.computerGraphicsKnowledge &&
      demographics.designModelingExperience &&
      demographics.artisticExperience,
  );
  const expectedTrials = testingMode
    ? TEST_PAIR_TRIALS + TEST_REFERENCE_TRIALS
    : PAIR_TRIALS_PER_SESSION + REFERENCE_TRIALS_PER_SESSION;
  const current = trials[index];
  const currentComplete = current
    ? current.type === 'pair'
      ? current.sameMaterialLikelihood !== null &&
        current.glossChoice !== '' &&
        current.metalChoice !== ''
      : Boolean(current.selectedCandidatePath)
    : false;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  useEffect(() => {
    if (!lightboxPath) return;
    const previous = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxPath('');
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [lightboxPath]);

  async function prepareStudy() {
    const run = preparationRun.current + 1;
    preparationRun.current = run;
    setPreparing(true);
    setPrepared(false);
    setError('');
    setPreloaded(0);
    try {
      let claimed: ClaimedSession;
      if (testingMode) {
        const response = await fetch(assetUrl('constancy_preview.json'));
        if (!response.ok) throw new Error('Preview manifest unavailable.');
        const preview = (await response.json()) as PreviewManifest;
        claimed = {
          study_session_id: 'testing',
          pair_trials: preview.pairs.slice(0, TEST_PAIR_TRIALS).map((pair, trial) => ({
            pair_id: pair.pair_id,
            trial_number: trial + 1,
            swap_ab: Math.random() < 0.5,
            image_path_a: pair.image_path_a,
            image_path_b: pair.image_path_b,
          })),
          reference_trials: preview.references
            .slice(0, TEST_REFERENCE_TRIALS)
            .map((reference, trial) => ({
              reference_id: reference.reference_id,
              reference_path: reference.reference_path,
              candidate_order: shuffle(reference.candidate_paths),
              trial_number: trial + 1,
            })),
        };
      } else {
        claimed = await claimConstancySession(metadata, {
          gender: demographics.gender,
          gender_other:
            demographics.gender === 'other'
              ? demographics.genderOther.trim()
              : null,
          age,
          computer_graphics_knowledge: demographics.computerGraphicsKnowledge,
          design_modeling_experience: demographics.designModelingExperience,
          artistic_experience: demographics.artisticExperience,
        });
      }
      if (
        claimed.pair_trials.length !== (testingMode ? TEST_PAIR_TRIALS : PAIR_TRIALS_PER_SESSION) ||
        claimed.reference_trials.length !==
          (testingMode ? TEST_REFERENCE_TRIALS : REFERENCE_TRIALS_PER_SESSION)
      ) {
        throw new Error('The server returned an incomplete assignment.');
      }
      const nextTrials = buildTrials(claimed);
      const urls = nextTrials.flatMap((trial) =>
        trial.type === 'pair'
          ? [stimulusUrl(trial.displayPathA), stimulusUrl(trial.displayPathB)]
          : [stimulusUrl(trial.referencePath), ...trial.candidateOrder.map(stimulusUrl)],
      );
      setPreloadTotal(new Set(urls).size);
      await preloadImages(urls, (count) => {
        if (preparationRun.current === run) setPreloaded(count);
      });
      if (preparationRun.current !== run) return;
      setTrials(nextTrials);
      setStudySessionId(claimed.study_session_id);
      setPrepared(true);
    } catch (cause) {
      if (preparationRun.current !== run) return;
      setError(cause instanceof Error ? cause.message : 'The study could not be prepared.');
    } finally {
      if (preparationRun.current === run) setPreparing(false);
    }
  }

  function openTutorial() {
    if (!demographicsComplete) return;
    setStage('tutorial');
    void prepareStudy();
  }

  function startStudy() {
    if (!prepared) return;
    setIndex(0);
    trialStartedAt.current = performance.now();
    setStage('study');
  }

  function updateCurrent(update: Partial<PairTrial> | Partial<ReferenceTrial>) {
    setTrials((previous) =>
      previous.map((trial, trialIndex) =>
        trialIndex === index ? ({ ...trial, ...update } as Trial) : trial,
      ),
    );
  }

  function canonicalRelative(choice: RelativeChoice, swapped: boolean) {
    if (choice === 'same') return 0;
    if (choice === 'a') return swapped ? 1 : -1;
    return swapped ? -1 : 1;
  }

  async function finishStudy(completedTrials: Trial[]) {
    if (testingMode) {
      localStorage.setItem('material-constancy-last-test', JSON.stringify(completedTrials));
      setStage('complete');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await submitConstancySession(
        studySessionId,
        metadata.participantId,
        completedTrials
          .filter((trial): trial is PairTrial => trial.type === 'pair')
          .map((trial) => ({
            pair_id: trial.pairId,
            same_material_likelihood: trial.sameMaterialLikelihood!,
            relative_glossiness: canonicalRelative(trial.glossChoice, trial.swapped),
            relative_metallicness: canonicalRelative(trial.metalChoice, trial.swapped),
            response_time_ms: trial.responseTimeMs ?? 0,
          })),
        completedTrials
          .filter((trial): trial is ReferenceTrial => trial.type === 'reference')
          .map((trial) => ({
            reference_id: trial.referenceId,
            candidate_order: trial.candidateOrder,
            selected_candidate_path: trial.selectedCandidatePath,
            response_time_ms: trial.responseTimeMs ?? 0,
          })),
      );
      setStage('complete');
    } catch {
      setError('Your responses could not be saved. Please try again without closing this page.');
    } finally {
      setSubmitting(false);
    }
  }

  function continueStudy() {
    if (!currentComplete || submitting) return;
    const elapsed = Math.round(performance.now() - trialStartedAt.current);
    const completedTrials = trials.map((trial, trialIndex) =>
      trialIndex === index ? { ...trial, responseTimeMs: elapsed } : trial,
    );
    setTrials(completedTrials);
    setShowHelp(false);
    if (index === completedTrials.length - 1) {
      void finishStudy(completedTrials);
      return;
    }
    setIndex((previous) => previous + 1);
    trialStartedAt.current = performance.now();
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: 'read_constancy_study_status',
          title: 'Read material constancy study status',
          description: 'Read the visible stage and progress without changing any response.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute: () => ({
            stage,
            currentTrial: stage === 'study' ? index + 1 : null,
            totalTrials: expectedTrials,
            imagesReady: prepared,
            testingMode,
          }),
        },
        { signal: lifecycle.signal },
      );
      await context.registerTool(
        {
          name: 'continue_constancy_study',
          title: 'Continue material constancy study',
          description: 'Continue from consent, demographics, or instructions when requirements are met.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: () => {
            if (stage === 'welcome') {
              if (!consented) throw new Error('Consent must be accepted before continuing.');
              setStage('demographics');
              return { stage: 'demographics' };
            }
            if (stage === 'demographics') {
              if (!demographicsComplete) {
                throw new Error('The demographic questionnaire must be completed manually.');
              }
              openTutorial();
              return { stage: 'tutorial' };
            }
            if (stage === 'tutorial') {
              if (!prepared) throw new Error('The study images are still loading.');
              startStudy();
              return { stage: 'study', totalTrials: expectedTrials };
            }
            throw new Error('The study cannot be continued from the current stage.');
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [consented, demographicsComplete, expectedTrials, index, prepared, stage, testingMode]);

  if (stage === 'welcome') {
    return (
      <main className="study-shell welcome-shell">
        <section className="welcome-card" aria-labelledby="study-title">
          <div className="study-mark" aria-hidden="true"><span /><span /><span /></div>
          <h1 id="study-title">Visual Perception Study</h1>
          <p className="lead">Thank you for taking part in this user study.</p>

          <div className="attention-callout">
            <Eye aria-hidden="true" />
            <div>
              <h2>Please read carefully and stay attentive</h2>
              <p>
                You will compare surface materials across changes in shape and
                illumination. Base every response on your visual impression.
              </p>
            </div>
          </div>

          <div className="study-facts">
            <div><strong className="fact-value">≈ 25 min</strong><span className="fact-label">Estimated time</span></div>
            <div><strong className="fact-value">{expectedTrials}</strong><span className="fact-label">Comparisons</span></div>
            <div><Monitor aria-hidden="true" /><span className="fact-label">Desktop or laptop</span></div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="testing-toggle"
            aria-pressed={testingMode}
            onClick={() => setTestingMode((value) => !value)}
          >
            <FlaskConical aria-hidden="true" /> Testing
            <span>{testingMode ? 'On' : 'Off'}</span>
          </Button>

          <div className="instructions compact-instructions">
            <h2>Before you begin</h2>
            <ul>
              <li>Use a desktop or laptop in a normally lit room.</li>
              <li>Set your screen to a comfortable, clearly visible brightness.</li>
              <li>Do not refresh or close the page while completing the study.</li>
              <li>Click any image to enlarge it; click again to return.</li>
              <li>Some questions have objectively verifiable answers and help detect inattentive responding.</li>
              <li>Feature descriptions are available from the <CircleHelp className="inline-info-icon" aria-label="Information" /> icon during pair comparisons.</li>
            </ul>
          </div>

          <label className="consent-row" htmlFor="study-consent">
            <Checkbox
              id="study-consent"
              checked={consented}
              onCheckedChange={(checked) => setConsented(checked === true)}
            />
            <span>
              I voluntarily agree to participate. I understand that the data
              collected will be anonymized and used as part of an academic study.
            </span>
          </label>
          <Button className="primary-action" size="lg" disabled={!consented} onClick={() => setStage('demographics')}>
            Continue <ArrowRight data-icon="inline-end" />
          </Button>
        </section>
      </main>
    );
  }

  if (stage === 'demographics') {
    return (
      <main className="study-shell demographics-shell">
        <section className="welcome-card demographics-card" aria-labelledby="demographics-title">
          <p className="eyebrow">About you</p>
          <h1 id="demographics-title">Demographic information</h1>
          <p className="lead">These responses are stored without your name and used only for academic analysis.</p>
          <div className="demographics-form">
            <DemographicChoice
              legend="Gender"
              value={demographics.gender}
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
                { value: 'other', label: 'Other (specify)' },
                { value: 'prefer_not_to_answer', label: 'Prefer not to answer' },
              ]}
              onChange={(gender) => setDemographics((current) => ({ ...current, gender }))}
            />
            {demographics.gender === 'other' ? (
              <label className="demographic-text-field">
                <span>Please specify</span>
                <input
                  value={demographics.genderOther}
                  maxLength={80}
                  onChange={(event) => setDemographics((current) => ({ ...current, genderOther: event.target.value }))}
                />
              </label>
            ) : null}
            <label className="demographic-text-field age-field">
              <span>Age</span>
              <input
                type="number"
                min="18"
                max="100"
                value={demographics.age}
                onChange={(event) => setDemographics((current) => ({ ...current, age: event.target.value }))}
              />
              <small>Enter an age between 18 and 100.</small>
            </label>
            <DemographicChoice
              legend="Knowledge of computer graphics"
              value={demographics.computerGraphicsKnowledge}
              options={EXPERIENCE_OPTIONS}
              onChange={(value) => setDemographics((current) => ({ ...current, computerGraphicsKnowledge: value }))}
            />
            <DemographicChoice
              legend="Experience with design or 3D modeling software"
              value={demographics.designModelingExperience}
              options={EXPERIENCE_OPTIONS}
              onChange={(value) => setDemographics((current) => ({ ...current, designModelingExperience: value }))}
            />
            <DemographicChoice
              legend="Artistic experience or knowledge"
              value={demographics.artisticExperience}
              options={EXPERIENCE_OPTIONS}
              onChange={(value) => setDemographics((current) => ({ ...current, artisticExperience: value }))}
            />
          </div>
          <div className="demographics-actions">
            <Button variant="ghost" size="lg" onClick={() => setStage('welcome')}><ArrowLeft /> Back</Button>
            <Button size="lg" disabled={!demographicsComplete} onClick={openTutorial}>
              Continue to instructions <ArrowRight />
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'tutorial') {
    return (
      <main className="study-shell tutorial-shell">
        <header className="page-header"><div><span className="brand-dot" /> Material constancy</div><span>Instructions</span></header>
        <section className="tutorial-content">
          <div className="tutorial-heading">
            <p className="eyebrow">What you will judge</p>
            <h1>Compare materials, not scenes</h1>
            <p>Shape and illumination may change. Focus on the surface material covering each object.</p>
          </div>
          <div className="task-guide-grid">
            <article className="task-guide-card">
              <span>1</span><h2>Material identity</h2>
              <p>Judge how likely it is that objects A and B have exactly the same underlying surface material.</p>
              <strong>Definitely same → Definitely different</strong>
            </article>
            <article className="task-guide-card">
              <span>2</span><h2>Relative appearance</h2>
              <p>Compare their visible glossiness and metallicness, even if you think the underlying material is the same.</p>
              <strong>A → Approximately same → B</strong>
            </article>
            <article className="task-guide-card">
              <span>3</span><h2>Reference selection</h2>
              <p>Select which of four candidates has the same underlying material as the reference. All candidates share one scene condition.</p>
              <strong>One candidate is physically correct</strong>
            </article>
          </div>
          <div className="feature-definitions">
            <div><strong>Glossiness</strong><p>Look for specular highlights and recognizable or blurred reflections. Do not equate glossiness with overall brightness.</p></div>
            <div><strong>Metallicness</strong><p>Look for strong bright–dark contrast and reflections tinted by the surface colour. A surface can be glossy without being metallic.</p></div>
          </div>
          <div className="preload-status">
            {preparing ? <LoaderCircle className="is-spinning" /> : prepared ? <Check /> : <CircleHelp />}
            <div>
              <strong>{prepared ? 'Images ready' : preparing ? 'Preparing study images' : 'Study not ready'}</strong>
              <span>{preparing ? `${preloaded} of ${preloadTotal || '…'} unique images loaded` : prepared ? `${expectedTrials} trials prepared` : error}</span>
            </div>
            {error ? <Button variant="outline" onClick={() => void prepareStudy()}>Try again</Button> : null}
          </div>
          <div className="explanation-actions">
            <Button variant="ghost" size="lg" onClick={() => setStage('demographics')}><ArrowLeft /> Back</Button>
            <Button size="lg" disabled={!prepared || preparing} onClick={startStudy}>Start study <ArrowRight /></Button>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'complete') {
    return (
      <main className="study-shell complete-shell">
        <section className="complete-card">
          <div className="success-icon"><Check /></div>
          <p className="eyebrow">Study complete</p>
          <h1>Thank you for taking part</h1>
          <p className="lead">Your responses have been recorded.</p>
          {testingMode ? (
            <div className="complete-actions">
              <Button onClick={() => downloadTestingData(trials, demographics, metadata)}><Download /> Download test data</Button>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  if (!current) return null;
  const progress = ((index + 1) / trials.length) * 100;

  return (
    <main className="study-shell constancy-study-shell">
      <header className="trial-header">
        <div><span className="brand-dot" /> Material constancy</div>
        <span>Trial {index + 1} of {trials.length}</span>
      </header>
      <Progress className="study-progress" value={progress} />

      {current.type === 'pair' ? (
        <section className="pair-trial-layout">
          <div className="pair-images-panel">
            {[
              { label: 'A', path: current.displayPathA },
              { label: 'B', path: current.displayPathB },
            ].map((image) => (
              <figure key={image.label}>
                <button type="button" onClick={() => setLightboxPath(image.path)} aria-label={`Enlarge image ${image.label}`}>
                  <img src={stimulusUrl(image.path)} alt={`Material ${image.label}`} />
                </button>
                <figcaption>{image.label}</figcaption>
              </figure>
            ))}
            <p className="zoom-reminder"><ZoomIn /> Click either image to enlarge it.</p>
          </div>
          <div className="pair-response-panel">
            <div className="ratings-title-row">
              <div><p className="eyebrow">Pair comparison</p><h1>Compare A and B</h1></div>
              <button className="attribute-help-button" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}><CircleHelp /></button>
            </div>
            {showHelp ? (
              <div className="inline-help-window">
                <p><strong>Underlying material:</strong> the physical surface reflectance, independent of object shape or lighting.</p>
                <p><strong>Glossiness:</strong> strength and clarity of specular reflections.</p>
                <p><strong>Metallicness:</strong> metal-like reflection structure, colour tinting and bright–dark contrast.</p>
              </div>
            ) : null}
            <fieldset className="pair-question identity-question">
              <legend>How likely is it that these objects have exactly the same underlying surface material?</legend>
              <RadioGroup
                value={current.sameMaterialLikelihood?.toString() ?? ''}
                onValueChange={(value) => updateCurrent({ sameMaterialLikelihood: Number(value) })}
                className="identity-scale"
              >
                {IDENTITY_OPTIONS.map((option) => (
                  <label className="scale-choice" key={option.value}>
                    <RadioGroupItem value={option.value.toString()} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            <RelativeQuestion attribute="glossier" value={current.glossChoice} onChange={(glossChoice) => updateCurrent({ glossChoice })} />
            <RelativeQuestion attribute="more metallic" value={current.metalChoice} onChange={(metalChoice) => updateCurrent({ metalChoice })} />
          </div>
        </section>
      ) : (
        <section className="reference-trial-layout">
          <div className="reference-heading">
            <p className="eyebrow">Reference selection</p>
            <h1>Which candidate has the same underlying material?</h1>
            <p>Ignore differences caused by shape and illumination.</p>
          </div>
          <div className="reference-workspace">
            <figure className="reference-sample">
              <button type="button" onClick={() => setLightboxPath(current.referencePath)}>
                <img src={stimulusUrl(current.referencePath)} alt="Reference material" />
              </button>
              <figcaption>Reference</figcaption>
            </figure>
            <div className="candidate-grid" role="radiogroup" aria-label="Candidate materials">
              {current.candidateOrder.map((path, candidateIndex) => (
                <label className="candidate-card" key={path} data-selected={current.selectedCandidatePath === path || undefined}>
                  <input
                    type="radio"
                    name="reference-candidate"
                    value={path}
                    checked={current.selectedCandidatePath === path}
                    onChange={() => updateCurrent({ selectedCandidatePath: path })}
                  />
                  <button type="button" tabIndex={-1} onClick={(event) => { event.preventDefault(); setLightboxPath(path); }}>
                    <img src={stimulusUrl(path)} alt={`Candidate ${candidateIndex + 1}`} />
                  </button>
                  <span>Candidate {candidateIndex + 1}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer className="constancy-actions">
        <Button
          variant="ghost"
          disabled={index === 0 || submitting}
          onClick={() => {
            setIndex((value) => value - 1);
            setShowHelp(false);
            trialStartedAt.current = performance.now();
          }}
        >
          <ArrowLeft /> Back
        </Button>
        <div>
          {error ? <p className="form-error">{error}</p> : null}
          <Button disabled={!currentComplete || submitting} onClick={continueStudy}>
            {submitting ? 'Saving…' : index === trials.length - 1 ? 'Submit responses' : 'Next trial'} <ArrowRight />
          </Button>
        </div>
      </footer>

      {lightboxPath ? (
        <button className="image-lightbox" onClick={() => setLightboxPath('')} aria-label="Close enlarged image">
          <img src={stimulusUrl(lightboxPath)} alt="Enlarged material" />
          <span>Click to close</span>
        </button>
      ) : null}
    </main>
  );
}
