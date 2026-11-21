// A tiny read-only JSON-RPC client with just enough ABI decoding for Sovereign's views.
// Calls made in the same tick go out as one JSON-RPC batch (Aevum answers batches, and allows browsers).
import { CONFIG } from "./config.js";

let id = 0;
let queue = [];
async function flush() {
  const batch = queue.splice(0, 60);
  if (queue.length) setTimeout(flush, 0);
  try {
    const res = await fetch(CONFIG.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch.map((b) => ({ jsonrpc: "2.0", id: b.id, method: b.method, params: b.params }))),
    });
    const body = await res.json();
    const byId = new Map((Array.isArray(body) ? body : [body]).map((r) => [r.id, r]));
    for (const b of batch) {
      const r = byId.get(b.id);
      if (!r) b.reject(new Error("no answer from the Aevum RPC"));
      else if (r.error) b.reject(new Error(r.error.message));
      else b.resolve(r.result);
    }
  } catch (e) {
    for (const b of batch) b.reject(e);
  }
}
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    queue.push({ id: ++id, method, params, resolve, reject });
    if (queue.length === 1) setTimeout(flush, 0);
  });
}

const SEL = {
  circles: "0xde979cbd",
  name: "0x06fdde03",
  share: "0xa8d5fd65",
  size: "0x949d225d",
  currentRound: "0x8a19c8bc",
  phase: "0xb1c9fe6e",
  memberCount: "0x11aee380",
  getRound: "0x8f1327c0",
  members: "0xbdd4d18d",
  paid: "0xa031fb7f",
  quorumNeeded: "0xcb571211",
  hasWon: "0xa52b2b88",
  organiser: "0x7e537486",
  joinBy: "0x020ea7af",
  payeeOf: "0xfe7e05d5",
};

const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const uint = (w) => BigInt("0x" + w);
const addr = (w) => "0x" + w.slice(24);
const pad = (v) => BigInt(v).toString(16).padStart(64, "0");
const padAddr = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

/** A string at word offset `at` of an ABI-encoded result. */
function decodeString(hex, at = 0) {
  const off = Number(uint(word(hex, at))) / 32;
  const len = Number(uint(word(hex, off)));
  const bytes = hex.slice(2 + (off + 1) * 64, 2 + (off + 1) * 64 + len * 2);
  return new TextDecoder().decode(Uint8Array.from(bytes.match(/../g) ?? [], (b) => parseInt(b, 16)));
}

function decodeAddressArray(hex) {
  const off = Number(uint(word(hex, 0))) / 32;
  const len = Number(uint(word(hex, off)));
  return Array.from({ length: len }, (_, i) => addr(word(hex, off + 1 + i)));
}

/** Every circle the factory opened, oldest first. */
export async function circles() {
  return call(CONFIG.factory, SEL.circles).then(decodeAddressArray);
}

export async function circleInfo(c) {
  const [name, share, size, currentRound, phase, memberCount, organiser, joinBy] = await Promise.all([
    call(c, SEL.name).then((h) => decodeString(h)),
    call(c, SEL.share).then((h) => uint(word(h, 0))),
    call(c, SEL.size).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.currentRound).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.phase).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.memberCount).then((h) => Number(uint(word(h, 0)))),
    call(c, SEL.organiser).then((h) => addr(word(h, 0))),
    call(c, SEL.joinBy).then((h) => Number(uint(word(h, 0)))),
  ]);
  return { address: c, name, share, size, currentRound, phase, memberCount, organiser, joinBy, practice: name.startsWith("Practice · ") };
}

export async function round(c, r) {
  const h = await call(c, SEL.getRound + pad(r));
  return {
    start: Number(uint(word(h, 0))),
    bidEnd: Number(uint(word(h, 1))),
    closedAt: Number(uint(word(h, 2))),
    bestBidder: addr(word(h, 3)),
    bestDiscount: uint(word(h, 4)),
    collected: uint(word(h, 5)),
    winner: addr(word(h, 6)),
    payTo: addr(word(h, 7)),
    discount: uint(word(h, 8)),
    approvals: Number(uint(word(h, 9))),
    closed: uint(word(h, 10)) === 1n,
    released: uint(word(h, 11)) === 1n,
  };
}

export async function members(c) {
  return decodeAddressArray(await call(c, SEL.members));
}

export async function hasPaid(c, r, member) {
  return uint(word(await call(c, SEL.paid + pad(r) + padAddr(member)), 0)) === 1n;
}

/** The payee a member named: { address, name }. */
export async function payeeOf(c, member) {
  const h = await call(c, SEL.payeeOf + padAddr(member));
  return { address: addr(word(h, 0)), name: decodeString(h, 1) };
}

// ---------------------------------------------------------------- blocks and logs

export const blockNumber = async () => Number(BigInt(await rpc("eth_blockNumber", [])));

const blockTimes = new Map();
export async function blockTime(n) {
  if (!blockTimes.has(n)) {
    const b = await rpc("eth_getBlockByNumber", ["0x" + n.toString(16), false]);
    blockTimes.set(n, Number(BigInt(b.timestamp)));
  }
  return blockTimes.get(n);
}

/** Logs of `addresses` over the last `chunks` × 1,000 blocks (Aevum allows 1,000 per query; a block is about a second). */
export async function recentLogs(addresses, chunks = 8) {
  if (!addresses.length) return [];
  const head = await blockNumber();
  const parts = [];
  for (let i = 0; i < chunks; i++) {
    const to = head - i * 1000;
    const from = Math.max(to - 999, CONFIG.firstBlock);
    if (to < CONFIG.firstBlock) break;
    parts.push(rpc("eth_getLogs", [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), address: addresses }]));
  }
  return (await Promise.all(parts)).flat();
}

export async function quorumNeeded(c) {
  return Number(uint(word(await call(c, SEL.quorumNeeded), 0)));
}

export async function hasWon(c, member) {
  return uint(word(await call(c, SEL.hasWon + padAddr(member)), 0)) === 1n;
}
