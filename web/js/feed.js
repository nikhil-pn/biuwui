// The live feed: the circles' on-chain events from the last couple of hours, newest first.
import { CONFIG, learn, who } from "./config.js";
import * as chain from "./chain.js";

const T = {
  "0x5cd81500d7f34f31cd8d8bd61c8cc1dd873c5ea0a46cd1c00ce014f1781f91d5": "Paid",
  "0xdcd726e11f8b5e160f00290f0fe3a1abb547474e53a8e7a8f49a85e7b1ca3199": "Bid",
  "0x79ffa8e6e7b1b7b373002096833b01342081d17820430b41755e5f5c90dec0f4": "AuctionClosed",
  "0x901993f3f5690f3be85c229ae30c2f32ca22013f73895b4e49a36a6a7d8178ca": "Approved",
  "0xb37499c950fc82cf35be1dfd627b9959d5947d39f31ceab33075b6864c2f2cc9": "Released",
  "0x9c483856da5cb00aefa21a4cbd0db9a82a54f3cfe2b7b606b5bb62138b2a43b6": "Joined",
  "0xaf65ecdc8a0d3ea90c8344c89e7001864fddf59dfdf41da2994463fe99049a59": "Left",
  "0xb9574e0faab8124549420ceb05e8203d89eacae04d747d51d12d373b600dbe9b": "RoundStarted",
  "0xd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb": "Withdrawn",
  "0xe06452d00b2b58f14a1fa6d499ea982ff93ea827ae700ea9ba03f4daddc94bc1": "Completed",
  "0x82812e07414e5ae8be274ec14a3be3fc80b7f1dcdad1db15c7e3951162806be3": "CircleOpened",
  "0xb0b5529c15667824a2fcfcee58a625d399fb6706d3a784d22a9a66e47982dd8a": "Dissolved",
  "0xa761582a460180d55522f9f5fdc076390a1f48a7a62a8afbd45c1bb797948edb": "Cancelled",
  "0xa33cb4ea37c263e77c2018c568979cb11458f03440d1a0edd53aadee26444211": "SecurityApplied",
  "0xaecab1636ba124fdfe5bab18383ae4372f3e842d5988c0505cada65881f5a319": "PayeeChangeRequested",
  "0xf3071bbe17f2553f609695eec74d12438cd4dd93ab64bf9d75f4172e4308cb67": "PayeeChangeCancelled",
  "0x04eb21b0cc801791f7f8922dd34c5b678afa0f16c229bb91698cbe9d681d190e": "PayeeChanged",
  "0xb37a8cc4997a2227209cbc21cca5aed1ad899167118926c0257d4e422cfb6ea2": "StandingOrderSet",
  "0x10fbbec4225309e413cdb67b7d92e9f5d0eb0b0e94a78f0ab8f0d33a67036880": "StandingOrderRevoked",
};

