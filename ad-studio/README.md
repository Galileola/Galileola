# Ad Studio

Take a photo or a short video of a product with your phone. Ad Studio turns it into finished advertising banners in up to three sizes, a 5-second video ad and a presenter video, on request.

Made for an advertising agency:
- **Brand kit per client:** logo, colours, style, language, brand voice and usual sizes, used by every ad for that client.
- **Client approval link:** the client opens a page (in English, Russian or Estonian), sees the ads and approves each one or asks for changes. No login is needed, and the decisions show up in the app.
- **One-click publishing:** post to the client's Facebook Page and Instagram (feed or story), or send the ad to their Meta ad account or Google Ads account as ready-to-use material. Nothing starts a paid campaign on its own.
- **Bulk ads:** read the products of a Shopify or WooCommerce shop (or a CSV file) and make one ad per product.
- **Presenter videos:** an AI presenter (or a real person, from a photo, with their permission) talks about the product for about 12 seconds in the ad language, and the banner closes the video.
- **Slogans:** ten slogan ideas in different tones, in the client's voice, for any product or straight into an ad's headline.

## What happens to a photo

1. **Brief.** Claude, acting as art director, looks at the photo. It writes the headline, the line under it, the button text and an offer sticker, in English, Russian or Estonian. It also picks a style and colours, describes a studio scene for the product, and plans a camera move for the video.
2. **Cut-out.** The product is cut out of the photo. Keys, cups and anything else around it are left out.
3. **Scene.** GPT Image 2 builds a photorealistic scene around the product for each size, and all sizes are made at the same time.
4. **Real product.** The app finds where the AI drew the product, then pastes the real product photo back exactly there, with its colours matched to the scene's light. Labels, logos and shapes stay exactly as in the photo.
5. **Quality check.** Claude compares each scene with the original photo. If a scene fails (wrong product, a duplicate, odd artefacts), Nano Banana Pro makes a second try and the better one is kept.
6. **Text.** The server sets the text with real fonts, so it is sharp and spelled correctly. The fonts cover English, Russian and Estonian. There are six styles: Luxury, Bold, Minimal, Fresh, Tech and Warm.
7. **Video (on request).** Kling 3.0 Pro films a 5-second clip from the finished scene. The server then adds the same text, which fades in after half a second.

After that, in the app you can:
- edit the text or style (instant, no AI cost), with slogan ideas for the headline
- make a new scene for one size
- save, share or publish any banner or video
- send the client an approval link
- make a presenter video

| Size | Pixels | For |
|---|---|---|
| Post 1:1 | 1080 × 1080 | Instagram and Facebook feed |
| Story 9:16 | 1080 × 1920 | Stories, Reels, TikTok |
| Banner 1.91:1 | 1200 × 628 | Facebook link ads, websites |

## Put it online on Hostinger (Business or Cloud web hosting)

Hostinger's Business and Cloud plans run Node.js apps. The server folder contains everything, including the web version of the app, so Hostinger only deploys that folder.

1. In hPanel, go to **Websites → Add website → Node.js web app**, and choose **Import Git repository**. Connect GitHub, give Hostinger access to the `Galileola` repository, and pick the branch that holds Ad Studio.
2. Choose the web address, for example a subdomain such as `ads.yourdomain.com`.
3. Check the deploy settings:
   - **Root directory:** `ad-studio/server`
   - **Node.js version:** 22 (or 24)
   - **Entry file:** `index.js`
   - **Build command:** leave empty
