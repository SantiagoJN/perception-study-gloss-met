import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type Demographics = {
  name: string; email: string; age: string; nativeLanguage: string; nativeLanguageOther: string;
  englishProficiency: string; countryOfOrigin: string;
  sexAssignedAtBirth: string; genderIdentity: string; genderSelfDescription: string;
  education: string; educationOther: string; normalOrCorrectedVision: string;
  backgroundExperience: string[];
};
export const EMPTY_DEMOGRAPHICS: Demographics = {
  name: '', email: '', age: '', nativeLanguage: '', nativeLanguageOther: '', englishProficiency: '', countryOfOrigin: '',
  sexAssignedAtBirth: '', genderIdentity: '', genderSelfDescription: '', education: '', educationOther: '',
  normalOrCorrectedVision: '', backgroundExperience: [],
};
const BASE_DEMOGRAPHIC_COLUMNS = [
  'demographics_skipped',
  'sex_assigned_at_birth', 'gender_identity', 'gender_self_description', 'education', 'education_other',
  'normal_or_corrected_vision', 'background_experience_json',
];
const INHOUSE_DEMOGRAPHIC_COLUMNS = ['name', 'email', 'age', 'native_language', 'native_language_other', 'english_proficiency', 'country_of_origin'];
export function demographicColumns(inhouse: boolean) {
  return inhouse ? [...BASE_DEMOGRAPHIC_COLUMNS, ...INHOUSE_DEMOGRAPHIC_COLUMNS] : [...BASE_DEMOGRAPHIC_COLUMNS];
}
export function demographicsCells(v: Demographics, skipped: boolean, inhouse: boolean) {
  const base = [
    skipped,
    v.sexAssignedAtBirth, v.genderIdentity, v.genderIdentity === 'self_describe' ? v.genderSelfDescription.trim() : '',
    v.education, v.education === 'other' ? v.educationOther.trim() : '',
    v.normalOrCorrectedVision, JSON.stringify(v.backgroundExperience),
  ];
  return inhouse ? [...base, v.name.trim(), v.email.trim(), v.age, v.nativeLanguage,
    v.nativeLanguage === 'other' ? v.nativeLanguageOther.trim() : '', v.englishProficiency, v.countryOfOrigin] : base;
}
export function demographicsPayload(v: Demographics, inhouse: boolean): Record<string, unknown> {
  const base = {
    sexAssignedAtBirth: v.sexAssignedAtBirth,
    genderIdentity: v.genderIdentity,
    genderSelfDescription: v.genderIdentity === 'self_describe' ? v.genderSelfDescription.trim() : '',
    education: v.education,
    educationOther: v.education === 'other' ? v.educationOther.trim() : '',
    normalOrCorrectedVision: v.normalOrCorrectedVision,
    backgroundExperience: [...v.backgroundExperience],
  };
  if (!inhouse) return base;
  return { ...base, name: v.name.trim(), email: v.email.trim(), age: v.age.trim(), nativeLanguage: v.nativeLanguage,
    nativeLanguageOther: v.nativeLanguage === 'other' ? v.nativeLanguageOther.trim() : '', englishProficiency: v.englishProficiency, countryOfOrigin: v.countryOfOrigin };
}
export function demographicsComplete(v: Demographics, inhouse: boolean) {
  const baseComplete = Boolean(v.sexAssignedAtBirth && v.genderIdentity &&
    (v.genderIdentity !== 'self_describe' || v.genderSelfDescription.trim()) && v.education && (v.education !== 'other' || v.educationOther.trim()) &&
    v.normalOrCorrectedVision && v.backgroundExperience.length &&
    (!v.backgroundExperience.includes('none') || v.backgroundExperience.length === 1));
  if (!baseComplete || !inhouse) return baseComplete;
  const age = Number(v.age);
  return Boolean(v.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()) && v.age.trim() && Number.isInteger(age) && age >= 18 && age <= 100 &&
    v.nativeLanguage && (v.nativeLanguage !== 'other' || v.nativeLanguageOther.trim()) && v.englishProficiency && v.countryOfOrigin);
}
export function toggleExperience(current: string[], value: string, checked: boolean) {
  if (!checked) return current.filter((item) => item !== value);
  if (value === 'none') return ['none'];
  return [...new Set([...current.filter((item) => item !== 'none'), value])];
}

