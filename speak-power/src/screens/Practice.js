// Answer box + feedback, used by lessons and by the Coach tab.
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { C, s, Button, ScoreBars, ListenButton, Eyebrow } from '../ui';
import { getFeedback } from '../lib/coach';
import { useDictation, openPermissions } from '../lib/platform';
import { overallScore } from '../lib/progress';

export function AiStatusLine({ status, setStatus, t }) {
  const [hint, setHint] = useState(false);
  const text = t.ai[status] || '';
  if (!text) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, backgroundColor: status === 'on' || status === 'server' ? C.good : status === 'connecting' ? C.gold : C.muted }} />
        <Text style={[s.note, { flex: 1 }]}>{text}</Text>
      </View>
      {status === 'denied' && (
        <View style={{ gap: 6 }}>
          <Button small kind="secondary" label={t.ai.allow} onPress={async () => {
            const st = await openPermissions();
            if (st === 'granted' || st === 'prompt') setStatus('on'); else setHint(true);
          }} />
          {hint && <Text style={s.note}>{t.ai.menuHint}</Text>}
        </View>
      )}
    </View>
  );
}

export default function Practice({ lang, situation, lesson, needSituation, aiStatus, setAiStatus, onResult, speaker }) {
  const t = lang.ui;
  const [answer, setAnswer] = useState('');
  const [own, setOwn] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const mic = useDictation((text) => setAnswer((a) => (a ? a + text : text.replace(/^\s+/, ''))));

  const run = async () => {
    const theSituation = needSituation ? own.trim() : situation;
    if (needSituation && !theSituation) { setError(t.needSituation); return; }
    if (!answer.trim()) { setError(t.needAnswer); return; }
    if (loading) return;
    mic.stop();
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const { result: r, status } = await getFeedback({ answer: answer.trim(), situation: theSituation, lesson, lang }, aiStatus);
      setResult(r);
      if (status !== aiStatus) setAiStatus(status);
      onResult && onResult(r, answer.trim());
    } finally {
      setLoading(false);
    }
  };

  const overall = result && overallScore(result.scores);
  return (
    <View style={{ gap: 12 }}>
      {needSituation && (
        <TextInput
          id="sp-own-situation"
          placeholder={t.freePlaceholder}
          placeholderTextColor="#8291AA"
          value={own}
          onChangeText={setOwn}
          style={s.inputSmall}
        />
      )}
      <TextInput
        id="sp-answer"
        multiline
        placeholder={t.placeholder}
        placeholderTextColor="#8291AA"
        value={mic.partial ? (answer ? answer + ' ' : '') + mic.partial : answer}
        onChangeText={(v) => { setAnswer(v); if (error) setError(''); }}
        style={s.input}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {mic.available && (
          <TouchableOpacity
            role="button"
            aria-label={mic.listening ? t.listening : t.speak}
            onPress={() => mic.toggle(lang.code)}
            style={[s.button, s.secondary, { flexDirection: 'row', gap: 6 }, mic.listening && { borderColor: C.gold }]}
          >
            <Text style={{ color: mic.listening ? C.gold : C.text, fontWeight: '800', fontSize: 15 }}>{mic.listening ? '● ' + t.listening : '🎙 ' + t.speak}</Text>
          </TouchableOpacity>
        )}
        <Button style={{ flex: 1 }} label={loading ? t.thinking : t.getFeedback} onPress={run} disabled={loading} />
      </View>
      {!!mic.notice && <Text style={s.note}>{t.voiceUnavailable}</Text>}
      {!!error && <Text style={[s.small, { color: C.bad }]}>{error}</Text>}

      {result && (
        <View style={[s.card, { backgroundColor: C.sunk }]}>
          <View style={s.row}>
            <Eyebrow color={result.source === 'ai' ? C.good : C.gold}>{result.source === 'ai' ? t.sourceAi.toUpperCase() : t.sourceQuick.toUpperCase()}</Eyebrow>
            {overall !== null && <Text style={{ color: C.gold, fontSize: 22, fontWeight: '800' }}>{overall}<Text style={s.small}> / 10</Text></Text>}
          </View>
          {result.scores && <ScoreBars scores={result.scores} t={t} />}
          {!!result.notice && <Text style={[s.note, { color: C.gold }]}>{t.ai[result.notice]}</Text>}
          <View style={s.infoBox}>
            <Text style={[s.small, { color: C.info, fontWeight: '700' }]}>{t.feedback}</Text>
            <Text style={{ color: C.info, fontSize: 15, lineHeight: 22 }}>{result.feedback}</Text>
          </View>
          {!!result.example && (
            <View style={{ gap: 8 }}>
              <Text style={[s.small, { fontWeight: '700' }]}>{t.tryThis}</Text>
              <Text style={[s.bodyStrong, { fontStyle: 'italic' }]}>“{result.example}”</Text>
              <ListenButton id="example" text={result.example} lang={lang} speaker={speaker} t={t} />
            </View>
          )}
          <Button small kind="ghost" label={t.tryAgain} onPress={() => { setResult(null); }} />
        </View>
      )}
    </View>
  );
}
