import AsyncStorage from '@react-native-async-storage/async-storage';

// Saved on this device only: server settings, the brand kit and recent ads.
const KEY = 'adstudio.v1';

const EMPTY = { server: { url: '', token: '' }, brand: { name: '', logo: null }, recent: [] };

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

export function addRecent(recent, item) {
  return [item, ...recent.filter((r) => r.id !== item.id)].slice(0, 12);
}
