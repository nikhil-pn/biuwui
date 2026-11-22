// The story pages: live stats, which step the live circle is on, the countdown, and the proof circle.
import { CONFIG } from "./config.js";
import { usd } from "./feed.js";

// Each page has only some of these elements; writes to missing ones go nowhere.
const NULL_EL = new Proxy({ style: {} }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
const $ = (id) => document.getElementById(id) ?? NULL_EL;

/** Totals over every circle the factory has opened. */
export function renderStats(infos) {
  let rounds = 0;
  let volume = 0n;
  let seats = 0;
  for (const c of infos) {
    const done = c.phase === 2 ? c.size : c.phase === 1 ? Math.max(c.currentRound - 1, 0) : 0;
    rounds += done;
    volume += BigInt(done) * c.share * BigInt(c.size);
    seats += c.memberCount;
  }
  $("st-circles").textContent = String(infos.length);
  $("st-rounds").textContent = String(rounds);
  $("st-volume").textContent = usd(volume);
  $("st-members").textContent = String(seats);
}

/** Which of the five steps the circle is on now, or null when it is not running. */
export function stepOf(info, round, paidCount, quorum) {
  if (info.phase !== 1 || !round) return null;
  const now = Date.now() / 1000;
  if (!round.closed) {
    if (now > round.bidEnd) return "close";
    return paidCount < info.size ? "pay" : "bid";
  }
  if (!round.released) return round.approvals < quorum ? "approve" : "release";
  return "pay";
}

export function highlightStep(step) {
  for (const li of document.querySelectorAll("#steps li")) li.classList.toggle("now", li.dataset.step === step);
}

const PHASES = ["Filling up", "Running", "Complete", "Dissolved", "Did not fill"];
const AFTER = { 2: "Every member took the pot once", 3: "Refunded pro rata", 4: "Every pledge refunded" };

let timer;
/** "Round 2 of 3 · Practice · Mei" and a live countdown to the end of bidding. */
export function renderHeader(info, round) {
  $("feed-circle").textContent = info.currentRound && info.phase === 1 ? `Round ${info.currentRound} of ${info.size} · ${info.name}` : `${info.name} · ${PHASES[info.phase] ?? ""}`;
  clearInterval(timer);
  const tick = () => {
    const el = $("feed-timer");
    if (info.phase === 0) {
      const left = Math.round(info.joinBy - Date.now() / 1000);
      return (el.textContent = left > 0 ? `${info.memberCount} of ${info.size} joined` : "Joining closed");
    }
    // The phase is already in the title next to this; say what it meant instead of repeating it.
    if (info.phase !== 1) return (el.textContent = AFTER[info.phase] ?? "");
    if (!round || round.closed) return (el.textContent = round?.released ? "" : "Release in progress");
    const left = Math.round(round.bidEnd - Date.now() / 1000);
    if (left <= 0) return (el.textContent = "Bidding closed");
    const m = Math.floor(left / 60);
    const s = String(left % 60).padStart(2, "0");
    el.textContent = `Bidding closes in ${m}:${s}`;
  };
  tick();
  timer = setInterval(tick, 1000);
}

async function getJson(path, fallback) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    return res.ok ? await res.json() : fallback;
  } catch {
    return fallback;
  }
}

/** Full-circle proof runs, oldest first (docs/proof/<circle>.json, copied to /data/proof.json by scripts/build-site.sh). */
let runsCache;
export const proofRuns = () => (runsCache ??= getJson("/data/proof.json", []));

/** The safety-path proofs (docs/proof/edge-cases.json, copied to /data/edge-cases.json by scripts/build-site.sh). */
export const edgeCases = () => getJson("/data/edge-cases.json", null);

const link = (href, text) => {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  return a;
};

/** The payee-lock test from the newest proof circle: a change requested, then cancelled with one signature. */
export async function renderLockTest() {
  const ul = document.getElementById("attempts");
  if (!ul) return;
  const runs = await proofRuns();
  const all = runs.flatMap((r) => r.steps);
  const first = (re) => all.find((s) => re.test(s.step));
  const steps = [first(/bids/i), first(/approves/i), first(/sets a standing order/i), first(/standing order collects/i), ...all.filter((s) => /payee lock/i.test(s.step))].filter(Boolean);
  if (!steps.length) return;
  ul.replaceChildren(
    ...steps.map((s) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      const text = s.step.replace(/^Payee lock: /, "");
      label.textContent = text[0].toUpperCase() + text.slice(1) + " · ";
      const res = document.createElement("span");
      const asked = /requested/i.test(s.step);
      res.className = asked ? "bad" : "good";
      res.textContent = asked ? "waits, visible to all" : /cancel/i.test(s.step) ? "cancelled" : "no gas";
      label.append(res);
      li.append(label, link(s.url, "explorer ↗"));
      return li;
    }),
  );
}

/** Every transaction of the first full circle, for the proof page. */
export async function renderProofSteps() {
  const ul = document.getElementById("proof-steps");
  if (!ul) return;
  const runs = await proofRuns();
  const run = runs[runs.length - 1];
  if (!run) return;
  $("proof-count").textContent = `${run.steps.filter((x) => x.tx).length} transactions, no gas`;
  $("proof-circle").replaceChildren(link(`${CONFIG.explorer}/address/${run.circle}`, `${run.circle.slice(0, 6)}…${run.circle.slice(-4)} ↗`));
  ul.replaceChildren(...proofItems(run.steps));
}

/** One numbered line per step: the transaction link, or "check" for a read or a refused request (no transaction). */
function proofItems(steps) {
  let n = 0;
  return steps.map((s) => {
    const li = document.createElement("li");
    const ic = document.createElement("span");
    ic.className = "ic" + (s.tx && /released|pay out|paid back|refund/i.test(s.step) ? " release" : "");
    ic.textContent = s.tx ? String(++n) : "·";
    const what = document.createElement("span");
    what.className = "what";
    what.textContent = s.step.replace(/his\/her payee/, "own payee");
    let a;
    if (s.tx) a = link(s.url, `${s.tx.slice(0, 10)}… ↗`);
    else {
      a = document.createElement("span");
      a.textContent = "check";
    }
    a.className = "when";
    li.append(ic, what, a);
    return li;
  });
}

/** The safety paths: one card per case (A to E), in the same style as the full circle. */
export async function renderEdgeSteps() {
  const box = document.getElementById("edge-cases");
  if (!box) return;
  const edge = await edgeCases();
  if (!edge) return;
  const total = edge.steps.filter((x) => x.tx).length;
  $("edge-count").textContent = `${total} transactions in all.`;
  const sections = [...new Set(edge.steps.map((x) => x.section))].sort();
  box.replaceChildren(
    ...sections.map((name) => {
      const steps = edge.steps.filter((x) => x.section === name);
      const count = steps.filter((x) => x.tx).length;
      const card = document.createElement("div");
      card.className = "feed-card";
      const head = document.createElement("header");
      head.className = "feed-head";
      const title = document.createElement("span");
      title.textContent = name;
      const right = document.createElement("span");
      right.className = "feed-timer";
      right.textContent = count ? `${count} transaction${count === 1 ? "" : "s"}` : "no transaction";
      head.append(title, right);
      const ul = document.createElement("ul");
      ul.className = "feed";
      ul.append(...proofItems(steps));
      card.append(head, ul);
      return card;
    }),
  );
}
