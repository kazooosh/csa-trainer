/* CSA Trainer - reine Frontend-App, Fortschritt liegt im Browser. */

/* ------------------------------------------------------------------ *
 * Speicher (mit In-Memory-Fallback, falls localStorage blockiert ist) *
 * ------------------------------------------------------------------ */
const MEM = {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return k in MEM ? MEM[k] : null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { MEM[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete MEM[k]; } }
};
const K_PROGRESS = 'csa.progress.v1';
const K_SESSION = 'csa.session.v1';
const K_QUESTIONS = 'csa.questions.v1';

/* Mitgelieferte Kataloge. Werden zusammengeführt, die Kategorie kommt aus der jeweiligen Datei. */
const CATALOG_FILES = ['questions.json', 'measureup.json'];

/* Schwierigkeitsgrade in Anzeige-Reihenfolge. 'unknown' für Kataloge ohne Einstufung (z. B. MeasureUp). */
const DIFFS = ['easy', 'medium', 'hard', 'unknown'];
const DIFF_LABEL = { easy: 'easy', medium: 'medium', hard: 'hard', unknown: 'unbekannt' };
const diffLabel = (d) => DIFF_LABEL[d] || d;

/* ------------------------------------------------------------------ *
 * Notfall-Katalog: greift nur, wenn questions.json nicht ladbar ist   *
 * (z. B. beim Öffnen per Doppelklick ohne Webserver).                 *
 * ------------------------------------------------------------------ */
const FALLBACK = {
  meta: { title: 'ServiceNow CSA', subtitle: 'Practice Exam', version: 1 },
  questions: [
    { number: 'Q1', category: 'Service Catalog', difficulty: 'easy',
      question: 'A Service Catalog may include which of the following components?',
      options: ['Order Guides, Exchange Rates, Calendars', 'Order Guides, Catalog Items, and Interceptors', 'Catalog Items, Asset Contracts, Task Surveys', 'Record Producers, Order Guides, and Catalog Items'],
      answer: ['D'],
      explanation: 'A Service Catalog is assembled from Catalog Items, Order Guides and Record Producers. Option D names all three. The other choices fold in unrelated platform features such as Exchange Rates, Calendars, Asset Contracts and Task Surveys.',
      reference: 'ServiceNow Docs - Service Catalog Management' },
    { number: 'Q2', category: 'Import Sets & Data Sources', difficulty: 'medium',
      question: 'Which one of the following statements applies to a set of fields when they are coalesced during an import?',
      options: ['If a match is found using the coalesce fields, the existing record is updated with the information being imported', 'If a match is not found using the coalesce fields, the system does not create a Transform Map', 'If a match is found using the coalesce fields, the system creates a new record', 'If a match is not found using the coalesce fields, the existing record is updated with the information being imported'],
      answer: ['A'],
      explanation: 'The coalesce fields serve as the match key during a transform. On a match the existing record is updated instead of a duplicate being inserted (A). Without a match a new record is inserted, so C and D reverse the logic, and coalescing has no bearing on whether a Transform Map is created (B).',
      reference: 'ServiceNow Docs - Field mapping and coalesce' },
    { number: 'Q3', category: 'Reporting & Analytics', difficulty: 'medium',
      question: 'As it relates to ServiceNow reporting, which of the following statements describes what a metric can do?',
      options: ['A metric is a report gauge used on homepages to display real-time data', 'A metric is a time measurement used to report the effectiveness of workflows and SLAs', 'A metric is used to measure and evaluate the effectiveness of IT service management processes', 'A metric is a comparative measurement used to report the effectiveness of workflows and SLAs'],
      answer: ['C'],
      explanation: 'A Metric measures and evaluates how effective and efficient ITSM processes are over time, for example how long a record stays in a given state (C). A gauge (A) is a homepage visualization, and B and D describe SLA behavior.',
      reference: 'ServiceNow Docs - Metrics' },
    { number: 'Q4', category: 'Service Catalog', difficulty: 'medium',
      question: 'The display sequence is controlled in a Service Catalog item using which of the following?',
      options: ['The Default Value field in the Catalog Item form', 'The Sequence field in the Catalog Item form', 'The Order field in the Variable form', 'The Choice field in the Variable form'],
      answer: ['C'],
      explanation: 'The order in which variables appear is governed by the Order field on each Variable record; lower values render higher (C). Default Value seeds a starting value, Choice defines selectable options, and the Catalog Item form has no Sequence field driving variable order.',
      reference: 'ServiceNow Docs - Service Catalog variables' },
    { number: 'Q5', category: 'Reporting & Analytics', difficulty: 'medium',
      question: 'Reports can be created from which different places in the platform? (Choose two.)',
      options: ['List column heading', 'Metrics module', 'Statistics module', 'View / Run module'],
      answer: ['A', 'D'],
      explanation: 'A report can be generated from a list column heading (A) and from the Reports application via the View / Run module, which opens the report designer (D). The Metrics and Statistics modules are not entry points for building reports.',
      reference: 'ServiceNow Docs - Create a report' }
  ]
};

