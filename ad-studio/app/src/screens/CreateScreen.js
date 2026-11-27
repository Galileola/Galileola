import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { C, Card, Title, Label, Hint, Button, Chip, Chips, Field, Note } from '../theme';
import { api, FORMATS, STYLES, LANGUAGES, fileUrl } from '../api';
import { pickProduct, pickLogo } from '../media';
import { ClientPicker, Checkbox } from '../components';

export default function CreateScreen({ clients, brand, onBrandChange, onOpenJob, onCreated, onSettings, onNewClient }) {
  const [clientId, setClientId] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [offer, setOffer] = useState('');
  const [details, setDetails] = useState('');
  const [style, setStyle] = useState('auto');
  const [language, setLanguage] = useState('en');
  const [formats, setFormats] = useState(['post', 'story']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    api.jobs(null, 10).then(setRecent).catch(() => {});
  }, []);

  const client = clients.find((c) => c.id === clientId);

  const pickClient = (id) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) {
      setStyle(c.style || 'auto');
      setLanguage(c.language || 'en');
      setFormats(c.formats?.length ? c.formats : ['post', 'story']);
    }
  };

  const choose = async (fromCamera) => {
    setError('');
    try {
      const picked = await pickProduct(fromCamera);
      if (picked) setPhoto(picked);
    } catch (e) {
      setError(e.message);
    }
  };

  const chooseLogo = async () => {
    setError('');
    try {
      const logo = await pickLogo();
      if (logo) onBrandChange({ ...brand, logo });
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleFormat = (id) =>
    setFormats((f) => (f.includes(id) ? (f.length > 1 ? f.filter((x) => x !== id) : f) : [...f, id]));

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const job = await api.createJob({
        photo: photo.dataUri,
        clientId,
        ...(client ? {} : { brand: brand.name, logo: brand.logo }),
        offer,
        details,
        style,
        language,
        formats,
      });
      onCreated(job);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={s.header}>
        <View>
          <Text style={s.brand}>AD STUDIO</Text>
          <Text style={s.tagline}>From phone photo to finished ad</Text>
        </View>
        <TouchableOpacity role="button" aria-label="Settings" onPress={onSettings} style={s.gear}>
          <Text style={{ color: C.soft, fontSize: 15, fontWeight: '700' }}>Settings</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <Title>1. Your product</Title>
        {photo ? (
          <View>
            <Image source={{ uri: photo.uri }} style={[s.preview, { aspectRatio: photo.width / photo.height }]} resizeMode="contain" />
            {photo.fromVideo ? <Hint style={{ marginTop: 8 }}>We took a still frame from your video. The video ad is made from the finished banner.</Hint> : null}
            <View style={s.row}>
              <Button small kind="secondary" label="Retake" onPress={() => choose(true)} style={{ flex: 1 }} />
              <Button small kind="secondary" label="Choose another" onPress={() => choose(false)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <View>
            <Hint style={{ marginBottom: 14 }}>Take a photo or a short video of the product. Any background is fine; the studio replaces it.</Hint>
            <Button label="Take photo or video" onPress={() => choose(true)} />
            <Button kind="secondary" label="Choose from gallery" onPress={() => choose(false)} style={{ marginTop: 10 }} />
          </View>
        )}
      </Card>

      <Card>
        <Title>2. The ad</Title>
        <Label>Client</Label>
        <ClientPicker clients={clients} value={clientId} onChange={pickClient} />
        {client ? (
          <Hint style={{ marginBottom: 14 }}>Uses {client.name}’s brand kit: logo, colours, voice. Edit it under Clients.</Hint>
        ) : (
          <View>
            <Field label="Brand" value={brand.name} onChangeText={(name) => onBrandChange({ ...brand, name })} placeholder="e.g. Lumea" maxLength={60} />
            <Label>Logo (optional)</Label>
            <View style={[s.row, { marginTop: 0, marginBottom: 14, alignItems: 'center' }]}>
              {brand.logo ? <Image source={{ uri: brand.logo }} style={s.logo} resizeMode="contain" /> : null}
              <Button small kind="secondary" label={brand.logo ? 'Change logo' : 'Add logo'} onPress={chooseLogo} />
              {brand.logo ? <Button small kind="secondary" label="Remove" onPress={() => onBrandChange({ ...brand, logo: null })} /> : null}
              <Button small kind="secondary" label="Save as client" onPress={onNewClient} />
            </View>
          </View>
        )}
        <Field label="Offer (optional)" value={offer} onChangeText={setOffer} placeholder="e.g. −30% this week, New, Free delivery" maxLength={160} />
        <Field label="What should people know? (optional)" value={details} onChangeText={setDetails} multiline placeholder="What makes it special, who it’s for, price…" maxLength={600} />

        <Label>Style</Label>
        <Chips>{STYLES.map((x) => <Chip key={x.id} label={x.label} active={style === x.id} onPress={() => setStyle(x.id)} />)}</Chips>

        <Label>Ad language</Label>
        <Chips>{LANGUAGES.map((x) => <Chip key={x.id} label={x.label} active={language === x.id} onPress={() => setLanguage(x.id)} />)}</Chips>

        <Label>Sizes</Label>
        {FORMATS.map((f) => <Checkbox key={f.id} label={f.label} hint={f.hint} checked={formats.includes(f.id)} onPress={() => toggleFormat(f.id)} />)}
      </Card>

      {error ? <Note kind="bad">{error}</Note> : null}
      <Button label="Create ad" onPress={create} disabled={!photo} busy={busy} style={{ marginTop: 12, marginBottom: 8 }} />
      <Hint style={{ textAlign: 'center', marginBottom: 24 }}>Takes about 2–4 minutes.</Hint>

      {recent.length ? (
        <Card>
          <Title>Recent ads</Title>
          {recent.map((r) => (
            <TouchableOpacity key={r.id} role="button" onPress={() => onOpenJob(r.id)} style={s.recent}>
              <Image source={{ uri: fileUrl(r.thumb) }} style={s.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={s.recentName} numberOfLines={1}>{[r.brand, r.headline].filter(Boolean).join(' · ') || 'Ad'}</Text>
                <Text style={s.recentHint}>{new Date(r.createdAt).toLocaleString()}{r.approval === 'approved' ? ' · Approved' : r.approval === 'changes' ? ' · Changes asked' : ''}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, marginTop: 6 },
  brand: { color: C.gold, fontSize: 22, fontWeight: '900', letterSpacing: 3 },
  tagline: { color: C.soft, fontSize: 14, marginTop: 2 },
  gear: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  preview: { width: '100%', maxHeight: 420, borderRadius: 12, backgroundColor: C.sunk },
  row: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  logo: { width: 64, height: 40, backgroundColor: C.sunk, borderRadius: 8 },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line, marginBottom: 6 },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: C.sunk },
  recentName: { color: C.text, fontSize: 16, fontWeight: '700' },
  recentHint: { color: C.muted, fontSize: 13, marginTop: 2 },
});