4. Under **Environment variables**, add:
   - `ANTHROPIC_API_KEY`: your Claude key
   - `FAL_KEY`: your fal.ai key
   - `APP_TOKEN`: a password you make up; the app asks for it once
   - `PUBLIC_URL`: the full address, for example `https://ads.yourdomain.com`
   - `MAX_RUNNING_JOBS`: `1` to start with (shared hosting has limited memory and processes; more ads simply wait in the queue)
   - later, for publishing: `META_APP_ID`, `META_APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
5. Click **Deploy**, then open the address, enter the password and make an ad. Every push to the branch redeploys automatically.

How it fits Hostinger's limits:
- **120-second limit:** Hostinger stops any single request after 120 seconds. Long work (making an ad, videos, publishing, bulk orders) runs in the background, and the app checks on it every few seconds.
- **Sleeping when idle:** Hostinger puts apps to sleep when nobody uses them. While work is in progress, the server visits its own address once a minute to stay awake. If it restarts anyway, unfinished ads start again by themselves; an ad that was halfway through is made again, which can cost a little extra.
- **Data:** clients, ads and pictures are kept in `~/ad-studio-data` in your hosting account, outside the app folder, so redeploying never deletes them. Download a copy now and then with the File Manager.
- **Video tools:** ffmpeg (used for the text on videos and the presenter video's end card) comes with the app through npm, so the hosting doesn't need it installed.

If the plan's memory or process limits become a problem (many clients, many videos), a Hostinger VPS or Render (below) runs the same code without these limits.

## Put it online (Render)

The repository includes a setup file (`render.yaml`) for [Render](https://render.com), a hosting service. Render builds the server and the web version of the app together and gives them one web address, which you open on your phone or computer.

1. Sign up at render.com with **Sign in with GitHub**, and allow Render to see the `Galileola` repository.
2. Click **New → Blueprint** and choose the `Galileola` repository and the branch that holds Ad Studio.
3. Render asks for these values:
   - `ANTHROPIC_API_KEY`: your Claude key (starts with `sk-ant-`)
   - `FAL_KEY`: your fal.ai key
   - `APP_TOKEN`: a password you make up; the app asks for it once
   - `META_APP_ID`, `META_APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: only for one-click publishing (see below). Leave them empty for now if you like; you can add them later under the service's **Environment** tab.
4. Click **Deploy Blueprint**. The first build takes several minutes.
5. Open the address Render shows (it ends in `onrender.com`), enter the password and make an ad. On an iPhone, tap **Share → Add to Home Screen** to open it like an app.

The setup uses Render's **Starter** plan with a small disk, so clients, ads and approvals are kept when the server restarts. Render shows the monthly price before you confirm.

## AI services

| Job | Service | Model id |
|---|---|---|
| Art director and quality check | Anthropic | `claude-opus-5-5` |
| Scene | fal.ai | `openai/gpt-image-2/edit` |
| Second try | fal.ai | `fal-ai/nano-banana-pro/edit` |
| Cut-out | fal.ai | `fal-ai/bria/background/remove` |
| Video | fal.ai | `fal-ai/kling-video/v3/pro/image-to-video` |
| Slogans, presenter script, post text | Anthropic | `claude-opus-5-5` |
| Presenter photo | fal.ai | `openai/gpt-image-2/edit` |
| Presenter voice | fal.ai | `elevenlabs/tts/eleven-v4` |
| Presenter video | fal.ai | `fal-ai/bytedance/omnihuman/v1.5` |

Each size uses one GPT Image 2 scene, or two images if the quality check asks for a second try, plus a few cut-outs. Each video is one 5-second Kling clip. A presenter video costs the most: a presenter photo, a voice recording and about 12 seconds of OmniHuman video. For current prices, see fal.ai's pricing page and your fal.ai usage dashboard.

## Run the server

You need Node.js 22.5 or newer (for the built-in database). ffmpeg, used for the video text, is installed with the other packages.

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

Everything is kept in `DATA_DIR` (default `~/ad-studio-data`, outside the app folder): a small database (clients, ads, approvals, account connections) and the pictures and videos. Ads are kept for 60 days (`JOB_TTL_DAYS`). Ads wait in a queue and `MAX_RUNNING_JOBS` (default 2) are made at the same time; after a restart, waiting ads start again.

## Publishing setup (one time)

One-click publishing uses the platforms' own sign-in pages. The agency sets up one app with Meta and one with Google; after that, each client is connected from the client's page in the app (**Clients → client → Publishing → Connect**).

The server needs its public address for the sign-in pages and so that Meta can fetch the pictures. Render provides it automatically; elsewhere, set `PUBLIC_URL`, for example `https://ads.example.com`.

