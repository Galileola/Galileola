import { webhookRoutes } from './webhooks.js';
import { publicRoutes } from './public.js';
import { joinRoutes } from './join.js';
import { adminRoutes } from './admin.js';
import { cronRoutes } from './cron.js';
import { payRoutes } from './pay.js';
import { legalRoutes } from './legal.js';
import { assistantRoutes } from './assistant.js';
import { seoRoutes } from './seo.js';
import { alertRoutes } from './alerts.js';

// Order matters only in that the webhook route must see the raw body (it uses express.raw itself).
export const allRoutes = [
  webhookRoutes,
  cronRoutes,
  seoRoutes,
  legalRoutes,
  publicRoutes,
  alertRoutes,
  joinRoutes,
  payRoutes,
  assistantRoutes,
  adminRoutes,
];
