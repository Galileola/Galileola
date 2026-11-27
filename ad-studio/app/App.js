import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { C } from './src/theme';
import { setServer, getServer, api } from './src/api';
import { load, save } from './src/store';
import CreateScreen from './src/screens/CreateScreen';
import JobScreen from './src/screens/JobScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { ClientsScreen, ClientScreen } from './src/screens/ClientsScreen';
import { BulkScreen, BatchScreen } from './src/screens/BulkScreen';
import { SlogansScreen } from './src/screens/SlogansScreen';

const TABS = [
  { id: 'create', label: 'Create' },
  { id: 'clients', label: 'Clients' },
  { id: 'bulk', label: 'Bulk' },
  { id: 'slogans', label: 'Slogans' },
];

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('create');
  const [screen, setScreen] = useState(null); // a screen on top of the tab: job, client, batch, settings
  const [clients, setClients] = useState([]);
  const [publishing, setPublishing] = useState(null);
  const scroll = useRef(null);

  const loadClients = useCallback(() => {
    api.clients().then(setClients).catch(() => {});
    api.options().then((o) => setPublishing(o.publishing)).catch(() => {});
  }, []);

  useEffect(() => {
    load().then(async (saved) => {
      const server = saved.server.url ? saved.server : getServer();
      setServer(server);
      if (!server.url) {
        setScreen({ name: 'settings' });
      } else {
        // Ask for the app password up front if the server needs one.
        const h = await api.health().catch(() => null);
        if (h?.passwordRequired && !server.token) setScreen({ name: 'settings' });
        else loadClients();
      }
      setData({ ...saved, server });
    });
  }, [loadClients]);

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

  const switchTab = (id) => {
    setTab(id);
    go(null);
  };

  if (!data) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.gold} />
      </View>
    );
  }

  const openJob = (id, initial) => go({ name: 'job', id, initial });
  const back = () => go(null);

  let body;
  if (screen?.name === 'settings') {
    body = (
      <SettingsScreen
        server={data.server}
        onBack={back}
        onSave={(server) => {
          setServer(server);
          update({ server });
          loadClients();
          go(null);
        }}
      />
    );
  } else if (screen?.name === 'job') {
    body = <JobScreen key={screen.id} jobId={screen.id} initial={screen.initial} onBack={back} />;
  } else if (screen?.name === 'client') {
    body = (
      <ClientScreen
        key={screen.id || 'new'}
        clientId={screen.id}
        publishing={publishing}
        onBack={() => { loadClients(); go(null); }}
        onSaved={(c) => { loadClients(); if (!screen.id) go({ name: 'client', id: c.id }); }}
        onOpenJob={(id) => openJob(id)}
      />
    );
  } else if (screen?.name === 'batch') {
    body = <BatchScreen batchId={screen.id} onBack={back} onOpenJob={(id) => openJob(id)} />;
  } else if (tab === 'clients') {
    body = <ClientsScreen key={clients.length} onOpen={(id) => go({ name: 'client', id })} onNew={() => go({ name: 'client', id: null })} />;
  } else if (tab === 'bulk') {
    body = <BulkScreen clients={clients} onStarted={(id) => go({ name: 'batch', id })} onOpenBatch={(id) => go({ name: 'batch', id })} />;
  } else if (tab === 'slogans') {
    body = <SlogansScreen clients={clients} />;
  } else {
    body = (
      <CreateScreen
        clients={clients}
        brand={data.brand}
        onBrandChange={(brand) => update({ brand })}
        onOpenJob={(id) => openJob(id)}
        onCreated={(job) => openJob(job.id, job)}
        onSettings={() => go({ name: 'settings' })}
        onNewClient={() => { setTab('clients'); go({ name: 'client', id: null }); }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="light" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        </KeyboardAvoidingView>
        <View style={s.tabs} role="tablist">
          {TABS.map((t) => {
            const active = tab === t.id && !['settings'].includes(screen?.name);
            return (
              <TouchableOpacity key={t.id} role="tab" aria-selected={active} aria-label={t.label} onPress={() => switchTab(t.id)} style={s.tab}>
                <View style={[s.tabDot, active && s.tabDotOn]} />
                <Text style={[s.tabText, active && s.tabTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 720, alignSelf: 'center' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 12, minHeight: 56 },
  tabDot: { width: 22, height: 4, borderRadius: 2, backgroundColor: 'transparent', marginBottom: 6 },
  tabDotOn: { backgroundColor: C.gold },
  tabText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: C.text },
});
