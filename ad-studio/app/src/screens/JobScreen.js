import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C, Card, Title, Hint, Button, Chip, Chips, Field, Note, Bar } from '../theme';
import { api, fileUrl, FORMATS, STYLES } from '../api';
import { saveToPhotos, share } from '../media';

const STAGES = {
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
  if (job.status !== 'running') return 1;
  if (job.stage === 'brief') return 0.08;
  if (job.stage === 'cutout') return 0.18;
  const weight = { waiting: 0, painting: 0.35, checking: 0.7, retrying: 0.8, typesetting: 0.95, done: 1, error: 1 };
  const states = Object.values(job.formats);
  return 0.2 + 0.8 * (states.reduce((n, f) => n + (weight[f.stage] ?? 0), 0) / states.length);
}

function busy(job) {
  if (!job) return true;
  if (job.status === 'running') return true;
  if (Object.values(job.formats).some((f) => !['done', 'error'].includes(f.stage))) return true;
  return Object.values(job.videos || {}).some((v) => ['starting', 'rendering', 'finishing'].includes(v.status));
}

function VideoPlayer({ url, ratio }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={{ width: '100%', aspectRatio: ratio, borderRadius: 12, backgroundColor: C.sunk }} contentFit="contain" nativeControls />;
}

function FormatCard({ job, format, onAction, flash }) {
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

      {state.stage === 'done' ? (
        <View style={s.actions}>
          <Button small label="Save" onPress={() => onAction(() => saveToPhotos(url))} style={s.action} />
          <Button small kind="secondary" label="Share" onPress={() => onAction(() => share(url))} style={s.action} />
          <Button small kind="secondary" label="New scene" onPress={() => onAction(() => api.redo(job.id, format.id), true)} style={s.action} />
        </View>
      ) : null}
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
              </View>
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
  const set = (key) => (value) => setCopy((c) => ({ ...c, [key]: value }));

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
      <Field label="Headline" value={copy.headline} onChangeText={set('headline')} maxLength={40} />
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

  const formats = job ? FORMATS.filter((f) => job.formats[f.id]) : [];

  return (
    <View>
      <TouchableOpacity role="button" aria-label="Back" onPress={onBack} style={s.back}>
        <Text style={{ color: C.soft, fontSize: 16, fontWeight: '700' }}>‹ New ad</Text>
      </TouchableOpacity>

      {!job ? <ActivityIndicator color={C.gold} style={{ marginTop: 40 }} /> : null}
      {error ? <Note kind="bad">{error}</Note> : null}

      {job?.status === 'running' ? (
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

      {job?.brief && job.status !== 'running' ? (
        <Card>
          <Text style={s.eyebrow}>THE ART DIRECTOR’S IDEA</Text>
          <Text style={s.idea}>{job.brief.copy.headline}</Text>
          <Hint>{job.brief.scene.setting}</Hint>
        </Card>
      ) : null}

      {job && job.status !== 'running' && job.status !== 'error'
        ? formats.map((f) => <FormatCard key={f.id} job={job} format={f} onAction={onAction(f.id)} flash={flash[f.id]} />)
        : null}

      {job?.status === 'done' ? <EditText key={job.version} job={job} onSaved={(next) => { setJob(next); setTick((t) => t + 1); }} /> : null}
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
});
