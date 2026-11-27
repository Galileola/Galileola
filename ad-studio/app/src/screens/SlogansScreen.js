import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { C, Card, Title, Label, Hint, Button, Chip, Chips, Field, Note } from '../theme';
import { api, LANGUAGES } from '../api';
import { pickProduct } from '../media';
import { ClientPicker, copyText } from '../components';

const TONES = { premium: 'Premium', playful: 'Playful', bold: 'Bold', emotional: 'Emotional', short: 'Short' };

/** A list of slogans; tap to copy, or "Use" when a handler is given. */
export function SloganList({ slogans, onUse }) {
  const [copied, setCopied] = useState(null);
  return slogans.map((sl, i) => (
    <View key={`${i}-${sl.text}`} style={s.slogan}>
      <Text style={s.tone}>{TONES[sl.tone] || sl.tone}</Text>
      <Text selectable style={s.text}>{sl.text}</Text>
      {sl.why ? <Text style={s.why}>{sl.why}</Text> : null}
      <View style={s.actions}>
        {onUse ? <Button small label="Use as headline" onPress={() => onUse(sl.text)} /> : null}
        <Button small kind="secondary" label={copied === i ? 'Copied' : 'Copy'} onPress={async () => { await copyText(sl.text); setCopied(i); }} />
      </View>
    </View>
  ));
}

/** Slogans for a client or product, without making an ad. */
export function SlogansScreen({ clients }) {
  const [clientId, setClientId] = useState(null);
  const [product, setProduct] = useState('');
  const [offer, setOffer] = useState('');
  const [language, setLanguage] = useState('en');
  const [photo, setPhoto] = useState(null);
  const [slogans, setSlogans] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickClient = (id) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) setLanguage(c.language || 'en');
  };

  const write = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.slogans({ clientId, product, offer, language, photo: photo?.dataUri, count: 10 });
      setSlogans(r.slogans);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={s.h1}>Slogans</Text>
      <Hint style={{ marginBottom: 16 }}>Ten slogan ideas in different tones, written in the client’s voice.</Hint>
      <Card>
        <Label>Client</Label>
        <ClientPicker clients={clients} value={clientId} onChange={pickClient} />
        <Field label="Product or campaign" value={product} onChangeText={setProduct} multiline placeholder="e.g. Vitamin C serum for tired skin, 30 ml, vegan" maxLength={400} />
        <Field label="Offer (optional)" value={offer} onChangeText={setOffer} placeholder="e.g. −20% this week" maxLength={160} />
        <Label>Language</Label>
        <Chips>{LANGUAGES.map((x) => <Chip key={x.id} label={x.label} active={language === x.id} onPress={() => setLanguage(x.id)} />)}</Chips>
        <View style={s.photoRow}>
          {photo ? <Image source={{ uri: photo.uri }} style={s.photo} /> : null}
          <Button small kind="secondary" label={photo ? 'Change photo' : 'Add a product photo (optional)'} onPress={async () => { try { const p = await pickProduct(false); if (p) setPhoto(p); } catch (e) { setError(e.message); } }} />
          {photo ? <Button small kind="secondary" label="Remove" onPress={() => setPhoto(null)} /> : null}
        </View>
        {error ? <Note kind="bad">{error}</Note> : null}
        <Button label="Write slogans" onPress={write} busy={busy} disabled={!product.trim() && !photo && !clientId} style={{ marginTop: 12 }} />
      </Card>
      {slogans ? (
        <Card>
          <Title>Ideas</Title>
          <SloganList slogans={slogans} />
          <Button kind="secondary" label="More ideas" onPress={write} busy={busy} style={{ marginTop: 8 }} />
        </Card>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  h1: { color: C.text, fontSize: 26, fontWeight: '900', marginTop: 6, marginBottom: 6 },
  slogan: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  tone: { color: C.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  text: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 4 },
  why: { color: C.muted, fontSize: 13, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  photo: { width: 52, height: 52, borderRadius: 8 },
});
