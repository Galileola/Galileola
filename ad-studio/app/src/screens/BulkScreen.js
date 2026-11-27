import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { C, Card, Title, Label, Hint, Button, Chip, Chips, Field, Note, Bar } from '../theme';
import { api, fileUrl, FORMATS, STYLES, LANGUAGES } from '../api';
import { ClientPicker, Checkbox, BackLink, Empty } from '../components';

/** Bulk ads: read a shop's products and make one ad per product. */
export function BulkScreen({ clients, onStarted, onOpenBatch }) {
  const [clientId, setClientId] = useState(null);
  const [mode, setMode] = useState('shop');
  const [url, setUrl] = useState('');
  const [csv, setCsv] = useState('');
  const [products, setProducts] = useState(null);
  const [source, setSource] = useState('');
  const [chosen, setChosen] = useState([]);
  const [offer, setOffer] = useState('');
  const [style, setStyle] = useState('auto');
  const [language, setLanguage] = useState('en');
  const [formats, setFormats] = useState(['post', 'story']);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [batches, setBatches] = useState([]);

  useEffect(() => {
    api.batches().then(setBatches).catch(() => {});
  }, []);

  const pickClient = (id) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) {
      setStyle(c.style || 'auto');
      setLanguage(c.language || 'en');
      setFormats(c.formats?.length ? c.formats : ['post', 'story']);
    }
  };

  const read = async () => {
    setLoading(true);
    setError('');
    setProducts(null);
    try {
      const r = await api.shopProducts(mode === 'shop' ? { url } : { csv });
      setProducts(r.products);
      setSource(r.source);
      setChosen(r.products.slice(0, 10).map((p) => p.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const toggleFormat = (id) => setFormats((f) => (f.includes(id) ? (f.length > 1 ? f.filter((x) => x !== id) : f) : [...f, id]));

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const batch = await api.startBatch({ clientId, products: products.filter((p) => chosen.includes(p.id)), offer, style, language, formats });
      onStarted(batch.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <View>
      <Text style={s.h1}>Bulk ads</Text>
      <Hint style={{ marginBottom: 16 }}>Make an ad for every product in an online shop. Shopify and WooCommerce shops work with just the address; for other shops, paste a CSV export.</Hint>

      <Card>
        <Title>1. Products</Title>
        <Label>Client</Label>
        <ClientPicker clients={clients} value={clientId} onChange={pickClient} />
        <Chips>
          <Chip label="Shop address" active={mode === 'shop'} onPress={() => setMode('shop')} />
          <Chip label="CSV file" active={mode === 'csv'} onPress={() => setMode('csv')} />
        </Chips>
        {mode === 'shop' ? (
          <Field label="Shop address" value={url} onChangeText={setUrl} placeholder="myshop.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        ) : (
          <Field label="CSV (name, image link, price, description)" value={csv} onChangeText={setCsv} multiline placeholder={'name;image;price\nVitamin C Serum;https://…/serum.jpg;29.90'} autoCapitalize="none" style={{ minHeight: 120, fontSize: 14 }} />
        )}
        <Button kind="secondary" label="Load products" onPress={read} busy={loading} disabled={mode === 'shop' ? !url.trim() : !csv.trim()} />
        {error && !products ? <Note kind="bad">{error}</Note> : null}
      </Card>

      {products ? (
        <Card>
          <Title>2. Choose products</Title>
          <Hint style={{ marginBottom: 10 }}>{products.length} products found ({source}). {chosen.length} chosen.</Hint>
          <View style={[s.inline, { marginBottom: 10 }]}>
            <Button small kind="secondary" label="Choose all" onPress={() => setChosen(products.map((p) => p.id))} />
            <Button small kind="secondary" label="Clear" onPress={() => setChosen([])} />
          </View>
          {products.map((p) => (
            <TouchableOpacity key={p.id} role="checkbox" aria-checked={chosen.includes(p.id)} onPress={() => toggle(p.id)} style={[s.product, chosen.includes(p.id) && s.productOn]}>
              <Image source={{ uri: p.image }} style={s.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={2}>{p.title}</Text>
                {p.price ? <Text style={s.meta}>{p.price}</Text> : null}
              </View>
              <View style={[s.box, chosen.includes(p.id) && s.boxOn]}>{chosen.includes(p.id) ? <Text style={{ color: C.goldInk, fontWeight: '900' }}>✓</Text> : null}</View>
            </TouchableOpacity>
          ))}
        </Card>
      ) : null}

      {products ? (
        <Card>
          <Title>3. The ads</Title>
          <Field label="Offer for all (optional)" value={offer} onChangeText={setOffer} placeholder="e.g. −20% Black Friday" maxLength={160} />
          <Label>Style</Label>
          <Chips>{STYLES.map((x) => <Chip key={x.id} label={x.label} active={style === x.id} onPress={() => setStyle(x.id)} />)}</Chips>
          <Label>Ad language</Label>
          <Chips>{LANGUAGES.map((x) => <Chip key={x.id} label={x.label} active={language === x.id} onPress={() => setLanguage(x.id)} />)}</Chips>
          <Label>Sizes</Label>
          {FORMATS.map((f) => <Checkbox key={f.id} label={f.label} hint={f.hint} checked={formats.includes(f.id)} onPress={() => toggleFormat(f.id)} />)}
          {error ? <Note kind="bad">{error}</Note> : null}
          <Button label={`Make ${chosen.length} ad${chosen.length === 1 ? '' : 's'}`} onPress={start} busy={starting} disabled={!chosen.length} style={{ marginTop: 10 }} />
          <Hint style={{ marginTop: 8 }}>Ads are made a few at a time; you can leave the app while it works.</Hint>
        </Card>
      ) : null}

      {batches.length ? (
        <Card>
          <Title>Earlier bulk orders</Title>
          {batches.map((b) => (
            <TouchableOpacity key={b.id} role="button" onPress={() => onOpenBatch(b.id)} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{b.title}</Text>
                <Text style={s.meta}>{new Date(b.createdAt).toLocaleString()} · {b.added} of {b.total} added</Text>
              </View>
            </TouchableOpacity>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const STATUS = { queued: 'Waiting', running: 'Working', done: 'Ready', error: 'Failed' };

/** Progress of one bulk order. */
export function BatchScreen({ batchId, onBack, onOpenJob }) {
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const b = await api.batch(batchId);
        if (!alive) return;
        setBatch(b);
        const busy = b.added + b.failed.length < b.total || b.jobs.some((j) => ['queued', 'running'].includes(j.status));
        if (busy) timer.current = setTimeout(poll, 4000);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [batchId]);

  const done = batch ? batch.jobs.filter((j) => j.status === 'done').length : 0;
  return (
    <View>
      <BackLink label="‹ Bulk ads" onPress={onBack} />
      {error ? <Note kind="bad">{error}</Note> : null}
      {!batch ? <ActivityIndicator color={C.gold} style={{ marginTop: 40 }} /> : (
        <View>
          <Card>
            <Title>{batch.title}</Title>
            <Bar value={batch.total ? done / batch.total : 1} />
            <Text style={s.progress}>{done} of {batch.total} ready</Text>
            {batch.failed.map((f) => <Hint key={f.title} style={{ color: C.bad }}>{f.title}: {f.error}</Hint>)}
          </Card>
          {batch.jobs.length === 0 ? <Empty>Downloading the product photos…</Empty> : null}
          <View style={s.grid}>
            {batch.jobs.map((j) => (
              <TouchableOpacity key={j.id} role="button" onPress={() => onOpenJob(j.id)} style={s.tile}>
                <Image source={{ uri: fileUrl(j.thumb) }} style={s.tileImg} />
                <Text style={s.tileText} numberOfLines={1}>{j.headline || j.details}</Text>
                <Text style={[s.meta, j.status === 'done' && { color: C.good }, j.status === 'error' && { color: C.bad }]}>{STATUS[j.status] || j.status}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  h1: { color: C.text, fontSize: 26, fontWeight: '900', marginTop: 6, marginBottom: 6 },
  inline: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  product: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, marginBottom: 8, backgroundColor: C.sunk },
  productOn: { borderColor: C.gold },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: '#fff' },
  name: { color: C.text, fontSize: 15, fontWeight: '700' },
  meta: { color: C.muted, fontSize: 13, marginTop: 2 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.gold, borderColor: C.gold },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  progress: { color: C.text, fontSize: 16, fontWeight: '700', marginTop: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', backgroundColor: C.card, borderRadius: 14, padding: 8, borderWidth: 1, borderColor: C.line },
  tileImg: { width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: C.sunk },
  tileText: { color: C.text, fontSize: 14, fontWeight: '700', marginTop: 6 },
});
