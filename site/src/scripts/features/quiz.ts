// Quiz interface: one question at a time, instant feedback with an explanation that links to the section,
// scoring, and hand-off of missed questions to the review scheduler.
// Question logic lives in lib/quiz.ts, scheduling in lib/srs.ts, storage in lib/progress.ts.

import { getProgress } from '../../lib/progress';
import { pickQuestions, scoreRun, seededShuffle, shuffleChoices, type Question, type TopicQuestion } from '../../lib/quiz';
import { grade, isDue, newItem } from '../../lib/srs';
import { isRead } from '../../lib/next-up';

const base = document.documentElement.dataset.base || '/';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const REPORT = 'https://github.com/skshubham1437/system-design-primer/issues/new?template=content-problem.yml';

interface QuizFile { slug: string; topic: string; title: string; reviewed: boolean; questions: Question[] }
interface Run { id: string; title: string; topicPath?: string; questions: Question[]; reviewed: boolean; label: (q: Question) => string | undefined }

/* ------------------------------------------------------------ the quiz runner */

function runner(root: HTMLElement, make: (seed: string, only?: string[]) => Run, intro: (start: () => void, startMissed?: (ids: string[]) => void) => void) {
  const progress = getProgress();
  let run: Run;
  let shown: Question[] = [];  // choices shuffled for this run
  let picked: (number | null)[] = [];
  let index = 0;
  let answered = false;
  let seed = '';

  const saveKey = () => `primer:quizrun:${run.id}`;
  const persistRun = () => { try { sessionStorage.setItem(saveKey(), JSON.stringify({ seed, index, picked, ids: run.questions.map((q) => q.id) })); } catch { /* ignore */ } };
  const clearRun = () => { try { sessionStorage.removeItem(saveKey()); } catch { /* ignore */ } };

  function begin(newSeed: string, only?: string[], resume?: { index: number; picked: (number | null)[] }) {
    seed = newSeed;
    run = make(seed, only);
    shown = run.questions.map((q) => shuffleChoices(q, seed));
    picked = resume?.picked ?? shown.map(() => null);
    index = resume?.index ?? 0;
    answered = picked[index] !== null && picked[index] !== undefined;
    renderQuestion();
  }

  function linkFor(q: Question): string {
    // mixed quizzes carry each question's own topic; a topic quiz uses the page it was started from
    const page = (q as Partial<TopicQuestion>).topic ?? run.topicPath ?? '';
    return page ? `${base}${page}${q.link ?? ''}` : '';
  }

  function renderQuestion() {
    const q = shown[index];
    const total = shown.length;
    const label = run.label(q);
    root.innerHTML = `
      <div class="quiz-bar" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${index}"><i style="width:${(index / total) * 100}%"></i></div>
      <div class="quiz-body">
        <p class="quiz-count">Question ${index + 1} of ${total}${label ? ` · ${esc(label)}` : ''}</p>
        <h4 class="quiz-q" id="quiz-q" tabindex="-1">${esc(q.q)}</h4>
        <div class="quiz-choices" role="radiogroup" aria-labelledby="quiz-q">
          ${q.choices.map((c, i) => `<button type="button" role="radio" class="quiz-choice" data-i="${i}" aria-checked="false"><kbd>${i + 1}</kbd><span>${esc(c)}</span></button>`).join('')}
        </div>
        <div class="quiz-feedback" aria-live="polite"></div>
      </div>`;
    if (answered) showFeedback(false);
    root.querySelector<HTMLElement>('#quiz-q')?.focus({ preventScroll: true });
  }

  function choose(i: number) {
    if (answered) return;
    picked[index] = i;
    answered = true;
    persistRun();
    showFeedback(true);
  }

  function showFeedback(announce: boolean) {
    const q = shown[index];
    const choice = picked[index]!;
    const ok = choice === q.answer;
    root.querySelectorAll<HTMLElement>('.quiz-choice').forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === choice));
      b.setAttribute('aria-disabled', 'true');
      if (i === q.answer) { b.classList.add('is-correct'); b.insertAdjacentHTML('beforeend', '<em class="quiz-flag">Correct answer</em>'); }
      else if (i === choice) { b.classList.add('is-wrong'); b.insertAdjacentHTML('beforeend', '<em class="quiz-flag">Your answer</em>'); }
    });
    const last = index === shown.length - 1;
    const href = linkFor(q);
    root.querySelector('.quiz-feedback')!.innerHTML = `
      <div class="quiz-explain ${ok ? 'ok' : 'bad'}">
        <b>${ok ? 'Correct.' : 'Not quite.'}</b> ${esc(q.why)}
        ${href ? `<a href="${esc(href)}">Read the section</a>` : ''}
      </div>
      <div class="quiz-actions"><button type="button" class="btn primary" data-next>${last ? 'See results' : 'Next question'} <kbd>Enter</kbd></button>
      <a class="quiz-report" href="${REPORT}&title=${encodeURIComponent(`Question ${q.id}`)}" target="_blank" rel="noopener noreferrer">Report a problem with this question</a></div>`;
    if (announce) root.querySelector<HTMLElement>('[data-next]')?.focus({ preventScroll: true });
  }

  function next() {
    if (!answered) return;
    if (index < shown.length - 1) { index++; answered = picked[index] !== null && picked[index] !== undefined; persistRun(); renderQuestion(); }
    else finish();
  }

  function finish() {
    const score = scoreRun(shown, picked);
    const now = Date.now();
    progress.update((d) => {
      for (const q of shown) {
        const was = d.quiz.items[q.id] ?? newItem(now);
        d.quiz.items[q.id] = grade(was, score.missed.includes(q.id) ? 'again' : 'good', now);
      }
      d.quiz.attempts = [...d.quiz.attempts, { id: run.id, score: score.correct, of: score.of, at: now }].slice(-200);
    });
    clearRun();
    const pct = Math.round((score.correct / score.of) * 100);
    const message = pct === 100 ? 'Perfect.' : pct >= 70 ? 'Solid. Check the ones you missed.' : 'Worth another look at the topic, then try again.';
    root.innerHTML = `
      <div class="quiz-bar"><i style="width:100%"></i></div>
      <div class="quiz-body quiz-results">
        <p class="quiz-count">Results</p>
        <h4 class="quiz-score" tabindex="-1">${score.correct} of ${score.of} <span>${pct}%</span></h4>
        <p class="quiz-msg">${message} Missed questions will come back for review.</p>
        <ol class="quiz-review">
          ${shown.map((q, i) => {
            const ok = picked[i] === q.answer;
            const href = linkFor(q);
            return `<li class="${ok ? 'ok' : 'bad'}"><span class="quiz-mark" aria-label="${ok ? 'Correct' : 'Incorrect'}">${ok ? '✓' : '✗'}</span>
              <div><b>${esc(q.q)}</b>${ok ? '' : `<p>Answer: ${esc(q.choices[q.answer])}. ${esc(q.why)} ${href ? `<a href="${esc(href)}">Read the section</a>` : ''}</p>`}</div></li>`;
          }).join('')}
        </ol>
        <div class="quiz-actions">
          <button type="button" class="btn primary" data-again>Try again</button>
          ${score.missed.length ? `<button type="button" class="btn" data-missed="${esc(score.missed.join(','))}">Retry the ${score.missed.length} missed</button>` : ''}
        </div>
      </div>`;
    root.querySelector<HTMLElement>('.quiz-score')?.focus({ preventScroll: true });
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const c = t.closest<HTMLElement>('.quiz-choice');
    if (c) choose(Number(c.dataset.i));
    else if (t.closest('[data-next]')) next();
    else if (t.closest('[data-again]')) begin(String(Date.now()));
    else if (t.closest('[data-missed]')) begin(String(Date.now()), t.closest<HTMLElement>('[data-missed]')!.dataset.missed!.split(','));
  });
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('a, select, input')) return;
    if (/^[1-5]$/.test(e.key) && !answered && root.querySelector('.quiz-choice')) { const i = Number(e.key) - 1; if (i < shown[index].choices.length) { e.preventDefault(); choose(i); } }
    else if (e.key === 'Enter' && answered && root.querySelector('[data-next]') && !t.closest('[data-next]')) { e.preventDefault(); next(); }
  });

  // let the caller draw an intro and call back to start; also offer to resume an unfinished run
  const resumeRun = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`primer:quizrun:${make('probe').id}`) || 'null');
      return saved && Array.isArray(saved.picked) ? saved : null;
    } catch { return null; }
  };
  const saved = resumeRun();
  if (saved) {
    const probe = make(saved.seed);
    const same = probe.questions.map((q) => q.id).join() === (saved.ids || []).join();
    if (same && saved.index < probe.questions.length) { begin(saved.seed, undefined, { index: saved.index, picked: saved.picked }); return; }
  }
  intro(() => begin(String(Date.now())), (ids) => begin(String(Date.now()), ids));
}

