export type TrainingRelativeChoice = 'a' | 'b' | 'same' | '';
export type PairTrainingAnswers = { identity: string; gloss: TrainingRelativeChoice; metal: TrainingRelativeChoice };
export type PairTrainingAttempt = PairTrainingAnswers & {
  exampleId: string;
  exampleNumber: number;
  attemptNumber: number;
  correct: boolean;
  responseTimeMs: number;
  helpOpenCount: number;
  checkedAt: string;
};
export const EMPTY_PAIR_TRAINING_ANSWERS: PairTrainingAnswers = { identity: '', gloss: '', metal: '' };
export const PAIR_TRAINING_EXAMPLES = [
  { id: 'yellow_different', imageA: 'tutorial/t01_gloss_low_metallic_low.png', imageB: 'tutorial/t01_gloss_high_metallic_high.png', expected: { identity: '1', gloss: 'b', metal: 'b' } },
  { id: 'blue_different', imageA: 'tutorial/t02_gloss_high_metallic_low.png', imageB: 'tutorial/t02_gloss_low_metallic_high.png', expected: { identity: '1', gloss: 'a', metal: 'b' } },
  { id: 'yellow_same', imageA: 'tutorial/t01_gloss_low_metallic_high.png', imageB: 'tutorial/t01_gloss_low_metallic_high.png', expected: { identity: '5', gloss: 'same', metal: 'same' } },
] satisfies Array<{ id: string; imageA: string; imageB: string; expected: PairTrainingAnswers }>;
export function pairTrainingComplete(answers: PairTrainingAnswers) { return Boolean(answers.identity && answers.gloss && answers.metal); }
export function pairTrainingCorrect(index: number, answers: PairTrainingAnswers) {
  const expected = PAIR_TRAINING_EXAMPLES[index]?.expected;
  return Boolean(expected && answers.identity === expected.identity && answers.gloss === expected.gloss && answers.metal === expected.metal);
}
export function pairTrainingFeedback(index: number, answers: PairTrainingAnswers): string[] {
  if (pairTrainingCorrect(index, answers)) return [];
  const expected = PAIR_TRAINING_EXAMPLES[index].expected;
  const messages: string[] = [];
  if (answers.identity !== expected.identity) {
    const question = answers.identity === '5'
      ? 'Do Images A and B really appear to have the same underlying material?'
      : answers.identity === '1'
        ? 'Do Images A and B really appear to have different underlying materials?'
        : 'Is the material identity of Images A and B really uncertain?';
    messages.push(`${question} Please look at their complete surface appearance, including differences in glossiness and metallicness rather than color alone.`);
  }
  if (answers.gloss !== expected.gloss) {
    const question = answers.gloss === 'a' || answers.gloss === 'b'
      ? `Is Image ${answers.gloss.toUpperCase()} really more glossy than Image ${answers.gloss === 'a' ? 'B' : 'A'}?`
      : 'Do Images A and B really look approximately equally glossy?';
    messages.push(`${question} Please look at the sharpness and definition of the highlights and reflections.`);
  }
  if (answers.metal !== expected.metal) {
    const question = answers.metal === 'a' || answers.metal === 'b'
      ? `Is Image ${answers.metal.toUpperCase()} really more metallic than Image ${answers.metal === 'a' ? 'B' : 'A'}?`
      : 'Do Images A and B really look approximately equally metallic?';
    messages.push(`${question} Please look for tinted reflections and the characteristic bright–dark contrast of metallic surfaces.`);
  }
  return messages;
}
