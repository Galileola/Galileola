import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import CONTENT, { LANG_ORDER } from './src/content';
import { C, Pill } from './src/ui';
import { loadState, saveState, freshState, markActive, levelOf, earnedBadges, overallScore, XP, dayKey } from './src/lib/progress';
import { useAiStatus, useSpeaker } from './src/lib/platform';
import { hasServer } from './src/lib/coach';
import Home from './src/screens/Home';
import Learn from './src/screens/Learn';
import Coach from './src/screens/Coach';
import Phrases from './src/screens/Phrases';
import Progress from './src/screens/Progress';

const TABS = [['home', '⌂'], ['learn', '▤'], ['coach', '◉'], ['phrases', '❝'], ['progress', '▥']];

export default function App() {
  const [state, setState] = useState(freshState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('home');
  const [lessonId, setLessonId] = useState(null);
  const [scenarioId, setScenarioId] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const scroll = useRef(null);
  const [aiStatus, setAiStatus] = useAiStatus(hasServer);
  const speaker = useSpeaker();

  useEffect(() => { loadState().then((loaded) => { stateRef.current = loaded; setState(loaded); setReady(true); }); }, []);
  useEffect(() => { if (ready) saveState(state); }, [state, ready]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const lang = CONTENT[state.lang] || CONTENT.en;
  const t = lang.ui;

  const commit = (next) => { stateRef.current = next; setState(next); };
  const scrollTop = () => { if (scroll.current) scroll.current.scrollTo({ y: 0, animated: false }); };
  const go = (next) => { speaker.stop(); setTab(next); scrollTop(); };
  const notify = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  // Applies a progress change, then announces XP, level-ups and new achievements.
  const award = (change, message) => {
    const prev = stateRef.current;
    const cur = CONTENT[prev.lang] || CONTENT.en;
    const next = markActive(change(prev));
    const notes = [message];
    const before = levelOf(prev.xp).level, after = levelOf(next.xp).level;
    if (after > before) notes.push(`${cur.ui.levelUp} ${cur.ui.level} ${after}`);
    const had = earnedBadges(prev, cur);
    earnedBadges(next, cur).filter((b) => !had.includes(b)).forEach((b) => notes.push(`${cur.ui.badgeUnlocked} ${cur.ui.badges[b][0]}`));
    commit(next);
    notify(notes.join('\n'));
  };

  const completeLesson = (lesson, correct) => {
    const first = !stateRef.current.done[lesson.id];
    const perfect = correct === lesson.quiz.length;
    const gained = first ? XP.lesson + correct * XP.perfectAnswer : XP.review;
    award((p) => ({
      ...p,
      xp: p.xp + gained,
      done: { ...p.done, [lesson.id]: { at: Date.now(), perfect: perfect || !!(p.done[lesson.id] && p.done[lesson.id].perfect) } },
      perfect: p.perfect + (perfect ? 1 : 0),
    }), `+${gained} ${t.xp}`);
    return gained;
  };

  const recordCoach = (result, { id, answer, daily }) => {
    const overall = overallScore(result.scores);
    const bonus = !!daily && stateRef.current.dailyDone !== dayKey();
    const gained = XP.coach + (bonus ? XP.daily : 0);
    award((p) => ({
      ...p,
      xp: p.xp + gained,
      sessions: p.sessions + 1,
      sharp: p.sharp + (overall !== null && overall >= 8 ? 1 : 0),
      dailyDone: bonus ? dayKey() : p.dailyDone,
      dailyCount: p.dailyCount + (bonus ? 1 : 0),
      history: [{ at: Date.now(), id, answer: answer.slice(0, 240), overall, source: result.source }, ...p.history].slice(0, 20),
    }), `+${gained} ${t.xp}`);
  };

  const shared = { lang, state, aiStatus, setAiStatus, speaker, onCoachResult: recordCoach };

  return (
    <SafeAreaProvider>
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={st.frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.header}>
          <View style={{ flexShrink: 1 }}>
            <Text style={st.logo}>♛ SPEAK POWER</Text>
            <Text style={st.tagline}>{t.tagline}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {LANG_ORDER.map((code) => (
              <Pill key={code} label={CONTENT[code].label} active={state.lang === code} onPress={() => { speaker.stop(); commit({ ...stateRef.current, lang: code }); }} />
            ))}
          </View>
        </View>

        <ScrollView ref={scroll} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          {tab === 'home' && (
            <Home lang={lang} state={state}
              onOpenLesson={(id) => { setLessonId(id); go('learn'); }}
              onDaily={(id) => { setScenarioId(id); go('coach'); }}
              onCoach={() => go('coach')} />
          )}
          {tab === 'learn' && <Learn {...shared} lessonId={lessonId} setLessonId={(id) => { speaker.stop(); setLessonId(id); scrollTop(); }} onComplete={completeLesson} scrollTop={scrollTop} />}
          {tab === 'coach' && <Coach {...shared} scenarioId={scenarioId} setScenarioId={(id) => { setScenarioId(id); scrollTop(); }} />}
          {tab === 'phrases' && <Phrases lang={lang} speaker={speaker} />}
          {tab === 'progress' && <Progress lang={lang} state={state} onReset={() => commit({ ...freshState(), lang: stateRef.current.lang })} />}
        </ScrollView>

        {!!toast && (
          <View style={st.toast}>
            <Text style={st.toastText}>{toast}</Text>
          </View>
        )}

        <View style={st.nav}>
          {TABS.map(([id, icon]) => (
            <TouchableOpacity key={id} role="button" aria-label={t.tabs[id]} style={st.navItem}
              onPress={() => { if (id === 'learn' && tab === 'learn') setLessonId(null); go(id); }}>
              <Text style={[st.navIcon, { color: tab === id ? C.gold : '#9BAAC2' }]}>{icon}</Text>
              <Text style={{ color: tab === id ? C.gold : '#9BAAC2', fontSize: 11 }} numberOfLines={1}>{t.tabs[id]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  frame: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  logo: { fontSize: 19, fontWeight: '900', color: '#F8FAFC', letterSpacing: 1 },
  tagline: { color: '#9BAAC2', fontSize: 12, marginTop: 4 },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 36 },
  toast: { position: 'absolute', left: 20, right: 20, bottom: 84, backgroundColor: C.gold, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, pointerEvents: 'none' },
  toastText: { color: C.goldInk, fontWeight: '800', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  nav: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#39475D', paddingVertical: 10, backgroundColor: C.bg },
  navItem: { flex: 1, alignItems: 'center', gap: 3, minWidth: 0 },
  navIcon: { fontSize: 21 },
});
