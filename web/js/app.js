// Fills the phone and the story with live data from the QDay Aevum testnet.
import { learn, who } from "./config.js";
import * as chain from "./chain.js";
import { ICON, renderFeed, usd } from "./feed.js";
import * as story from "./story.js";
import { initTabs, renderPeople } from "./tabs.js";

const $ = (id) => document.getElementById(id) ?? NULL_EL;
// Each page has only some of the live pieces; writes to missing ones go nowhere.
const NULL_EL = new Proxy({ style: {} }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
const has = (id) => Boolean(document.getElementById(id));
const PHASES = ["Filling up", "Running", "Completed", "Dissolved", "Did not fill"];
const ICONS = [ICON.open, ICON.star, ICON.lock];
const CHIPS = 3;

/** "$1,234.56" with the decimals in grey. */
function money(units) {
  const [whole, dec] = usd(units).slice(1).split(".");
  return `$${whole}<span class="dec">.${dec}</span>`;
}

const state = { list: [], all: [], selected: null, tab: "wallet" };

function chipFor(c, i) {
  const b = document.createElement("button");
  b.className = "chip" + (c.address === state.selected ? " active" : "");
  const icon = document.createElement("span");
  icon.className = "chip-icon";
  icon.innerHTML = ICONS[i % ICONS.length];
  b.append(icon, document.createTextNode(c.name));
  b.addEventListener("click", () => {
    state.selected = c.address;
    renderChips();
    refreshPhone().catch(console.error);
  });
  return b;
}

function renderChips() {
  if (!state.list.length || !has("circle-chips")) return;
  $("circle-chips").replaceChildren(...state.list.slice(0, CHIPS).map(chipFor));
}

/** Everything the page shows about one circle. */
async function snapshot(address) {
  const info = await chain.circleInfo(address);
  const rounds = await Promise.all(
    Array.from({ length: Math.max(info.currentRound, 0) }, (_, i) => chain.round(address, i + 1)),
  );
  const memberList = await chain.members(address);
  const [paidFlags, payees] = await Promise.all([
    info.currentRound ? Promise.all(memberList.map((m) => chain.hasPaid(address, info.currentRound, m))) : [],
    Promise.all(memberList.map((m) => chain.payeeOf(address, m).catch(() => null))),
  ]);
  payees.forEach((p, i) => p && learn(memberList[i], p.name));
  return { info, rounds, memberList, paid: paidFlags.filter(Boolean).length, paidFlags };
}

async function refreshPhone() {
  if (!has("balance")) return;
  const c = state.list.find((x) => x.address === state.selected);
  if (!c) return;
  const { info, rounds, paid, memberList, paidFlags } = await snapshot(c.address);
  if (state.tab === "members") {
    const won = await Promise.all(memberList.map((m) => chain.hasWon(c.address, m)));
    renderPeople(memberList.map((m, i) => ({ name: who(m), paid: paidFlags[i], won: won[i] })));
  }
  if (state.tab === "activity") {
    const quorum = await chain.quorumNeeded(c.address);
    await renderFeed([c], quorum, "phone-feed", 12);
  }
  const saved = rounds.reduce((s, r) => s + r.collected, 0n);
  const shared = rounds.filter((r) => r.released).reduce((s, r) => s + r.discount, 0n);
  $("balance").innerHTML = money(saved);
  $("gain").textContent = saved > 0n ? `+${((Number(shared) / Number(saved)) * 100).toFixed(2)}%` : "+0.00%";
  $("card-kind").textContent = PHASES[info.phase];

  const now = rounds[info.currentRound - 1];
  const count = info.phase === 0 ? info.memberCount : paid;
  const pct = info.size ? Math.round((count / info.size) * 100) : 0;
  $("round-title").textContent = info.currentRound ? `Round ${info.currentRound} of ${info.size}` : "Filling up";
  $("pot").innerHTML = money(now ? now.collected : info.share * BigInt(info.memberCount));
  $("paid-tag").textContent = `${count} of ${info.size}`;
  $("paid-word").textContent = info.phase === 0 ? "pledged" : "paid in";
  $("paid-bar").style.width = `${pct}%`;
  $("paid-knob").style.left = `${pct}%`;
  $("share").innerHTML = money(info.share);
  $("round-tag").textContent = PHASES[info.phase].toLowerCase();
  $("ticks").replaceChildren(
    ...Array.from({ length: info.size }, (_, i) => {
      const t = document.createElement("span");
      if (rounds[i]?.released) t.className = "done";
      return t;
    }),
  );
}

/** The newest running circle drives the story: its step, countdown and feed. */
async function refreshStory() {
  if (!has("steps") && !has("feed") && !has("device-note")) return;
  const live = state.list.find((c) => c.phase === 1) ?? state.list[0];
  if (!live) return;
  const [snap, quorum] = await Promise.all([snapshot(live.address), chain.quorumNeeded(live.address)]);
  const round = snap.rounds[snap.info.currentRound - 1];
  story.highlightStep(story.stepOf(snap.info, round, snap.paid, quorum));
  story.renderHeader(snap.info, round);
  if (has("feed")) await renderFeed(state.list.slice(0, 6), quorum);
  $("device-note").textContent = `Live on QDay Aevum testnet · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

async function loadCircles() {
  const addrs = await chain.circles();
  const infos = await Promise.all(addrs.map((a) => chain.circleInfo(a)));
  story.renderStats(infos);
  // Newest first: the phone opens on the newest circle and keeps following it.
  const fresh = [...infos].reverse();
  const newest = fresh[0]?.address;
  if (!state.selected || (state.list[0] && state.list[0].address !== newest && state.selected === state.list[0].address)) {
    state.selected = newest ?? null;
  }
  state.list = fresh;
  state.all = infos;
  renderChips();
}

const every = (ms, fn) => setInterval(() => fn().catch((e) => console.error("Biu Wui:", e)), ms);

async function start() {
  if (has("flow-ring")) {
    const { mountFlowDemo } = await import("./ring.js");
    mountFlowDemo($("flow-ring"), $("flow-caption"), $("flow-dots"));
  }
  story.renderLockTest().catch(() => {});
  story.renderProofSteps().catch(() => {});
  initTabs((tab) => {
    state.tab = tab;
    refreshPhone().catch(console.error);
  });
  try {
    await loadCircles();
    await refreshPhone();
    await refreshStory();
  } catch (e) {
    console.error("Biu Wui: could not read the testnet", e);
    $("device-note").textContent = "Could not reach the QDay Aevum testnet. Retrying…";
  }
  every(15000, refreshPhone);
  every(20000, refreshStory);
  every(60000, loadCircles);
}

start();
