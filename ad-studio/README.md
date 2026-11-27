# Ad Studio

Take a photo or a short video of a product with your phone. Ad Studio turns it into finished advertising banners in up to three sizes, and a 5-second video ad on request.

## What happens to a photo

1. **Brief.** Claude, acting as art director, looks at the photo. It writes the headline, the line under it, the button text and an offer sticker, in English, Russian or Estonian. It also picks a style and colours, describes a studio scene for the product, and plans a camera move for the video.
2. **Cut-out.** The product is cut out of the photo. Keys, cups and anything else around it are left out.
3. **Scene.** GPT Image 2 builds a photorealistic scene around the product for each size, and all sizes are made at the same time.
4. **Real product.** The app finds where the AI drew the product, then pastes the real product photo back exactly there, with its colours matched to the scene's light. Labels, logos and shapes stay exactly as in the photo.
5. **Quality check.** Claude compares each scene with the original photo. If a scene fails (wrong product, a duplicate, odd artefacts), Nano Banana Pro makes a second try and the better one is kept.
6. **Text.** The server sets the text with real fonts, so it is sharp and spelled correctly. The fonts cover English, Russian and Estonian. There are six styles: Luxury, Bold, Minimal, Fresh, Tech and Warm.
7. **Video (on request).** Kling 3.0 Pro films a 5-second clip from the finished scene. The server then adds the same text, which fades in after half a second.

After that, in the app you can:
- edit the text or style (instant, no AI cost)
- make a new scene for one size
- save or share any banner or video

| Size | Pixels | For |
|---|---|---|
| Post 1:1 | 1080 × 1080 | Instagram and Facebook feed |
| Story 9:16 | 1080 × 1920 | Stories, Reels, TikTok |
| Banner 1.91:1 | 1200 × 628 | Facebook link ads, websites |

## Try it online (Render)

The repository includes a setup file for [Render](https://render.com), a hosting service. Render builds the server and the web version of the app together and gives them one web address, which you open on your phone or computer.

1. Sign up at render.com with **Sign in with GitHub**, and allow Render to see the `Galileola` repository.
2. Click **New → Blueprint** and choose the `Galileola` repository and the branch that holds Ad Studio.
3. Render asks for three values:
   - `ANTHROPIC_API_KEY`: your Claude key (starts with `sk-ant-`)
   - `FAL_KEY`: your fal.ai key
   - `APP_TOKEN`: a password you make up; the app asks for it once
4. Click **Deploy Blueprint**. The first build takes several minutes.
5. Open the address Render shows (it ends in `onrender.com`), enter the password and make an ad. On an iPhone, tap **Share → Add to Home Screen** to open it like an app.

The setup uses Render's free plan, which is fine for trying it out. A free service sleeps when nobody uses it, so the first visit after a break can take about a minute. It also loses its saved files when it restarts, so save the ads you want to keep. For daily work, switch the service to a paid plan in Render.

## AI services

| Job | Service | Model id |
|---|---|---|
| Art director and quality check | Anthropic | `claude-opus-5-5` |
| Scene | fal.ai | `openai/gpt-image-2/edit` |
| Second try | fal.ai | `fal-ai/nano-banana-pro/edit` |
| Cut-out | fal.ai | `fal-ai/bria/background/remove` |
| Video | fal.ai | `fal-ai/kling-video/v3/pro/image-to-video` |

Each size uses one GPT Image 2 scene, or two images if the quality check asks for a second try, plus a few cut-outs. Each video is one 5-second Kling clip. For current prices, see fal.ai's pricing page and your fal.ai usage dashboard.

## Run the server

You need Node.js 20.19 or newer and `ffmpeg`, which is used for the video text.

```bash
cd server
cp .env.example .env      # then fill in ANTHROPIC_API_KEY and FAL_KEY
npm install
npm start
```

Check it at `http://localhost:3000/health`. Both `claude` and `fal` should be `true`.

To get the keys:
- **Anthropic:** sign up at console.anthropic.com, add credit under Billing, then create a key under API Keys.
- **fal.ai:** sign up at fal.ai, add credit under Billing, then create a key under Dashboard → Keys.

The keys stay on the server and never go into the app. Set `APP_TOKEN` as well, so that only your app can use the server.

Finished ads are kept for 48 hours (`JOB_TTL_HOURS`). Running jobs live in memory, so a restart forgets them, but the finished files stay on disk.

## Run the app

The app is built with Expo, the same setup as SPEAK POWER, and runs on iPhone, Android and the web.

```bash
cd app
npm install
npx expo start
```

1. Scan the QR code with the iPhone's Camera app (with Expo Go installed).
2. In the app, open **Settings** and enter the server address. For a server on your computer, that's its address on your Wi-Fi network, for example `http://192.168.1.10:3000`.
3. Enter the app token if you set one, then tap **Test connection**.

For the web version, run `npm run build:web`. It writes the site to `app/dist/`. The server then serves it at its own address, for example `http://localhost:3000`, and the app uses that same address to reach the server. The `Dockerfile` does the same in one image.

## Android and iPhone apps

The app in `app/` is a native app for Android and iPhone; the same code also builds the web version. Installable apps are built in the cloud by Expo's build service (EAS), so no Mac is needed. `eas.json` holds two build profiles:

| Profile | Android | iPhone |
|---|---|---|
| `preview` | An `.apk` file you install from a link, no store needed | Installs on registered test iPhones (needs an Apple developer account) |
| `production` | An app bundle for Google Play | A build for TestFlight and the App Store |

Before building, put the server address (for example the Render address) in `EXPO_PUBLIC_API_URL` in `eas.json`, so the app opens ready to use. People can still change it in the app's Settings.

```bash
cd app
npx eas-cli login                                 # free Expo account
npx eas-cli init                                  # links the project to the account
npx eas-cli build -p android --profile preview    # gives an install link for Android
npx eas-cli build -p ios --profile production     # iPhone build
npx eas-cli submit -p ios                         # sends it to TestFlight
```

What each store needs:
- **Google Play:** a Play Console developer account (one-time fee). New personal accounts currently have to run a closed test with at least 12 testers for 14 days before publishing; organisation accounts don't.
- **Apple App Store and TestFlight:** an Apple Developer Program membership (yearly fee). EAS creates the signing certificates for you.
- **Both:** a privacy policy web page, because the app uses the camera and photos and sends pictures to AI services. You also need store screenshots and a short description.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Whether the Claude and fal.ai keys are set, and whether a password is needed |
| GET | `/api/options` | Styles, sizes, languages and model ids |
| POST | `/api/jobs` | Start an ad: `{ photo, logo?, brand, offer, details, style, language, formats }`. Photo and logo are data URIs. |
| GET | `/api/jobs/:id` | Progress and results |
| POST | `/api/jobs/:id/text` | New text or style: `{ copy: { headline, subline, cta, badge }, style? }` |
| POST | `/api/jobs/:id/redo` | New scene for one size: `{ format }` |
| POST | `/api/jobs/:id/video` | Make a video for one size: `{ format }` |

Files are served under `/files/<job id>/`.
