// The story pages: live stats, which step the live circle is on, the countdown, and the proof circle.
import { CONFIG } from "./config.js";
import { usd } from "./feed.js";

// Each page has only some of these elements; writes to missing ones go nowhere.
const NULL_EL = new Proxy({ style: {} }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
const $ = (id) => document.getElementById(id) ?? NULL_EL;

/** Totals over every circle both factories have opened. */
export function renderStats(infos) {
  let rounds = 0;
  let volume = 0n;
  let joined = 0;
  for (const c of infos) {
    const done = c.phase === 2 ? c.size : c.phase === 1 ? Math.max(c.currentRound - 1, 0) : 0;
    rounds += done;
    volume += BigInt(done) * c.share * BigInt(c.size);
    joined += c.memberCount;
  }
  $("st-circles").textContent = String(infos.length);
  $("st-rounds").textContent = String(rounds);
  $("st-volume").textContent = usd(volume);
  $("st-members").textContent = String(joined);
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
    if (info.phase !== 1) return (el.textContent = PHASES[info.phase] ?? "");
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

/** The first full circle's transactions (docs/proof, copied to /data/proof.json by scripts/build-site.sh). */
export async function proofRuns() {
  try {
    const res = await fetch("/data/proof.json", { cache: "no-store" });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

const link = (href, text) => {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  return a;
};

/** The payee-lock test from the proof circle: a change requested, then cancelled with one signature. */
export async function renderLockTest() {
  const ul = document.getElementById("attempts");
  if (!ul) return;
  const runs = await proofRuns();
  const steps = runs.flatMap((r) => r.steps).filter((s) => /payee lock|standing order|bids|approves/i.test(s.step)).slice(0, 6);
  if (!steps.length) return;
  ul.replaceChildren(
    ...steps.map((s) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = s.step.replace(/^Payee lock: /, "") + " · ";
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
  $("proof-circle").replaceChildren(link(`${CONFIG.explorer}/address/${run.circle}`, `${run.circle.slice(0, 6)}…${run.circle.slice(-4)} ↗`));
  ul.replaceChildren(
    ...run.steps.map((s, i) => {
      const li = document.createElement("li");
      const ic = document.createElement("span");
      ic.className = "ic" + (/released|pay out/i.test(s.step) ? " release" : "");
      ic.textContent = String(i + 1);
      const what = document.createElement("span");
      what.className = "what";
      what.textContent = s.step;
      const a = link(s.url, `${s.tx.slice(0, 10)}… ↗`);
      a.className = "when";
      li.append(ic, what, a);
      return li;
    }),
  );
}
