# SPEAK POWER

A confidence and communication coaching app for iOS, Android and the web, built with Expo (React Native). The full interface and course are available in English, Russian and Estonian.

## What's inside

- **Course:** 6 modules and 24 lessons (calm confidence, assertiveness, handling pushback, speaking at work, public speaking, influence). Each lesson has a key idea, a "say this instead" example with alternatives, a two-question quiz with explanations and a practice task.
- **Speaking coach:** 24 real-life situations plus free practice. Each answer is scored for clarity, calm, confidence and respect, with written feedback and an improved example.
- **Daily challenge:** a new situation every day, with bonus XP.
- **Power phrases:** about 70 ready-to-use lines, searchable, with read-aloud.
- **Progress:** XP, levels and ranks, day streaks, 10 achievements, per-module progress and recent practice. Progress is saved on the device.

## Where the coach's feedback comes from

1. **Published claude.ai page:** the page asks Claude through the viewer (the `sample` capability), so no server or API key is needed. Voice input (`dictation`) and read-aloud (`tts`) also come from the viewer where it offers them.
2. **Your own server:** deploy `server/` and set `EXPO_PUBLIC_COACH_URL` (see below). The mobile app uses this.
3. **Instant check:** a scorer that runs on the device and always works, even offline. It flags hedges, over-apologising, aggressive words and absolutes, and checks for a clear next step.

## Run on your iPhone (Expo Go)

The project uses Expo SDK 58, which is the version the current Expo Go app runs.

1. On the iPhone, install **Expo Go** from the App Store.
2. On a computer, install Node.js 20.19.4 or newer (the 22 LTS release works).
3. In this folder, run `npm install`, then `npx expo start`.
4. Scan the QR code with the iPhone's Camera app and open it in Expo Go. The phone and the computer must be on the same Wi-Fi network. If the phone can't connect, stop the server and run `npx expo start --tunnel` instead.

Android works the same way: scan the QR code from inside the Expo Go app.

For voice answers, use the keyboard's own microphone. Read-aloud uses `expo-speech`.

## Build the web version

`npx expo export --platform web` writes a static site to `dist/`.

## Publish on GitHub Pages

`npm run build:pages` builds the web version into `docs/` at the repository root. The output is one self-contained page, plus the icon and manifest that let a phone install it.

To switch Pages on (one time only): in the repository on GitHub, open **Settings → Pages**, set **Source** to **Deploy from a branch**, choose the branch and the **/docs** folder, and click **Save**. The site appears at `https://<owner>.github.io/<repo>/` within a few minutes. After you change the app, run `npm run build:pages` again and push.

On an iPhone, open the site in Safari and tap **Share → Add to Home Screen**. It then opens full-screen, like an app. AI feedback and voice input come from claude.ai, so the GitHub version uses the instant check, and read-aloud uses the phone's own voices.

## AI coach server (optional, for the mobile app)

1. Deploy `server/` to a Node.js host with HTTPS and run `npm install && npm start`. Set `OPENAI_API_KEY` **on the server only** (see `server/.env.example`).
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_COACH_URL=https://YOUR-HOST/coach`.
3. Restart Expo.

**Security:** never put an API key in the app or in any `EXPO_PUBLIC_` variable. Before a public release, add authentication, rate limiting, usage quotas, a privacy notice and monitoring to the server.

## Project layout

- `App.js`: app shell, navigation, XP and achievement handling
- `src/content/{en,ru,et}.js`: the course and all interface text, with identical structure in each language
- `src/lib/coach.js`: coach logic (Claude, then your server, then the instant check)
- `src/lib/platform.js`: optional claude.ai viewer features (AI, dictation, read-aloud, permissions)
- `src/lib/progress.js`: saving, XP, levels, streaks and achievements
- `src/screens/`: Home, Learn (course and lesson player), Coach, Phrases, Progress
- `server/`: optional AI coach backend
