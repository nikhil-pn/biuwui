// Runs the app locally: the static app (web-app/) plus the serverless API (api/*.ts) on one port, the way Vercel
// serves it. The browser bundle is rebuilt in memory with this AEVUM_RPC (and SOVEREIGN_FACTORY) baked in, so the
// app can run against a local fork; the tracked web-app/js/app.js is never touched.
//
//   AEVUM_RPC=http://127.0.0.1:8545 RELAYER_PRIVATE_KEY=… FAUCET_PRIVATE_KEY=… npx tsx scripts/serve-app.ts
//   → http://127.0.0.1:3000   (PORT to change it)
import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { build } from "esbuild";
import relay from "../api/relay";
import faucet from "../api/faucet";
import health from "../api/health";
import { aevum, FACTORY } from "./lib/aevum";
import type { Req, Res } from "../api/lib/shared";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = "web-app";
const API: Record<string, (req: Req, res: Res) => unknown> = { relay, faucet, health };
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain",
};

const rpc = aevum.rpcUrls.default.http[0];
const bundle = await build({
  entryPoints: ["web-src/app/main.ts"], bundle: true, platform: "browser", format: "esm", target: "es2022", write: false,
  define: { "process.env.AEVUM_RPC": JSON.stringify(rpc), "process.env.SOVEREIGN_FACTORY": JSON.stringify(FACTORY) },
  logLevel: "warning",
});
const appJs = bundle.outputFiles[0].contents;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((ok, fail) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => ok(s));
    req.on("error", fail);
  });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  const api = /^\/api\/([a-z]+)$/.exec(url.pathname);
  if (api && API[api[1]]) {
    const body = await readBody(req);
    let code = 200;
    const out: Res = {
      status(c) { code = c; return out; },
      json(b) { res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(b)); },
      setHeader(n, v) { res.setHeader(n, v); },
    };
    // Locally the caller's IP is the socket address (Vercel sets x-vercel-forwarded-for instead).
    const headers = { ...req.headers, "x-vercel-forwarded-for": req.socket.remoteAddress ?? "local" };
    return API[api[1]]({ method: req.method, body, headers }, out);
  }
  if (url.pathname === "/js/app.js") return res.writeHead(200, { "content-type": TYPES[".js"] }).end(appJs);
  const file = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
  } catch {
    res.writeHead(200, { "content-type": TYPES[".html"] }).end(await readFile(join(ROOT, "index.html"))); // app routes
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Sovereign app on http://127.0.0.1:${PORT}  (chain reads: ${rpc}, factory ${FACTORY})`);
  if (!/127\.0\.0\.1|localhost/.test(rpc)) console.log("Note: AEVUM_RPC is the public testnet: the relayer and faucet here would send real testnet transactions.");
});
