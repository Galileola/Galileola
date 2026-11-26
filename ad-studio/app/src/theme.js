import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';

export const C = {
  bg: '#0E0F13',
  card: '#17191F',
  sunk: '#111317',
  line: '#2A2D36',
  text: '#F4F4F6',
  soft: '#B9BCC6',
  muted: '#868A96',
  gold: '#F2C14E',
  goldInk: '#1A1405',
  good: '#7ED4A6',
  warn: '#F5B84B',
  warnBg: '#2E2412',
  bad: '#F28B82',
  badBg: '#311A1A',
};

export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;

export const Title = ({ children, style }) => <Text style={[s.title, style]}>{children}</Text>;

export const Label = ({ children }) => <Text style={s.label}>{children}</Text>;

export const Hint = ({ children, style }) => <Text style={[s.hint, style]}>{children}</Text>;

export function Button({ label, onPress, kind = 'primary', disabled, busy, small, style }) {
  const primary = kind === 'primary';
  return (
    <TouchableOpacity
      role="button"
      aria-label={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={[s.button, !primary && s.secondary, small && s.small, (disabled || busy) && s.disabled, style]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? C.goldInk : C.text} />
      ) : (
        <Text style={[s.buttonText, !primary && { color: C.text }, small && { fontSize: 14 }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export const Chip = ({ label, active, onPress }) => (
  <TouchableOpacity role="button" aria-label={label} aria-selected={active} onPress={onPress} style={[s.chip, active && s.chipActive]}>
    <Text style={[s.chipText, active && { color: C.goldInk }]}>{label}</Text>
  </TouchableOpacity>
);

export const Chips = ({ children }) => <View style={s.chips}>{children}</View>;

export const Field = ({ label, multiline, style, ...props }) => (
  <View style={{ marginBottom: 14 }}>
    {label ? <Label>{label}</Label> : null}
    <TextInput
      placeholderTextColor={C.muted}
      multiline={multiline}
      style={[s.input, multiline && { minHeight: 84, textAlignVertical: 'top' }, style]}
      {...props}
    />
  </View>
);

export const Note = ({ kind = 'warn', children }) => (
  <View style={[s.note, { backgroundColor: kind === 'bad' ? C.badBg : C.warnBg }]}>
    <Text style={{ color: kind === 'bad' ? C.bad : C.warn, fontSize: 14, lineHeight: 20 }}>{children}</Text>
  </View>
);

export const Bar = ({ value }) => (
  <View style={s.track}>
    <View style={{ width: `${Math.round(Math.max(0.03, Math.min(1, value)) * 100)}%`, height: '100%', backgroundColor: C.gold, borderRadius: 6 }} />
  </View>
);

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 18, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: C.line },
  title: { color: C.text, fontSize: 20, fontWeight: '800', marginBottom: 12 },
  label: { color: C.soft, fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 },
  hint: { color: C.muted, fontSize: 14, lineHeight: 20 },
  button: { backgroundColor: C.gold, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  small: { paddingVertical: 10, paddingHorizontal: 14, minHeight: 42, borderRadius: 12 },
  disabled: { opacity: 0.45 },
  buttonText: { color: C.goldInk, fontSize: 16, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.sunk, borderWidth: 1, borderColor: C.line },
  chipActive: { backgroundColor: C.gold, borderColor: C.gold },
  chipText: { color: C.text, fontSize: 14, fontWeight: '700' },
  input: { backgroundColor: C.sunk, borderRadius: 12, borderWidth: 1, borderColor: C.line, color: C.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12 },
  note: { borderRadius: 12, padding: 12, marginTop: 10 },
  track: { height: 8, backgroundColor: C.sunk, borderRadius: 6, overflow: 'hidden' },
});
