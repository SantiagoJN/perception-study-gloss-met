import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleHelp, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { EMPTY_PAIR_TRAINING_ANSWERS, PAIR_TRAINING_EXAMPLES, pairTrainingComplete, pairTrainingCorrect, pairTrainingFeedback, type PairTrainingAnswers, type PairTrainingAttempt } from './pairTrainingData';

export function PairTraining({ attempts, onAttempt, onBack, onComplete }: { attempts: PairTrainingAttempt[]; onAttempt: (attempt: PairTrainingAttempt) => void; onBack: () => void; onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<PairTrainingAnswers>(EMPTY_PAIR_TRAINING_ANSWERS);
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [zoom, setZoom] = useState('');
  const attemptStartedAt = useRef(performance.now());
  const helpOpenCount = useRef(0);
  const example = PAIR_TRAINING_EXAMPLES[index];
  const asset = (path: string) => import.meta.env.BASE_URL + path;
  const update = (change: Partial<PairTrainingAnswers>) => { setAnswers((v) => ({ ...v, ...change })); setConfirmed(false); setFeedback([]); };
  const reset = (next: number) => { setIndex(next); setAnswers(EMPTY_PAIR_TRAINING_ANSWERS); setConfirmed(false); setFeedback([]); setShowHelp(false); setZoom(''); attemptStartedAt.current = performance.now(); helpOpenCount.current = 0; };
  const toggleHelp = () => { if (!showHelp) helpOpenCount.current += 1; setShowHelp((v) => !v); };
  const feedbackMessage = (message: string) => <p key={message}>{message}</p>;
  function check() {
    if (!pairTrainingComplete(answers)) return;
    const correct = pairTrainingCorrect(index, answers);
    onAttempt({
      exampleId: example.id,
      exampleNumber: index + 1,
      attemptNumber: attempts.filter((attempt) => attempt.exampleId === example.id).length + 1,
      identity: answers.identity,
      gloss: answers.gloss,
      metal: answers.metal,
      correct,
      responseTimeMs: Math.max(0, Math.round(performance.now() - attemptStartedAt.current)),
      helpOpenCount: helpOpenCount.current,
      checkedAt: new Date().toISOString(),
    });
    attemptStartedAt.current = performance.now();
    helpOpenCount.current = 0;
    if (correct) { setConfirmed(true); setFeedback([]); }
    else { setConfirmed(false); setFeedback(pairTrainingFeedback(index, answers)); }
  }
  function advance() {
    if (!confirmed || !pairTrainingCorrect(index, answers)) return;
    if (index === PAIR_TRAINING_EXAMPLES.length - 1) onComplete();
    else reset(index + 1);
  }
  return <main className="study-shell constancy-study-shell training-study-shell pair-training-shell">
    <header className="trial-header"><div><span className="brand-dot" /> Pair comparison test</div><div className="trial-header-actions"><span className="training-badge">Training</span><span>Example {index + 1} of {PAIR_TRAINING_EXAMPLES.length}</span></div></header>
    <Progress className="study-progress" value={(index + 1) / PAIR_TRAINING_EXAMPLES.length * 100} />
    <section className="pair-trial-layout">
      <div className="pair-images-panel">{[{ label: 'A', path: example.imageA }, { label: 'B', path: example.imageB }].map((image) => <figure key={image.label}><button aria-label={`Enlarge image ${image.label}`} onClick={() => setZoom(asset(image.path))}><img src={asset(image.path)} alt={`Image ${image.label}`} /></button><figcaption>{image.label}</figcaption></figure>)}<p className="zoom-reminder"><ZoomIn /> Click either image to enlarge it.</p></div>
      <div className="pair-response-panel">
        <div className="ratings-title-row"><h1>Compare A and B</h1><button className="attribute-help-button" aria-label="Information about material, glossiness and metallicness" aria-expanded={showHelp} aria-controls="pair-training-help" onClick={toggleHelp}><CircleHelp /></button></div>
        <p className="training-note">This is training. Your answers in this part will not count as study trials.</p>
        {showHelp && <div className="inline-help-window" id="pair-training-help"><p><strong>Underlying material:</strong> the surface’s physical reflectance, independent of object shape or lighting. Note that two different materials can share a similar color or chromatic pattern while differing in glossiness or metallic appearance.</p><p><strong>Glossiness:</strong> the sharpness and clarity of highlights and reflections. Brightness alone does not make a surface glossy.</p><p><strong>Metallicness:</strong> metal-like reflections, color tinting and characteristic bright–dark contrast. A glossy surface is not necessarily metallic.</p></div>}
        <fieldset className="pair-question identity-question"><legend>Do these objects look like they are made of the same material?</legend><RadioGroup aria-label="Material identity" value={answers.identity} onValueChange={(identity) => update({ identity })} className="identity-scale compact-identity-scale">{[{ value: '1', label: 'Probably different' }, { value: '3', label: 'Unsure' }, { value: '5', label: 'Probably same' }].map((option) => <label className="scale-choice" key={option.value}><RadioGroupItem value={option.value} /><span>{option.label}</span></label>)}</RadioGroup></fieldset>
        <div className="pair-attributes">{([{ field: 'gloss', attribute: 'glossy' }, { field: 'metal', attribute: 'metallic' }] as const).map(({ field, attribute }) => <fieldset className="pair-question" key={field}><legend>Which surface appears <strong>more {attribute}</strong>?</legend><RadioGroup aria-label={`Relative ${attribute === 'glossy' ? 'glossiness' : 'metallicness'}`} value={answers[field]} onValueChange={(value) => update({ [field]: value })} className="three-choice-scale">{[{ value: 'a', label: `A more ${attribute}` }, { value: 'same', label: 'Approximately same' }, { value: 'b', label: `B more ${attribute}` }].map((option) => <label className="scale-choice" key={option.value}><RadioGroupItem value={option.value} /><span>{option.label}</span></label>)}</RadioGroup></fieldset>)}</div>
        {feedback.length > 0 && <div className="training-feedback training-feedback-error" role="alert">{feedback.map(feedbackMessage)}</div>}
        {confirmed && <div className="training-feedback" role="status"><strong>Correct!</strong> You can continue.</div>}
      </div>
    </section>
    <footer className="constancy-actions"><Button variant="ghost" onClick={() => index === 0 ? onBack() : reset(index - 1)}><ArrowLeft /> Back</Button>{confirmed ? <Button onClick={advance}>{index === PAIR_TRAINING_EXAMPLES.length - 1 ? 'Begin test' : 'Next example'} <ArrowRight /></Button> : <Button disabled={!pairTrainingComplete(answers)} onClick={check}>Check answers <ArrowRight /></Button>}</footer>
    {zoom && <button className="image-lightbox" onClick={() => setZoom('')}><img src={zoom} alt="Enlarged training image" /><span>Click to close</span></button>}
  </main>;
}
