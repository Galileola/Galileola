import { Platform, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';

const MAX_SIDE = 1600;

async function toJpeg(uri, width, height) {
  let ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width || 0, height || 0) > MAX_SIDE) {
    ctx = width >= height ? ctx.resize({ width: MAX_SIDE }) : ctx.resize({ height: MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
  return { uri: out.uri, dataUri: `data:image/jpeg;base64,${out.base64}`, width: out.width, height: out.height };
}

/**
 * Takes a photo or short video with the camera, or picks one from the
 * gallery. A video is turned into a still: the frame one second in, or
 * the middle of a shorter clip.
 */
export async function pickProduct(fromCamera) {
  const permission = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error(fromCamera ? 'Allow camera access in Settings to take a photo.' : 'Allow photo access in Settings to choose a photo.');

  const options = { mediaTypes: Platform.OS === 'web' ? ['images'] : ['images', 'videos'], quality: 1, videoMaxDuration: 20 };
  const result = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];

  if (asset.type === 'video') {
    const durationMs = asset.duration || 2000;
    const frame = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: Math.min(1000, durationMs / 2), quality: 1 });
    return { ...(await toJpeg(frame.uri, frame.width, frame.height)), fromVideo: true };
  }
  return { ...(await toJpeg(asset.uri, asset.width, asset.height)), fromVideo: false };
}

/** Picks a logo and keeps its transparency (PNG, at most 800 px). */
export async function pickLogo() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Allow photo access in Settings to choose a logo.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  let ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width || 0, asset.height || 0) > 800) {
    ctx = (asset.width || 0) >= (asset.height || 0) ? ctx.resize({ width: 800 }) : ctx.resize({ height: 800 });
  }
  const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.PNG, base64: true });
  return `data:image/png;base64,${out.base64}`;
}

async function download(url) {
  const name = url.split('/').slice(-2).join('-');
  const target = new File(Paths.cache, name);
  if (target.exists) return target;
  return File.downloadFileAsync(url, target);
}

/** Saves a banner or video to the phone's photo library (opens it on the web). */
export async function saveToPhotos(url) {
  if (Platform.OS === 'web') {
    await Linking.openURL(url);
    return 'Opened in a new tab. Right-click (or long-press) to save it.';
  }
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo', 'video']);
  if (!permission.granted) throw new Error('Allow saving to Photos in Settings.');
  const file = await download(url);
  await MediaLibrary.Asset.create(file.uri);
  return 'Saved to Photos.';
}

/** Opens the share sheet (WhatsApp, email, Instagram…). */
export async function share(url) {
  if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync())) {
    await Linking.openURL(url);
    return;
  }
  const file = await download(url);
  await Sharing.shareAsync(file.uri);
}
