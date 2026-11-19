import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { C, s, Card, Button, Eyebrow, Bar } from '../ui';
import { levelOf, rankOf, liveStreak, allLessons, BADGES, earnedBadges } from '../lib/progress';

const Stat = ({ value, label }) => (
  <View style={[s.card, { flexBasis: '47%', flexGrow: 1, gap: 4, padding: 14 }]}>
    <Text style={{ color: C.gold, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
    <Text style={s.small}>{label}</Text>
  </View>
);

export default function Progress({ lang, state, onReset }) {
  const t = lang.ui;
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const lessons = allLessons(lang);
  const done = lessons.filter((l) => state.done[l.id]).length;
  const lv = levelOf(state.xp);
  const scored = state.history.filter((h) => typeof h.overall === 'number');
  const avg = scored.length ? (scored.reduce((a, h) => a + h.overall, 0) / scored.length).toFixed(1) : '–';
  const earned = earnedBadges(state, lang);

  return (
    <View style={{ gap: 15 }}>
      <Text style={s.heading}>{t.progressTitle}</Text>
      <Card>
        <View style={s.row}>
          <View>
            <Text style={s.small}>{t.level} {lv.level}</Text>
            <Text style={s.title}>{t.ranks[rankOf(lv.level)]}</Text>
          </View>
          <Text style={{ color: C.gold, fontSize: 28, fontWeight: '800' }}>{state.xp} <Text style={s.small}>{t.xp}</Text></Text>
        </View>
        <Bar value={lv.into / lv.need} />
        <Text style={s.small}>{lv.into} / {lv.need} {t.xp}</Text>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Stat value={`${done}/${lessons.length}`} label={t.lessonsDone} />
        <Stat value={liveStreak(state)} label={t.streak} />
        <Stat value={state.best} label={t.bestStreak} />
        <Stat value={state.sessions} label={t.sessions} />
        <Stat value={avg} label={t.avgScore} />
        <Stat value={`${earned.length}/${BADGES.length}`} label={t.achievements.charAt(0) + t.achievements.slice(1).toLowerCase()} />
      </View>

      <Card>
        <Eyebrow>{t.modulesLabel}</Eyebrow>
        {lang.modules.map((m) => {
          const d = m.lessons.filter((l) => state.done[l.id]).length;
          return (
            <View key={m.id} style={{ gap: 6 }}>
              <View style={s.row}>
                <Text style={[s.bodyStrong, { flex: 1 }]}>{m.title}</Text>
                <Text style={s.small}>{d}/{m.lessons.length}</Text>
              </View>
              <Bar value={d / m.lessons.length} height={6} color={d === m.lessons.length ? C.good : C.gold} />
            </View>
          );
        })}
      </Card>

      <Card>
        <Eyebrow>{t.achievements}</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {BADGES.map((b) => {
            const on = earned.includes(b.id);
            return (
              <View key={b.id} style={{ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderRadius: 12, backgroundColor: on ? '#2E3A4F' : C.sunk, borderWidth: 1, borderColor: on ? C.gold : C.lineSoft, opacity: on ? 1 : 0.6 }}>
                <Text style={{ fontSize: 20, color: on ? C.gold : C.muted, width: 24, textAlign: 'center' }}>{b.icon}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.small, { color: on ? C.text : C.soft, fontWeight: '700' }]}>{t.badges[b.id][0]}</Text>
                  <Text style={[s.small, { fontSize: 12, lineHeight: 16 }]}>{t.badges[b.id][1]}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      {confirm ? (
        <Card>
          <Text style={s.bodyStrong}>{t.resetAsk}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button kind="ghost" label={t.cancel} onPress={() => setConfirm(false)} />
            <Button style={{ flex: 1, backgroundColor: C.bad }} label={t.resetYes} onPress={() => { onReset(); setConfirm(false); setNotice(t.resetDone); }} />
          </View>
        </Card>
      ) : (
        <Button kind="secondary" label={t.reset} onPress={() => { setConfirm(true); setNotice(''); }} />
      )}
      {!!notice && <Text style={[s.small, { textAlign: 'center' }]}>{notice}</Text>}
    </View>
  );
}
