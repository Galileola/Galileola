import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { C, s, Card, Eyebrow, ListenButton, Button } from '../ui';

export default function Phrases({ lang, speaker, onPractise }) {
  const t = lang.ui;
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const match = (l) => !needle || [l.title, l.weak, ...l.say].some((x) => x.toLowerCase().includes(needle));
  const groups = lang.modules.map((m) => ({ ...m, lessons: m.lessons.filter(match) })).filter((m) => m.lessons.length);

  return (
    <View style={{ gap: 15 }}>
      <View style={{ gap: 4 }}>
        <Text style={s.heading}>{t.phrasesTitle}</Text>
        <Text style={s.body}>{t.phrasesSub}</Text>
      </View>
      <TextInput id="sp-phrase-search" placeholder={t.search} placeholderTextColor="#8291AA" value={q} onChangeText={setQ} style={s.inputSmall} />
      {groups.length === 0 && <Text style={s.body}>{t.noResults}</Text>}
      {groups.map((m) => (
        <View key={m.id} style={{ gap: 10 }}>
          <Eyebrow>{m.title.toUpperCase()}</Eyebrow>
          {m.lessons.map((l) => (
            <Card key={l.id}>
              <Text style={s.h3}>{l.title}</Text>
              <Text style={[s.small, { textDecorationLine: 'line-through' }]}>✕ {l.weak}</Text>
              {l.say.map((p, i) => (
                <View key={i} style={{ gap: 6, borderTopWidth: i ? 1 : 0, borderTopColor: C.lineSoft, paddingTop: i ? 10 : 0 }}>
                  <Text style={s.bodyStrong}>“{p}”</Text>
                  <ListenButton id={'ph-' + l.id + '-' + i} text={p} lang={lang} speaker={speaker} t={t} />
                </View>
              ))}
              <Button small kind="secondary" label={'💬 ' + t.chat.practiseChat.replace('{name}', l.chat.who)} onPress={() => onPractise(l.id)} />
            </Card>
          ))}
        </View>
      ))}
    </View>
  );
}