**Facebook and Instagram (Meta):**
1. At developers.facebook.com, create an app of the **Business** type.
2. Add **Facebook Login for Business**. Under its settings, add this redirect address: `<your address>/connect/meta/callback`.
3. The app asks for these permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`, `ads_management`.
4. Put the app's ID and secret in `META_APP_ID` and `META_APP_SECRET`.

While the Meta app is in development mode, only people with a role on the app (add your staff under **App roles**) can connect accounts. That's enough when your agency manages the clients' Pages through its Business Manager. For clients who should connect their own accounts, Meta has to approve the app first (App Review).

For Instagram, the client's Instagram account must be a business or creator account linked to their Facebook Page. Story-size ads are posted as Instagram stories; the other sizes go to the feed.

**Google Ads:**
1. In Google Cloud Console, create a project and enable the **Google Ads API**.
2. Create an OAuth client of the **Web application** type, with this redirect address: `<your address>/connect/google/callback`.
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Google may ask you to apply for API access for the Cloud project before it accepts uploads. If you reach client accounts through a manager (MCC) account, enter its ID on the account page when you connect.

Banners go into the Google Ads account as image assets, ready to add to a campaign. Videos for Google Ads have to go through YouTube, so the app sends only banners there.

## Run the app

The app is built with Expo, the same setup as SPEAK POWER, and runs on iPhone, Android and the web.

```bash
cd app
npm install
npx expo start
```

1. Scan the QR code with the iPhone's Camera app (with Expo Go installed).
2. In the app, open **Settings** and enter the server address. For a server on your computer, that's its address on your Wi-Fi network, for example `http://192.168.1.10:3000`.
3. Enter the app password if you set one, then tap **Test connection**.

For the web version, run `npm run build:web`. It writes the site to `server/public/` (this folder is committed, so the server folder can be deployed on its own; rebuild it after changing the app). The server serves it at its own address, for example `http://localhost:3000`, and the app uses that same address to reach the server. The `Dockerfile` does the same in one image.

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

The app password (`APP_TOKEN`) goes in the `x-app-token` header of every `/api` request.

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Whether the keys are set, which publishing is set up, and whether a password is needed |
| GET | `/api/options` | Styles, sizes, languages, publishing set-up and model ids |
| GET, POST | `/api/clients` | List clients; create a brand kit `{ name, logo?, primary, accent, style, language, tone, website, about, formats }` |
| GET, PUT, DELETE | `/api/clients/:id` | One brand kit, with which accounts are connected (never the tokens) |
| POST, DELETE | `/api/clients/:id/connect/:provider` | Start connecting (`meta` or `google`; returns the sign-in `url`) or disconnect |
| POST | `/api/jobs` | Start an ad: `{ photo, clientId?, brand?, logo?, offer, details, style, language, formats }`. Photo and logo are data URIs; a client's brand kit fills in the rest. |
| GET | `/api/jobs?client=` | Recent ads |
| GET | `/api/jobs/:id` | Progress and results |
| POST | `/api/jobs/:id/text` | New text or style: `{ copy: { headline, subline, cta, badge }, style? }` |
| POST | `/api/jobs/:id/redo` | New scene for one size: `{ format }` |
| POST | `/api/jobs/:id/video` | Make a video for one size: `{ format }` |
| POST | `/api/jobs/:id/avatar` | Presenter video: `{ mode: 'ai' \| 'photo', gender, photo?, consent? }` |
| POST | `/api/jobs/:id/review` | The client approval link |
| POST | `/api/jobs/:id/slogans` | Slogan ideas for this ad |
| POST | `/api/jobs/:id/caption` | Suggested post text |
| POST | `/api/jobs/:id/publish` | `{ format, kind: 'image' \| 'video' \| 'presenter', targets: ['facebook', 'instagram', 'meta_ads', 'google_ads'], caption }` |
| POST | `/api/slogans` | Slogans without an ad: `{ clientId?, product, offer?, language, photo? }` |
| POST | `/api/shop/products` | Products from a shop `{ url }` or a CSV `{ csv }` |
| GET, POST | `/api/batches` | Bulk orders; start one with `{ clientId?, products, offer, style, language, formats }` |
| GET | `/api/batches/:id` | A bulk order's progress |

Public pages: `/review/<token>` (client approval), `/connect/meta/...` and `/connect/google/...` (account sign-in). Files are served under `/files/`.
