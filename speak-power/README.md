# SPEAK POWER — React Native Expo MVP

A runnable iOS and Android Expo source project with English, Russian, and Estonian UI; daily challenge/lesson; multiple-choice speaking exercise; points and progress stored locally; and a text communication coach.

## Try on a phone

1. Install Node.js (current LTS) on your computer and Expo Go on your phone.
2. In this directory run `npm install` then `npx expo install --fix` to align native packages with your Expo SDK.
3. Run `npx expo start` (same Wi-Fi), or `npx expo start --tunnel` if your network blocks local access.
4. Scan the QR code with Expo Go / your iPhone camera as prompted.

## AI coach (optional)

By default the app provides clearly labeled demonstration feedback and does not require a paid AI service. For live AI coaching:

1. Deploy the `server` folder to a Node.js host with HTTPS. Run `npm install && npm start` there. Set `OPENAI_API_KEY` **on the server only** (see `server/.env.example`).
2. Copy `.env.example` to `.env` in the mobile project and set `EXPO_PUBLIC_COACH_URL=https://YOUR-HOST/coach`.
3. Restart Expo. The mobile app will call your server, which calls the OpenAI API. If unavailable, the app falls back to demonstration feedback.

**Security:** Never put an OpenAI API key in the mobile app or any `EXPO_PUBLIC_` variable. Before public release add authentication, rate limiting, usage quotas, privacy disclosures, and server monitoring. The example server is for development, not hardened production deployment.

## Status and limitations

This is a source-code MVP, not an App Store/Google Play release. It contains one daily lesson/exercise, a text coach (not microphone speech recognition), a three-language UI, and local progress tracking. Lesson content does not rotate by date yet. No account sync. Expo SDK compatibility and physical-device behavior still need verification on a development machine with npm network access.
