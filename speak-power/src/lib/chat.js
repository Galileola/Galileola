// Role-play conversations. Every reply you send is scored, rated good, weak
// (vague or unsure) or harsh (rude), and the other person answers accordingly.
// With Claude (claude.ai viewer) the character is played live; otherwise the
// lesson's scripted lines are used, opened with a reaction that fits your reply.
import { quickCheck, serverFeedback, hasServer } from './coach';
import { samplePromise } from './platform';
import { overallScore } from './progress';

export function qualityOf(scores, harshFlags = 0) {
  if (harshFlags > 0 || scores.respect <= 5 || scores.calm <= 4) return 'harsh';
  if (scores.confidence <= 5 || scores.clarity <= 5) return 'weak';
  return 'good';
}

const pick = (list, seed) => list[Math.abs(seed) % list.length];

export function scriptedReply(lang, lesson, turn, quality, seed) {
  const c = lang.ui.chat;
  const lines = lesson.chat.lines;
  if (turn >= lines.length - 1) return { text: pick(c.end[quality], seed), end: true };
  return { text: pick(c.react[quality], seed) + ' ' + lines[turn + 1], end: false };
}

const score = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : null; };

async function claudeTurn({ lang, lesson, transcript, turn }) {
  const sample = await samplePromise;
  if (!sample) return null;
  const who = lesson.chat.who;
  const last = turn >= lesson.chat.lines.length - 1;
  const prompt = [
    `You are role-playing a practice conversation in SPEAK POWER, a communication coaching app. Write every text value in ${lang.name}.`,
    `Situation: ${lesson.practice}`,
    `You play ${who} (${lesson.chat.role}). Stay in character and sound natural, like a chat message: one or two short sentences.`,
    `The user is practising: ${lesson.title}. ${lesson.idea}`,
    `Questions you planned to ask (adapt them freely): ${lesson.chat.lines.join(' | ')}`,
    'Conversation so far:',
    ...transcript.map((m) => `${m.from === 'me' ? 'User' : who}: ${m.text}`),
    last
      ? `That was the user's final reply. As ${who}, give a short, natural closing line that reflects how the conversation went.`
      : `As ${who}, react to the user's last message (warmer if it was calm and confident, more pushback if it was vague, offended if it was rude), then ask a new question or raise a new challenge that moves the conversation forward. Never repeat an earlier question.`,
    'Also coach the user on their last message only.',
    'Reply with only a JSON object in exactly this shape:',
    '{"reply":"what you say next, in character","scores":{"clarity":7,"calm":8,"confidence":6,"respect":9},"tip":"one short, specific coaching tip about the user\'s last message"}',
    'Scores are whole numbers from 1 to 10. Plain text only, no Markdown.',
  ].join('\n');
  const data = await sample.json(prompt, { modelTier: 'quick', cache: false });
  const reply = typeof data?.reply === 'string' ? data.reply.trim() : '';
  if (!reply) throw { code: 'invalid_json' };
  const s = data.scores || {};
  const scores = { clarity: score(s.clarity), calm: score(s.calm), confidence: score(s.confidence), respect: score(s.respect) };
  return {
    reply,
    scores: Object.values(scores).every((v) => v !== null) ? scores : null,
    tip: typeof data?.tip === 'string' ? data.tip.trim() : '',
  };
}

const AI_OFF = ['sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];

// One reply from the user. Returns { result, status }, where status is the AI
// coach status to show next and result is
// { scores, overall, tip, quality, reply, end, source, notice }.
export async function chatTurn({ lang, lesson, transcript, text, turn, seed }, aiStatus) {
  const check = quickCheck(text, lang);
  const quality = qualityOf(check.scores, check.flags.harsh);
  const scripted = scriptedReply(lang, lesson, turn, quality, seed);
  const base = { scores: check.scores, tip: check.feedback.split('\n')[0], quality, reply: scripted.text, end: scripted.end, source: 'quick' };
  const done = (r, status) => ({ result: { ...r, overall: overallScore(r.scores) }, status });

  if (aiStatus === 'on' || aiStatus === 'connecting') {
    try {
      const ai = await claudeTurn({ lang, lesson, transcript, turn });
      if (ai) {
        const scores = ai.scores || check.scores;
        return done({ ...base, scores, tip: ai.tip || base.tip, reply: ai.reply, quality: qualityOf(scores, check.flags.harsh), source: 'ai' }, 'on');
      }
    } catch (e) {
      const code = e && e.code;
      const status = code === 'not_granted' ? 'denied' : AI_OFF.includes(code) ? (hasServer ? 'server' : 'off') : 'on';
      return done({ ...base, notice: code === 'rate_limited' ? 'busy' : status === 'on' ? 'error' : '' }, status);
    }
  }
  if (hasServer) {
    try {
      const tip = await serverFeedback({ answer: text, situation: lesson.practice, lang });
      if (tip) return done({ ...base, tip, source: 'ai' }, aiStatus);
    } catch (e) {
      return done({ ...base, notice: 'error' }, aiStatus);
    }
  }
  return done(base, aiStatus);
}

// Average scores and best line for the end-of-conversation card.
export function summarize(results) {
  const keys = ['clarity', 'calm', 'confidence', 'respect'];
  const scores = {};
  keys.forEach((k) => { scores[k] = Math.round(results.reduce((a, r) => a + r.scores[k], 0) / results.length); });
  const best = results.reduce((b, r) => (r.overall > b.overall ? r : b), results[0]);
  return { scores, overall: overallScore(scores), best: best.text, source: results.some((r) => r.source === 'ai') ? 'ai' : 'quick' };
}
