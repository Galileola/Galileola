import AsyncStorage from '@react-native-async-storage/async-storage';

// Saved on this device only: server settings and the quick brand (for ads without a client).
const KEY = 'adstudio.v1';

const EMPTY = { server: { url: '', token: '' }, brand: { name: '', logo: null } };

export async function load() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function save(state) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable: the app still works for this session.
  }
}