/* ------------------------------------------------------------------ *
 * Zustand                                                             *
 * ------------------------------------------------------------------ */
let META = {};
let QUESTIONS = [];
let BY_ID = {};
let progress = {};
let session = null;
let setup = { mode: 'all', sources: ['all'], cats: [], diffs: [], count: 20 };
let questionsFromImport = false;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const LETTERS = 'ABCDEFGHIJ';

/* stabile ID aus dem Fragetext, damit ein Neu-Parsen der PDF den Fortschritt nicht killt */
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'q' + h.toString(36);
}

/* Mehrere Kataloge zu einem zusammenführen. Nimmt ein einzelnes Objekt oder ein Array davon. */
function mergeCatalogs(list) {
  const arr = (Array.isArray(list) ? list : [list]).filter((c) => c && Array.isArray(c.questions));
  return {
    meta: Object.assign({}, (arr[0] && arr[0].meta) || {}, { sources: arr.map((c) => (c.meta && c.meta.source) || '') }),
    questions: arr.reduce((all, c) => all.concat(c.questions), [])
  };
}

async function loadBundled() {
  const results = await Promise.all(CATALOG_FILES.map(async (f) => {
    try {
      const res = await fetch(f, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (e) {
      console.info(f + ' nicht geladen.');
      return null;
    }
  }));
  return mergeCatalogs(results);
}

function normalize(raw) {
  META = raw.meta || {};
  QUESTIONS = (raw.questions || []).map((q, i) => {
    const options = q.options || [];
    const answerLetters = (Array.isArray(q.answer) ? q.answer : [q.answer])
      .map((a) => String(a).trim().toUpperCase());
    const answer = answerLetters
      .map((l) => (/^\d+$/.test(l) ? Number(l) : LETTERS.indexOf(l)))
      .filter((n) => n >= 0 && n < options.length);
    const urls = (Array.isArray(q.referenceUrl) ? q.referenceUrl : [q.referenceUrl])
      .map((u) => String(u || '').trim())
      .filter((u) => /^https?:\/\//i.test(u));
    const diff = String(q.difficulty || '').trim().toLowerCase();
    return {
      id: q.id || hashId(q.question || ('idx' + i)),
      number: q.number || 'Q' + (i + 1),
      category: q.category || 'Ohne Kategorie',
      topic: q.topic || '',
      difficulty: DIFFS.includes(diff) ? diff : 'unknown',
      question: q.question || '',
      options,
      answer,
      multi: answer.length > 1,
      explanation: q.explanation || '',
      reference: q.reference || '',
      referenceUrls: urls
    };
  }).filter((q) => q.question && q.options.length >= 2 && q.answer.length);
  BY_ID = {};
  QUESTIONS.forEach((q) => { BY_ID[q.id] = q; });
}

const BLANK = { box: 0, streak: 0, correct: 0, wrong: 0, seen: 0, needsWork: false, marked: false, last: 0 };
/* peek liest nur, prog legt an. Sonst füllt sich der Speicher mit leeren Datensätzen. */
function peek(id) { return progress[id] || BLANK; }
function prog(id) {
  if (!progress[id]) progress[id] = Object.assign({}, BLANK);
  return progress[id];
}
function saveProgress() { store.set(K_PROGRESS, JSON.stringify(progress)); }
function saveSession() { session ? store.set(K_SESSION, JSON.stringify(session)) : store.del(K_SESSION); }

/* ------------------------------------------------------------------ *
 * Start                                                               *
 * ------------------------------------------------------------------ */
async function boot() {
  try { progress = JSON.parse(store.get(K_PROGRESS) || '{}'); } catch (e) { progress = {}; }

  const imported = store.get(K_QUESTIONS);
  if (imported) {
    try { normalize(JSON.parse(imported)); questionsFromImport = true; } catch (e) { /* fällt unten durch */ }
  }
  if (!QUESTIONS.length && window.__EMBEDDED_QUESTIONS__) {
    try { normalize(mergeCatalogs(window.__EMBEDDED_QUESTIONS__)); } catch (e) { /* fällt unten durch */ }
  }
  if (!QUESTIONS.length) {
    normalize(await loadBundled());
    if (!QUESTIONS.length) {
      normalize(FALLBACK);
      console.info('Keine Kataloge geladen, Notfall-Katalog aktiv.');
    }
  }

  try {
    const s = JSON.parse(store.get(K_SESSION) || 'null');
    if (s && s.ids && s.ids.every((id) => BY_ID[id])) session = s;
  } catch (e) { session = null; }

  wire();
  renderMenu();
  show('menu');
}

/* ------------------------------------------------------------------ *
 * Navigation                                                          *
 * ------------------------------------------------------------------ */
function show(name) {
  ['menu', 'setup', 'quiz', 'result', 'stats', 'data'].forEach((s) => {
    $('#screen-' + s).classList.toggle('hidden', s !== name);
  });
  const quiz = name === 'quiz';
  $('#rail').classList.toggle('hidden', !quiz);
  if (!quiz) $('#counter').textContent = '';
  $('#brandSub').textContent = quiz ? '' : (META.title || '');
  window.scrollTo(0, 0);
  document.body.dataset.screen = name;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

/* ------------------------------------------------------------------ *
 * Pools                                                               *
 * ------------------------------------------------------------------ */
const isWrongList = (q) => peek(q.id).needsWork;
const isMarked = (q) => peek(q.id).marked;

function poolFor(sources, cats, diffs) {
  let base = QUESTIONS.filter((q) => {
    if (sources.includes('all')) return true;
    if (sources.includes('wrong') && isWrongList(q)) return true;
    if (sources.includes('marked') && isMarked(q)) return true;
    return false;
  });
  if (cats && cats.length) base = base.filter((q) => cats.includes(q.category));
  if (diffs && diffs.length) base = base.filter((q) => diffs.includes(q.difficulty));
  return base;
}

function weightOf(q) {
  const p = progress[q.id];
  if (!p || !p.seen) return 12;
  let w = Math.max(1, 6 - p.box * 1.2);
  if (p.needsWork) w *= 2;
  return w;
}

function drawWeighted(pool, n) {
  const items = pool.slice();
  const out = [];
  n = Math.min(n, items.length);
  for (let k = 0; k < n; k++) {
    const total = items.reduce((s, q) => s + weightOf(q), 0);
    let r = Math.random() * total;
    let idx = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      r -= weightOf(items[i]);
      if (r <= 0) { idx = i; break; }
    }
    out.push(items.splice(idx, 1)[0]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Hauptmenü                                                           *
 * ------------------------------------------------------------------ */
function renderMenu() {
  const wrong = QUESTIONS.filter(isWrongList).length;
  const marked = QUESTIONS.filter(isMarked).length;
  const mix = QUESTIONS.filter((q) => isWrongList(q) || isMarked(q)).length;

  $('#cntAll').textContent = QUESTIONS.length;
  $('#cntWrong').textContent = wrong;
  $('#cntMarked').textContent = marked;
  $('#cntMix').textContent = mix;
  $('#cardWrong').disabled = wrong === 0;
  $('#cardMarked').disabled = marked === 0;
  $('#cardMix').disabled = mix === 0;

  let seen = 0, right = 0, total = 0;
  Object.values(progress).forEach((p) => { if (p.seen) seen++; right += p.correct; total += p.correct + p.wrong; });
  $('#mStatSeen').textContent = seen + ' / ' + QUESTIONS.length;
  $('#mStatRate').textContent = total ? Math.round((right / total) * 100) + '%' : '--';
  $('#mStatGaps').textContent = wrong;
  $('#menuSub').textContent = (META.title || 'Fragenkatalog') + ' mit ' + QUESTIONS.length + ' Fragen.';

  const open = session ? session.ids.filter((id) => !session.answers[id] || !session.answers[id].resolved).length : 0;
  $('#resumeCard').classList.toggle('hidden', !session || open === 0);
  if (session) $('#resumeDesc').textContent = open + ' von ' + session.ids.length + ' Fragen noch offen';
}

/* ------------------------------------------------------------------ *
 * Setup                                                               *
 * ------------------------------------------------------------------ */
function openSetup(mode) {
  setup.mode = mode;
  setup.sources = mode === 'all' ? ['all'] : mode === 'mix' ? ['wrong', 'marked'] : [mode];
  setup.cats = [];
  setup.diffs = [];

  const titles = { all: 'Neue Runde', wrong: 'Wissenslücken', marked: 'Markierte Fragen', mix: 'Lücken und Markierte' };
  $('#setupTitle').textContent = titles[mode];
  $('#setupSub').textContent = 'Filter setzen, Länge wählen, los.';

  const cats = Array.from(new Set(QUESTIONS.map((q) => q.category))).sort();
  $('#catChips').innerHTML = cats.map((c) =>
    '<button class="chip" data-cat="' + esc(c) + '">' + esc(c) + '<span class="n">' + QUESTIONS.filter((q) => q.category === c).length + '</span></button>'
  ).join('');

  const diffs = DIFFS.filter((d) => QUESTIONS.some((q) => q.difficulty === d));
  $('#diffChips').innerHTML = diffs.map((d) =>
    '<button class="chip" data-diff="' + d + '">' + diffLabel(d) + '<span class="n">' + QUESTIONS.filter((q) => q.difficulty === d).length + '</span></button>'
  ).join('');

  syncSetup();
  show('setup');
}

function syncSetup() {
  $$('#sourceChips .chip').forEach((c) => c.classList.toggle('on', setup.sources.includes(c.dataset.src)));
  $$('#catChips .chip').forEach((c) => c.classList.toggle('on', setup.cats.includes(c.dataset.cat)));
  $$('#diffChips .chip').forEach((c) => c.classList.toggle('on', setup.diffs.includes(c.dataset.diff)));

  const pool = poolFor(setup.sources, setup.cats, setup.diffs);
  const input = $('#countInput');
  input.max = Math.max(1, pool.length);
  $('#poolHint').textContent = pool.length
    ? pool.length + ' Fragen passen zum Filter. Mehr als das gibt es nicht, größere Zahlen werden gekappt.'
    : 'Keine Frage passt zu diesem Filter.';
  $('#startBtn').disabled = pool.length === 0;
}

/* ------------------------------------------------------------------ *
 * Session                                                             *
 * ------------------------------------------------------------------ */
function startSession(ids) {
  session = { ids, i: 0, answers: {}, startedAt: Date.now() };
  saveSession();
  renderQuiz();
  show('quiz');
}

function ansOf(id) {
  if (!session.answers[id]) session.answers[id] = { picks: [], attempts: 0, resolved: false, firstTry: false, wrongPicks: [] };
  return session.answers[id];
}

function commitProgress(id, firstTry) {
  const p = prog(id);
  p.seen++;
  p.last = Date.now();
  if (firstTry) {
    p.correct++;
    p.streak++;
    p.box = Math.min(4, p.box + 1);
    if (p.streak >= 2) p.needsWork = false;
  } else {
    p.wrong++;
    p.streak = 0;
    p.box = Math.max(0, p.box - 1);
    p.needsWork = true;
  }
  saveProgress();
}

/* ------------------------------------------------------------------ *
 * Quiz-Rendering                                                      *
 * ------------------------------------------------------------------ */
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function renderRail() {
  $('#rail').innerHTML = session.ids.map((id, i) => {
    const a = session.answers[id];
    let cls = 'rail-tick';
    if (a && a.resolved) cls += a.firstTry ? ' correct' : ' wrong';
    if (i === session.i) cls += ' current';
    return '<button class="' + cls + '" data-jump="' + i + '" title="Frage ' + (i + 1) + '"></button>';
  }).join('');
}

function renderQuiz() {
  const id = session.ids[session.i];
  const q = BY_ID[id];
  const a = ansOf(id);
  const p = peek(id);

  renderRail();
  $('#counter').textContent = (session.i + 1) + ' / ' + session.ids.length;

  $('#qMeta').innerHTML =
    '<span class="tag num">' + esc(q.number) + '</span>' +
    '<span class="tag">' + esc(q.category) + '</span>' +
    (q.topic ? '<span class="tag topic" title="' + esc(q.topic) + '">' + esc(q.topic) + '</span>' : '') +
    '<span class="tag ' + esc(q.difficulty) + '">' + esc(diffLabel(q.difficulty)) + '</span>' +
    '<span class="spacer"></span>' +
    '<span class="leitner"><span class="cap">BOX</span>' +
      [0, 1, 2, 3, 4].map((b) => '<span class="pip' + (b <= p.box && p.seen ? ' on' : '') + '"></span>').join('') +
    '</span>' +
    '<button class="mark-btn ' + (p.marked ? 'on' : '') + '" id="markBtn">' + (p.marked ? '★ Markiert' : '☆ Merken') + '</button>';

  $('#qText').textContent = q.question;
  $('#qNote').textContent = q.multi ? 'Mehrfachauswahl: ' + q.answer.length + ' Antworten' : '';

  $('#qOptions').innerHTML = q.options.map((opt, i) => {
    let cls = 'opt';
    if (a.resolved) {
      if (q.answer.includes(i)) cls += ' correct';
      else if (a.picks.includes(i) || a.wrongPicks.includes(i)) cls += ' wrong';
      else cls += ' dimmed';
    } else {
      if (a.picks.includes(i)) cls += ' picked';
      if (a.wrongPicks.includes(i)) cls += ' wrong dimmed';
    }
    return '<button class="' + cls + '" data-opt="' + i + '"' + (a.resolved ? ' disabled' : '') + '>' +
      '<span class="letter">' + LETTERS[i] + '</span><span class="txt">' + esc(opt) + '</span></button>';
  }).join('');

  const confirmRow = $('#qConfirmRow');
  if (q.multi && !a.resolved) {
    confirmRow.innerHTML = '<button class="btn btn-primary" id="confirmBtn"' + (a.picks.length ? '' : ' disabled') + '>Antwort prüfen<span class="kbd">Enter</span></button>' +
      '<span class="hint" style="margin:0">Versuch ' + (a.attempts + 1) + ' von 2</span>';
  } else {
    confirmRow.innerHTML = '';
  }

  $('#qExplain').innerHTML = a.resolved ? explainHtml(q, a) : '';

  $('#prevBtn').disabled = session.i === 0;
  $('#nextBtn').textContent = session.i === session.ids.length - 1 ? 'Runde auswerten' : 'Weiter →';
}

function explainHtml(q, a) {
  const letters = q.answer.map((i) => LETTERS[i]).join(', ');
  const verdict = a.firstTry ? 'Richtig' : a.solved ? 'Richtig im zweiten Versuch' : 'Falsch';
  return '<div class="explain">' +
    '<div class="verdict ' + (a.firstTry ? 'ok' : 'bad') + '">' +
      verdict + ' &middot; Lösung ' + letters +
    '</div>' + paragraphs(q.explanation) + refHtml(q) +
    '</div>';
}

/* Absätze aus Zeilenumbrüchen, MeasureUp erklärt jede Option in einer eigenen Zeile */
function paragraphs(text) {
  return String(text).split(/\n+/).map((t) => t.trim()).filter(Boolean)
    .map((t) => '<p>' + esc(t) + '</p>').join('');
}

function refHtml(q) {
  const urls = q.referenceUrls;
  if (!urls.length) return q.reference ? '<div class="ref">' + esc(q.reference) + '</div>' : '';
  const label = (u, i) => {
    if (q.reference && urls.length === 1) return q.reference;
    let host = '';
    try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { host = 'Link'; }
    return (q.reference ? q.reference + ' ' : 'Quelle ') + (i + 1) + ' (' + host + ')';
  };
  return urls.map((u, i) =>
    '<div class="ref"><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(label(u, i)) + ' &#8599;</a></div>'
  ).join('');
}

function shake() {
  const el = $('#qOptions');
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

function pickOption(i) {
  const id = session.ids[session.i];
  const q = BY_ID[id];
  const a = ansOf(id);
  if (a.resolved) return;

  if (q.multi) {
    const at = a.picks.indexOf(i);
    at >= 0 ? a.picks.splice(at, 1) : a.picks.push(i);
    saveSession();
    renderQuiz();
    return;
  }

  if (a.wrongPicks.includes(i)) return;
  if (q.answer.includes(i)) {
    a.picks = [i];
    a.firstTry = a.attempts === 0;
    a.solved = true;
    a.resolved = true;
    commitProgress(id, a.firstTry);
    saveSession();
    renderQuiz();
  } else {
    a.attempts++;
    a.wrongPicks.push(i);
    if (a.attempts >= 2) { a.resolved = true; a.firstTry = false; a.solved = false; commitProgress(id, false); }
    saveSession();
    renderQuiz();
    shake();
  }
}

function confirmMulti() {
  const id = session.ids[session.i];
  const q = BY_ID[id];
  const a = ansOf(id);
  if (a.resolved || !a.picks.length) return;

  if (sameSet(a.picks, q.answer)) {
    a.firstTry = a.attempts === 0;
    a.solved = true;
    a.resolved = true;
    commitProgress(id, a.firstTry);
    saveSession();
    renderQuiz();
  } else {
    a.attempts++;
    if (a.attempts >= 2) {
      a.resolved = true;
      a.firstTry = false;
      a.solved = false;
      commitProgress(id, false);
    } else {
      a.picks = [];
    }
    saveSession();
    renderQuiz();
    shake();
  }
}

function goTo(i) {
  if (i < 0 || i >= session.ids.length) return;
  session.i = i;
  saveSession();
  renderQuiz();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function nextQuestion() {
  if (session.i === session.ids.length - 1) finishSession();
  else goTo(session.i + 1);
}

/* ------------------------------------------------------------------ *
 * Auswertung                                                          *
 * ------------------------------------------------------------------ */
function finishSession() {
  const resolved = session.ids.filter((id) => session.answers[id] && session.answers[id].resolved);
  const right = resolved.filter((id) => session.answers[id].firstTry).length;
  const wrong = resolved.length - right;
  const open = session.ids.length - resolved.length;

  $('#resPct').textContent = resolved.length ? Math.round((right / resolved.length) * 100) + '%' : '--';
  $('#resCap').textContent = right + ' von ' + resolved.length + ' im ersten Versuch';
  $('#resRight').textContent = right;
  $('#resWrong').textContent = wrong;
  $('#resOpen').textContent = open;

  $('#resList').innerHTML = session.ids.map((id, i) => {
    const q = BY_ID[id];
    const a = session.answers[id];
    const st = !a || !a.resolved ? '' : a.firstTry ? 'correct' : 'wrong';
    return '<button class="review-item" data-review="' + i + '">' +
      '<span class="tick ' + st + '"></span>' +
      '<span><span class="q">' + esc(q.question) + '</span>' +
      '<span class="m">' + esc(q.number) + ' &middot; ' + esc(q.category) + ' &middot; ' +
      (!a || !a.resolved ? 'nicht beantwortet' : a.firstTry ? 'richtig' : 'falsch') + '</span></span></button>';
  }).join('');

  const wrongIds = resolved.filter((id) => !session.answers[id].firstTry);
  $('#resRetry').disabled = wrongIds.length === 0;
  $('#resRetry').textContent = wrongIds.length ? 'Die ' + wrongIds.length + ' falschen nachüben' : 'Keine falschen Antworten';
  $('#resRetry').dataset.ids = JSON.stringify(wrongIds);

  session = null;
  saveSession();
  renderMenu();
  show('result');
}

/* ------------------------------------------------------------------ *
 * Statistik                                                           *
 * ------------------------------------------------------------------ */
function bar(name, right, total) {
  const pct = total ? Math.round((right / total) * 100) : 0;
  return '<div class="bar-row"><span class="name" title="' + esc(name) + '">' + esc(name) + '</span>' +
    '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
    '<span class="val">' + (total ? pct + '%' : '--') + '</span></div>';
}

function renderStats() {
  let seen = 0, right = 0, total = 0;
  Object.values(progress).forEach((p) => { if (p.seen) seen++; right += p.correct; total += p.correct + p.wrong; });
  $('#sTotal').textContent = QUESTIONS.length;
  $('#sSeen').textContent = seen;
  $('#sRate').textContent = total ? Math.round((right / total) * 100) + '%' : '--';

  const boxes = [0, 0, 0, 0, 0];
  let untouched = 0;
  QUESTIONS.forEach((q) => {
    const p = progress[q.id];
    if (!p || !p.seen) untouched++;
    else boxes[p.box]++;
  });
  $('#sBoxes').innerHTML = boxes.map((n, i) => bar('Box ' + i, n, QUESTIONS.length)
    .replace(/<span class="val">.*?<\/span>/, '<span class="val">' + n + '</span>')).join('') +
    bar('Noch nie', untouched, QUESTIONS.length).replace(/<span class="val">.*?<\/span>/, '<span class="val">' + untouched + '</span>');

  const group = (keyFn) => {
    const m = {};
    QUESTIONS.forEach((q) => {
      const k = keyFn(q);
      const p = progress[q.id] || { correct: 0, wrong: 0 };
      if (!m[k]) m[k] = { right: 0, total: 0 };
      m[k].right += p.correct;
      m[k].total += p.correct + p.wrong;
    });
    return m;
  };
  const cats = group((q) => q.category);
  $('#sCats').innerHTML = Object.keys(cats).sort().map((k) => bar(k, cats[k].right, cats[k].total)).join('') || '<div class="empty">Noch keine Antworten.</div>';
  const diffs = group((q) => q.difficulty);
  $('#sDiffs').innerHTML = DIFFS.filter((d) => diffs[d]).map((d) => bar(diffLabel(d), diffs[d].right, diffs[d].total)).join('');
}

/* ------------------------------------------------------------------ *
 * Daten                                                               *
 * ------------------------------------------------------------------ */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFile(input, cb) {
  const f = input.files && input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { cb(JSON.parse(r.result)); } catch (e) { toast('Die Datei ist kein gültiges JSON.'); } };
  r.readAsText(f);
  input.value = '';
}

function renderData() {
  $('#qSourceHint').textContent = questionsFromImport
    ? 'Aktiv ist ein selbst geladener Katalog mit ' + QUESTIONS.length + ' Fragen.'
    : 'Aktiv sind die mitgelieferten Kataloge (' + CATALOG_FILES.join(', ') + ') mit ' + QUESTIONS.length + ' Fragen.';
}

/* ------------------------------------------------------------------ *
 * Events                                                              *
 * ------------------------------------------------------------------ */
function wire() {
  $('#brandBtn').onclick = () => { renderMenu(); show('menu'); };
  $$('[data-nav="menu"]').forEach((b) => { b.onclick = () => { renderMenu(); show('menu'); }; });

  $$('.menu-card[data-mode]').forEach((b) => { b.onclick = () => openSetup(b.dataset.mode); });
  $('#resumeCard').onclick = () => { renderQuiz(); show('quiz'); };
  $('#toStats').onclick = () => { renderStats(); show('stats'); };
  $('#toData').onclick = () => { renderData(); show('data'); };

  $('#sourceChips').onclick = (e) => {
    const c = e.target.closest('[data-src]');
    if (!c) return;
    const s = c.dataset.src;
    if (s === 'all') setup.sources = ['all'];
    else {
      setup.sources = setup.sources.filter((x) => x !== 'all');
      const at = setup.sources.indexOf(s);
      at >= 0 ? setup.sources.splice(at, 1) : setup.sources.push(s);
      if (!setup.sources.length) setup.sources = ['all'];
    }
    syncSetup();
  };
  $('#catChips').onclick = (e) => {
    const c = e.target.closest('[data-cat]');
    if (!c) return;
    const at = setup.cats.indexOf(c.dataset.cat);
    at >= 0 ? setup.cats.splice(at, 1) : setup.cats.push(c.dataset.cat);
    syncSetup();
  };
  $('#diffChips').onclick = (e) => {
    const c = e.target.closest('[data-diff]');
    if (!c) return;
    const at = setup.diffs.indexOf(c.dataset.diff);
    at >= 0 ? setup.diffs.splice(at, 1) : setup.diffs.push(c.dataset.diff);
    syncSetup();
  };

  $('#startBtn').onclick = () => {
    const pool = poolFor(setup.sources, setup.cats, setup.diffs);
    let n = parseInt($('#countInput').value, 10);
    if (!n || n < 1) n = 1;
    n = Math.min(n, pool.length);
    if (!n) return;
    startSession(drawWeighted(pool, n).map((q) => q.id));
  };

  $('#qOptions').onclick = (e) => {
    const b = e.target.closest('[data-opt]');
    if (b && !b.disabled) pickOption(Number(b.dataset.opt));
  };
  $('#qConfirmRow').onclick = (e) => { if (e.target.closest('#confirmBtn')) confirmMulti(); };
  $('#qMeta').onclick = (e) => {
    if (!e.target.closest('#markBtn')) return;
    const p = prog(session.ids[session.i]);
    p.marked = !p.marked;
    saveProgress();
    renderQuiz();
  };
  $('#rail').onclick = (e) => {
    const b = e.target.closest('[data-jump]');
    if (b) goTo(Number(b.dataset.jump));
  };
  $('#prevBtn').onclick = () => goTo(session.i - 1);
  $('#nextBtn').onclick = () => nextQuestion();
  $('#quitBtn').onclick = () => finishSession();

  $('#resList').onclick = (e) => {
    const b = e.target.closest('[data-review]');
    if (b) toast('Die Runde ist abgeschlossen. Starte eine neue, um die Frage erneut zu sehen.');
  };
  $('#resRetry').onclick = (e) => {
    const ids = JSON.parse(e.currentTarget.dataset.ids || '[]');
    if (ids.length) startSession(ids);
  };

  $('#expProgress').onclick = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download('csa-fortschritt-' + stamp + '.json', JSON.stringify({ type: 'csa-progress', version: 1, progress }, null, 2));
    toast('Fortschritt exportiert.');
  };
  $('#impProgressBtn').onclick = () => $('#impProgress').click();
  $('#impProgress').onchange = (e) => readFile(e.target, (data) => {
    const p = data.progress || data;
    if (typeof p !== 'object') return toast('Keine Fortschrittsdatei.');
    progress = p;
    saveProgress();
    renderMenu();
    renderData();
    toast('Fortschritt importiert.');
  });

  $('#impQuestionsBtn').onclick = () => $('#impQuestions').click();
  $('#impQuestions').onchange = (e) => readFile(e.target, (data) => {
    if (!data.questions || !data.questions.length) return toast('Keine Fragen in der Datei gefunden.');
    store.set(K_QUESTIONS, JSON.stringify(data));
    normalize(data);
    questionsFromImport = true;
    session = null;
    saveSession();
    renderMenu();
    renderData();
    toast(QUESTIONS.length + ' Fragen geladen.');
  });
  $('#resetQuestions').onclick = async () => {
    store.del(K_QUESTIONS);
    questionsFromImport = false;
    if (window.__EMBEDDED_QUESTIONS__) normalize(mergeCatalogs(window.__EMBEDDED_QUESTIONS__));
    else normalize(await loadBundled());
    if (!QUESTIONS.length) normalize(FALLBACK);
    session = null;
    saveSession();
    renderMenu();
    renderData();
    toast('Mitgelieferte Kataloge aktiv.');
  };

  $('#resetConfirm').oninput = (e) => { $('#resetBtn').disabled = e.target.value.trim() !== 'FORTSCHRITT LOESCHEN'; };
  $('#resetBtn').onclick = () => {
    progress = {};
    session = null;
    saveProgress();
    saveSession();
    $('#resetConfirm').value = '';
    $('#resetBtn').disabled = true;
    renderMenu();
    toast('Fortschritt gelöscht.');
  };

  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (document.body.dataset.screen !== 'quiz' || !session) return;

  const q = BY_ID[session.ids[session.i]];
  const a = ansOf(session.ids[session.i]);

  if (/^[1-9]$/.test(e.key)) {
    const i = Number(e.key) - 1;
    if (i < q.options.length) { e.preventDefault(); pickOption(i); }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!a.resolved && q.multi) confirmMulti();
    else if (a.resolved) nextQuestion();
    return;
  }
  if (e.key === 'ArrowRight') { e.preventDefault(); nextQuestion(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(session.i - 1); }
  if (e.key.toLowerCase() === 'm') {
    const p = prog(session.ids[session.i]);
    p.marked = !p.marked;
    saveProgress();
    renderQuiz();
  }
  if (e.key === 'Escape') { renderMenu(); show('menu'); }
}

boot();
