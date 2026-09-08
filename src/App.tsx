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
  Minimize2,
  Monitor,
  RotateCcw,
  ZoomIn,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MAIN_RATINGS_PER_SESSION } from '@/study-config';
import {
  claimStudyAssignment,
  submitStudySession,
} from '@/supabase';

const BASE_STIMULI = [
  'Ceramic__0330_marble_wall_01.png',
  'Ceramic__0974_arcane_arabesque_patterns.png',
  'Ceramic__cgbc_blue_tiles_001.png',
  'Ceramic__tc_tiles_085.png',
  'Fabric__0265_fabric_padded_wall.png',
  'Fabric__0266_fabric_padded_wall.png',
  'Fabric__acg_fabric_058.png',
  'Fabric__js_fabric_pattern_006.png',
  'Metal__0361_metal_brushed_copper.png',
  'Metal__acg_metal_016.png',
  'Metal__cgbc_metal_weave_002.png',
];

const STUDY_TRIAL_COUNT = MAIN_RATINGS_PER_SESSION;
const STIMULI = Array.from(
  { length: STUDY_TRIAL_COUNT },
  (_, index) => BASE_STIMULI[index % BASE_STIMULI.length],
);

const TRAINING_STIMULI = [
  'g0m0_[3_3_ninomaru_teien_2k_shift_200][sphere][MERL_EDIT-beige-fabric_hue_0_sat_1_spec_1].jpg',
  'g0m1_[3_3_ninomaru_teien_2k_shift_200][sphere][MERL-blue-metallic-paint].jpg',
  'g1m0_[3_3_ninomaru_teien_2k_shift_200][sphere][MERL_EDIT-beige-fabric_diff_mix_white-paint_spec_hue_0_sat_1_spec_0].jpg',
  'g1m1_[3_3_ninomaru_teien_2k_shift_200][sphere][RGL-chm_orange_rgb].jpg',
];
const TESTING_TRIAL_COUNT = 10;

const SCALE = [1, 2, 3, 4, 5, 6, 7];
const COMPLETION_CODE = 'PREVIEW';
const ASSET_BASE = import.meta.env.BASE_URL;

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

function studyImageUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = window.USER_STUDY_CONFIG?.stimulusBaseUrl
    ?.trim()
    .replace(/\/$/, '');
  if (baseUrl) {
    const relativePath = path.replace(/^\/+/, '').replace(/^stimuli\//, '');
    return baseUrl + '/' + encodeAssetPath(relativePath);
  }
  const relativePath = path.startsWith('stimuli/') ? path : 'stimuli/' + path;
  return assetUrl(encodeAssetPath(relativePath));
}

async function preloadImages(
  urls: string[],
  onProgress: (loaded: number) => void,
) {
  let nextIndex = 0;
  let loaded = 0;
  const workerCount = Math.min(6, urls.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < urls.length) {
      const url = urls[nextIndex];
      nextIndex += 1;
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Image preload failed'));
        image.src = url;
      });
      loaded += 1;
      onProgress(loaded);
    }
  });
  await Promise.all(workers);
}

type Attribute = 'glossiness' | 'metallicness';
type Stage =
  | 'welcome'
  | 'explanation'
  | 'training'
  | 'study'
  | 'complete';
type Phase = 'training' | 'study';

type Rating = {
  stimulus: string;
  stimulusId?: number;
  imagePath?: string;
  phase: Phase;
  trialNumber: number;
  glossiness: number | null;
  metallicness: number | null;
  responseTimeMs?: number;
};

function ratingImageUrl(rating: Rating) {
  if (rating.phase === 'training') {
    return assetUrl('training/' + encodeAssetPath(rating.stimulus));
  }
  if (rating.stimulusId !== undefined && rating.imagePath) {
    return studyImageUrl(rating.imagePath);
  }
  return assetUrl('stimuli/' + encodeAssetPath(rating.stimulus));
}

type ProlificMeta = {
  participantId: string;
  studyId: string;
  sessionId: string;
};

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

const ATTRIBUTE_COPY: Record<
  Attribute,
  { question: string; emphasis: string; left: string; right: string }
