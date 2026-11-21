#!/usr/bin/env bash
# Builds the web front end into web/ (static, deployed to Vercel as one project):
#   web-src/site/main.ts -> web/js/site.js   (landing, /how, /proof, /security)
#   web-src/app/main.ts  -> web/js/app.js    (the app at /app)
#   docs/proof/*.json    -> web/data/proof.json
#   api/*.ts             -> web/api/*.mjs     (serverless functions, bundled at the end)
# Usage: bash scripts/build-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"

mkdir -p web/js web/data

# Browser bundles. The shared chain config reads process.env.AEVUM_RPC on Node; in the browser it is unset.
for entry in site app; do
  npx esbuild "web-src/$entry/main.ts" --bundle --format=esm --target=es2020 --minify \
    --define:process.env.AEVUM_RPC=undefined --legal-comments=none \
    --outfile="web/js/$entry.js" --log-level=warning
done

# Proof data for /proof and /how.
node -e '
const fs = require("fs");
const dir = "docs/proof";
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")));
all.sort((a, b) => String(a.ranAt).localeCompare(String(b.ranAt)));
fs.writeFileSync("web/data/proof.json", JSON.stringify(all));
'

# Subset the CJK serif to exactly the characters the site and app use (Google Fonts `text=`).
node -e '
const fs = require("fs"), path = require("path");
const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (/\.(html|ts)$/.test(e.name)) files.push(p);
});
walk("web-src");
fs.readdirSync("web").filter((f) => f.endsWith(".html")).forEach((f) => files.push(path.join("web", f)));
const chars = new Set();
for (const f of files) for (const ch of fs.readFileSync(f, "utf8")) if (/[㐀-鿿가-힯豈-﫿]/.test(ch)) chars.add(ch);
const text = encodeURIComponent([...chars].sort().join(""));
for (const f of fs.readdirSync("web").filter((f) => f.endsWith(".html"))) {
  const p = path.join("web", f);
  const html = fs.readFileSync(p, "utf8");
  const out = html.replace(/(<link[^>]*data-cjk-font[^>]*href="[^"]*?&text=)[^"]*(")/, `$1${text}$2`);
  if (out !== html) fs.writeFileSync(p, out);
}
console.log(`CJK subset: ${chars.size} characters`);
'

# Serverless API (written separately in api/), bundled for Vercel's Node runtime.
for f in api/*.ts; do [ -e "$f" ] || continue; n=$(basename "$f" .ts); npx esbuild "$f" --bundle --platform=node --format=esm --target=node20 --outfile="web/api/$n.mjs" --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" --log-level=warning; done

echo "built web/"
