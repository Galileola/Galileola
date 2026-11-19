import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { C, s, Card, Button, Eyebrow } from '../ui';
import Practice, { AiStatusLine } from './Practice';
import { allLessons, dayNumber } from '../lib/progress';

export default function Coach({ lang, state, scenarioId, setScenarioId, aiStatus, setAiStatus, onCoachResult, speaker }) {
  const t = lang.ui;
  const lessons = allLessons(lang);
  const dailyId = lessons[dayNumber() % lessons.length].id;
  const id = scenarioId || dailyId;
  const lesson = lessons.find((l) => l.id === id) || null;
  const [picking, setPicking] = useState(false);
  const titleFor = (sid) => (sid === 'free' ? t.free : (lessons.find((l) => l.id === sid) || {}).title || '');

  return (
    <View style={{ gap: 15 }}>
      <Text style={s.heading}>{t.coachTitle}</Text>
      <AiStatusLine status={aiStatus} setStatus={setAiStatus} t={t} />

      {picking ? (
        <Card>
          <Eyebrow>{t.choose.toUpperCase()}</Eyebrow>
          <TouchableOpacity role="button" aria-label={t.free} onPress={() => { setScenarioId('free'); setPicking(false); }} style={[s.option, id === 'free' && { borderColor: C.gold }]}>
            <Text style={s.h3}>{t.free}</Text>
            <Text style={s.small}>{t.freeDesc}</Text>
          </TouchableOpacity>
          {lang.modules.map((m) => (
            <View key={m.id} style={{ gap: 8 }}>
              <Text style={[s.small, { fontWeight: '700', marginTop: 6 }]}>{m.title}</Text>
              {m.lessons.map((l) => (
                <TouchableOpacity key={l.id} role="button" aria-label={l.title} onPress={() => { setScenarioId(l.id); setPicking(false); }} style={[s.option, id === l.id && { borderColor: C.gold, backgroundColor: '#39415A' }]}>
                  <Text style={s.h3}>{l.title}{l.id === dailyId ? '  ★' : ''}</Text>
                  <Text style={s.small} numberOfLines={2}>{l.practice}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          <Button kind="ghost" label={t.cancel} onPress={() => setPicking(false)} />
        </Card>
      ) : (
        <Card>
          <View style={s.row}>
            <Eyebrow>{id === dailyId ? t.daily : t.situation}</Eyebrow>
            <TouchableOpacity role="button" aria-label={t.change} onPress={() => setPicking(true)}>
              <Text style={{ color: C.gold, fontWeight: '700' }}>{t.change} ›</Text>
            </TouchableOpacity>
          </View>
          {id === 'free' ? (
            <>
              <Text style={s.title}>{t.free}</Text>
              <Text style={s.small}>{t.freeDesc}</Text>
            </>
          ) : (
            <>
              <Text style={s.small}>{lesson.title}</Text>
              <Text style={s.title}>{lesson.practice}</Text>
            </>
          )}
          <Practice key={id} lang={lang} situation={id === 'free' ? '' : lesson.practice} lesson={id === 'free' ? null : lesson} needSituation={id === 'free'}
            aiStatus={aiStatus} setAiStatus={setAiStatus} speaker={speaker}
            onResult={(r, answer) => onCoachResult(r, { id, answer, daily: id === dailyId })} />
          <Button kind="ghost" small label={t.another + ' ↻'} onPress={() => {
            const pool = lessons.filter((l) => l.id !== id);
            setScenarioId(pool[Math.floor(Math.random() * pool.length)].id);
          }} />
        </Card>
      )}

      {state.history.length > 0 && !picking && (
        <View style={{ gap: 10 }}>
          <Eyebrow color={C.muted}>{t.recent}</Eyebrow>
          {state.history.slice(0, 5).map((h) => (
            <View key={h.at} style={[s.card, { backgroundColor: C.sunk, padding: 13, gap: 4 }]}>
              <View style={s.row}>
                <Text style={[s.small, { flex: 1 }]} numberOfLines={1}>{titleFor(h.id)}</Text>
                {h.overall !== null && h.overall !== undefined && <Text style={{ color: C.gold, fontWeight: '800' }}>{h.overall}</Text>}
              </View>
              <Text style={s.bodyStrong} numberOfLines={2}>“{h.answer}”</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