> = {
  glossiness: {
    question: 'How glossy does the material appear?',
    emphasis: 'glossy',
    left: '1 · Not glossy at all',
    right: '7 · Extremely glossy',
  },
  metallicness: {
    question: 'How metallic does the material appear?',
    emphasis: 'metallic',
    left: '1 · Not metallic at all',
    right: '7 · Extremely metallic',
  },
};

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function makeRatings(stimuli: string[], phase: Phase): Rating[] {
  return stimuli.map((stimulus, trialIndex) => ({
    stimulus,
    phase,
    trialNumber: trialIndex + 1,
    glossiness: null,
    metallicness: null,
  }));
}

function ScaleQuestion({
  attribute,
  value,
  onChange,
}: {
  attribute: Attribute;
  value: number | null;
  onChange: (value: number) => void;
}) {
  const copy = ATTRIBUTE_COPY[attribute];
  const [beforeEmphasis, afterEmphasis] = copy.question.split(copy.emphasis);
  return (
    <fieldset className="rating-question">
      <legend>
        {beforeEmphasis}
        <span className="attribute-term">{copy.emphasis}</span>
        {afterEmphasis}
      </legend>
      <RadioGroup
        aria-label={copy.question}
        value={value?.toString() ?? ''}
        onValueChange={(nextValue) => onChange(Number(nextValue))}
        className="rating-scale"
      >
        {SCALE.map((point) => (
          <label key={point} className="rating-option">
            <RadioGroupItem
              value={point.toString()}
              aria-label={point + ' out of 7'}
            />
            <span>{point}</span>
          </label>
        ))}
      </RadioGroup>
      <div className="scale-labels" aria-hidden="true">
        <span>{copy.left}</span>
        <span>{copy.right}</span>
      </div>
    </fieldset>
  );
}

function ExamplePair({
  attribute,
  description,
  lowImage,
  highImage,
  cue,
}: {
  attribute: string;
  description: string;
  lowImage: string;
  highImage: string;
  cue: string;
}) {
  return (
    <article className="attribute-card">
      <div className="attribute-copy">
        <p className="eyebrow">Visual attribute</p>
        <h2>{attribute}</h2>
        <p>{description}</p>
        <p className="cue">
          <Eye aria-hidden="true" />
          <span>
            <strong>Look for:</strong> {cue}
          </span>
        </p>
      </div>
      <div className="example-comparison">
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lowImage}
            alt={'Example with low ' + attribute.toLowerCase()}
          />
          <figcaption><span>1</span> Low</figcaption>
        </figure>
        <div className="comparison-arrow" aria-hidden="true"><ArrowRight /></div>
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={highImage}
            alt={'Example with high ' + attribute.toLowerCase()}
          />
          <figcaption><span>7</span> High</figcaption>
        </figure>
      </div>
    </article>
  );
}

