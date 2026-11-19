import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C, s, Card, Eyebrow, Bar } from '../ui';
import ChatView, { useChatLog, useRolePlay } from './ChatView';
import { allLessons } from '../lib/progress';

function Course({ lang, state, onOpen }) {
  const t = lang.ui;
  const total = allLessons(lang).length;
  return (
    <View style={{ gap: 15 }}>
      <View style={{ gap: 4 }}>
        <Text style={s.heading}>{t.course}</Text>
        <Text style={s.body}>{lang.modules.length} {t.modulesWord} · {total} {t.lessonsWord}</Text>
      </View>
      {lang.modules.map((m, mi) => {
        const done = m.lessons.filter((l) => state.done[l.id]).length;
        return (
          <Card key={m.id}>
            <View style={{ gap: 4 }}>
              <Eyebrow>{`${mi + 1} · ${done}/${m.lessons.length}`}</Eyebrow>
              <Text style={s.title}>{m.title}</Text>
              <Text style={s.small}>{m.desc}</Text>
            </View>
            <Bar value={done / m.lessons.length} height={6} />
            <View style={{ gap: 8 }}>
              {m.lessons.map((l, li) => {
                const isDone = !!state.done[l.id];
                return (
                  <TouchableOpacity key={l.id} role="button" aria-label={l.title} onPress={() => onOpen(l.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: isDone ? '#3E5A52' : C.lineSoft, backgroundColor: C.sunk }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: isDone ? C.good : C.chip }}>
                      <Text style={{ color: isDone ? C.goldInk : C.text, fontWeight: '800', fontSize: 13 }}>{isDone ? '✓' : li + 1}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.bodyStrong}>{l.title}</Text>
                      <Text style={s.small} numberOfLines={1}>💬 {l.chat.who} · {l.chat.role}</Text>
                    </View>
                    <Text style={{ color: C.muted, fontSize: 18 }}>›</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

// A lesson told as a chat: the coach explains, quizzes you with tap answers,
// then you practise in a role-play with the lesson's character.
function LessonChat({ lang, lesson, nextLesson, onClose, onOpen, onComplete, onConversation, aiStatus, setAiStatus, speaker }) {
  const t = lang.ui;
  const c = t.chat;
  const log = useChatLog();
  const [stage, setStage] = useState('wait');
  const [qi, setQi] = useState(0);
  const firstTry = useRef([]);
  const started = useRef(false);
  const finished = useRef(false);

  const coachSay = (items, then) => {
    if (!items.length) { if (then) then(); return; }
    const [m, ...rest] = items;
    const msg = typeof m === 'string' ? { text: m } : m;
    log.typeThen(c.coachName, msg.text || '', () => { log.add({ from: 'coach', ...msg }); coachSay(rest, then); });
  };

  const finish = (summary) => {
    if (finished.current) return;
    finished.current = true;
    setStage('wait');
    if (summary) log.add({ from: 'summary', data: { ...summary, xp: onConversation(summary, { id: lesson.id }) } });
    const gained = onComplete(lesson, firstTry.current.filter(Boolean).length);
    coachSay([`♛ ${t.lessonDone} +${gained} ${t.xp}`], () => setStage('done'));
  };
  const play = useRolePlay(log, { lang, aiStatus, setAiStatus, onFinish: (summary) => finish(summary) });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    coachSay([c.lessonIntro.replace('{title}', lesson.title), lesson.idea, { text: '', contrast: { weak: lesson.weak, strong: lesson.say[0] } }], () => setStage('intro'));
  }, []);

  const ask = (i) => {
    setStage('wait');
    const q = lesson.quiz[i];
    const lead = i === 0 ? c.quizIntro : `${t.question} ${i + 1} ${t.of} ${lesson.quiz.length}`;
    coachSay([`${lead}\n\n${q.q}`], () => { setQi(i); setStage('quiz'); });
  };

  const answer = (opt) => {
    const q = lesson.quiz[qi];
    setStage('wait');
    log.add({ from: 'me', text: q.o[opt] });
    const ok = opt === q.a;
    firstTry.current[qi] = ok;
    const reply = ok ? `✓ ${t.correct} ${q.why}` : `✕ ${t.notQuite} ${c.bestAnswer} “${q.o[q.a]}”\n${q.why}`;
    coachSay([reply], () => {
      if (qi + 1 < lesson.quiz.length) ask(qi + 1);
      else coachSay([c.practiceIntro], () => { setStage('practice'); play.start(lesson); });
    });
  };

  const gotIt = { label: c.gotIt + ' →', primary: true, onPress: () => { log.add({ from: 'me', text: c.gotIt }); ask(0); } };
  let chips = [];
  if (stage === 'intro') {
    chips = [gotIt, { label: c.moreExamples, onPress: () => {
      setStage('wait');
      log.add({ from: 'me', text: c.moreExamples });
      coachSay([{ text: t.moreWays, quotes: lesson.say.slice(1) }], () => setStage('intro2'));
    } }];
  } else if (stage === 'intro2') chips = [gotIt];
  else if (stage === 'quiz') chips = lesson.quiz[qi].o.map((o, i) => ({ label: o, onPress: () => answer(i) }));
  else if (stage === 'practice' && play.active && !play.busy) {
    chips = [{ label: '💡 ' + c.hint, onPress: play.hint }, { label: c.skipPractice, onPress: () => { play.stop(); finish(null); } }];
  } else if (stage === 'done') {
    chips = [...(nextLesson ? [{ label: t.nextLesson + ' →', primary: true, onPress: () => onOpen(nextLesson.id) }] : []), { label: t.backToCourse, onPress: onClose }];
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={st.top}>
        <TouchableOpacity role="button" aria-label={t.backToCourse} onPress={onClose}>
          <Text style={{ color: C.gold, fontWeight: '700', fontSize: 15 }}>‹ {t.backToCourse}</Text>
        </TouchableOpacity>
        <Text style={[s.small, { flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>{lesson.moduleTitle}</Text>
      </View>
      <ChatView lang={lang} speaker={speaker} log={log} chips={chips}
        input={stage === 'practice' && play.active ? { onSend: play.send, disabled: play.busy } : null} />
    </View>
  );
}

export default function Learn(props) {
  const { lang, lessonId, setLessonId } = props;
  const lessons = allLessons(lang);
  const index = lessons.findIndex((l) => l.id === lessonId);
  if (index < 0) return <Course lang={lang} state={props.state} onOpen={setLessonId} />;
  return (
    <LessonChat key={lessonId + lang.code} {...props} lesson={lessons[index]} nextLesson={lessons[index + 1]}
      onClose={() => setLessonId(null)} onOpen={setLessonId} />
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
});