/* ------------------------------------------------------------ topic quiz (end of a topic page) */

export function mount(host: HTMLElement) {
  const src = host.dataset.src!;
  const slug = host.dataset.slug!;
  const progress = getProgress();
  const root = document.createElement('section');
  root.className = 'widget quiz';
  root.setAttribute('aria-label', 'Test yourself');
  host.replaceChildren(root);
  root.innerHTML = '<div class="quiz-body"><p class="ch-note">Loading questions…</p></div>';

  fetch(src).then((r) => r.json() as Promise<QuizFile>).then((file) => {
    const make = (seed: string, only?: string[]): Run => {
      const qs = only ? file.questions.filter((q) => only.includes(q.id)) : file.questions;
      return { id: slug, title: file.title, topicPath: file.topic, reviewed: file.reviewed, questions: seededShuffle(qs, `${seed}:order`), label: () => undefined };
    };
    runner(root, make, (start) => {
      const doc = progress.get();
      const last = [...doc.quiz.attempts].reverse().find((a) => a.id === slug);
      const dueNow = file.questions.filter((q) => doc.quiz.items[q.id] && doc.quiz.items[q.id].seen > 0 && isDue(doc.quiz.items[q.id], Date.now()));
      const mins = Math.max(1, Math.round(file.questions.length * 0.7));
      root.innerHTML = `
        <div class="widget-head"><div><p class="eyebrow">Test yourself</p><h3>${file.questions.length} questions on ${esc(file.title)}</h3>
          <p>About ${mins} minutes. Pick an answer for instant feedback. Questions you miss come back for review.</p></div></div>
        <div class="quiz-body">
          ${file.reviewed ? '' : `<p class="quiz-draft"><b>Draft.</b> These questions have not been checked by a second person yet. If something looks wrong, <a href="${REPORT}" target="_blank" rel="noopener noreferrer">report it</a>.</p>`}
          ${last ? `<p class="quiz-last">Last attempt: <b>${last.score} of ${last.of}</b>.</p>` : ''}
          <div class="quiz-actions"><button type="button" class="btn primary" data-start>${last ? 'Take it again' : 'Start the quiz'}</button>
          ${dueNow.length ? `<button type="button" class="btn" data-missed="${esc(dueNow.map((q) => q.id).join(','))}">Review ${dueNow.length} due</button>` : ''}</div>
        </div>`;
      root.querySelector('[data-start]')!.addEventListener('click', start);
    });
  }).catch(() => { root.innerHTML = '<div class="quiz-body"><p class="ch-note">The quiz could not be loaded. Check your connection and reload the page.</p></div>'; });
}