function downloadResults(
  trainingRatings: Rating[],
  studyRatings: Rating[],
  meta: ProlificMeta,
  attributeOrder: Attribute[],
) {
  const completedAt = new Date().toISOString();
  const glossinessFirst = attributeOrder[0] === 'glossiness';
  const header = [
    'participant_id',
    'study_id',
    'session_id',
    'phase',
    'trial_number',
    'stimulus',
    'glossiness',
    'metallicness',
    'attribute_order',
    'glossiness_first',
    'response_time_ms',
    'completed_at',
  ];
  const rows = [...trainingRatings, ...studyRatings].map((rating) =>
    [
      meta.participantId || 'preview',
      meta.studyId || 'preview',
      meta.sessionId || 'preview',
      rating.phase,
      rating.trialNumber,
      rating.stimulus,
      rating.glossiness,
      rating.metallicness,
      attributeOrder[0] + '_then_' + attributeOrder[1],
      glossinessFirst,
      rating.responseTimeMs,
      completedAt,
    ]
      .map((cell) => '"' + String(cell ?? '').replaceAll('"', '""') + '"')
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...rows].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    'material-ratings-' + (meta.participantId || 'preview') + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Home() {
  const [stage, setStage] = useState<Stage>('welcome');
  const [consented, setConsented] = useState(false);
  const [examplesRevealed, setExamplesRevealed] = useState(false);
  const [attributeOrder, setAttributeOrder] = useState<Attribute[]>([]);
  const [trainingRatings, setTrainingRatings] = useState<Rating[]>([]);
  const [studyRatings, setStudyRatings] = useState<Rating[]>([]);
  const [index, setIndex] = useState(0);
  const [showAttributeHelp, setShowAttributeHelp] = useState(false);
  const [expandedImage, setExpandedImage] = useState(false);
  const [testingMode, setTestingMode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [studyPrepared, setStudyPrepared] = useState(false);
  const [preloadedCount, setPreloadedCount] = useState(0);
  const [preloadTotal, setPreloadTotal] = useState(0);
  const [startError, setStartError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [remoteSessionId, setRemoteSessionId] = useState('');
  const [savedRemotely, setSavedRemotely] = useState(false);
  const [meta, setMeta] = useState<ProlificMeta>({
    participantId: '',
    studyId: '',
    sessionId: '',
  });
  const trialStartedAt = useRef(0);
  const preloadRun = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => {
      setMeta({
        participantId: params.get('PROLIFIC_PID') ?? '',
        studyId: params.get('STUDY_ID') ?? '',
        sessionId: params.get('SESSION_ID') ?? '',
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!expandedImage) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedImage(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expandedImage]);

  const isTraining = stage === 'training';
  const activeRatings = isTraining ? trainingRatings : studyRatings;
  const current = activeRatings[index];
  const completedInPhase = activeRatings.filter(
    (rating) =>
      rating.glossiness !== null && rating.metallicness !== null,
  ).length;
  const canContinue = Boolean(
    current &&
      current.glossiness !== null &&
      current.metallicness !== null,
  );
  const isPreview = !meta.participantId;
  const mainTrialCount = testingMode
    ? TESTING_TRIAL_COUNT
    : STUDY_TRIAL_COUNT;
  const totalTrialCount = TRAINING_STIMULI.length + mainTrialCount;

  const sessionLabel = useMemo(
    () =>
      isPreview ? 'Preview session' : 'Participant ' + meta.participantId,
    [isPreview, meta.participantId],
  );

  async function prepareStudy() {
    const runId = preloadRun.current + 1;
    preloadRun.current = runId;
    const firstAttribute: Attribute =
      Math.random() < 0.5 ? 'glossiness' : 'metallicness';
    const secondAttribute: Attribute =
      firstAttribute === 'glossiness' ? 'metallicness' : 'glossiness';
    const nextOrder = [firstAttribute, secondAttribute];
    setStarting(true);
    setStudyPrepared(false);
    setPreloadedCount(0);
    setPreloadTotal(0);
    setStartError('');
    try {
      const assignment = testingMode
        ? null
        : await claimStudyAssignment(
            meta,
            firstAttribute + '_then_' + secondAttribute,
          );
      const nextStudyRatings = assignment?.length
        ? assignment.map((item) => ({
            stimulus: item.file_name,
            stimulusId: item.stimulus_id,
            imagePath: item.public_path,
            phase: 'study' as const,
            trialNumber: item.trial_number,
            glossiness: null,
            metallicness: null,
          }))
        : makeRatings(
            shuffle(STIMULI).slice(0, mainTrialCount),
            'study',
          );
      if (assignment?.length && assignment.length !== STUDY_TRIAL_COUNT) {
        throw new Error('The server did not return exactly 80 images.');
      }
      setRemoteSessionId(assignment?.[0]?.study_session_id ?? '');
      setAttributeOrder(nextOrder);
      const nextTrainingRatings = makeRatings(
        shuffle(TRAINING_STIMULI),
        'training',
      );
      setTrainingRatings(nextTrainingRatings);
      setStudyRatings(nextStudyRatings);
      const urls = [
        ...nextTrainingRatings.map(ratingImageUrl),
        ...nextStudyRatings.map(ratingImageUrl),
      ];
      setPreloadTotal(urls.length);
      await preloadImages(urls, (loaded) => {
        if (preloadRun.current === runId) setPreloadedCount(loaded);
      });
      if (preloadRun.current !== runId) return;
      setStudyPrepared(true);
    } catch {
      if (preloadRun.current !== runId) return;
      setStudyPrepared(false);
      setIndex(0);
      setStartError(
        'The study images could not be prepared. Check your connection and try again.',
      );
    } finally {
      if (preloadRun.current === runId) setStarting(false);
    }
  }

  function openExplanation() {
    setExamplesRevealed(false);
    setStage('explanation');
    void prepareStudy();
  }

  function startStudy() {
    if (!studyPrepared) return;
    setIndex(0);
    trialStartedAt.current = performance.now();
    setStage('training');
  }

  function returnToWelcome() {
    preloadRun.current += 1;
    setStarting(false);
    setStudyPrepared(false);
    setPreloadedCount(0);
    setPreloadTotal(0);
    setStartError('');
    setStage('welcome');
  }

  function updateRating(field: Attribute, value: number) {
    const update = (previous: Rating[]) =>
      previous.map((rating, ratingIndex) =>
        ratingIndex === index ? { ...rating, [field]: value } : rating,
      );
    if (isTraining) setTrainingRatings(update);
    else setStudyRatings(update);
  }

  function goBack() {
    if (index === 0) return;
    setExpandedImage(false);
    setShowAttributeHelp(false);
    setIndex((previous) => previous - 1);
    trialStartedAt.current = performance.now();
  }

  async function continueRatings() {
    if (!canContinue || submitting) return;
    const elapsed = Math.round(performance.now() - trialStartedAt.current);
    const nextRatings = activeRatings.map((rating, ratingIndex) =>
      ratingIndex === index
        ? { ...rating, responseTimeMs: elapsed }
        : rating,
    );

    if (isTraining) setTrainingRatings(nextRatings);
    else setStudyRatings(nextRatings);

    if (index === nextRatings.length - 1) {
      if (isTraining) {
        setIndex(0);
        setShowAttributeHelp(false);
        setExpandedImage(false);
        trialStartedAt.current = performance.now();
        setStage('study');
      } else {
        const result = {
          meta,
          attributeOrder,
          testingMode,
          glossinessFirst: attributeOrder[0] === 'glossiness',
          trainingRatings,
          studyRatings: nextRatings,
          completedAt: new Date().toISOString(),
        };
        localStorage.setItem(
          'material-perception-last-result',
          JSON.stringify(result),
        );
        if (remoteSessionId) {
          setSubmitting(true);
          setSubmitError('');
          try {
            await submitStudySession(
              remoteSessionId,
              meta.participantId,
              trainingRatings.map((rating, trainingIndex) => ({
                stimulus: rating.stimulus,
                trial_number: trainingIndex + 1,
                glossiness: rating.glossiness!,
                metallicness: rating.metallicness!,
                response_time_ms: rating.responseTimeMs ?? 0,
              })),
              nextRatings.map((rating) => ({
                stimulus_id: rating.stimulusId!,
                glossiness: rating.glossiness!,
                metallicness: rating.metallicness!,
                response_time_ms: rating.responseTimeMs ?? 0,
              })),
            );
            setSavedRemotely(true);
          } catch {
            setSubmitError(
              'Your responses could not be saved. Please try again without closing this page.',
            );
            setSubmitting(false);
            return;
          }
          setSubmitting(false);
        }
        setStage('complete');
      }
      return;
    }

    setExpandedImage(false);
    setShowAttributeHelp(false);
    setIndex((previous) => previous + 1);
    trialStartedAt.current = performance.now();
  }

  function restart() {
    preloadRun.current += 1;
    setConsented(false);
    setAttributeOrder([]);
    setTrainingRatings([]);
    setStudyRatings([]);
    setIndex(0);
    setExamplesRevealed(false);
    setShowAttributeHelp(false);
    setExpandedImage(false);
    setTestingMode(false);
    setStarting(false);
    setStudyPrepared(false);
    setPreloadedCount(0);
    setPreloadTotal(0);
    setStartError('');
    setSubmitting(false);
    setSubmitError('');
    setRemoteSessionId('');
    setSavedRemotely(false);
    setStage('welcome');
  }

  useEffect(() => {
    const context = (
      document as Document & { modelContext?: ModelContext }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: 'read_material_study_status',
          title: 'Read material study status',
          description:
            'Read the visible study stage and completion progress without changing any response.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: false,
          },
          execute: () => ({
            stage,
            currentSample:
              stage === 'training'
                ? index + 1
                : stage === 'study'
                  ? TRAINING_STIMULI.length + index + 1
                  : null,
            totalSamples: totalTrialCount,
            completedSamples:
              stage === 'study'
                ? TRAINING_STIMULI.length + completedInPhase
                : completedInPhase,
            attributeOrder: attributeOrder.length ? attributeOrder : null,
          }),
        },
        { signal: lifecycle.signal },
      );
      await context.registerTool(
        {
          name: 'start_material_study',
          title: 'Continue material study',
          description:
            'Move from consent to the instructions, or start the study after the instructions.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: false,
          },
          execute: () => {
            if (stage === 'welcome') {
              if (!consented) {
                throw new Error(
                  'Consent must be accepted before continuing.',
                );
              }
              openExplanation();
              return { stage: 'explanation' };
            }
            if (stage === 'explanation') {
              if (!studyPrepared) {
                throw new Error('The study images are still loading.');
              }
              startStudy();
              return {
                stage: 'training',
                totalSamples: TRAINING_STIMULI.length,
              };
            }
            throw new Error(
              'The study cannot be started from the current stage.',
            );
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [
    attributeOrder,
    completedInPhase,
    consented,
    index,
    stage,
    testingMode,
    studyPrepared,
    totalTrialCount,
  ]);

  if (stage === 'welcome') {
    return (
      <main className="study-shell welcome-shell">
        <section className="welcome-card" aria-labelledby="study-title">
          <div className="study-mark" aria-hidden="true">
            <span /><span /><span />
          </div>
          <h1 id="study-title">Visual Perception Study</h1>
          <p className="lead">
            Thank you for taking part in this user study.
          </p>

          <div className="attention-callout">
            <Eye aria-hidden="true" />
            <div>
              <h2>Please read carefully and stay attentive</h2>
              <p>
                Take time to understand the two attributes before you begin.
                Look closely at every image and give your best judgment rather
                than answering at random.
              </p>
            </div>
          </div>

          <div className="study-facts">
            <div>
              <span className="fact-value">25 min</span>
              <span className="fact-label">Estimated time</span>
            </div>
            <div>
              <span className="fact-value">{totalTrialCount}</span>
              <span className="fact-label">Images to rate</span>
            </div>
            <div>
              <Monitor aria-hidden="true" />
              <span className="fact-label">Desktop or laptop</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="testing-toggle"
            aria-pressed={testingMode}
            onClick={() => setTestingMode((enabled) => !enabled)}
          >
            <FlaskConical aria-hidden="true" /> Testing
            <span>{testingMode ? 'On' : 'Off'}</span>
          </Button>

          <div className="instructions compact-instructions">
            <h2>Before you begin</h2>
            <ul>
              <li>Use a desktop or laptop in a normally lit room.</li>
              <li>
                Set your screen to a comfortable, clearly visible brightness.
              </li>
              <li>
                Do not refresh or close the page while completing the study.
              </li>
              <li>
                There are no right or wrong answers—we are interested in your
                perception.
              </li>
              <li>
                Click any material image to enlarge it, then click it again to
                return.
              </li>
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
              collected will be anonymized and used as part of an academic
              research study.
            </span>
          </label>

          <Button
            size="lg"
            className="primary-action"
            disabled={!consented}
            onClick={openExplanation}
          >
            Continue to instructions <ArrowRight data-icon="inline-end" />
          </Button>
          <!--<p className="preview-note">
            {isPreview
              ? 'Preview mode · Responses stay in this browser and can be downloaded at the end.'
              : 'Your Prolific identifiers were received successfully.'}
          </p>-->
        </section>
      </main>
    );
  }

  if (stage === 'explanation') {
    return (
      <main className="study-shell explanation-shell">
        <header className="page-header">
          <div>
            <span className="brand-dot" aria-hidden="true" />
            Material appearance
          </div>
          <span>Instructions</span>
        </header>
        {!examplesRevealed ? (
          <button
            type="button"
            className="explanation-gate"
            aria-labelledby="explanation-gate-title"
            onClick={() => setExamplesRevealed(true)}
          >
            <span className="explanation-heading">
              <span className="eyebrow">What you will rate</span>
              <span
                className="explanation-title"
                id="explanation-gate-title"
              >
                Learn the two visual attributes
              </span>
              <span className="explanation-description">
                Focus on the material covering the object, not on the
                background. You will rate how strongly each attribute applies
                from 1 to 7.
              </span>
            </span>
            <span className="gate-prompt">
              Click anywhere to continue <ArrowRight aria-hidden="true" />
            </span>
          </button>
        ) : (
          <section
            className="explanation-content"
            aria-labelledby="explanation-title"
          >
            <div className="explanation-heading">
              <p className="eyebrow">What you will rate</p>
              <h1 id="explanation-title">Learn the two visual attributes</h1>
              <p>
                Focus on the material covering the object, not on the
                background. You will rate how strongly each attribute applies
                from 1 to 7.
              </p>
            </div>

            <ExamplePair
              attribute="Glossiness"
              description="Glossiness describes how much a surface appears smooth, shiny, or lustrous. It is independent from how bright or light-colored the material is overall."
              cue="specular highlights and recognizable reflections. Glossier surfaces usually show stronger or clearer reflected features; matte surfaces show weak, broad, or no visible reflections."
              lowImage={assetUrl('examples/glossy_0.jpg')}
              highImage={assetUrl('examples/glossy_1.jpg')}
            />
            <ExamplePair
              attribute="Metallicness"
              description="Metallicness describes how much the surface looks as if it is made of metal. A material can be glossy without looking metallic."
              cue="strong contrast across the shape, darker regions away from highlights, and reflections that may take on the material's color rather than remaining white."
              lowImage={assetUrl('examples/metal_0.jpg')}
              highImage={assetUrl('examples/metal_1.jpg')}
            />

            <div className="explanation-actions">
              <Button
                variant="ghost"
                size="lg"
                onClick={returnToWelcome}
              >
                <ArrowLeft data-icon="inline-start" /> Back
              </Button>
              <Button
                size="lg"
                disabled={starting || !studyPrepared}
                onClick={startStudy}
              >
                {studyPrepared ? 'Start study' : 'Please wait…'}
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
            <div className="preload-status" role="status" aria-live="polite">
              {studyPrepared ? (
                <Check aria-hidden="true" />
              ) : (
                <LoaderCircle className={starting ? 'is-spinning' : ''} aria-hidden="true" />
              )}
              <div>
                <strong>
                  {studyPrepared
                    ? 'Images ready'
                    : starting
                      ? `Preparing images ${preloadedCount} of ${preloadTotal || totalTrialCount}`
                      : 'Images are not ready'}
                </strong>
                <span>
                  {studyPrepared
                    ? 'You can begin the study.'
                    : 'Please wait here while the images are loaded.'}
                </span>
              </div>
              {!studyPrepared && !starting ? (
                <Button size="sm" variant="outline" onClick={() => void prepareStudy()}>
                  Try again
                </Button>
              ) : null}
            </div>
            {startError ? <p className="form-error preload-error">{startError}</p> : null}
          </section>
        )}
      </main>
    );
  }

  if (stage === 'complete') {
    return (
      <main className="study-shell complete-shell">
        <section className="complete-card" aria-labelledby="complete-title">
          <div className="success-icon" aria-hidden="true"><Check /></div>
          <p className="eyebrow">All {totalTrialCount} samples rated</p>
          <h1 id="complete-title">Thank you for taking part</h1>
          <p className="lead">
            {savedRemotely
              ? 'Your responses have been saved successfully.'
              : 'Your responses have been recorded in this browser and are available for testing.'}
          </p>
          <div className="complete-actions">
            <Button
              size="lg"
              onClick={() =>
                downloadResults(
                  trainingRatings,
                  studyRatings,
                  meta,
                  attributeOrder,
                )
              }
            >
              <Download data-icon="inline-start" /> Download test data
            </Button>
            {!isPreview && COMPLETION_CODE !== 'PREVIEW' ? (
              <Button
                size="lg"
                variant="outline"
                onClick={() =>
                  window.location.assign(
                    'https://app.prolific.com/submissions/complete?cc=' +
                      COMPLETION_CODE,
                  )
                }
              >
                Return to Prolific <ArrowRight data-icon="inline-end" />
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={restart}>
                <RotateCcw data-icon="inline-start" /> Run preview again
              </Button>
            )}
          </div>
          <p className="session-id">{sessionLabel}</p>
        </section>
      </main>
    );
  }

  const totalInPhase = activeRatings.length;
  const imageOffset = isTraining ? 0 : TRAINING_STIMULI.length;
  const imageNumber = imageOffset + index + 1;
  const completedOverall = imageOffset + completedInPhase;
  const imageSrc = ratingImageUrl(current);

  return (
    <main className="study-shell trial-shell">
      <header className="trial-header">
        <div>
          <span className="brand-dot" aria-hidden="true" />
          Material appearance
        </div>
        <span>Image {imageNumber} of {totalTrialCount}</span>
      </header>

      <Progress
        value={
          ((imageNumber - 1 + (canContinue ? 1 : 0)) /
            totalTrialCount) *
          100
        }
        aria-label={
          completedOverall +
          ' of ' +
          totalTrialCount +
          ' images completed'
        }
        className="study-progress"
      />

      <section className="trial-grid" aria-live="polite">
        <div className="stimulus-panel">
          <button
            type="button"
            className="stimulus-frame"
            onClick={() => setExpandedImage(true)}
            aria-label={'Enlarge material image ' + imageNumber}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.stimulus}
              src={imageSrc}
              alt={'Material sample ' + imageNumber}
              draggable={false}
            />
          </button>
          <p className="zoom-reminder">
            <ZoomIn aria-hidden="true" />
            <span>
              Focus on the whole material before answering. Click the image to
              zoom in; click it again to return.
            </span>
          </p>
        </div>

        <div className="ratings-panel">
          <div className="ratings-heading">
            <p className="eyebrow">Your visual impression</p>
            <div className="ratings-title-row">
              <h1>Rate this material</h1>
              <button
                type="button"
                className="attribute-help-button"
                aria-label="Show glossiness and metallicness guide"
                aria-expanded={showAttributeHelp}
                onClick={() => setShowAttributeHelp((visible) => !visible)}
              >
                <CircleHelp aria-hidden="true" />
              </button>
            </div>
            <p className="ratings-instructions">
              Select one value on each scale. Both answers are required.
            </p>
            {showAttributeHelp ? (
              <aside
                className="attribute-help-window"
                aria-label="Glossiness and metallicness guide"
              >
                <div className="attribute-help-item">
                  <div className="attribute-help-images" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrl('examples/glossy_0.jpg')} alt="" />
                    <ArrowRight />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrl('examples/glossy_1.jpg')} alt="" />
                  </div>
                  <p>
                    <strong>Glossiness</strong>
                    Look for specular highlights and clear reflections.
                  </p>
                </div>
                <div className="attribute-help-item">
                  <div className="attribute-help-images" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrl('examples/metal_0.jpg')} alt="" />
                    <ArrowRight />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrl('examples/metal_1.jpg')} alt="" />
                  </div>
                  <p>
                    <strong>Metallicness</strong>
                    Look for strong contrast, darker regions, and tinted
                    reflections.
                  </p>
                </div>
              </aside>
            ) : null}
          </div>

          {attributeOrder.map((attribute) => (
            <ScaleQuestion
              key={attribute}
              attribute={attribute}
              value={current[attribute]}
              onChange={(value) => updateRating(attribute, value)}
            />
          ))}

          <div className="trial-actions">
            <Button
              variant="ghost"
              size="lg"
              disabled={index === 0}
              onClick={goBack}
            >
              <ArrowLeft data-icon="inline-start" /> Back
            </Button>
            <Button
              size="lg"
              disabled={!canContinue || submitting}
              onClick={continueRatings}
            >
              {submitting
                ? 'Saving responses…'
                : index === totalInPhase - 1
                ? isTraining
                  ? 'Next image'
                  : 'Finish study'
                : 'Next image'}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
          {submitError ? <p className="form-error">{submitError}</p> : null}
        </div>
      </section>
      {expandedImage ? (
        <button
          type="button"
          className="image-lightbox"
          onClick={() => setExpandedImage(false)}
          aria-label="Close enlarged material image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageSrc} alt={'Enlarged material sample ' + imageNumber} />
          <span><Minimize2 aria-hidden="true" /> Click image to return</span>
        </button>
      ) : null}
    </main>
  );
}
