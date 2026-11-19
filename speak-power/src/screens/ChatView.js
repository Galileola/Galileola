// Chat screen building blocks: the message log, the role-play engine hook and the view.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { C, s, ScoreBars, ListenButton } from '../ui';
import { useDictation } from '../lib/platform';
import { chatTurn, summarize } from '../lib/chat';

let seq = 0;
const nextId = () => ++seq;
export const typingTime = (text) => Math.min(1500, 400 + (text || '').length * 15);

// Messages: {from:'scene'|'divider'|'coach'|'them'|'me'|'summary', ...}
export function useChatLog() {
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(null);
  const alive = useRef(true);
  const gen = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const add = (m) => { const id = nextId(); setMessages((ms) => [...ms, { id, ...m }].slice(-120)); return id; };
  const patch = (id, change) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...change } : m)));
  // Timers from a cancelled conversation never fire.
  const later = (ms, fn) => { const g = gen.current; setTimeout(() => { if (alive.current && g === gen.current) fn(); }, ms); };
  const cancel = () => { gen.current += 1; setTyping(null); };
  const typeThen = (name, text, fn) => { setTyping(name); later(typingTime(text), () => { setTyping(null); fn(); }); };
  return { messages, typing, setTyping, add, patch, later, cancel, typeThen, alive };
}

// Runs one role-play: the other person opens, you reply, they react, four times.
export function useRolePlay(log, { lang, aiStatus, setAiStatus, onFinish }) {
  const conv = useRef(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);

  const start = (lesson, opts = {}) => {
    log.cancel();
    const c = { lesson, turn: 0, transcript: [], results: [], seed: nextId(), over: false };
    conv.current = c;
    setActive(true);
    setBusy(true);
    if (opts.divider) log.add({ from: 'divider', text: opts.divider });
    log.add({ from: 'scene', title: lesson.title, text: lesson.practice });
    const first = lesson.chat.lines[0];
    log.typeThen(lesson.chat.who, first, () => {
      log.add({ from: 'them', name: lesson.chat.who, role: lesson.chat.role, text: first });
      c.transcript.push({ from: 'them', text: first });
      setBusy(false);
    });
  };

  const send = async (text) => {
    const c = conv.current;
    if (!c || c.over || busy) return;
    const myId = log.add({ from: 'me', text });
    c.transcript.push({ from: 'me', text });
    setBusy(true);
    log.setTyping(c.lesson.chat.who);
    const t0 = Date.now();
    const { result, status } = await chatTurn({ lang, lesson: c.lesson, transcript: c.transcript, text, turn: c.turn, seed: c.seed + c.turn * 7 + text.length }, aiStatus);
    if (!log.alive.current || conv.current !== c || c.over) return;
    if (status !== aiStatus) setAiStatus(status);
    c.results.push({ text, scores: result.scores, overall: result.overall, source: result.source });
    log.patch(myId, { note: { overall: result.overall, tip: result.tip, quality: result.quality, source: result.source, notice: result.notice } });
    log.later(Math.max(250, typingTime(result.reply) - (Date.now() - t0)), () => {
      log.setTyping(null);
      log.add({ from: 'them', name: c.lesson.chat.who, role: c.lesson.chat.role, text: result.reply });
      c.transcript.push({ from: 'them', text: result.reply });
      c.turn += 1;
      if (result.end) {
        c.over = true;
        setActive(false);
        if (onFinish) onFinish(summarize(c.results), c);
      }
      setBusy(false);
    });
  };

  const hint = () => { const c = conv.current; if (c) log.add({ from: 'coach', text: lang.ui.chat.hintIntro, quotes: c.lesson.say }); };
  const stop = () => { if (conv.current) conv.current.over = true; log.cancel(); setActive(false); setBusy(false); };
  return { start, send, hint, stop, busy, active };
}

const AVATARS = ['#3B5B8C', '#5B4B8A', '#2F6F6A', '#7A4E3A', '#4F6B2F', '#7A3E5C'];
const avatarColor = (name) => AVATARS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATARS.length];
const QUALITY = { good: C.good, weak: C.gold, harsh: C.bad };

