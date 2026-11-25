#!/usr/bin/env bash
# Builds the app and packs it for Hostinger.
# Hostinger's servers can run the finished app but cannot run the Next.js build tools,
# so the app is built here and uploaded as a ready-made Node.js server (server.js).
# Hostinger then runs "npm install" and starts server.js.
# Result: plaani-<commit>.zip in this folder. Needs .env.local with the public Supabase values.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

OUT=.hostinger
rm -rf "$OUT" && mkdir -p "$OUT/.next"
cp -R .next/standalone/. "$OUT/"
rm -rf "$OUT/node_modules"                 # Hostinger installs the packages itself
cp -R .next/static "$OUT/.next/static"     # browser files (CSS, JavaScript)
if [ -d public ]; then cp -R public "$OUT/public"; fi
cp package-lock.json "$OUT/"
rm -f "$OUT"/.env*                          # never upload local settings

# The build refers to some packages by an extra hashed name (e.g. @react-pdf/renderer-1a2b...),
# normally a shortcut (symlink) in .next/node_modules. Shortcuts do not survive the upload,
# so each one becomes a tiny package that loads the real one.
find "$OUT/.next/node_modules" -type l 2>/dev/null | while read -r link; do
  real="$(readlink "$link")"; real="${real##*node_modules/}"
  name="${link#"$OUT/.next/node_modules/"}"
  rm "$link" && mkdir -p "$link"
  printf '{ "name": "%s", "type": "module", "exports": "./index.js" }\n' "$name" > "$link/package.json"
  printf 'export * from "%s";\n' "$real" > "$link/index.js"
done

ZIP="plaani-$(git rev-parse --short HEAD).zip"
rm -f plaani-*.zip
(cd "$OUT" && zip -qr "../$ZIP" .)
echo "$ZIP"
