import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { C, s, Card, Button, Eyebrow, Bar, ListenButton } from '../ui';
import Practice, { AiStatusLine } from './Practice';
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
                    <Text style={[s.bodyStrong, { flex: 1 }]}>{l.title}</Text>
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

function Lesson({ lang, lesson, nextLesson, onClose, onOpen, onComplete, aiStatus, setAiStatus, onCoachResult, speaker, scrollTop }) {
  const t = lang.ui;
  const [step, setStep] = useState('idea');
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState(null);
  const [firstTry, setFirstTry] = useState([]);
  const [gained, setGained] = useState(0);
  useEffect(() => { scrollTop(); }, [step, qi]);

  const totalSteps = lesson.quiz.length + 2;
  const at = step === 'idea' ? 0 : step === 'quiz' ? 1 + qi : step === 'practice' ? totalSteps - 1 : totalSteps;
  const q = lesson.quiz[qi];

  const finish = () => {
    setGained(onComplete(lesson, firstTry.filter(Boolean).length));
    setStep('done');
  };

  return (
    <View style={{ gap: 15 }}>
      <View style={s.row}>
        <TouchableOpacity role="button" aria-label={t.back} onPress={onClose} style={{ paddingVertical: 4 }}>
          <Text style={{ color: C.gold, fontWeight: '700', fontSize: 15 }}>‹ {t.backToCourse}</Text>
        </TouchableOpacity>
        <Text style={s.small}>{Math.min(at + 1, totalSteps)}/{totalSteps}</Text>
      </View>
      <Bar value={at / totalSteps} height={6} />
      <Text style={s.small}>{lesson.moduleTitle}</Text>
      <Text style={s.heading}>{lesson.title}</Text>

      {step === 'idea' && (
        <>
          <Card>
            <Eyebrow>{t.keyIdea}</Eyebrow>
            <Text style={s.bodyStrong}>{lesson.idea}</Text>
          </Card>
          <Card>
            <View style={{ gap: 4 }}>
              <Text style={[s.small, { color: C.bad, fontWeight: '700' }]}>✕ {t.insteadOf}</Text>
              <Text style={[s.body, { textDecorationLine: 'line-through', color: C.muted }]}>{lesson.weak}</Text>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={[s.small, { color: C.good, fontWeight: '700' }]}>✓ {t.say}</Text>
              <Text style={[s.title, { fontSize: 17 }]}>“{lesson.say[0]}”</Text>
              <ListenButton id={lesson.id + '-0'} text={lesson.say[0]} lang={lang} speaker={speaker} t={t} />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={[s.small, { fontWeight: '700' }]}>{t.moreWays}</Text>
              {lesson.say.slice(1).map((p, i) => (
                <View key={i} style={{ gap: 6 }}>
                  <Text style={s.bodyStrong}>• {p}</Text>
                  <ListenButton id={lesson.id + '-' + (i + 1)} text={p} lang={lang} speaker={speaker} t={t} />
                </View>
              ))}
            </View>
          </Card>
          <Button label={t.checkYourself + ' →'} onPress={() => { setStep('quiz'); setQi(0); setPicked(null); }} />
        </>
      )}

      {step === 'quiz' && (
        <Card>
          <Eyebrow>{`${t.question} ${qi + 1} ${t.of} ${lesson.quiz.length}`}</Eyebrow>
          <Text style={s.title}>{q.q}</Text>
          <View style={{ gap: 9 }}>
            {q.o.map((opt, i) => {
              const show = picked !== null;
              const isRight = i === q.a;
              const style = show && isRight ? { borderColor: C.good, backgroundColor: C.goodBg } : show && i === picked ? { borderColor: C.bad, backgroundColor: C.badBg } : null;
              return (
                <TouchableOpacity key={i} role="button" aria-label={opt} disabled={show}
                  onPress={() => { setPicked(i); setFirstTry((f) => { const n = [...f]; n[qi] = i === q.a; return n; }); }}
                  style={[s.option, style]}>
                  <Text style={s.optionText}>{String.fromCharCode(65 + i)}. {opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {picked !== null && (
            <>
              <View style={[s.infoBox, picked !== q.a && { backgroundColor: C.badBg }]}>
                <Text style={{ color: picked === q.a ? C.good : C.bad, fontWeight: '800' }}>{picked === q.a ? t.correct : t.notQuite}</Text>
                <Text style={{ color: C.info, lineHeight: 22 }}>{q.why}</Text>
              </View>
              <Button label={t.next + ' →'} onPress={() => {
                if (qi + 1 < lesson.quiz.length) { setQi(qi + 1); setPicked(null); } else setStep('practice');
              }} />
            </>
          )}
        </Card>
      )}

      {step === 'practice' && (
        <>
          <Card>
            <Eyebrow>{t.practiceStep}</Eyebrow>
            <Text style={s.title}>{lesson.practice}</Text>
            <Text style={s.small}>{t.practiceHint}</Text>
            <Practice lang={lang} situation={lesson.practice} lesson={lesson} aiStatus={aiStatus} setAiStatus={setAiStatus}
              onResult={(r, answer) => onCoachResult(r, { id: lesson.id, answer })} speaker={speaker} />
          </Card>
          <AiStatusLine status={aiStatus} setStatus={setAiStatus} t={t} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button kind="ghost" label={t.skip} onPress={finish} />
            <Button style={{ flex: 1 }} label={t.finish + ' ✓'} onPress={finish} />
          </View>
        </>
      )}

      {step === 'done' && (
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Text style={{ fontSize: 40, color: C.gold }}>♛</Text>
          <Text style={s.heading}>{t.lessonDone}</Text>
          <Text style={{ color: C.gold, fontSize: 22, fontWeight: '800' }}>+{gained} {t.xp}</Text>
          <Text style={s.small}>{firstTry.filter(Boolean).length}/{lesson.quiz.length} {t.correct.replace('!', '')}</Text>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 6 }}>
            {nextLesson && <Button label={t.nextLesson + ' →'} onPress={() => onOpen(nextLesson.id)} />}
            <Button kind="secondary" label={t.backToCourse} onPress={onClose} />
          </View>
        </Card>
      )}
    </View>
  );
}

export default function Learn(props) {
  const { lang, lessonId, setLessonId } = props;
  const lessons = allLessons(lang);
  const index = lessons.findIndex((l) => l.id === lessonId);
  if (index < 0) return <Course lang={lang} state={props.state} onOpen={setLessonId} />;
  return (
    <Lesson key={lessonId} {...props} lesson={lessons[index]} nextLesson={lessons[index + 1]}
      onClose={() => setLessonId(null)} onOpen={setLessonId} />
  );
}
