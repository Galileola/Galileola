import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C, Card, Title, Label, Hint, Button, Chip, Chips, Field, Note, Bar } from '../theme';
import { api, fileUrl, FORMATS, STYLES, TARGETS } from '../api';
import { saveToPhotos, share, pickProduct } from '../media';
import { LinkBox, Checkbox } from '../components';
import { SloganList } from './SlogansScreen';

const STAGES = {
  queued: 'Waiting for a free slot in the studio',
  brief: 'The art director is studying your photo',
  cutout: 'Cutting out your product',
  scenes: 'Building the studio scenes',
};

const FORMAT_STAGES = {
  waiting: 'Waiting',
  painting: 'Building the scene',
  checking: 'Quality check',
  retrying: 'Second try with another model',
  typesetting: 'Setting the text',
  done: 'Ready',
  error: 'Failed',
};

const VIDEO_STAGES = { starting: 'Starting…', rendering: 'Filming (about 3 minutes)…', finishing: 'Adding the text…' };

function progress(job) {
  if (job.status === 'queued') return 0.03;
  if (job.status !== 'running') return 1;
  if (job.stage === 'brief') return 0.08;
  if (job.stage === 'cutout') return 0.18;
  const weight = { waiting: 0, painting: 0.35, checking: 0.7, retrying: 0.8, typesetting: 0.95, done: 1, error: 1 };
  const states = Object.values(job.formats);
  return 0.2 + 0.8 * (states.reduce((n, f) => n + (weight[f.stage] ?? 0), 0) / states.length);
}

function busy(job) {
  if (!job) return true;
  if (job.status === 'running' || job.status === 'queued') return true;
  if (job.avatar?.status === 'working') return true;
  if (Object.values(job.formats).some((f) => !['done', 'error'].includes(f.stage))) return true;
  return Object.values(job.videos || {}).some((v) => ['starting', 'rendering', 'finishing'].includes(v.status));
}

function VideoPlayer({ url, ratio, withSound }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = !withSound;
    if (!withSound) p.play();
  });
  return <VideoView player={player} style={{ width: '100%', aspectRatio: ratio, borderRadius: 12, backgroundColor: C.sunk }} contentFit="contain" nativeControls />;
}

const TARGET_LABEL = Object.fromEntries(TARGETS.map((t) => [t.id, t.label]));

