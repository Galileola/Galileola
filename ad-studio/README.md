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

For a web version, run `npm run build:web`. It writes a static site to `dist/`, which can be hosted anywhere.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Whether the Claude and fal.ai keys are set |
| GET | `/api/options` | Styles, sizes, languages and model ids |
| POST | `/api/jobs` | Start an ad: `{ photo, logo?, brand, offer, details, style, language, formats }`. Photo and logo are data URIs. |
| GET | `/api/jobs/:id` | Progress and results |
| POST | `/api/jobs/:id/text` | New text or style: `{ copy: { headline, subline, cta, badge }, style? }` |
| POST | `/api/jobs/:id/redo` | New scene for one size: `{ format }` |
| POST | `/api/jobs/:id/video` | Make a video for one size: `{ format }` |

Files are served under `/files/<job id>/`.
