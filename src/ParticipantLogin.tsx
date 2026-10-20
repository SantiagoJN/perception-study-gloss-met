import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ParticipantLogin({
  studyTitle,
  onLogin,
  mode = 'prolific',
}: {
  studyTitle: string | null;
  onLogin: (username: string, password: string) => Promise<void>;
  mode?: 'prolific' | 'inhouse';
}) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submittedUsername = mode === 'inhouse' ? 'gilab-inhouse' : username.trim();
  const submittedPassword = username.trim();
  const linkIsComplete = Boolean(studyTitle);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!linkIsComplete || submittedPassword.length < 8 || busy) return;
    setBusy(true);
    setError('');
    try { await onLogin(submittedUsername, submittedPassword); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The credentials could not be verified.'); }
    finally { setBusy(false); }
  }

  return <main className="study-shell welcome-shell login-shell"><section className="welcome-card login-card">
    <div className="login-icon" aria-hidden="true"><KeyRound /></div>
    <div className="tutorial-heading card-title-heading"><h1>{mode === 'inhouse' ? 'In-house access' : 'Participant access'}</h1><p>{mode === 'inhouse' ? 'Enter the internal access code provided by the study organiser.' : 'Please introduce the username provided by Prolific.'}</p></div>
    <form className="participant-login-form" onSubmit={submit}>
      <label><span>{mode === 'inhouse' ? 'Access code' : 'Username'}</span><input type={mode === 'inhouse' ? 'password' : 'text'} autoComplete={mode === 'inhouse' ? 'current-password' : 'username'} maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      {error && <p className="login-error" role="alert">{error}</p>}
      <Button className="primary-action" size="lg" type="submit" disabled={!linkIsComplete || submittedPassword.length < 8 || busy}>{busy ? <><LoaderCircle className="is-spinning" /> Verifying…</> : <>Continue <ArrowRight /></>}</Button>
    </form>
  </section></main>;
}
