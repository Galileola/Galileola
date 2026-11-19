# SPEAK POWER — Expo mobile app MVP

A React Native app for iOS and Android. Includes English, Russian, Estonian, one interactive lesson, a demonstration text coach, and persistent local progress.

## Run

1. Install Node.js 20.19+ and the Expo Go app on your phone.
2. In this folder run `npm install`.
3. Run `npx expo start --tunnel` (or `npx expo start` on the same Wi-Fi).
4. Scan the QR code with Expo Go (Android) or the iPhone Camera/Expo Go as prompted.

The coach uses **demo feedback**, not a real AI model. No API keys are included. For a real AI coach, add a secure server endpoint and keep API keys on the server, not in the mobile app.

This is source code, not an App Store release or an installed binary. Expo SDK/package compatibility should be verified by `npx expo install --check` after installation.
