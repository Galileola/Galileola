import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { C, s, Button } from '../ui';
import { openPermissions } from '../lib/platform';

// One line telling the viewer where the coach's feedback comes from.
export default function AiStatusLine({ status, setStatus, t }) {
  const [hint, setHint] = useState(false);
  const text = t.ai[status] || '';
  if (!text) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, backgroundColor: status === 'on' || status === 'server' ? C.good : status === 'connecting' ? C.gold : C.muted }} />
        <Text style={[s.note, { flex: 1 }]}>{text}</Text>
      </View>
      {status === 'denied' && (
        <View style={{ gap: 6 }}>
          <Button small kind="secondary" label={t.ai.allow} onPress={async () => {
            const st = await openPermissions();
            if (st === 'granted' || st === 'prompt') setStatus('on'); else setHint(true);
          }} />
          {hint && <Text style={s.note}>{t.ai.menuHint}</Text>}
        </View>
      )}
    </View>
  );
}
