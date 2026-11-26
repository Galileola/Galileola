import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C, Card, Title, Hint, Button, Field, Note } from '../theme';
import { api, setServer } from '../api';

export default function SettingsScreen({ server, onSave, onBack }) {
  const [url, setUrl] = useState(server.url);
  const [token, setToken] = useState(server.token);
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    setStatus(null);
    setServer({ url, token });
    try {
      const h = await api.health();
      setStatus(h.claude && h.fal ? { ok: true, text: 'Connected. Claude and fal.ai are ready.' } : { ok: false, text: `Connected, but the server is missing ${[!h.claude && 'the Claude key', !h.fal && 'the fal.ai key'].filter(Boolean).join(' and ')}.` });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <View>
      <TouchableOpacity role="button" aria-label="Back" onPress={onBack} style={s.back}>
        <Text style={{ color: C.soft, fontSize: 16, fontWeight: '700' }}>‹ Back</Text>
      </TouchableOpacity>
      <Card>
        <Title>Server</Title>
        <Hint style={{ marginBottom: 14 }}>The Ad Studio server holds the AI keys and makes the ads. Ask whoever set it up for its address.</Hint>
        <Field label="Server address" value={url} onChangeText={setUrl} placeholder="https://ads.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Field label="App token (if the server uses one)" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry />
        {status ? <Note kind={status.ok ? 'warn' : 'bad'}>{status.text}</Note> : null}
        <View style={s.row}>
          <Button kind="secondary" label="Test connection" onPress={test} busy={testing} style={{ flex: 1 }} />
          <Button label="Save" onPress={() => onSave({ url: url.trim(), token: token.trim() })} style={{ flex: 1 }} />
        </View>
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  back: { paddingVertical: 10, marginBottom: 6, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
