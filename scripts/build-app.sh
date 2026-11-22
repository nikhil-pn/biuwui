#!/usr/bin/env bash
# Build the Sovereign app (web-app/, deployed as app.sovereign.exprmnts.fun): bundle the TypeScript, copy the styles
# and fonts it shares with the site (web/), and bundle the serverless API (api/) next to it. Run before every app deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
npx esbuild web-src/app/main.ts --bundle --platform=browser --format=esm --target=es2022 --minify \
  --define:process.env.AEVUM_RPC=undefined --define:process.env.SOVEREIGN_FACTORY=undefined --legal-comments=none --outfile=web-app/js/app.js --log-level=warning
cp web/css/base.css web/css/glass.css web/css/wallet.css web/css/ring.css web-app/css/
mkdir -p web-app/fonts && cp web/fonts/* web-app/fonts/
cp web/favicon.svg web-app/
for f in api/*.ts; do [ -e "$f" ] || continue; n=$(basename "$f" .ts); npx esbuild "$f" --bundle --platform=node --format=esm --target=node20 --outfile="web-app/api/$n.mjs" --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" --log-level=warning; done
echo "built web-app/ ($(du -h web-app/js/app.js | cut -f1) app bundle, $(ls web-app/api | wc -l) API functions)"
