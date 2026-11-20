// Forwarder for an old shop address (e.g. shop.sekdigital.eu after the shop moved to
// sekdigital.eu). Every request gets a permanent redirect to the same path on the new address,
// so links in emails buyers already have keep working. No dependencies and no settings needed:
// the target comes from REDIRECT_TO, else from "redirectTo" in package.json.
const http = require('node:http');

const target = String(process.env.REDIRECT_TO || require('./package.json').redirectTo).replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(target)) {
  console.error(`REDIRECT_TO must be an https:// address without a path, got "${target}"`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // GET and HEAD: 301. Anything else: 308, which keeps the method and body.
  const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
  const location = target + (req.url && req.url.startsWith('/') ? req.url : '/');
  res.writeHead(status, { Location: location, 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Moved to ${location}\n`);
});
server.listen(Number(process.env.PORT || 3000), () => console.log(`Forwarding every request to ${target}`));
