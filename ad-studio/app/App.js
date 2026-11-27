import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { C } from './src/theme';
import { setServer, getServer, api } from './src/api';
import { load, save, addRecent } from './src/store';
import CreateScreen from './src/screens/CreateScreen';
import JobScreen from './src/screens/JobScreen';
import SettingsScreen from './src/screens/SettingsScreen';

export default function App() {
  const [data, setData] = useState(null);
  const [screen, setScreen] = useState({ name: 'create' });
  const scroll = useRef(null);

  useEffect(() => {
    load().then((saved) => {
      const server = saved.server.url ? saved.server : getServer();
      setServer(server);
      setData({ ...saved, server });
      if (!server.url) {
        setScreen({ name: 'settings' });
        return;
      }
      // Ask for the app password up front if the server needs one.
      api.health().then((h) => {
        if (h.passwordRequired && !server.token) setScreen({ name: 'settings' });
      }).catch(() => {});
    });
  }, []);

  // patch: an object, or a function of the current data (safe to call from old closures).
  const update = (patch) => {
    setData((d) => {
      const next = { ...d, ...(typeof patch === 'function' ? patch(d) : patch) };
      save(next);
      return next;
    });
  };

  const go = (next) => {
    setScreen(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const remember = (job) => {
    const first = Object.values(job.formats).find((f) => f.banner);
    update((d) => ({
      recent: addRecent(d.recent, {
        id: job.id,
        createdAt: job.createdAt,
        title: [job.request.brand, job.brief?.copy?.headline].filter(Boolean).join(' · ') || 'Ad',
        thumb: first?.banner || null,
      }),
    }));
  };

  if (!data) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.gold} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
        <StatusBar style="light" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            {screen.name === 'create' ? (
              <CreateScreen
                brand={data.brand}
                onBrandChange={(brand) => update({ brand })}
                recent={data.recent}
                onOpenJob={(id) => go({ name: 'job', id })}
                onCreated={(job) => {
                  remember(job);
                  go({ name: 'job', id: job.id, initial: job });
                }}
                onSettings={() => go({ name: 'settings' })}
              />
            ) : null}
            {screen.name === 'job' ? (
              <JobScreen
                jobId={screen.id}
                initial={screen.initial}
                onBack={() => go({ name: 'create' })}
                onUpdate={(job) => job.status === 'done' && remember(job)}
              />
            ) : null}
            {screen.name === 'settings' ? (
              <SettingsScreen
                server={data.server}
                onBack={() => go({ name: 'create' })}
                onSave={(server) => {
                  setServer(server);
                  update({ server });
                  go({ name: 'create' });
                }}
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 720, alignSelf: 'center' },
});