/** Publishing one banner or video to the client's connected accounts. */
function PublishPanel({ job, format, kind, connections, onPublished }) {
  const available = TARGETS.filter((t) => t.check(connections) && !(t.imagesOnly && kind !== 'image'));
  const [targets, setTargets] = useState(available.filter((t) => t.id !== 'google_ads' || kind === 'image').map((t) => t.id));
  const [caption, setCaption] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  if (!job.clientId) return <Note>Publishing works for ads made for a saved client. Choose a client when you create the ad.</Note>;
  if (!available.length) return <Note>Connect this client’s Facebook, Instagram or Google Ads account under Clients first.</Note>;

  const toggle = (id) => setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const suggest = async () => {
    setSuggesting(true);
    try {
      setCaption((await api.caption(job.id)).caption);
    } catch (e) {
      setError(e.message);
    } finally {
      setSuggesting(false);
    }
  };
  const go = async () => {
    setPublishing(true);
    setError('');
    setResults(null);
    try {
      const { runId } = await api.publish(job.id, { format, kind, targets, caption });
      // Publishing runs on the server; an Instagram video can take a few minutes.
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const next = await api.job(job.id);
        const run = next.publishRuns?.[runId];
        if (run) setResults(run.results);
        if (run?.status === 'done') {
          onPublished?.(next);
          break;
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <View style={s.panel}>
      {available.map((t) => (
        <Checkbox key={t.id} label={t.label} hint={t.id === 'instagram' && (format === 'story' || kind === 'presenter') ? 'As a story' : t.id === 'meta_ads' || t.id === 'google_ads' ? 'Ready for a campaign; nothing is spent' : null} checked={targets.includes(t.id)} onPress={() => toggle(t.id)} />
      ))}
      {targets.some((t) => t === 'facebook' || t === 'instagram') ? (
        <View>
          <Field label="Post text" value={caption} onChangeText={setCaption} multiline placeholder="What the post says" maxLength={2200} />
          <Button small kind="secondary" label="Write it for me" onPress={suggest} busy={suggesting} style={{ alignSelf: 'flex-start', marginTop: -6, marginBottom: 12 }} />
        </View>
      ) : null}
      {error ? <Note kind="bad">{error}</Note> : null}
      <Button label="Publish now" onPress={go} busy={publishing} disabled={!targets.length} />
      {results ? results.map((r) => (
        <Text key={r.target} style={{ color: r.ok ? C.good : C.bad, marginTop: 8 }}>{TARGET_LABEL[r.target]}: {r.ok ? 'done' : r.error}</Text>
      )) : null}
    </View>
  );
}

const DECISION = { approved: 'Client approved', changes: 'Client asked for changes' };

function ApprovalCard({ job, onUpdate }) {
  const [url, setUrl] = useState(null);
  const [busyLink, setBusyLink] = useState(false);
  const [error, setError] = useState('');
  const make = async () => {
    setBusyLink(true);
    try {
      const r = await api.review(job.id);
      setUrl(r.url);
      onUpdate(r.job);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyLink(false);
    }
  };
  const decisions = job.approval?.decisions || {};
  return (
    <Card>
      <Title>Client approval</Title>
      <Hint style={{ marginBottom: 12 }}>Send the client a link. They see the ads in their language and approve each one or ask for changes; no login needed.</Hint>
      {Object.entries(decisions).map(([f, d]) => (
        <Text key={f} style={{ color: d.status === 'approved' ? C.good : C.warn, marginBottom: 6 }}>
          {FORMATS.find((x) => x.id === f)?.label}: {DECISION[d.status]}{d.name ? ` (${d.name})` : ''}{d.comment ? ` – “${d.comment}”` : ''}
        </Text>
      ))}
      {url ? <LinkBox url={url} message={`Your ads from ${job.request.brand || 'us'} are ready for review:`} /> : (
        <Button kind="secondary" label={job.approval ? 'Show the approval link' : 'Create approval link'} onPress={make} busy={busyLink} />
      )}
      {error ? <Note kind="bad">{error}</Note> : null}
    </Card>
  );
}

const AVATAR_STEPS = { script: 'Writing the script', presenter: 'Creating the presenter', voice: 'Recording the voice', filming: 'Filming (about 3–6 minutes)', finishing: 'Adding the end card' };

function PresenterCard({ job, connections, onUpdate }) {
  const [mode, setMode] = useState('female');
  const [photo, setPhoto] = useState(null);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [error, setError] = useState('');
  const avatar = job.avatar;
  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const body = mode === 'photo' ? { mode: 'photo', photo: photo?.dataUri, consent, gender: 'female' } : { mode: 'ai', gender: mode };
      onUpdate(await api.avatar(job.id, body));
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };
  const url = fileUrl(avatar?.url);
  return (
    <Card>
      <Title>Presenter video</Title>
      <Hint style={{ marginBottom: 12 }}>A person talks about the product for about 12 seconds in the ad language; the banner closes the video. Good for Reels, TikTok and Stories.</Hint>
      {avatar?.status === 'working' ? (
        <View style={s.videoWait}><ActivityIndicator color={C.gold} /><Text style={{ color: C.soft, marginLeft: 10 }}>{AVATAR_STEPS[avatar.step] || 'Working…'}</Text></View>
      ) : null}
      {avatar?.status === 'done' && url ? (
        <View>
          <VideoPlayer url={url} ratio={9 / 16} withSound />
          {avatar.script ? <Hint style={{ marginTop: 8 }}>“{avatar.script}”</Hint> : null}
          <View style={s.actions}>
            <Button small label="Save video" onPress={() => saveToPhotos(url)} style={s.action} />
            <Button small kind="secondary" label="Share" onPress={() => share(url)} style={s.action} />
            <Button small kind="secondary" label="Publish" onPress={() => setShowPublish((v) => !v)} style={s.action} />
          </View>
          {showPublish ? <PublishPanel job={job} format="story" kind="presenter" connections={connections} onPublished={onUpdate} /> : null}
        </View>
      ) : null}
      {avatar?.status === 'error' ? <Note kind="bad">{avatar.error}</Note> : null}
      {avatar?.status !== 'working' ? (
        <View style={{ marginTop: avatar?.status === 'done' ? 16 : 0 }}>
          <Label>{avatar?.status === 'done' ? 'Make another' : 'Presenter'}</Label>
          <Chips>
            <Chip label="AI woman" active={mode === 'female'} onPress={() => setMode('female')} />
            <Chip label="AI man" active={mode === 'male'} onPress={() => setMode('male')} />
            <Chip label="Real person’s photo" active={mode === 'photo'} onPress={() => setMode('photo')} />
          </Chips>
          {mode === 'photo' ? (
            <View>
              <View style={[s.actions, { marginTop: 0, marginBottom: 10, alignItems: 'center' }]}>
                {photo ? <Image source={{ uri: photo.uri }} style={{ width: 52, height: 52, borderRadius: 8 }} /> : null}
                <Button small kind="secondary" label={photo ? 'Change photo' : 'Choose a photo of the person'} onPress={async () => { try { const p = await pickProduct(false); if (p) setPhoto(p); } catch (e) { setError(e.message); } }} />
              </View>
              <Checkbox label="The person in the photo agreed to appear in this ad" checked={consent} onPress={() => setConsent((c) => !c)} />
            </View>
          ) : null}
          {error ? <Note kind="bad">{error}</Note> : null}
          <Button label="Make presenter video" onPress={start} busy={starting} disabled={mode === 'photo' && (!photo || !consent)} style={{ marginTop: 6 }} />
        </View>
      ) : null}
    </Card>
  );
}

function FormatCard({ job, format, onAction, flash, connections, onUpdate }) {
  const [publishKind, setPublishKind] = useState(null);
  const state = job.formats[format.id];
  const video = job.videos?.[format.id];
  const url = fileUrl(state.banner);
  const videoUrl = fileUrl(video?.url);
  const working = !['done', 'error'].includes(state.stage);

  return (
    <Card>
      <View style={s.cardHead}>
        <Text style={s.formatName}>{format.label}</Text>
        <Text style={[s.stage, state.stage === 'done' && { color: C.good }, state.stage === 'error' && { color: C.bad }]}>{FORMAT_STAGES[state.stage]}</Text>
      </View>

      {url && !working ? (
        <Image source={{ uri: url }} style={[s.banner, { aspectRatio: format.ratio }]} resizeMode="contain" />
      ) : (
        <View style={[s.banner, s.placeholder, { aspectRatio: format.ratio }]}>
          {state.stage === 'error' ? <Text style={{ color: C.bad }}>{state.error}</Text> : <ActivityIndicator color={C.gold} />}
        </View>
      )}

      {state.stage === 'done' && state.review && !state.review.approved ? (
        <Note>The quality check flagged this one{state.review.issues?.length ? `: ${state.review.issues.join('; ')}` : '.'} You can make it again.</Note>
      ) : null}

      {job.approval?.decisions?.[format.id] ? (
        <Text style={{ color: job.approval.decisions[format.id].status === 'approved' ? C.good : C.warn, marginTop: 10 }}>
          {DECISION[job.approval.decisions[format.id].status]}{job.approval.decisions[format.id].comment ? `: “${job.approval.decisions[format.id].comment}”` : ''}
        </Text>
      ) : null}

      {state.stage === 'done' ? (
        <View style={s.actions}>
          <Button small label="Save" onPress={() => onAction(() => saveToPhotos(url))} style={s.action} />
          <Button small kind="secondary" label="Share" onPress={() => onAction(() => share(url))} style={s.action} />
          <Button small kind="secondary" label="Publish" onPress={() => setPublishKind((k) => (k === 'image' ? null : 'image'))} style={s.action} />
          <Button small kind="secondary" label="New scene" onPress={() => onAction(() => api.redo(job.id, format.id), true)} style={s.action} />
        </View>
      ) : null}
      {publishKind === 'image' ? <PublishPanel job={job} format={format.id} kind="image" connections={connections} onPublished={onUpdate} /> : null}
      {state.stage === 'error' ? (
        <Button small kind="secondary" label="Try again" onPress={() => onAction(() => api.redo(job.id, format.id), true)} style={{ marginTop: 12 }} />
      ) : null}

      {state.stage === 'done' ? (
        <View style={s.videoBox}>
          {video?.status === 'done' && videoUrl ? (
            <View>
              <VideoPlayer url={videoUrl} ratio={format.ratio} />
              <View style={s.actions}>
                <Button small label="Save video" onPress={() => onAction(() => saveToPhotos(videoUrl))} style={s.action} />
                <Button small kind="secondary" label="Share video" onPress={() => onAction(() => share(videoUrl))} style={s.action} />
                <Button small kind="secondary" label="Publish video" onPress={() => setPublishKind((k) => (k === 'video' ? null : 'video'))} style={s.action} />
              </View>
              {publishKind === 'video' ? <PublishPanel job={job} format={format.id} kind="video" connections={connections} onPublished={onUpdate} /> : null}
            </View>
          ) : video && VIDEO_STAGES[video.status] ? (
            <View style={s.videoWait}>
              <ActivityIndicator color={C.gold} />
              <Text style={{ color: C.soft, marginLeft: 10 }}>{VIDEO_STAGES[video.status]}</Text>
            </View>
          ) : (
            <View>
              {video?.status === 'error' ? <Note kind="bad">{video.error}</Note> : null}
              <Button small kind="secondary" label="Make a 5-second video ad" onPress={() => onAction(() => api.video(job.id, format.id), true)} style={{ marginTop: 12 }} />
            </View>
          )}
        </View>
      ) : null}
      {flash ? <Hint style={{ marginTop: 10, color: C.good }}>{flash}</Hint> : null}
    </Card>
  );
}

function EditText({ job, onSaved }) {
  const [copy, setCopy] = useState(job.brief.copy);
  const [style, setStyle] = useState(job.brief.style);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [slogans, setSlogans] = useState(null);
  const [thinking, setThinking] = useState(false);
  const set = (key) => (value) => setCopy((c) => ({ ...c, [key]: value }));
  const ideas = async () => {
    setThinking(true);
    setError('');
    try {
      setSlogans((await api.jobSlogans(job.id)).slogans);
    } catch (e) {
      setError(e.message);
    } finally {
      setThinking(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      onSaved(await api.editText(job.id, copy, style));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Title>Edit the text</Title>
      <Hint style={{ marginBottom: 14 }}>Changes are instant and free; the photos stay the same.</Hint>
      <Field label="Headline" value={copy.headline} onChangeText={set('headline')} maxLength={48} />
      <Button small kind="secondary" label={slogans ? 'More slogan ideas' : 'Slogan ideas'} onPress={ideas} busy={thinking} style={{ alignSelf: 'flex-start', marginTop: -6, marginBottom: 12 }} />
      {slogans ? <View style={{ marginBottom: 12 }}><SloganList slogans={slogans} onUse={(t) => { set('headline')(t); setSlogans(null); }} /></View> : null}
      <Field label="Line under it" value={copy.subline} onChangeText={set('subline')} maxLength={80} />
      <Field label="Button" value={copy.cta} onChangeText={set('cta')} maxLength={24} />
      <Field label="Sticker (leave empty for none)" value={copy.badge} onChangeText={set('badge')} maxLength={12} />
      <Chips>{STYLES.filter((x) => x.id !== 'auto').map((x) => <Chip key={x.id} label={x.label} active={style === x.id} onPress={() => setStyle(x.id)} />)}</Chips>
      {error ? <Note kind="bad">{error}</Note> : null}
      <Button label="Update banners" onPress={submit} busy={saving} disabled={!copy.headline?.trim()} />
    </Card>
  );
}

export default function JobScreen({ jobId, initial, onBack, onUpdate }) {
  const [job, setJob] = useState(initial || null);
  const [connections, setConnections] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState({});
  const [tick, setTick] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const next = await api.job(jobId);
        if (!alive) return;
        setJob(next);
        onUpdate?.(next);
        setError('');
        if (busy(next)) timer.current = setTimeout(poll, 3000);
      } catch (e) {
        if (!alive) return;
        setError(e.message);
        timer.current = setTimeout(poll, 6000);
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [jobId, tick]);

  const onAction = (formatId) => async (fn, refresh) => {
    setFlash((f) => ({ ...f, [formatId]: '' }));
    try {
      const result = await fn();
      if (refresh) {
        setJob(result);
        setTick((t) => t + 1);
      } else if (typeof result === 'string') {
        setFlash((f) => ({ ...f, [formatId]: result }));
      }
    } catch (e) {
      setFlash((f) => ({ ...f, [formatId]: '' }));
      setError(e.message);
    }
  };

  useEffect(() => {
    if (job?.clientId && !connections) api.client(job.clientId).then((c) => setConnections(c.connections)).catch(() => {});
  }, [job?.clientId]);

  const refresh = (next) => {
    if (next) setJob(next);
    setTick((t) => t + 1);
  };

  const formats = job ? FORMATS.filter((f) => job.formats[f.id]) : [];

  return (
    <View>
      <TouchableOpacity role="button" aria-label="Back" onPress={onBack} style={s.back}>
        <Text style={{ color: C.soft, fontSize: 16, fontWeight: '700' }}>‹ New ad</Text>
      </TouchableOpacity>

      {!job ? <ActivityIndicator color={C.gold} style={{ marginTop: 40 }} /> : null}
      {error ? <Note kind="bad">{error}</Note> : null}

      {job?.status === 'running' || job?.status === 'queued' ? (
        <Card>
          <Title>Making your ad</Title>
          <Bar value={progress(job)} />
          <Text style={s.step}>{STAGES[job.stage] || 'Working…'}</Text>
          {job.stage === 'scenes'
            ? formats.map((f) => (
                <Text key={f.id} style={s.sub}>
                  {f.label}: {FORMAT_STAGES[job.formats[f.id].stage]}
                </Text>
              ))
            : null}
          <Hint style={{ marginTop: 12 }}>Usually 2–4 minutes. You can leave this screen; the ad will be under Recent ads.</Hint>
        </Card>
      ) : null}

      {job?.status === 'error' ? <Note kind="bad">{job.error}</Note> : null}

      {job?.brief && job.status === 'done' ? (
        <Card>
          <Text style={s.eyebrow}>THE ART DIRECTOR’S IDEA</Text>
          <Text style={s.idea}>{job.brief.copy.headline}</Text>
          <Hint>{job.brief.scene.setting}</Hint>
        </Card>
      ) : null}

      {job && job.status === 'done'
        ? formats.map((f) => <FormatCard key={f.id} job={job} format={f} onAction={onAction(f.id)} flash={flash[f.id]} connections={connections} onUpdate={refresh} />)
        : null}

      {job?.status === 'done' ? <EditText key={job.version} job={job} onSaved={refresh} /> : null}
      {job?.status === 'done' ? <ApprovalCard job={job} onUpdate={refresh} /> : null}
      {job?.status === 'done' ? <PresenterCard job={job} connections={connections} onUpdate={refresh} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  back: { paddingVertical: 10, marginBottom: 6, alignSelf: 'flex-start' },
  step: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 16 },
  sub: { color: C.soft, fontSize: 15, marginTop: 6 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  formatName: { color: C.text, fontSize: 17, fontWeight: '800' },
  stage: { color: C.soft, fontSize: 14, fontWeight: '700' },
  banner: { width: '100%', borderRadius: 12, backgroundColor: C.sunk },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  action: { flexGrow: 1 },
  videoBox: { marginTop: 4 },
  videoWait: { flexDirection: 'row', alignItems: 'center', marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: C.sunk },
  eyebrow: { color: C.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  idea: { color: C.text, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  panel: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg },
});
