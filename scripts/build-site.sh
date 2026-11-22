#!/usr/bin/env bash
# The site (web/, deployed as sovereign.exprmnts.fun) is plain HTML, CSS and JS with no bundling. The only build step:
# copy the proof runs from docs/proof/ into web/data/ for the proof, security and landing pages:
#   web/data/proof.json       every full-circle run (docs/proof/<circle>.json), oldest first
#   web/data/edge-cases.json  the safety-path proofs (docs/proof/edge-cases.json)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
mkdir -p web/data
node -e '
const fs = require("fs");
const read = (f) => JSON.parse(fs.readFileSync(`docs/proof/${f}`, "utf8"));
const runs = fs.readdirSync("docs/proof").filter((f) => /^0x[0-9a-fA-F]{40}\.json$/.test(f)).map(read);
runs.sort((a, b) => String(a.ranAt).localeCompare(String(b.ranAt)));
fs.writeFileSync("web/data/proof.json", JSON.stringify(runs));
const tx = (r) => r.steps.filter((s) => s.tx).length;
console.log(`web/data/proof.json: ${runs.length} circle run(s), newest ${runs.at(-1)?.circle} (${runs.at(-1) ? tx(runs.at(-1)) : 0} transactions)`);
if (fs.existsSync("docs/proof/edge-cases.json")) {
  const edge = read("edge-cases.json");
  fs.writeFileSync("web/data/edge-cases.json", JSON.stringify(edge));
  console.log(`web/data/edge-cases.json: ${tx(edge)} transactions`);
}
'
