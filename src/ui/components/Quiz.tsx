import { useEffect, useMemo, useState } from 'react';
import { QUESTIONS, TOPICS, type Question, type Topic } from '../../content/questions';
import { PLATFORMS, type PlatformId } from '../../engine/platform';
import { runInWorker } from '../runner';
import { Dialog } from './Chrome';

type Answers = Record<string, string>; // key: platform:id -> chosen option
const KEY = 'stackyard:quiz';
const readAnswers = (): Answers => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const writeAnswers = (a: Answers) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage may be blocked */ } };
const LEVELS = ['', 'Warm-up', 'Tricky', 'Nasty'];

export function QuizDialog({ platform, onClose, onOpen }: { platform: PlatformId; onClose(): void; onOpen(q: Question): void }) {
  const [topic, setTopic] = useState<Topic | 'All'>('All');
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>(readAnswers);
  const [truth, setTruth] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<string | null>(null);
  const list = useMemo(() => QUESTIONS.filter((q) => topic === 'All' || q.topic === topic), [topic]);
  const q = list[Math.min(idx, list.length - 1)];
  const key = (x: Question) => platform + ':' + x.id;
  const done = q ? answers[key(q)] : undefined;
  const revealed = done !== undefined;
  const answer = q ? truth[key(q)] : undefined;

  useEffect(() => { setPick(null); }, [q?.id, platform]);
  // the true answer is whatever the simulator prints on the chosen machine
  useEffect(() => {
    if (!q || truth[key(q)] !== undefined) return;
    let live = true;
    runInWorker(q.code, platform).then((r) => { if (live) setTruth((t) => ({ ...t, [key(q)]: r.stdout.trim() })); }).catch(() => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id, platform]);

  const submit = () => {
    if (!q || pick === null) return;
    const next = { ...answers, [key(q)]: pick };
    setAnswers(next); writeAnswers(next);
  };
  const right = (x: Question) => answers[key(x)] !== undefined && truth[key(x)] !== undefined && answers[key(x)] === truth[key(x)];
  const attempted = list.filter((x) => answers[key(x)] !== undefined).length;
  const correct = list.filter((x) => right(x)).length;
  const reset = () => { const next = { ...answers }; for (const x of QUESTIONS) delete next[key(x)]; setAnswers(next); writeAnswers(next); setPick(null); };

  if (!q) return null;
  const ok = revealed && answer !== undefined && done === answer;
  return (
    <Dialog title="Tricky questions" onClose={onClose} wide>
      <div className="quiz">
        <aside className="quiz-side">
          <p className="muted small">Answers are for <b>{PLATFORMS[platform].label}</b>. Switch the machine at the top to see how the same code behaves elsewhere.</p>
          <select value={topic} onChange={(e) => { setTopic(e.target.value as Topic | 'All'); setIdx(0); }} aria-label="Topic">
            <option value="All">All topics ({QUESTIONS.length})</option>
            {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <ol className="qlist">
            {list.map((x, i) => (
              <li key={x.id}>
                <button aria-current={x.id === q.id} onClick={() => setIdx(i)}>
                  <span className={'qdot ' + (answers[key(x)] === undefined ? '' : right(x) ? 'good' : 'bad')} aria-hidden="true" />
                  {x.title}
                </button>
              </li>
            ))}
          </ol>
          <div className="quiz-score"><b>{correct}</b> of {attempted} right <span className="muted">· {list.length - attempted} to go</span> {attempted > 0 && <button className="linkbtn" onClick={reset}>reset</button>}</div>
        </aside>
        <div className="quiz-main">
          <div className="qmeta"><span className={'lvl l' + q.level}>{LEVELS[q.level]}</span><span className="muted">{q.topic}</span>{q.varies && <span className="chip" title="The answer depends on the machine">differs by platform</span>}</div>
          <h3>{q.title}</h3>
          <pre className="qcode mono">{q.code}</pre>
          <p className="qask"><b>{q.ask}</b></p>
          <div className="qopts" role="radiogroup" aria-label="Answers">
            {q.options.map((o) => {
              const chosen = (revealed ? done : pick) === o;
              const isTruth = revealed && answer === o;
              return (
                <button key={o} role="radio" aria-checked={chosen} disabled={revealed} className={'qopt mono' + (isTruth ? ' truth' : chosen && revealed ? ' miss' : '')} onClick={() => setPick(o)}>{o}</button>
              );
            })}
          </div>
          {!revealed && <div className="qactions"><button className="btn primary" disabled={pick === null || answer === undefined} onClick={submit}>Check my answer</button><span className="muted small">Think first: no peeking at the visualiser.</span></div>}
          {revealed && (
            <div className={'qresult ' + (ok ? 'good' : 'bad')} role="status">
              <strong>{ok ? 'Correct.' : 'Not quite.'}</strong> On {PLATFORMS[platform].label} this program prints <span className="mono">{answer}</span>.
              <p>{q.why}</p>
              {q.platforms && <p className="plat-note"><b>{PLATFORMS[platform].label}:</b> {q.platforms[platform]}</p>}
              {q.platforms && (Object.keys(q.platforms) as PlatformId[]).filter((p) => p !== platform).map((p) => <p key={p} className="plat-note muted"><b>{PLATFORMS[p].label}:</b> {q.platforms![p]}</p>)}
              <div className="qactions">
                <button className="btn primary" onClick={() => onOpen(q)}>Watch it in the visualiser</button>
                {idx < list.length - 1 && <button className="btn" onClick={() => setIdx(idx + 1)}>Next question</button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
