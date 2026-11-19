// The speaking coach. Three sources, tried in order:
// 1. Claude, through the claude.ai viewer (published web page)
// 2. your own server at EXPO_PUBLIC_COACH_URL (see server/)
// 3. the instant check below, which runs on the device and always works.
import { samplePromise } from './platform';

const COACH_URL = process.env.EXPO_PUBLIC_COACH_URL || '';
export const hasServer = !!COACH_URL;

const norm = (s) => ' ' + s.toLowerCase().replace(/[’`]/g, "'").replace(/[.,!?;:"“”«»„()[\]…–—]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

// Counts words and phrases from a list; "stem*" matches any word starting with stem.
function hits(text, list) {
  let count = 0;
  const found = [];
  for (const item of list) {
    const stem = item.endsWith('*');
    const needle = ' ' + (stem ? item.slice(0, -1) : item + ' ');
    let i = 0, c = 0;
    while ((i = text.indexOf(needle, i)) !== -1) { c++; i += needle.length - 1; }
    if (c) { count += c; found.push(stem ? item.slice(0, -1) : item); }
  }
  return { count, found };
}

export function quickCheck(answer, lang) {
  const lex = lang.lexicon;
  const t = lang.ui.offline;
  const n = norm(answer);
  const words = n.trim().split(' ').filter(Boolean).length;
  const hedges = hits(n, lex.hedges), sorry = hits(n, lex.sorry), harsh = hits(n, lex.harsh);
  const absolutes = hits(n, lex.absolutes), mine = hits(n, lex.iStatements), steps = hits(n, lex.nextSteps);
  const question = answer.includes('?');
  const caps = answer.split(/\s+/).some((w) => w.length >= 4 && w === w.toUpperCase() && w !== w.toLowerCase());
  const shouting = (answer.match(/!/g) || []).length > 1 || caps;

  let clarity = 7, calm = 8, confidence = 7, respect = 8;
  if (words < 6) { clarity -= 3; confidence -= 2; } else if (words < 12) clarity -= 1;
  if (words > 90) clarity -= 2;
  confidence -= Math.min(4, hedges.count * 1.5);
  clarity -= Math.min(2, hedges.count * 0.5);
  if (sorry.count > 1) confidence -= 2; else if (sorry.count === 1) confidence -= 0.5;
  respect -= Math.min(6, harsh.count * 3);
  calm -= Math.min(5, harsh.count * 2);
  if (absolutes.count) { respect -= 1; calm -= 1; }
  if (shouting) calm -= 2;
  if (mine.count) { respect += 1; confidence += 1; }
  if (steps.count || question) { clarity += 1; confidence += 0.5; }
  const clamp = (x) => Math.max(1, Math.min(10, Math.round(x)));

  const list = (f) => f.slice(0, 3).join(', ');
  const tips = [];
  if (harsh.count) tips.push(t.harsh.replace('{w}', list(harsh.found)));
  if (words < 6) tips.push(t.short);
  if (hedges.count) tips.push(t.hedges.replace('{w}', list(hedges.found)));
  if (sorry.count > 1) tips.push(t.sorry);
  if (absolutes.count) tips.push(t.absolutes);
  if (shouting) tips.push(t.shouting);
  if (words > 90) tips.push(t.long);
  if (!steps.count && !question && words >= 6) tips.push(t.nextStep);
  if (mine.count) tips.push(t.iGood);
  if (!tips.length || (tips.length === 1 && mine.count)) tips.unshift(t.good);

  return {
    source: 'quick',
    scores: { clarity: clamp(clarity), calm: clamp(calm), confidence: clamp(confidence), respect: clamp(respect) },
    feedback: tips.slice(0, 3).join('\n'),
  };
}

function buildPrompt({ answer, situation, lesson, lang }) {
  return [
    `You are SPEAK POWER, a warm, expert communication coach. Write every text value in ${lang.name}.`,
    `The user is practising this situation: ${situation}`,
    lesson ? `Lesson focus: ${lesson.title}. ${lesson.idea}` : '',
    'Assess the user’s answer for clarity, calmness, confidence and respect. Be specific about what they wrote, encouraging, and practical. Never encourage aggression, manipulation or deception.',
    'Reply with only a JSON object in exactly this shape:',
    '{"scores":{"clarity":7,"calm":8,"confidence":6,"respect":9},"feedback":"2 to 4 short sentences of specific feedback","example":"one improved answer the user could say in this situation"}',
    'Scores are whole numbers from 1 to 10. Use plain text in the strings, with no Markdown.',
    'The user’s answer:',
    '"""',
    answer.slice(0, 2000),
    '"""',
  ].filter(Boolean).join('\n');
}

const score = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : null; };

async function claudeCheck(input) {
  const sample = await samplePromise;
  if (!sample) return null;
  const data = await sample.json(buildPrompt(input), { modelTier: 'quick' });
  const s = (data && data.scores) || {};
  const scores = { clarity: score(s.clarity), calm: score(s.calm), confidence: score(s.confidence), respect: score(s.respect) };
  const feedback = typeof data?.feedback === 'string' ? data.feedback.trim() : '';
  if (!feedback) throw { code: 'invalid_json' };
  return {
    source: 'ai',
    scores: Object.values(scores).every((v) => v !== null) ? scores : null,
    feedback,
    example: typeof data?.example === 'string' ? data.example.trim() : '',
  };
}

async function serverCheck({ answer, situation, lang }) {
  if (!COACH_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(COACH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: answer, language: lang.code, scenario: situation }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('Coach unavailable');
    const data = await res.json();
    if (typeof data.feedback !== 'string' || !data.feedback.trim()) throw new Error('Invalid coach response');
    return { source: 'ai', feedback: data.feedback.slice(0, 3000) };
  } finally {
    clearTimeout(timer);
  }
}

const AI_OFF = ['sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];

// Returns { result, status } where status is the AI coach status to show next.
export async function getFeedback(input, aiStatus) {
  const { lang, lesson } = input;
  const quick = quickCheck(input.answer, lang);
  const example = lesson ? lesson.say[0] : '';
  if (aiStatus === 'on' || aiStatus === 'connecting') {
    try {
      const ai = await claudeCheck(input);
      if (ai) return { result: { ...quick, ...ai, scores: ai.scores || quick.scores, example: ai.example || example }, status: 'on' };
    } catch (e) {
      const code = e && e.code;
      const status = code === 'not_granted' ? 'denied' : AI_OFF.includes(code) ? (hasServer ? 'server' : 'off') : 'on';
      const notice = code === 'rate_limited' ? 'busy' : code === 'not_granted' || AI_OFF.includes(code) ? '' : 'error';
      return { result: { ...quick, example, notice }, status };
    }
  }
  if (hasServer) {
    try {
      const srv = await serverCheck(input);
      if (srv) return { result: { ...quick, feedback: srv.feedback, source: 'ai', example }, status: aiStatus };
    } catch (e) {
      return { result: { ...quick, example, notice: 'error' }, status: aiStatus };
    }
  }
  return { result: { ...quick, example }, status: aiStatus };
}
