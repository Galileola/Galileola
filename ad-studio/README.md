# Ad Studio

Take a photo or a short video of a product and get professional advertising banners and video ads.

**Status:** just started. The server code is in progress.

## AI services

| Job | Service | Reached through |
|---|---|---|
| Art director: reads the photo, writes the ad text, briefs the image AI, checks every result | Claude Opus 5.5 (`claude-opus-5-5`) | Anthropic API |
| Studio-quality scene around the real product | GPT Image 2 (`openai/gpt-image-2/edit`) | fal.ai |
| Second image model, used when a scene fails the quality check | Nano Banana Pro (`fal-ai/nano-banana-pro/edit`) | fal.ai |
| Product cut-out (transparent background) | Bria background removal (`fal-ai/bria/background/remove`) | fal.ai |
| Video ads from the finished scene | Kling 3.0 Pro (`fal-ai/kling-video/v3/pro/image-to-video`) | fal.ai |

## Keys you need

1. **Anthropic:** sign up at console.anthropic.com, add credit under Billing, then create a key under API Keys.
2. **fal.ai:** sign up at fal.ai, add credit under Billing, then create a key under Dashboard → Keys.

Put both keys in `server/.env` (see `server/.env.example`) on the server only, never in the app.
