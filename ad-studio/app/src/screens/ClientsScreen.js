import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet, AppState, Linking, Platform } from 'react-native';
import { C, Card, Title, Label, Hint, Button, Chip, Chips, Field, Note } from '../theme';
import { api, fileUrl, FORMATS, STYLES, LANGUAGES } from '../api';
import { pickLogo } from '../media';
import { ColorField, Checkbox, BackLink, Empty } from '../components';

/** The list of clients (brand kits). */
export function ClientsScreen({ onOpen, onNew }) {
  const [clients, setClients] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.clients().then(setClients).catch((e) => setError(e.message));
  }, []);
  return (
    <View>
      <Text style={s.h1}>Clients</Text>
      <Hint style={{ marginBottom: 16 }}>Each client has a brand kit: logo, colours, style, language and voice. Every ad for the client uses it.</Hint>
      {error ? <Note kind="bad">{error}</Note> : null}
      <Button label="+ New client" onPress={onNew} style={{ marginBottom: 16 }} />
      {!clients && !error ? <ActivityIndicator color={C.gold} /> : null}
      {clients?.length === 0 ? <Empty>No clients yet.</Empty> : null}
      {clients?.map((c) => (
        <TouchableOpacity key={c.id} role="button" aria-label={c.name} onPress={() => onOpen(c.id)} style={s.row}>
          {c.logo ? <Image source={{ uri: fileUrl(c.logo) }} style={s.logo} resizeMode="contain" /> : <View style={[s.logo, s.initial]}><Text style={s.initialText}>{c.name.slice(0, 1).toUpperCase()}</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{c.name}</Text>
            <Text style={s.meta}>{[STYLES.find((x) => x.id === c.style)?.label, LANGUAGES.find((x) => x.id === c.language)?.label, c.connections?.meta ? 'Facebook' : null, c.connections?.google ? 'Google Ads' : null].filter(Boolean).join(' · ')}</Text>
          </View>
          <View style={s.dots}>{[c.primary, c.accent].filter(Boolean).map((col) => <View key={col} style={[s.dot, { backgroundColor: col }]} />)}</View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const EMPTY = { name: '', logo: null, primary: '', accent: '', style: 'auto', language: 'en', tone: '', website: '', about: '', formats: ['post', 'story'] };

/** Creating or editing one client's brand kit, its connections and its ads. */
export function ClientScreen({ clientId, onBack, onSaved, onOpenJob, publishing }) {
  const [client, setClient] = useState(clientId ? null : EMPTY);
  const [logo, setLogo] = useState(undefined); // undefined = unchanged, null = removed, string = new
  const [jobs, setJobs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    if (!clientId) return;
    api.client(clientId).then(setClient).catch((e) => setError(e.message));
    api.jobs(clientId, 12).then(setJobs).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    load();
    // Coming back from the Facebook or Google sign-in page.
    const sub = AppState.addEventListener('change', (state) => state === 'active' && load());
    const onFocus = () => load();
    if (Platform.OS === 'web') window.addEventListener('focus', onFocus);
    return () => {
      sub.remove();
      if (Platform.OS === 'web') window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  if (!client) return <ActivityIndicator color={C.gold} style={{ marginTop: 40 }} />;
  const set = (key) => (value) => setClient((c) => ({ ...c, [key]: value }));
  const logoUri = logo === undefined ? (client.logo ? fileUrl(client.logo) : null) : logo;

  const save = async () => {
    setSaving(true);
    setError('');
    setNote('');
    try {
      const body = { ...client };
      delete body.logo;
      if (logo !== undefined) body.logo = logo;
      const saved = await api.saveClient(clientId, body);
      setLogo(undefined);
      setClient(saved);
      setNote('Saved.');
      onSaved?.(saved);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const connect = async (provider) => {
    setError('');
    try {
      const { url } = await api.connect(clientId, provider);
      await Linking.openURL(url);
      setNote('Finish signing in in the browser, then come back here.');
    } catch (e) {
      setError(e.message);
    }
  };

  const disconnect = async (provider) => {
    try {
      setClient(await api.disconnect(clientId, provider));
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleFormat = (id) => set('formats')(client.formats.includes(id) ? (client.formats.length > 1 ? client.formats.filter((f) => f !== id) : client.formats) : [...client.formats, id]);
  const meta = client.connections?.meta;
  const google = client.connections?.google;

  return (
    <View>
      <BackLink label="‹ Clients" onPress={onBack} />
      <Card>
        <Title>{clientId ? client.name || 'Client' : 'New client'}</Title>
        <Field label="Name" value={client.name} onChangeText={set('name')} placeholder="e.g. Lumea" maxLength={60} />
        <Label>Logo</Label>
        <View style={[s.inline, { marginBottom: 14 }]}>
          {logoUri ? <Image source={{ uri: logoUri }} style={s.bigLogo} resizeMode="contain" /> : null}
          <Button small kind="secondary" label={logoUri ? 'Change logo' : 'Add logo'} onPress={async () => { try { const l = await pickLogo(); if (l) setLogo(l); } catch (e) { setError(e.message); } }} />
          {logoUri ? <Button small kind="secondary" label="Remove" onPress={() => setLogo(null)} /> : null}
        </View>
        <ColorField label="Main brand colour" value={client.primary} onChange={set('primary')} />
        <ColorField label="Accent colour (buttons and stickers)" value={client.accent} onChange={set('accent')} />
        <Label>Style</Label>
        <Chips>{STYLES.map((x) => <Chip key={x.id} label={x.label} active={client.style === x.id} onPress={() => set('style')(x.id)} />)}</Chips>
        <Label>Ad language</Label>
        <Chips>{LANGUAGES.map((x) => <Chip key={x.id} label={x.label} active={client.language === x.id} onPress={() => set('language')(x.id)} />)}</Chips>
        <Field label="Brand voice" value={client.tone} onChangeText={set('tone')} placeholder="e.g. warm and premium, no slang, speaks to young mothers" multiline maxLength={300} />
        <Field label="About the business" value={client.about} onChangeText={set('about')} placeholder="What they sell, what makes them different, where they are" multiline maxLength={600} />
        <Field label="Website" value={client.website} onChangeText={set('website')} placeholder="lumea.ee" autoCapitalize="none" maxLength={200} />
        <Label>Usual sizes</Label>
        {FORMATS.map((f) => <Checkbox key={f.id} label={f.label} hint={f.hint} checked={client.formats.includes(f.id)} onPress={() => toggleFormat(f.id)} />)}
        {error ? <Note kind="bad">{error}</Note> : null}
        {note ? <Hint style={{ color: C.good, marginTop: 10 }}>{note}</Hint> : null}
        <Button label={clientId ? 'Save brand kit' : 'Create client'} onPress={save} busy={saving} disabled={!client.name.trim()} style={{ marginTop: 12 }} />
      </Card>

      {clientId ? (
        <Card>
          <Title>Publishing</Title>
          <Hint style={{ marginBottom: 12 }}>Connect the client’s accounts once. Then each ad can be posted, or sent to the ad accounts, with one tap.</Hint>
          <View style={s.conn}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>Facebook and Instagram</Text>
              <Text style={s.meta}>{meta ? [meta.pageName, meta.igUsername && `@${meta.igUsername}`, meta.adAccountName && `Ads: ${meta.adAccountName}`].filter(Boolean).join(' · ') : publishing?.meta === false ? 'Not set up on the server yet' : 'Not connected'}</Text>
            </View>
            {meta ? <Button small kind="secondary" label="Disconnect" onPress={() => disconnect('meta')} /> : <Button small label="Connect" disabled={publishing?.meta === false} onPress={() => connect('meta')} />}
          </View>
          <View style={s.conn}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>Google Ads</Text>
              <Text style={s.meta}>{google ? `${google.customerName}` : publishing?.google === false ? 'Not set up on the server yet' : 'Not connected'}</Text>
            </View>
            {google ? <Button small kind="secondary" label="Disconnect" onPress={() => disconnect('google')} /> : <Button small label="Connect" disabled={publishing?.google === false} onPress={() => connect('google')} />}
          </View>
        </Card>
      ) : null}

      {clientId && jobs.length ? (
        <Card>
          <Title>Ads for {client.name}</Title>
          {jobs.map((j) => (
            <TouchableOpacity key={j.id} role="button" onPress={() => onOpenJob(j.id)} style={s.row}>
              <Image source={{ uri: fileUrl(j.thumb) }} style={s.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{j.headline || 'Ad'}</Text>
                <Text style={s.meta}>{new Date(j.createdAt).toLocaleDateString()} · {j.approval === 'approved' ? 'Approved by client' : j.approval === 'changes' ? 'Client asked for changes' : j.status === 'done' ? 'Ready' : j.status}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  h1: { color: C.text, fontSize: 26, fontWeight: '900', marginTop: 6, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  logo: { width: 48, height: 48, borderRadius: 10, backgroundColor: '#fff' },
  initial: { backgroundColor: C.sunk, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  initialText: { color: C.gold, fontSize: 20, fontWeight: '900' },
  name: { color: C.text, fontSize: 16, fontWeight: '700' },
  meta: { color: C.muted, fontSize: 13, marginTop: 2 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: C.line },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  bigLogo: { width: 96, height: 56, backgroundColor: '#fff', borderRadius: 8 },
  conn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: C.sunk },
});
