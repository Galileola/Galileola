// Progress: XP, levels, streaks, achievements. Saved on the device (AsyncStorage,
// which is localStorage on the web), so each person keeps their own progress.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'speak-power-v2';
const OLD_KEY = 'speak-power-v1';

export const XP = { lesson: 50, perfectAnswer: 10, review: 10, coach: 15, daily: 25 };
export const LEVEL_XP = 150;

export const freshState = () => ({
  v: 2, lang: 'en', xp: 0, done: {}, streak: 0, best: 0, last: '',
  history: [], sessions: 0, sharp: 0, perfect: 0, dailyDone: '', dailyCount: 0,
});

export async function loadState() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
    const old = await AsyncStorage.getItem(OLD_KEY);
    if (old) {
      // carry over progress from the first version of the app
      const d = JSON.parse(old);
      const s = freshState();
      if (['en', 'ru', 'et'].includes(d.lang)) s.lang = d.lang;
      if (d.completed) s.done['calm-authority'] = { at: Date.now(), perfect: false };
      s.xp = Math.max(0, Number(d.points) || 0);
      return s;
    }
  } catch (e) {}
  return freshState();
}

export function saveState(state) {
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); };
export const dayNumber = (d = new Date()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

// Any XP-earning activity counts as practice for today.
export function markActive(s) {
  const today = dayKey();
  if (s.last === today) return s;
  const streak = s.last === yesterdayKey() ? s.streak + 1 : 1;
  return { ...s, streak, best: Math.max(s.best, streak), last: today };
}
export const liveStreak = (s) => (s.last === dayKey() || s.last === yesterdayKey() ? s.streak : 0);

export function levelOf(xp) {
  return { level: Math.floor(xp / LEVEL_XP) + 1, into: xp % LEVEL_XP, need: LEVEL_XP };
}
export const rankOf = (level) => (level >= 13 ? 5 : level >= 9 ? 4 : level >= 6 ? 3 : level >= 4 ? 2 : level >= 2 ? 1 : 0);

export const allLessons = (lang) => lang.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleId: m.id, moduleTitle: m.title })));

export const BADGES = [
  { id: 'first', icon: '★', test: (s) => Object.keys(s.done).length >= 1 },
  { id: 'module', icon: '◆', test: (s, lang) => lang.modules.some((m) => m.lessons.every((l) => s.done[l.id])) },
  { id: 'graduate', icon: '♛', test: (s, lang) => lang.modules.every((m) => m.lessons.every((l) => s.done[l.id])) },
  { id: 'streak3', icon: '✦', test: (s) => s.best >= 3 },
  { id: 'streak7', icon: '☀', test: (s) => s.best >= 7 },
  { id: 'coach5', icon: '◉', test: (s) => s.sessions >= 5 },
  { id: 'coach25', icon: '✪', test: (s) => s.sessions >= 25 },
  { id: 'sharp', icon: '➚', test: (s) => s.sharp >= 1 },
  { id: 'perfect', icon: '✔', test: (s) => s.perfect >= 1 },
  { id: 'daily5', icon: '☼', test: (s) => s.dailyCount >= 5 },
];
export const earnedBadges = (s, lang) => BADGES.filter((b) => b.test(s, lang)).map((b) => b.id);

export const overallScore = (scores) => {
  if (!scores) return null;
  const v = [scores.clarity, scores.calm, scores.confidence, scores.respect];
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
};
