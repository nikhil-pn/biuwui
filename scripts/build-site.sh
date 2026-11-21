#!/usr/bin/env bash
# The site (web/, deployed as sovereign.exprmnts.fun) is plain HTML, CSS and JS with no bundling. The only build step:
# copy the proof runs (docs/proof/*.json) into web/data/proof.json for the proof and security pages.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
mkdir -p web/data
node -e '
const fs = require("fs");
const all = fs.readdirSync("docs/proof").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(`docs/proof/${f}`, "utf8")));
all.sort((a, b) => String(a.ranAt).localeCompare(String(b.ranAt)));
fs.writeFileSync("web/data/proof.json", JSON.stringify(all));
console.log(`web/data/proof.json: ${all.length} run(s)`);
'