/** Small line icons for the feed (SVG, drawn in the text colour). */
const svg = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" style="fill:none" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  in: svg('<path d="M12 4v14M6 12l6 6 6-6"/>'),
  out: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
  bid: svg('<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'),
  gavel: svg('<path d="m14 5 5 5M9 10l5-5M11.5 7.5 4 15l2 2 7.5-7.5"/><path d="M13 20h8"/>'),
  ok: svg('<path d="M5 12.5 10 17l9-10"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  round: svg('<circle cx="12" cy="12" r="8"/>'),
  star: svg('<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.2 7 19l1.2-5.6L4 9.6 9.6 9Z"/>'),
  open: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="1.6"/><circle cx="19" cy="15" r="1.6"/><circle cx="5" cy="15" r="1.6"/>'),
  stop: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16v.5"/>'),
  shield: svg('<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/>'),
  lock: svg('<rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  repeat: svg('<path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/>'),
  warn: svg('<path d="M12 4 3 20h18Z"/><path d="M12 10v4M12 17v.5"/>'),
};

const w = (hex, i) => BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
const topicAddr = (t) => "0x" + t.slice(26);
const topicNum = (t) => Number(BigInt(t));
const dataAddr = (hex, i) => "0x" + hex.slice(2 + i * 64 + 24, 2 + (i + 1) * 64);
function dataString(hex, at) {
  const off = Number(w(hex, at)) / 32;
  const len = Number(w(hex, off));
  const bytes = hex.slice(2 + (off + 1) * 64, 2 + (off + 1) * 64 + len * 2);
  return new TextDecoder().decode(Uint8Array.from(bytes.match(/../g) ?? [], (b) => parseInt(b, 16)));
}

/** "$0.03", "$1,250.00", "$0.0003": two decimals at least, more only when the amount has them. */
export const usd = (units) => {
  const v = BigInt(units);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const unit = 10n ** BigInt(CONFIG.decimals);
  const whole = (a / unit).toLocaleString("en-US");
  const dec = (a % unit).toString().padStart(CONFIG.decimals, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${neg ? "−" : ""}$${whole}.${dec}`;
};
const time = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const HOW = ["paid", "signed a payment (no gas)", "paid by standing order", "pledge counts as round 1", "covered from security"];

/** One readable line for one event: icon, kind, text, sub-line. */
function describe(name, log, names, quorum) {
  const t = log.topics;
  const d = log.data;
  const circle = names[log.address.toLowerCase()] ?? "circle";
  const rd = (n) => `Round ${n} · ${circle}`;
  switch (name) {
    case "Paid": {
      const how = Number(w(d, 1));
      return [how === 2 ? ICON.repeat : ICON.in, "", how === 3 ? `${who(topicAddr(t[2]))}'s ${usd(w(d, 0))} pledge counts for round 1` : `${who(topicAddr(t[2]))} paid ${usd(w(d, 0))}`, `${HOW[how] ?? "paid"} · ${rd(topicNum(t[1]))}`];
    }
    case "Bid": return [ICON.bid, "", `${who(topicAddr(t[2]))} bid a ${usd(w(d, 0))} discount`, `signed, no gas · ${rd(topicNum(t[1]))}`];
    case "AuctionClosed": return [ICON.gavel, "", `Auction closed: ${who(topicAddr(t[2]))} wins the ${usd(w(d, 2))} pot`, `${usd(w(d, 1))} discount · payee locked · ${rd(topicNum(t[1]))}`];
    case "Approved": return [ICON.ok, "", `${who(topicAddr(t[2]))} approved the release`, `${Number(w(d, 0))} of ${quorum} needed · ${rd(topicNum(t[1]))}`];
    case "Released": return [ICON.out, "release", `${usd(w(d, 1))} paid to ${who(topicAddr(t[2]))}'s locked payee`, `${usd(w(d, 2) - w(d, 3))} shared with members, ${usd(w(d, 4))} held as security · ${rd(topicNum(t[1]))}`];
    case "Joined": return [ICON.plus, "", `${who(topicAddr(t[1]))} joined with a pledge`, `payee ${dataString(d, 2)} · ${circle}`];
    case "Left": return [ICON.minus, "", `${who(topicAddr(t[1]))} left and got ${usd(w(d, 0))} back`, circle];
    case "RoundStarted": return [ICON.round, "", `Round ${topicNum(t[1])} started`, `bidding until ${time(Number(w(d, 1)))} · ${circle}`];
    case "Withdrawn": return [ICON.out, "", `${usd(w(d, 0))} paid out to ${who(topicAddr(t[1]))}'s payee`, circle];
    case "Completed": return [ICON.star, "release", "Circle complete: every member took the pot once", circle];
    case "CircleOpened": return [ICON.open, "", `${who(topicAddr(t[1]))} opened ${circle}`, `${usd(w(d, 0))} a round · ${Number(w(d, 1))} seats`];
    case "Dissolved": return [ICON.stop, "fail", "Circle dissolved, members refunded pro rata", circle];
    case "Cancelled": return [ICON.stop, "fail", "The circle did not fill: every pledge refunded", circle];
    case "SecurityApplied": return [ICON.shield, "", `${who(topicAddr(t[2]))}'s share covered from their security`, rd(topicNum(t[1]))];
    case "PayeeChangeRequested": return [ICON.warn, "fail", `${who(topicAddr(t[1]))} asked to send ${who(topicAddr(t[1])) === "You" ? "your" : "their"} pot to ${dataString(d, 1)}`, `takes effect at ${time(Number(w(d, 2)))}, cancellable · ${circle}`];
    case "PayeeChangeCancelled": return [ICON.lock, "", `${who(topicAddr(t[1]))} cancelled a payee change`, circle];
    case "PayeeChanged": return [ICON.lock, "", `${who(topicAddr(t[1]))}'s payee is now ${dataString(d, 1)}`, `${dataAddr(d, 0).slice(0, 6)}…${dataAddr(d, 0).slice(-4)} · ${circle}`];
    case "StandingOrderSet": return [ICON.repeat, "", `${who(topicAddr(t[1]))} set a standing order`, `one share a round, at most ${Number(w(d, 0))} rounds · ${circle}`];
    case "StandingOrderRevoked": return [ICON.repeat, "", `${who(topicAddr(t[1]))} revoked their standing order`, circle];
    default: return null;
  }
}

function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const seenBy = new Map();

/** Render the feed for `circles` ({address, name}[]) into the list `target`, at most `limit` lines. */
export async function renderFeed(circles, quorum, target = "feed", limit = 40) {
  if (!seenBy.has(target)) seenBy.set(target, { seen: new Set(), first: true });
  const mem = seenBy.get(target);
  const names = Object.fromEntries(circles.map((c) => [c.address.toLowerCase(), c.name]));
  const logs = await chain.recentLogs(circles.map((c) => c.address));
  // Learn the names members chose before describing anything.
  for (const log of logs) if (T[log.topics[0]] === "Joined") learn(topicAddr(log.topics[1]), dataString(log.data, 2));
  const items = [];
  for (const log of logs) {
    const name = T[log.topics[0]];
    const line = name && describe(name, log, names, quorum);
    if (line) items.push({ key: log.transactionHash + log.logIndex, block: Number(BigInt(log.blockNumber)), idx: Number(BigInt(log.logIndex)), tx: log.transactionHash, line });
  }
  items.sort((a, b) => b.block - a.block || b.idx - a.idx);
  const top = items.slice(0, limit);
  const withTime = await Promise.all(top.map(async (it) => ({ ...it, ts: await chain.blockTime(it.block) })));

  const ul = document.getElementById(target);
  if (!ul) return;
  if (!withTime.length) {
    ul.innerHTML = '<li class="empty">No transactions in the last couple of hours yet.</li>';
    return;
  }
  ul.replaceChildren(
    ...withTime.map((it) => {
      const [icon, kind, text, sub] = it.line;
      const li = document.createElement("li");
      if (!mem.first && !mem.seen.has(it.key)) li.className = "fresh";
      mem.seen.add(it.key);
      const ic = document.createElement("span");
      ic.className = "ic " + kind;
      ic.innerHTML = icon;
      const what = document.createElement("span");
      what.className = "what";
      what.textContent = text;
      const small = document.createElement("small");
      small.textContent = sub;
      what.append(small);
      const a = document.createElement("a");
      a.className = "when";
      a.href = `${CONFIG.explorer}/tx/${it.tx}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = ago(it.ts) + " ↗";
      li.append(ic, what, a);
      return li;
    }),
  );
  mem.first = false;
}
