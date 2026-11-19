// Endless chat practice: one role-play after another, each with a new person and question.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { C, s, Card, Button, Eyebrow } from '../ui';
import ChatView, { useChatLog, useRolePlay } from './ChatView';
import AiStatusLine from './AiStatus';
import { allLessons, dayNumber } from '../lib/progress';

export default function Coach({ lang, scenarioId, setScenarioId, aiStatus, setAiStatus, onConversation, speaker }) {
  const t = lang.ui;
  const c = t.chat;
  const lessons = allLessons(lang);
  const dailyId = lessons[dayNumber() % lessons.length].id;
  const [picking, setPicking] = useState(false);
  const [over, setOver] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const current = useRef(null);
  const shown = useRef(false);
  const langRef = useRef(lang.code);
  const log = useChatLog();
  const play = useRolePlay(log, {
    lang, aiStatus, setAiStatus,
    onFinish: (summary, conv) => {
      const xp = onConversation(summary, { id: conv.lesson.id, daily: conv.lesson.id === dailyId });
      log.add({ from: 'summary', data: { ...summary, xp } });
      setOver(true);
    },
  });

  const begin = (id, divider) => {
    const lesson = lessons.find((l) => l.id === id) || lessons[0];
    current.current = lesson.id;
    setCurrentId(lesson.id);
    setOver(false);
    setPicking(false);
    play.start(lesson, { divider: divider ? c.newChat : null });
  };

  useEffect(() => {
    const id = scenarioId || dailyId;
    if (!shown.current) { shown.current = true; begin(id, false); } else if (id !== current.current) begin(id, true);
  }, [scenarioId]);

  useEffect(() => {
    if (langRef.current === lang.code) return;
    langRef.current = lang.code;
    begin(current.current || dailyId, true);
  }, [lang.code]);

  const nextUp = () => {
    const i = lessons.findIndex((l) => l.id === current.current);
    begin(lessons[(i + 1) % lessons.length].id, true);
  };

  if (picking) {
    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30, gap: 12 }}>
        <Card>
          <Eyebrow>{c.pick.toUpperCase()}</Eyebrow>
          {lang.modules.map((m) => (
            <View key={m.id} style={{ gap: 8 }}>
              <Text style={[s.small, { fontWeight: '700', marginTop: 6 }]}>{m.title}</Text>
              {m.lessons.map((l) => (
                <TouchableOpacity key={l.id} role="button" aria-label={l.title}
                  onPress={() => { begin(l.id, true); setScenarioId(l.id); }}
                  style={[s.option, currentId === l.id && { borderColor: C.gold, backgroundColor: '#39415A' }]}>
                  <Text style={s.h3}>{l.title}{l.id === dailyId ? '  ★' : ''}</Text>
                  <Text style={s.small} numberOfLines={2}>💬 {l.chat.who} · {l.chat.lines[0]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          <Button kind="ghost" label={t.cancel} onPress={() => setPicking(false)} />
        </Card>
      </ScrollView>
    );
  }

  const lesson = lessons.find((l) => l.id === currentId);
  let chips = [];
  if (over) chips = [{ label: c.nextChat + ' →', primary: true, onPress: nextUp }, { label: c.pick, onPress: () => setPicking(true) }];
  else if (play.active && !play.busy) chips = [{ label: '💡 ' + c.hint, onPress: play.hint }];

  return (
    <View style={{ flex: 1 }}>
      <View style={st.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.eyebrow, { color: C.gold }]}>{currentId === dailyId ? t.daily : t.coachTitle.toUpperCase()}</Text>
          {!!lesson && <Text style={s.h3} numberOfLines={1}>{lesson.title}</Text>}
        </View>
        <TouchableOpacity role="button" aria-label={t.change} onPress={() => setPicking(true)}>
          <Text style={{ color: C.gold, fontWeight: '700' }}>{t.change} ›</Text>
        </TouchableOpacity>
      </View>
      <ChatView lang={lang} speaker={speaker} log={log} chips={chips}
        header={<AiStatusLine status={aiStatus} setStatus={setAiStatus} t={t} />}
        input={play.active ? { onSend: play.send, disabled: play.busy } : null} />
    </View>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
});
