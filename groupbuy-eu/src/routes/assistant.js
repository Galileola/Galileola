import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, cleanHistory } from '../assistant.js';
import { isJoinable } from '../dealState.js';
import { deliveryCountries } from '../deliveryCountries.js';
import { EU_COUNTRIES } from '../util.js';
import { createRateLimiter } from '../rateLimit.js';
import { ENGLISH_NAMES, isShopLanguage } from '../i18n/index.js';
import { applyLanguage } from '../i18n/middleware.js';

// POST /api/assistant  { messages: [{ role: 'user' | 'assistant', content }] } -> { reply }
// The chat history lives in the visitor's browser; nothing is stored on the server.
export function assistantRoutes(app, ctx) {
  const { config, repo, clock } = ctx;
  const perIp = createRateLimiter({ windowMs: 15 * 60_000, max: config.assistantRateLimit ?? 30, clock });
  const perDay = createRateLimiter({ windowMs: 24 * 60 * 60_000, max: config.assistantDailyLimit ?? 1000, clock });

  app.post('/api/assistant', express.json({ limit: '64kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (isShopLanguage(req.body?.lang) && req.body.lang !== res.locals.lang) applyLanguage(req, res, req.body.lang, ctx);
    const { t, lang } = res.locals;
    if (!ctx.assistant) return res.status(503).json({ error: t('assistant.unavailable') });

    const messages = cleanHistory(req.body?.messages);
    if (!messages) return res.status(400).json({ error: t('assistant.tooLong') });

    if (!perIp.take(req.ip) || !perDay.take('site')) {
      return res.status(429).json({ error: t('assistant.busy') });
    }

    const now = clock.now();
    const deals = repo
      .listPublicDeals()
      .filter((d) => isJoinable(d, now))
      .map((d) => ({ ...d, count: repo.committedCount(d.id), minimumReached: d.status !== 'open' }));
    const system = buildSystemPrompt({
      business: config.business, baseUrl: config.baseUrl, deals, siteLanguage: ENGLISH_NAMES[lang],
      deliveryTo: deliveryCountries().map((c) => EU_COUNTRIES[c]), testMode: config.paymentsMode !== 'live',
    });

    try {
      const result = await ctx.assistant.reply({ system, messages });
      if (result.refused || !result.text) {
        return res.json({ reply: t('assistant.refused') });
      }
      res.json({ reply: result.text });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        console.warn('[assistant] rate limited by the API');
        return res.status(429).json({ error: t('assistant.busyShort') });
      }
      if (err instanceof Anthropic.AuthenticationError) {
        console.error('[assistant] ANTHROPIC_API_KEY was rejected. Check the key in the environment variables.');
      } else if (err instanceof Anthropic.APIError) {
        console.error(`[assistant] API error ${err.status}: ${err.message}`);
      } else {
        console.error('[assistant]', err);
      }
      res.status(502).json({ error: t('assistant.failed') });
    }
  });
}