/* ------------------------------------------------------------ mixed quiz (/quiz/) */

export function mountMixed(host: HTMLElement) {
  const progress = getProgress();
  const root = document.createElement('section');
  root.className = 'widget quiz';
  root.setAttribute('aria-label', 'Mixed quiz');
  host.replaceChildren(root);
  root.innerHTML = '<div class="quiz-body"><p class="ch-note">Loading questions…</p></div>';

  fetch(`${base}data/quiz/index.json`).then((r) => r.json() as Promise<{ slug: string }[]>)
    .then((idx) => Promise.all(idx.map((e) => fetch(`${base}data/quiz/${e.slug}.json`).then((r) => r.json() as Promise<QuizFile>))))
    .then((files) => {
      const all: TopicQuestion[] = files.flatMap((f) => f.questions.map((q) => ({ ...q, topic: f.topic })));
      const titles = new Map(files.map((f) => [f.topic, f.title]));
      const anyDraft = files.some((f) => !f.reviewed);
      let count = 10;

      const make = (seed: string, only?: string[]): Run => {
        const doc = progress.get();
        const readTopics = new Set(all.map((q) => q.topic).filter((t) => isRead(doc, t)));
        const chosen = only ? all.filter((q) => only.includes(q.id)) : pickQuestions({ questions: all, items: doc.quiz.items, readTopics, count, now: Date.now(), seed });
        return { id: 'mixed', title: 'Mixed quiz', questions: chosen, reviewed: !anyDraft, label: (q) => titles.get((q as TopicQuestion).topic) };
      };
      runner(root, make, (start) => {
        const doc = progress.get();
        const due = all.filter((q) => doc.quiz.items[q.id]?.seen && isDue(doc.quiz.items[q.id], Date.now())).length;
        const draw = () => {
          root.innerHTML = `
            <div class="widget-head"><div><p class="eyebrow">Mixed quiz</p><h3>Questions from across the topics</h3>
              <p>Due reviews come first, then questions from topics you have read, then the rest.</p></div></div>
            <div class="quiz-body">
              ${anyDraft ? `<p class="quiz-draft"><b>Draft.</b> Some questions have not been checked by a second person yet. <a href="${REPORT}" target="_blank" rel="noopener noreferrer">Report anything that looks wrong</a>.</p>` : ''}
              <p class="quiz-last">${all.length} questions available${due ? `, <b>${due} due for review</b>` : ''}.</p>
              <label class="lab-field inline"><span>Number of questions</span>
                <div class="lab-input"><select id="quiz-count" aria-label="Number of questions">${[5, 10, 15].map((n) => `<option${n === count ? ' selected' : ''}>${n}</option>`).join('')}</select></div></label>
              <div class="quiz-actions"><button type="button" class="btn primary" data-start>Start</button></div>
            </div>`;
          root.querySelector('[data-start]')!.addEventListener('click', start);
          root.querySelector('#quiz-count')!.addEventListener('change', (e) => { count = Number((e.target as HTMLSelectElement).value); });
        };
        draw();
      });
    })
    .catch(() => { root.innerHTML = '<div class="quiz-body"><p class="ch-note">Quizzes could not be loaded. Reload the page to try again.</p></div>'; });
}