type Option = { value: string; label: string };
const options = (entries: [string, string][]): Option[] => entries.map(([value, label]) => ({ value, label }));
export const LANGUAGE_OPTIONS = options([
  ['en', 'English'], ['es', 'Spanish'], ['de', 'German'], ['fr', 'French'], ['zh', 'Chinese (Mandarin)'],
  ['hi', 'Hindi'], ['ar', 'Arabic'], ['bn', 'Bengali'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ur', 'Urdu'], ['ja', 'Japanese'], ['other', 'Other'],
]);
// ISO 3166-1 countries and territories, plus Kosovo. Store stable codes, not localized labels.
const REGION_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK'.split(' ');
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const COUNTRY_OPTIONS: Option[] = REGION_CODES.map((code) => ({ value: code, label: code === 'XK' ? 'Kosovo' : regionNames.of(code) ?? code })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
export const BACKGROUND_OPTIONS = options([['photography', 'Photography'], ['painting_illustration', 'Painting / Illustration'], ['graphic_design', 'Graphic design'], ['computer_graphics_rendering', 'Computer graphics / rendering'], ['none', 'None of the above']]);
const YES_NO = options([['no', 'No'], ['yes', 'Yes']]);

function Choice({ legend, value, choices, onChange, descriptionId }: { legend: string; value: string; choices: Option[]; onChange: (value: string) => void; descriptionId?: string }) {
  return <fieldset className="demographic-field"><legend>{legend}</legend><RadioGroup aria-label={legend} aria-describedby={descriptionId} value={value} onValueChange={onChange} className="demographic-options">{choices.map((option) => <label key={option.value} className="demographic-option"><RadioGroupItem value={option.value} /><span>{option.label}</span></label>)}</RadioGroup></fieldset>;
}
function TextField({ label, value, onChange, type = 'text', autoComplete }: { label: string; value: string; onChange: (value: string) => void; type?: string; autoComplete?: string }) {
  return <label className="demographic-text-field"><span>{label}</span><input type={type} autoComplete={autoComplete} maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
function SelectField({ label, value, choices, onChange }: { label: string; value: string; choices: Option[]; onChange: (value: string) => void }) {
  return <label className="demographic-text-field"><span>{label}</span><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}><option value="" disabled>Select an option</option>{choices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
export function DemographicsForm({ values: v, onChange, inhouse }: { values: Demographics; onChange: (values: Demographics) => void; inhouse: boolean }) {
  const update = (field: keyof Demographics, value: string) => {
    const next = { ...v, [field]: value };
    // Clear hidden text so obsolete personal details are not retained in local storage.
    if (field === 'genderIdentity' && value !== 'self_describe') next.genderSelfDescription = '';
    if (field === 'education' && value !== 'other') next.educationOther = '';
    if (field === 'nativeLanguage' && value !== 'other') next.nativeLanguageOther = '';
    onChange(next);
  };
  return <div className="demographics-form">
    <section className="demographics-section" aria-labelledby="demographic-information-title"><h2 id="demographic-information-title">Demographic information</h2>
      {inhouse && <>
        <TextField label="Name" value={v.name} onChange={(value) => update('name', value)} autoComplete="name" />
        <TextField label="Email address" value={v.email} onChange={(value) => update('email', value)} type="email" autoComplete="email" />
        <label className="demographic-text-field age-field"><span>Age</span><input type="number" min="18" max="100" step="1" value={v.age} onChange={(e) => update('age', e.target.value)} aria-describedby="age-help" /><small id="age-help">Enter an age between 18 and 100.</small></label>
      </>}
      <Choice legend="Sex assigned at birth" value={v.sexAssignedAtBirth} choices={options([['female', 'Female'], ['male', 'Male'], ['intersex', 'Intersex'], ['prefer_not_to_say', 'Prefer not to say']])} onChange={(value) => update('sexAssignedAtBirth', value)} />
      <Choice legend="Gender identity" value={v.genderIdentity} choices={options([['woman', 'Woman'], ['man', 'Man'], ['non_binary', 'Non-binary'], ['self_describe', 'Prefer to self-describe'], ['prefer_not_to_say', 'Prefer not to say']])} onChange={(value) => update('genderIdentity', value)} />
      {v.genderIdentity === 'self_describe' && <TextField label="Please describe your gender identity" value={v.genderSelfDescription} onChange={(value) => update('genderSelfDescription', value)} />}
      <SelectField label="Highest level of education completed" value={v.education} choices={options([['primary', 'Primary education'], ['secondary', 'Secondary school'], ['bachelors', "Bachelor’s degree"], ['masters', "Master’s degree"], ['doctorate', 'Doctorate'], ['other', 'Other']])} onChange={(value) => update('education', value)} />
      {v.education === 'other' && <TextField label="Please specify your education" value={v.educationOther} onChange={(value) => update('educationOther', value)} />}
      {inhouse && <>
        <SelectField label="Native language" value={v.nativeLanguage} choices={LANGUAGE_OPTIONS} onChange={(value) => update('nativeLanguage', value)} />
        {v.nativeLanguage === 'other' && <TextField label="Please specify your native language" value={v.nativeLanguageOther} onChange={(value) => update('nativeLanguageOther', value)} />}
        <div><Choice legend="Task language proficiency in English" value={v.englishProficiency} choices={options([['A', 'A — Basic'], ['B', 'B — Independent'], ['C', 'C — Proficient']])} onChange={(value) => update('englishProficiency', value)} descriptionId="english-proficiency-help" /><p className="demographic-help" id="english-proficiency-help"><strong>Level A</strong> — Basic: simple, everyday interactions.<br /><strong>Level B</strong> — Independent: most everyday situations and work-related communication.<br /><strong>Level C</strong> — Proficient: complex academic or professional communication.</p></div>
        <SelectField label="Country of origin" value={v.countryOfOrigin} choices={COUNTRY_OPTIONS} onChange={(value) => update('countryOfOrigin', value)} />
      </>}
    </section>
    <section className="demographics-section" aria-labelledby="vision-title"><h2 id="vision-title">Vision</h2>
      <div><Choice legend="Do you have normal or corrected-to-normal vision?" value={v.normalOrCorrectedVision} choices={YES_NO} onChange={(value) => update('normalOrCorrectedVision', value)} descriptionId="normal-vision-help" /><p className="demographic-help" id="normal-vision-help">For example, select Yes if you have myopia and are currently wearing glasses or contact lenses that correct it.</p></div>
    </section>
    <section className="demographics-section" aria-labelledby="background-title"><h2 id="background-title">Background and experience</h2>
      <fieldset className="demographic-field"><legend>Do you have formal training or significant experience in any of the following?</legend><p className="demographic-help">Select all that apply.</p><div className="demographic-options">{BACKGROUND_OPTIONS.map((option) => <label key={option.value} className="demographic-option"><Checkbox checked={v.backgroundExperience.includes(option.value)} onCheckedChange={(checked) => onChange({ ...v, backgroundExperience: toggleExperience(v.backgroundExperience, option.value, checked === true) })} /><span>{option.label}</span></label>)}</div></fieldset>
    </section>
  </div>;
}
