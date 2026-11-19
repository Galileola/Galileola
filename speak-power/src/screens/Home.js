import React from 'react';
import { View, Text } from 'react-native';
import { C, s, Card, Button, Eyebrow, Bar } from '../ui';
import { levelOf, rankOf, liveStreak, dayKey, dayNumber, allLessons } from '../lib/progress';

export default function Home({ lang, state, onOpenLesson, onDaily, onCoach }) {
  const t = lang.ui;
  const lessons = allLessons(lang);
  const next = lessons.find((l) => !state.done[l.id]);
  const daily = lessons[dayNumber() % lessons.length];
  const dailyDone = state.dailyDone === dayKey();
  const lv = levelOf(state.xp);
  const doneCount = lessons.filter((l) => state.done[l.id]).length;
  const tip = t.tips[dayNumber() % t.tips.length];

  return (
    <View style={{ gap: 15 }}>
      <View style={{ gap: 4 }}>
        <Text style={s.heading}>{t.welcome}</Text>
        <Text style={s.body}>{t.sub}</Text>
      </View>

      <Card>
        <View style={s.row}>
          <View>
            <Text style={s.small}>{t.level} {lv.level}</Text>
            <Text style={s.title}>{t.ranks[rankOf(lv.level)]}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: C.gold, fontSize: 24, fontWeight: '800' }}>{liveStreak(state)}</Text>
            <Text style={s.small}>{t.streak}</Text>
          </View>
        </View>
        <Bar value={lv.into / lv.need} />
        <Text style={s.small}>{lv.into} / {lv.need} {t.xp} · {doneCount}/{lessons.length} {t.lessonsWord}</Text>
      </Card>

      <Card>
        <Eyebrow>{t.daily}</Eyebrow>
        <Text style={s.title}>{daily.title}</Text>
        <Text style={s.body}>{daily.practice}</Text>
        {dailyDone ? (
          <Text style={[s.small, { color: C.good }]}>✓ {t.dailyDone}</Text>
        ) : (
          <>
            <Text style={[s.small, { color: C.gold }]}>{t.dailyBonus}</Text>
            <Button label={t.takeChallenge + ' →'} onPress={() => onDaily(daily.id)} />
          </>
        )}
      </Card>

      <Card>
        <Eyebrow>{t.continueLabel}</Eyebrow>
        {next ? (
          <>
            <Text style={s.small}>{next.moduleTitle}</Text>
            <Text style={s.title}>{next.title}</Text>
            <Button label={(doneCount ? t.continueBtn : t.startCourse) + ' →'} onPress={() => onOpenLesson(next.id)} />
          </>
        ) : (
          <Text style={s.body}>{t.allDone}</Text>
        )}
      </Card>

      <Button kind="secondary" label={t.practice + ' →'} onPress={onCoach} />

      <View style={[s.card, { backgroundColor: C.sunk }]}>
        <Eyebrow color={C.muted}>{t.tip}</Eyebrow>
        <Text style={s.bodyStrong}>{tip}</Text>
      </View>
    </View>
  );
}