function Bubble({ m, lang, speaker }) {
  const t = lang.ui;
  if (m.from === 'divider') {
    return (
      <View style={st.divider}>
        <View style={st.rule} /><Text style={st.dividerText}>{m.text}</Text><View style={st.rule} />
      </View>
    );
  }
  if (m.from === 'scene') {
    return (
      <View style={st.scene}>
        <Text style={[s.eyebrow, { color: C.gold }]}>{t.chat.scene} · {m.title}</Text>
        <Text style={st.sceneText}>{m.text}</Text>
      </View>
    );
  }
  if (m.from === 'coach') {
    return (
      <View style={st.left}>
        <View style={[st.avatar, { backgroundColor: C.gold }]}><Text style={{ color: C.goldInk, fontWeight: '900' }}>♛</Text></View>
        <View style={[st.bubble, st.coachBubble]}>
          <Text style={st.name}>{t.chat.coachName}</Text>
          {!!m.text && <Text style={st.text}>{m.text}</Text>}
          {m.contrast && (
            <View style={{ gap: 8, marginTop: 2 }}>
              <Text style={[s.small, { color: C.bad, fontWeight: '700' }]}>✕ {t.insteadOf}</Text>
              <Text style={[st.text, { color: C.muted, textDecorationLine: 'line-through' }]}>{m.contrast.weak}</Text>
              <Text style={[s.small, { color: C.good, fontWeight: '700' }]}>✓ {t.say}</Text>
              <Text style={[st.text, { fontWeight: '700' }]}>“{m.contrast.strong}”</Text>
              <ListenButton id={'c' + m.id} text={m.contrast.strong} lang={lang} speaker={speaker} t={t} />
            </View>
          )}
          {m.quotes && m.quotes.map((q, i) => (
            <View key={i} style={st.quote}>
              <Text style={st.text}>“{q}”</Text>
              <ListenButton id={'q' + m.id + '-' + i} text={q} lang={lang} speaker={speaker} t={t} />
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (m.from === 'them') {
    return (
      <View style={st.left}>
        <View style={[st.avatar, { backgroundColor: avatarColor(m.name) }]}><Text style={st.initial}>{m.name.replace(/^(Mr|Ms|Mrs|Aunt|господин|госпожа|тётя|härra|proua|tädi)\s+/i, '').charAt(0).toUpperCase()}</Text></View>
        <View style={[st.bubble, st.themBubble]}>
          <Text style={st.name}>{m.name} <Text style={{ color: C.muted, fontWeight: '400' }}>· {m.role}</Text></Text>
          <Text style={st.text}>{m.text}</Text>
          <ListenButton id={'t' + m.id} text={m.text} lang={lang} speaker={speaker} t={t} />
        </View>
      </View>
    );
  }
  if (m.from === 'me') {
    const n = m.note;
    return (
      <View style={st.right}>
        <View style={[st.bubble, st.meBubble]}><Text style={[st.text, { color: C.goldInk }]}>{m.text}</Text></View>
        {n && (
          <View style={st.note}>
            <View style={[st.dot, { backgroundColor: QUALITY[n.quality] || C.muted }]} />
            <Text style={[s.small, { flex: 1 }]}>
              <Text style={{ color: QUALITY[n.quality] || C.text, fontWeight: '800' }}>{n.overall}</Text>
              <Text style={{ color: C.muted }}> · {n.source === 'ai' ? t.sourceAi : t.sourceQuick}</Text>
              {'\n'}{n.tip}{n.notice ? '\n' + t.ai[n.notice] : ''}
            </Text>
          </View>
        )}
      </View>
    );
  }
  if (m.from === 'summary') {
    const d = m.data;
    return (
      <View style={[s.card, st.summary]}>
        <View style={s.row}>
          <Text style={[s.eyebrow, { color: C.gold }]}>{t.chat.summary}</Text>
          <Text style={{ color: C.gold, fontSize: 22, fontWeight: '800' }}>{d.overall}<Text style={s.small}> / 10</Text></Text>
        </View>
        <ScoreBars scores={d.scores} t={t} />
        <View style={{ gap: 4 }}>
          <Text style={[s.small, { fontWeight: '700' }]}>{t.chat.bestLine}</Text>
          <Text style={[s.bodyStrong, { fontStyle: 'italic' }]}>“{d.best}”</Text>
        </View>
        {!!d.xp && <Text style={{ color: C.gold, fontWeight: '800' }}>+{d.xp} {t.xp}</Text>}
      </View>
    );
  }
  return null;
}

function InputBar({ lang, onSend, disabled }) {
  const t = lang.ui;
  const [text, setText] = useState('');
  const mic = useDictation((f) => setText((a) => (a ? a + f : f.replace(/^\s+/, ''))));
  const shown = mic.partial ? (text ? text + ' ' : '') + mic.partial : text;
  const canSend = !disabled && !!text.trim();
  const send = () => { if (!canSend) return; mic.stop(); onSend(text.trim()); setText(''); };
  return (
    <View style={st.inputBar}>
      {mic.available && (
        <TouchableOpacity role="button" aria-label={mic.listening ? t.listening : t.speak} onPress={() => mic.toggle(lang.code)}
          style={[st.round, { backgroundColor: mic.listening ? C.bad : C.chip }]}>
          <Text style={{ color: C.text, fontSize: 18 }}>{mic.listening ? '■' : '🎙'}</Text>
        </TouchableOpacity>
      )}
      <TextInput
        id="sp-chat-input"
        multiline
        value={shown}
        onChangeText={setText}
        placeholder={mic.listening ? t.listening : t.chat.placeholder}
        placeholderTextColor="#8291AA"
        style={st.input}
        onKeyPress={(e) => {
          if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault(); send(); }
        }}
      />
      <TouchableOpacity role="button" aria-label={t.chat.send} onPress={send} disabled={!canSend} style={[st.round, { backgroundColor: C.gold, opacity: canSend ? 1 : 0.4 }]}>
        <Text style={{ color: C.goldInk, fontSize: 20, fontWeight: '900' }}>↑</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ChatView({ lang, speaker, log, chips, input, header }) {
  const scroll = useRef(null);
  const t = lang.ui;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={st.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
        onContentSizeChange={() => { if (scroll.current) scroll.current.scrollToEnd({ animated: true }); }}>
        {header}
        {log.messages.map((m) => <Bubble key={m.id} m={m} lang={lang} speaker={speaker} />)}
        {!!log.typing && (
          <View style={st.left}>
            <View style={[st.bubble, st.themBubble, { paddingVertical: 10 }]}><Text style={[s.small, { fontStyle: 'italic' }]}>{t.chat.typing.replace('{name}', log.typing)}</Text></View>
          </View>
        )}
      </ScrollView>
      {!!chips && chips.length > 0 && (
        <View style={st.chips}>
          {chips.map((c) => (
            <TouchableOpacity key={c.label} role="button" aria-label={c.label} onPress={c.onPress} style={[st.chip, c.primary && st.chipPrimary]}>
              <Text style={[st.chipText, c.primary && { color: C.goldInk }]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {!!input && <InputBar lang={lang} onSend={input.onSend} disabled={input.disabled} />}
    </View>
  );
}

const st = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16, gap: 12 },
  left: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '92%' },
  right: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '85%', gap: 6 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  bubble: { borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, gap: 6, flexShrink: 1 },
  coachBubble: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 6 },
  themBubble: { backgroundColor: '#24324D', borderBottomLeftRadius: 6 },
  meBubble: { backgroundColor: C.gold, borderBottomRightRadius: 6 },
  name: { color: C.gold, fontSize: 12, fontWeight: '800' },
  text: { color: C.text, fontSize: 16, lineHeight: 23 },
  quote: { gap: 6, borderTopWidth: 1, borderTopColor: C.lineSoft, paddingTop: 8 },
  note: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', maxWidth: 320 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  scene: { alignSelf: 'stretch', gap: 6, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: C.lineSoft, backgroundColor: C.sunk },
  sceneText: { color: C.soft, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  rule: { flex: 1, height: 1, backgroundColor: C.line },
  dividerText: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  summary: { borderColor: C.gold, backgroundColor: C.sunk },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.gold, maxWidth: '100%' },
  chipPrimary: { backgroundColor: C.gold },
  chipText: { color: C.gold, fontWeight: '700', fontSize: 14, lineHeight: 19 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.lineSoft },
  input: { flex: 1, minHeight: 42, maxHeight: 120, backgroundColor: C.sunk, borderWidth: 1, borderColor: '#56637B', borderRadius: 21, color: '#FFFFFF', paddingHorizontal: 15, paddingTop: 10, paddingBottom: 10, fontSize: 16, lineHeight: 21 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
