import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView, Share, Platform, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { C, Label, Hint } from './theme';
import { fileUrl } from './api';

/** Horizontal list of clients to choose from; "No client" first. */
export function ClientPicker({ clients, value, onChange, allowNone = true }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8 }}>
      {allowNone ? (
        <TouchableOpacity role="button" aria-selected={!value} onPress={() => onChange(null)} style={[s.client, !value && s.clientOn]}>
          <Text style={[s.clientText, !value && { color: C.goldInk }]}>No client</Text>
        </TouchableOpacity>
      ) : null}
      {clients.map((c) => (
        <TouchableOpacity key={c.id} role="button" aria-label={c.name} aria-selected={value === c.id} onPress={() => onChange(c.id)} style={[s.client, value === c.id && s.clientOn]}>
          {c.logo ? <Image source={{ uri: fileUrl(c.logo) }} style={s.clientLogo} resizeMode="contain" /> : null}
          <Text style={[s.clientText, value === c.id && { color: C.goldInk }]}>{c.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const SWATCHES = ['#111111', '#FFFFFF', '#C8A165', '#E63946', '#F2C14E', '#2A9D8F', '#264653', '#3A86FF', '#8338EC', '#FF006E', '#FB5607', '#6A994E'];

/** A brand colour: tap a swatch or type a #hex code. */
export function ColorField({ label, value, onChange }) {
  const [draft, setDraft] = useState(value || '');
  const set = (v) => {
    setDraft(v);
    if (/^#[0-9a-f]{6}$/i.test(v) || v === '') onChange(v);
  };
  return (
    <View style={{ marginBottom: 14 }}>
      <Label>{label}</Label>
      <View style={s.swatches}>
        {SWATCHES.map((c) => (
          <TouchableOpacity key={c} role="button" aria-label={c} onPress={() => set(c)} style={[s.swatch, { backgroundColor: c }, value?.toLowerCase() === c.toLowerCase() && s.swatchOn]} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={[s.preview, { backgroundColor: /^#[0-9a-f]{6}$/i.test(draft) ? draft : 'transparent' }]} />
        <TextInput value={draft} onChangeText={(v) => set(v.trim())} placeholder="#C8A165 (empty = let the AI choose)" placeholderTextColor={C.muted} autoCapitalize="none" style={s.input} maxLength={7} />
      </View>
    </View>
  );
}

/** A link with Copy and Share buttons. */
export function LinkBox({ url, message }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={s.linkBox}>
      <Text selectable style={s.link} numberOfLines={2}>{url}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TouchableOpacity role="button" onPress={async () => { await Clipboard.setStringAsync(url); setCopied(true); }} style={s.linkBtn}>
          <Text style={s.linkBtnText}>{copied ? 'Copied' : 'Copy link'}</Text>
        </TouchableOpacity>
        <TouchableOpacity role="button" onPress={() => shareText(message ? `${message}\n${url}` : url)} style={s.linkBtn}>
          <Text style={s.linkBtnText}>Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export async function shareText(text) {
  if (Platform.OS === 'web' && !navigator.share) {
    await Clipboard.setStringAsync(text);
    return;
  }
  await Share.share({ message: text });
}

export async function copyText(text) {
  await Clipboard.setStringAsync(text);
}

export function Checkbox({ label, hint, checked, onPress, disabled }) {
  return (
    <TouchableOpacity role="checkbox" aria-checked={checked} disabled={disabled} onPress={onPress} style={[s.check, checked && s.checkOn, disabled && { opacity: 0.45 }]}>
      <View style={[s.box, checked && s.boxOn]}>{checked ? <Text style={{ color: C.goldInk, fontWeight: '900' }}>✓</Text> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={s.checkLabel}>{label}</Text>
        {hint ? <Text style={s.checkHint}>{hint}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export const BackLink = ({ label = '‹ Back', onPress }) => (
  <TouchableOpacity role="button" aria-label="Back" onPress={onPress} style={{ paddingVertical: 10, marginBottom: 6, alignSelf: 'flex-start' }}>
    <Text style={{ color: C.soft, fontSize: 16, fontWeight: '700' }}>{label}</Text>
  </TouchableOpacity>
);

export const Empty = ({ children }) => <Hint style={{ textAlign: 'center', paddingVertical: 20 }}>{children}</Hint>;

const s = StyleSheet.create({
  client: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.sunk, borderWidth: 1, borderColor: C.line },
  clientOn: { backgroundColor: C.gold, borderColor: C.gold },
  clientText: { color: C.text, fontSize: 14, fontWeight: '700' },
  clientLogo: { width: 22, height: 22, borderRadius: 4, backgroundColor: '#fff' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  swatch: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line },
  swatchOn: { borderWidth: 3, borderColor: C.gold },
  preview: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  input: { flex: 1, backgroundColor: C.sunk, borderRadius: 12, borderWidth: 1, borderColor: C.line, color: C.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10 },
  linkBox: { backgroundColor: C.sunk, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line, marginTop: 10 },
  link: { color: C.gold, fontSize: 14 },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  linkBtnText: { color: C.text, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line, marginBottom: 8, backgroundColor: C.sunk },
  checkOn: { borderColor: C.gold },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.gold, borderColor: C.gold },
  checkLabel: { color: C.text, fontSize: 16, fontWeight: '700' },
  checkHint: { color: C.muted, fontSize: 13, marginTop: 2 },
});
