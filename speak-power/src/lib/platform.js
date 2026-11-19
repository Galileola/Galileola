// Optional features that the claude.ai viewer offers to the published web page:
// "sample" (ask Claude), "tts" (read aloud), "dictation" (speech to text) and
// "permissions". In the native app, or on any other host, they resolve to null
// and the app falls back to the server coach / expo-speech / the keyboard's own mic.
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

const claude = typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function' ? window.claude : null;
export const inClaudeViewer = !!claude;

const use = (name) => (claude ? claude.use(name).catch(() => null) : Promise.resolve(null));
export const samplePromise = use('sample');
export const ttsPromise = use('tts');
export const dictationPromise = use('dictation');
export const permissionsPromise = use('permissions');

// AI coach status: 'connecting' | 'on' | 'server' | 'off' | 'denied'
export function useAiStatus(hasServer) {
  const [status, setStatus] = useState(hasServer ? 'server' : 'connecting');
  useEffect(() => {
    let live = true;
    (async () => {
      const sample = await samplePromise;
      if (!live) return;
      if (!sample) { setStatus(hasServer ? 'server' : Platform.OS === 'web' ? 'off' : 'app'); return; }
      let state = 'prompt';
      try { const p = await permissionsPromise; if (p) state = await p.state('sample'); } catch (e) {}
      if (live) setStatus(state === 'denied' ? 'denied' : state === 'unavailable' ? (hasServer ? 'server' : 'off') : 'on');
    })();
    return () => { live = false; };
  }, [hasServer]);
  return [status, setStatus];
}

// Opens the viewer's Permissions panel so a viewer who declined can allow the AI coach.
export async function openPermissions() {
  const p = await permissionsPromise;
  if (!p) return 'unavailable';
  try {
    await p.manage();
    const state = await p.state('sample');
    return state;
  } catch (e) {
    return 'unavailable';
  }
}

// Read aloud. Inside the claude.ai viewer only the viewer's own voice is used
// (and the control is hidden when it is not offered); elsewhere expo-speech.
export function useSpeaker() {
  const [ns, setNs] = useState(null);
  const [available, setAvailable] = useState(!inClaudeViewer);
  const [speakingId, setSpeakingId] = useState(null);
  useEffect(() => {
    if (!inClaudeViewer) return;
    let off;
    ttsPromise.then((t) => {
      setNs(t);
      setAvailable(!!t);
      if (t) off = t.onState(({ state, reason }) => {
        if (state === 'idle') { setSpeakingId(null); if (reason === 'not_granted' || reason === 'unavailable') setAvailable(false); }
      });
    });
    return () => { if (off) off(); };
  }, []);
  const speak = (id, text, lang) => {
    if (speakingId === id) { stop(); return; }
    setSpeakingId(id);
    if (inClaudeViewer) {
      if (!ns) { setSpeakingId(null); return; }
      ns.speak(text, { language: lang.code }).catch((e) => {
        setSpeakingId((cur) => (cur === id ? null : cur));
        if (e && (e.code === 'not_granted' || e.code === 'unavailable')) setAvailable(false);
      });
    } else {
      Speech.stop();
      Speech.speak(text, { language: lang.speech, onDone: () => setSpeakingId(null), onStopped: () => setSpeakingId(null), onError: () => setSpeakingId(null) });
    }
  };
  const stop = () => {
    setSpeakingId(null);
    if (inClaudeViewer) { if (ns) ns.stop(); } else Speech.stop();
  };
  return { available, speak, stop, speakingId };
}

// Speech to text through the viewer. start() must run inside the tap handler,
// so the namespace is resolved ahead of time and kept in a ref.
export function useDictation(onFinal) {
  const ref = useRef(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState('idle');
  const [partial, setPartial] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const offs = [];
    dictationPromise.then((d) => {
      if (!d) return;
      ref.current = d;
      setAvailable(true);
      offs.push(d.onPartial(({ text }) => setPartial(text)));
      offs.push(d.onFinal(({ text }) => { setPartial(''); finalRef.current(text); }));
      offs.push(d.onState(({ state: s, reason }) => {
        setState(s);
        if (s === 'idle') {
          setPartial('');
          if (reason === 'not_granted' || reason === 'unavailable') setAvailable(false);
        }
      }));
    });
    return () => offs.forEach((off) => off());
  }, []);
  const toggle = (language) => {
    const d = ref.current;
    if (!d) return;
    if (d.active()) { d.stop().catch(() => {}); return; }
    setNotice('');
    d.start({ language }).catch((e) => {
      const code = e && e.code;
      if (code === 'not_granted') setAvailable(false);
      else if (code === 'unavailable') setNotice('unavailable');
      else if (code !== 'stopped' && code !== 'dismissed') setNotice('error');
    });
  };
  const stop = () => { const d = ref.current; if (d && d.active()) d.stop().catch(() => {}); };
  return { available, listening: state !== 'idle', partial, notice, toggle, stop };
}
