// Shared look: the navy and gold identity of the original MVP.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export const C = {
  bg: '#101B31', card: '#1D2B44', sunk: '#152239', line: '#34435D', lineSoft: '#2A3954',
  gold: '#E6B96F', goldInk: '#182033', text: '#F5F7FC', soft: '#B5C1D3', muted: '#9BAAC2',
  chip: '#263751', good: '#86D4AE', goodBg: '#1E3B3A', bad: '#F2998F', badBg: '#3F2830',
  info: '#D8F4E6', infoBg: '#263E48',
};

export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;

export const Button = ({ label, onPress, kind = 'primary', small, disabled, style }) => (
  <TouchableOpacity
    role="button"
    aria-label={label}
    disabled={disabled}
    onPress={onPress}
    style={[s.button, kind === 'secondary' && s.secondary, kind === 'ghost' && s.ghost, small && s.smallBtn, disabled && s.disabled, style]}
  >
    <Text style={[s.buttonText, kind !== 'primary' && { color: C.text }, small && { fontSize: 14 }]}>{label}</Text>
  </TouchableOpacity>
);

export const Eyebrow = ({ children, color = C.gold }) => <Text style={[s.eyebrow, { color }]}>{children}</Text>;

export const Bar = ({ value, color = C.gold, height = 8 }) => (
  <View style={[s.track, { height }]}>
    <View style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height: '100%', backgroundColor: color, borderRadius: 10 }} />
  </View>
);

export const Pill = ({ label, active, onPress }) => (
  <TouchableOpacity role="button" aria-label={label} onPress={onPress} style={[s.pill, active && s.pillActive]}>
    <Text style={[s.pillText, active && { color: C.goldInk }]}>{label}</Text>
  </TouchableOpacity>
);

export const ListenButton = ({ id, text, lang, speaker, t }) => {
  if (!speaker.available) return null;
  const playing = speaker.speakingId === id;
  return (
    <TouchableOpacity role="button" aria-label={playing ? t.stop : t.listen} onPress={() => speaker.speak(id, text, lang)} style={s.listen}>
      <Text style={s.listenText}>{playing ? '■ ' + t.stop : '▶ ' + t.listen}</Text>
    </TouchableOpacity>
  );
};

export const ScoreBars = ({ scores, t }) => (
  <View style={{ gap: 10 }}>
    {['clarity', 'calm', 'confidence', 'respect'].map((k) => (
      <View key={k} style={{ gap: 5 }}>
        <View style={s.row}>
          <Text style={s.small}>{t.scores[k]}</Text>
          <Text style={[s.small, { color: C.text, fontWeight: '700' }]}>{scores[k]}/10</Text>
        </View>
        <Bar value={scores[k] / 10} color={scores[k] >= 7 ? C.good : scores[k] >= 5 ? C.gold : C.bad} height={7} />
      </View>
    ))}
  </View>
);

export const s = StyleSheet.create({
  heading: { fontSize: 26, fontWeight: '800', color: '#FFFFFF' },
  title: { fontSize: 19, fontWeight: '700', color: '#FFFFFF', lineHeight: 26 },
  h3: { fontSize: 16, fontWeight: '700', color: C.text, lineHeight: 22 },
  body: { color: C.soft, fontSize: 15, lineHeight: 23 },
  bodyStrong: { color: C.text, fontSize: 15, lineHeight: 23 },
  small: { color: C.muted, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 17, padding: 17, gap: 12 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  button: { backgroundColor: C.gold, borderRadius: 13, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  secondary: { backgroundColor: C.chip, borderWidth: 1, borderColor: '#52617B' },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  smallBtn: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10 },
  disabled: { opacity: 0.5 },
  buttonText: { color: C.goldInk, fontWeight: '800', fontSize: 15 },
  track: { backgroundColor: '#3A4860', borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  pill: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.chip },
  pillActive: { backgroundColor: C.gold },
  pillText: { color: '#E5EAF3', fontWeight: '700', fontSize: 13 },
  listen: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: C.line },
  listenText: { color: C.gold, fontWeight: '700', fontSize: 13 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: '#56637B', borderRadius: 12, color: 'white', minHeight: 110, textAlignVertical: 'top', padding: 13, fontSize: 16, lineHeight: 22 },
  inputSmall: { backgroundColor: C.bg, borderWidth: 1, borderColor: '#56637B', borderRadius: 12, color: 'white', padding: 12, fontSize: 16 },
  note: { color: C.muted, fontSize: 12, lineHeight: 18 },
  infoBox: { backgroundColor: C.infoBg, borderRadius: 12, padding: 13, gap: 6 },
  option: { padding: 14, borderColor: '#475670', borderWidth: 1, borderRadius: 12 },
  optionText: { color: C.text, fontSize: 15, lineHeight: 23 },
});
