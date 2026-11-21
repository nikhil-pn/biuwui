// Biu Wui app: wallet (burner or injected), faucet, practice circle, open/join, and the live circle view.
// Reads come straight from Aevum; every write is a member's signature that /api/relay submits.
import { parseUnits, type Address } from "viem";
import { chopSvg, hydrateChops } from "../lib/chop";
import { createRing, type RingMember } from "../lib/ring";
import { addrLink, DEMO_CIRCLE, esc, fmt, PHASES, publicClient, short, txLink } from "../lib/chain";
import * as act from "./actions";
import { explain, faucet } from "./api";
import { balanceOf, circleEvents, listCircles, loadCircle, type Circle, type CircleRow, type Ev, type Member } from "./data";
import { openSheet, toast } from "./sheet";
import { addAevum, burnerKey, connectInjected, displayName, forgetWallet, hasInjected, onInjectedChange, restoreWallet, useBurner, type Wallet } from "./wallet";

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const screen = $("#screen")!;
let wallet: Wallet | null = null;
let balance: bigint | null = null;
let view: { stop(): void } | null = null;
const now = () => Math.floor(Date.now() / 1000);
const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const BOTS = new Set(["Ah Ming", "Kitty"]);
const BLOCK_SEC = 1; // Aevum testnet makes about one block a second (measured)

function clock(s: number) {
  if (s <= 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${ss}`;
}
function ago(sec: number) {
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} d ago`;
}
const money = (v: bigint | null | undefined) => {
  if (v == null) return "–";
  const [i, d] = fmt(v).split(".");
  return `${i}<span class="dec">.${d}</span>`;
};

// ---------------------------------------------------------------- top bar + wallet

function renderTopbar() {
  const pill = $("#wallet-pill")!;
  if (!wallet) {
    pill.innerHTML = `<span class="w-dot off"></span>Choose a wallet`;
    return;
  }
  pill.innerHTML = `<span class="w-dot"></span><span class="num">${balance == null ? "…" : fmt(balance)}</span><small>tUSD8</small><span class="w-addr">${short(wallet.address)}</span>`;
}

async function refreshBalance() {
  if (!wallet) return;
  try {
    balance = await balanceOf(wallet.address);
  } catch { /* keep */ }
  renderTopbar();
  document.querySelectorAll("[data-balance]").forEach((e) => (e.innerHTML = money(balance)));
}

function chooseWallet(then?: () => void) {
  const s = openSheet(`
    <div class="info">
      <div class="center">${chopSvg("標會", "hero-chop")}</div>
      <h2 class="center">Choose how to sign</h2>
      <p class="lead center">Members never pay gas or send transactions. You only sign; our relayer submits.</p>
      <div class="tx-actions">
        <button class="btn-red block-btn" data-w="burner">Try without a wallet</button>
        <p class="fine center">A test key is made in this browser and kept here. Test money only.</p>
        <button class="btn-glass block-btn" data-w="injected" ${hasInjected() ? "" : "disabled"}>Connect wallet (MetaMask, Rabby…)</button>
        ${hasInjected() ? `<button class="link center" data-w="network">Add the Aevum network to my wallet</button>` : `<p class="fine center">No browser wallet found on this device.</p>`}
      </div>
      <p class="err" role="alert" hidden></p>
    </div>`);
  s.body.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-w]");
    if (!b) return;
    const err = $(".err", s.body)!;
    try {
      if (b.dataset.w === "network") {
        await addAevum();
        toast("Aevum testnet added to your wallet");
        return;
      }
      wallet = b.dataset.w === "burner" ? useBurner() : await connectInjected();
      s.close();
      await refreshBalance();
      toast(wallet.kind === "burner" ? "Test wallet ready" : "Wallet connected");
      then ? then() : route();
    } catch (x) {
      err.textContent = explain(x);
      err.hidden = false;
    }
  });
}

function walletSheet() {
  if (!wallet) return chooseWallet();
  const w = wallet;
  const s = openSheet(`
    <div class="info">
      <h2>${w.kind === "burner" ? "Your test wallet" : "Your wallet"}</h2>
      <dl class="rows glass">
        <div><dt>Address</dt><dd><a href="${addrLink(w.address)}" target="_blank" rel="noopener">${short(w.address)} ↗</a></dd></div>
        <div><dt>tUSD8</dt><dd class="num" data-balance>${money(balance)}</dd></div>
        <div><dt>Gas token</dt><dd>not needed</dd></div>
        <div><dt>Network</dt><dd>QDay Aevum testnet (44005)</dd></div>
      </dl>
      ${w.kind === "burner" ? `<p class="warn">This key lives only in this browser and is for <b>test money only</b>. Anyone using this browser can use it. Export it to keep it.</p>` : ""}
      <div class="tx-actions">
        <button class="btn-glass block-btn" data-k="copy">Copy address</button>
        ${w.kind === "burner" ? `<button class="btn-glass block-btn" data-k="export">Show private key</button>` : `<button class="btn-glass block-btn" data-k="network">Add / switch to Aevum</button>`}
        <button class="btn-glass block-btn" data-k="${w.kind === "burner" ? "reset" : "disconnect"}">${w.kind === "burner" ? "Reset: make a new test wallet" : "Disconnect"}</button>
      </div>
      <pre class="key" hidden></pre>
    </div>`);
  s.body.addEventListener("click", async (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>("[data-k]")?.dataset.k;
    if (k === "copy") { await navigator.clipboard?.writeText(w.address); toast("Address copied"); }
    if (k === "export") { const pre = $(".key", s.body)!; pre.textContent = burnerKey() ?? ""; pre.hidden = !pre.hidden; }
    if (k === "network") await addAevum().then(() => toast("Aevum is set in your wallet")).catch((x) => toast(explain(x)));
    if (k === "reset") {
      if (!confirm("Make a new test wallet? The old key and its test tUSD8 are forgotten unless you exported it.")) return;
      forgetWallet(true);
      wallet = useBurner();
      balance = null;
      s.close();
      refreshBalance();
      route();
    }
    if (k === "disconnect") { forgetWallet(false); wallet = null; balance = null; s.close(); renderTopbar(); route(); }
  });
}

function getFaucet(btn: HTMLButtonElement) {
  if (!wallet) return chooseWallet();
  const w = wallet;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Sending…`;
  faucet(w.address)
    .then(async ({ hash }) => {
      btn.innerHTML = `<span class="spinner"></span> Confirming…`;
      await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1500 });
      toast("0.03 test tUSD8 arrived");
      refreshBalance();
      btn.textContent = "Got it ✓";
    })
    .catch((e) => {
      toast(explain(e));
      btn.disabled = false;
      btn.textContent = "Get 0.03 test tUSD8";
    });
}

// ---------------------------------------------------------------- home

function welcome() {
  screen.innerHTML = `
    <section class="welcome">
      <div class="welcome-mark">${chopSvg("標會", "hero-chop")}</div>
      <p class="kicker">Biu Wui · a savings circle on QDay Aevum</p>
      <h1>Bid for the pot, together.</h1>
      <ul class="points">
        <li class="glass">Everyone pays the same share each round. <b>Whoever needs it soonest bids a discount</b> for the pot; the discount is shared by all.</li>
        <li class="glass"><b>You only sign</b>, like stamping a chop. You never need gas.</li>
        <li class="glass">The pot only goes to a <b>named, locked payee</b>. Nobody can run off with it.</li>
      </ul>
      <button class="btn-red block-btn" data-go="burner">Try without a wallet</button>
      <button class="btn-glass block-btn" data-go="choose">Connect a wallet</button>
      <p class="fine">Testnet only · tUSD8 is a test stablecoin with no value · <a href="/how">How it works</a></p>
    </section>`;
  screen.onclick = async (e) => {
    const g = (e.target as HTMLElement).closest<HTMLElement>("[data-go]")?.dataset.go;
    if (g === "burner") { wallet = useBurner(); await refreshBalance(); toast("Test wallet ready"); route(); }
    if (g === "choose") chooseWallet();
  };
}

function circleRow(r: CircleRow) {
  const status = r.phase === 0 ? `forming · ${r.count}/${r.size}` : r.phase === 1 ? `round ${r.round} of ${r.size}` : PHASES[r.phase].toLowerCase();
  return `<li><a href="#circle=${r.address}">
    <span class="c-ico ${r.phase === 1 ? "live" : ""}">${esc([...r.name.replace(/^Practice · /, "")][0] ?? "?")}</span>
    <span class="c-name">${esc(r.name)}<small>${fmt(r.share)} tUSD8 a round · ${status}</small></span>
    <span class="c-go">›</span></a></li>`;
}

function home() {
  const w = wallet!;
  screen.innerHTML = `
    <section class="home">
      <div class="col-a">
        <article class="wallet-card glass sheen">
          <p class="kicker">${w.kind === "burner" ? "Your test wallet" : "Your wallet"} · <button class="link" data-h="wallet">${short(w.address)}</button></p>
          <p class="big num" data-balance>${money(balance)}</p>
          <p class="muted">tUSD8 · gas needed: none</p>
          <div class="row-btns"><button class="btn-ink" data-h="faucet">Get 0.03 test tUSD8</button><button class="btn-glass" data-h="wallet">Wallet</button></div>
          ${w.kind === "burner" ? `<p class="fine">Test-only key kept in this browser. Export or reset it under Wallet.</p>` : ""}
        </article>
        <article class="practice glass strong">
          <div class="practice-art" aria-hidden="true">${chopSvg("開會")}</div>
          <p class="kicker red">The 2-minute demo</p>
          <h2>Start a practice circle with Ah Ming and Kitty</h2>
          <p>Ah Ming and Kitty are <b>friendly bots</b>. They join your circle within about 30 seconds, pay their shares, bid now and then and approve releases, so you can play whole rounds in a few minutes: pay, bid, approve, release.</p>
          <button class="btn-red block-btn" data-h="practice">Start a practice circle</button>
        </article>
        <article class="glass card-pad">
          <h3>Your own circle</h3>
          <p class="muted">Open a circle with your rules, or join one from a link.</p>
          <div class="row-btns"><a class="btn-glass" href="#open">Open a circle</a></div>
          <form class="join-link" data-h="joinlink"><input name="link" placeholder="Paste a circle link or address" autocomplete="off" spellcheck="false"><button class="btn-ink" type="submit">Go</button></form>
        </article>
      </div>
      <div class="col-b">
        <article class="glass list-card"><header><h3>My circles</h3></header><ul class="clist" id="mine"><li class="empty">Looking…</li></ul></article>
        <article class="glass list-card"><header><h3>Recent circles</h3><span class="muted small">both Biu Wui factories</span></header><ul class="clist" id="recent"><li class="empty">Loading from Aevum…</li></ul></article>
      </div>
    </section>`;
  screen.onclick = (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-h]");
    if (!t) return;
    const h = t.dataset.h;
    if (h === "wallet") walletSheet();
    if (h === "faucet") getFaucet(t as HTMLButtonElement);
    if (h === "practice") act.startPractice(w, (a) => (location.hash = `circle=${a}`));
  };
  screen.querySelector<HTMLFormElement>(".join-link")!.onsubmit = (e) => {
    e.preventDefault();
    const v = (e.target as HTMLFormElement).link.value as string;
    const m = v.match(/0x[0-9a-fA-F]{40}/);
    if (m) location.hash = `circle=${m[0]}`;
    else toast("That doesn't contain a circle address.");
  };
  const load = async () => {
    try {
      const rows = await listCircles(w.address);
      const mine = rows.filter((r) => r.mine);
      $("#mine")!.innerHTML = mine.length ? mine.map(circleRow).join("") : `<li class="empty">None yet. Start a practice circle, or open one.</li>`;
      $("#recent")!.innerHTML = rows.slice(0, 12).map(circleRow).join("") || `<li class="empty">No circles yet.</li>`;
    } catch {
      $("#recent")!.innerHTML = `<li class="empty">Couldn't reach Aevum. Retrying…</li>`;
    }
  };
  load();
  const t = setInterval(() => { if (!document.hidden) { load(); refreshBalance(); } }, 15000);
  view = { stop: () => clearInterval(t) };
}

// ---------------------------------------------------------------- open a circle (form)

function openForm() {
  if (!wallet) return chooseWallet(() => openForm());
  const w = wallet;
  screen.innerHTML = `
    <section class="narrow">
      <a class="back" href="#">‹ Home</a>
      <h1 class="title">Open a circle</h1>
      <p class="muted sub">The rules are fixed once it opens. Members never pay gas; you don't either.</p>
      <form class="glass form-card" id="open-form" novalidate>
        <label class="field"><span>Circle name</span><input name="name" maxlength="64" placeholder="e.g. Sham Shui Po family" required></label>
        <div class="field-row">
          <label class="field"><span>Share a round (tUSD8)</span><input name="share" inputmode="decimal" value="0.01"></label>
          <label class="field"><span>Members (2–50)</span><input name="size" type="number" min="2" max="50" value="5"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Joining stays open (hours)</span><input name="joinH" type="number" min="0.1" step="0.5" value="24"></label>
          <label class="field"><span>Bidding per round (minutes)</span><input name="roundM" type="number" min="1" value="60"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Grace period (minutes)</span><input name="graceM" type="number" min="1" value="60"><small>Before a stalled round can be dissolved.</small></label>
          <label class="field"><span>Payee-change delay (minutes)</span><input name="delayM" type="number" min="1" value="60"><small>How long a payee change waits, visible to all.</small></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Max discount (%, ≤ 40)</span><input name="disc" type="number" min="0" max="40" value="30"></label>
          <label class="field"><span>Organiser fee (%, ≤ 5)</span><input name="fee" type="number" min="0" max="5" step="0.5" value="1"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Approval quorum (%, > 50)</span><input name="quorum" type="number" min="51" max="100" value="60"></label>
          <label class="field"><span>Winner's security (%)</span><input name="sec" type="number" min="0" max="100" value="50"><small>Held back from each pot to cover the winner's later shares.</small></label>
        </div>
        <p class="err" role="alert" hidden></p>
        <button class="btn-red block-btn" type="submit">Review and sign</button>
      </form>
    </section>`;
  const f = $<HTMLFormElement>("#open-form")!;
  f.onsubmit = (e) => {
    e.preventDefault();
    const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
    const err = $(".err", f)!;
    const fail = (m: string) => { err.textContent = m; err.hidden = false; };
    const name = v("name");
    const nb = new TextEncoder().encode(name).length;
    if (!nb) return fail("Give the circle a name.");
    if (nb > 64) return fail("The name can be at most 64 bytes.");
    let share: bigint;
    try { share = parseUnits(v("share") || "0", 6); } catch { return fail("Enter the share like 0.5."); }
    if (share <= 0n) return fail("The share must be more than 0.");
    const size = Number(v("size"));
    if (!Number.isInteger(size) || size < 2 || size > 50) return fail("Members must be 2 to 50.");
    const secs = (x: string, mult: number) => Math.round(Number(x) * mult);
    const joinWindow = secs(v("joinH"), 3600), roundLength = secs(v("roundM"), 60), graceLength = secs(v("graceM"), 60), payeeDelay = secs(v("delayM"), 60);
    if ([joinWindow, roundLength, graceLength, payeeDelay].some((s) => !(s >= 60) || s > 4294967295)) return fail("Every time must be at least 1 minute.");
    const bps = (x: string) => Math.round(Number(x) * 100);
    const maxDiscountBps = bps(v("disc")), feeBps = bps(v("fee")), quorumBps = bps(v("quorum")), securityBps = bps(v("sec"));
    if (!(maxDiscountBps >= 0 && maxDiscountBps <= 4000)) return fail("Max discount must be 0 to 40%.");
    if (!(feeBps >= 0 && feeBps <= 500)) return fail("The organiser fee must be 0 to 5%.");
    if (!(quorumBps > 5000 && quorumBps <= 10000)) return fail("The quorum must be over 50% (and at most 100%).");
    if (!(securityBps >= 0 && securityBps <= 10000)) return fail("Security must be 0 to 100%.");
    err.hidden = true;
    act.openCircle(w, { share, size, joinWindow, roundLength, graceLength, payeeDelay, maxDiscountBps, feeBps, quorumBps, securityBps, name }, (a) => (location.hash = `circle=${a}`));
  };
}

// ---------------------------------------------------------------- the circle view

function describe(e: Ev, nameOf: (a?: unknown) => string, c: Circle): { ic: string; text: string; cls?: string } | null {
  const a = e.args as Record<string, never>;
  const r = a.round != null ? `round ${a.round}` : "";
  switch (e.name) {
    case "CircleOpened": return { ic: "開", text: `Circle opened · ${fmt(a.share)} tUSD8 a round, ${a.size} seats` };
    case "Joined": return { ic: "入", text: `<b>${esc(a.payeeName)}</b> joined with a signed pledge` };
    case "Left": return { ic: "退", text: `${nameOf(a.member)} left; pledge of ${fmt(a.refund)} refunded` };
    case "RoundStarted": return { ic: "始", text: `Round ${a.round} started` };
    case "Paid": {
      const how = Number(a.how);
      if (how === 3) return null; // the pledge, already shown as Joined
      const by = ["directly", "by signature", "by standing order", "", "from held security"][how] ?? "";
      return { ic: "付", text: `${nameOf(a.member)} paid ${r} ${by}` };
    }
    case "Bid": return { ic: "標", text: `${nameOf(a.member)} bid a <b>${fmt(a.discount)}</b> discount in ${r}` };
    case "AuctionClosed": return { ic: "結", text: `Round ${a.round} closed: <b>${nameOf(a.winner)}</b> wins at ${fmt(a.discount)} discount`, cls: "gold" };
    case "Approved": return { ic: "准", text: `${nameOf(a.member)} approved ${r} (${a.approvals} of ${c.quorumNeeded})` };
    case "Released": return { ic: "放", text: `Round ${a.round} pot released: <b>${fmt(a.payout)}</b> to ${nameOf(a.winner)}'s payee ${short(a.payTo)}`, cls: "gold" };
    case "SecurityApplied": return { ic: "保", text: `${nameOf(a.member)}'s held security paid ${r}` };
    case "StandingOrderSet": return { ic: "供", text: `${nameOf(a.member)} set a standing order: ${a.maxRounds} round(s)` };
    case "StandingOrderRevoked": return { ic: "消", text: `${nameOf(a.member)} revoked their standing order` };
    case "PayeeChangeRequested": return { ic: "!", text: `${nameOf(a.member)} asked to change payee to <b>${esc(a.payeeName)}</b> · ${short(a.payout)}`, cls: "warn" };
    case "PayeeChangeCancelled": return { ic: "消", text: `${nameOf(a.member)} cancelled a payee change` };
    case "PayeeChanged": return { ic: "收", text: `${nameOf(a.member)}'s payee is now <b>${esc(a.payeeName)}</b> · ${short(a.payout)}`, cls: "warn" };
    case "Withdrawn": return { ic: "利", text: `${fmt(a.amount)} paid out to ${nameOf(a.member)}'s payee`, cls: "gold" };
    case "Completed": return { ic: "完", text: "Circle completed. Held security is now paid back.", cls: "gold" };
    case "Dissolved": return { ic: "散", text: `Circle dissolved in round ${a.round}; what's left goes back pro rata` };
    case "Cancelled": return { ic: "退", text: "Circle didn't fill in time and was cancelled; every pledge comes back" };
    default: return null;
  }
}

function circleView(addr: Address) {
  screen.innerHTML = `
    <section class="cview">
      <a class="back" href="#">‹ All circles</a>
      <header class="c-head glass sheen" id="c-head"><div class="boot"><span class="spinner"></span> Reading the circle from Aevum…</div></header>
      <div id="c-banners"></div>
      <div class="c-grid">
        <article class="glass ring-card">
          <header><h2 id="ring-title">The circle</h2><span class="timer num" id="c-timer"></span></header>
          <div class="ring-wrap"><div id="c-ring"></div></div>
          <p class="ring-legend"><span class="lg paid"></span> paid this round <span class="lg win"></span> wins this round <span class="lg won">★</span> already won <span class="lg tick">✓</span> approved</p>
        </article>
        <div class="c-side">
          <article class="glass moves" id="c-moves"></article>
          <article class="glass facts" id="c-facts"></article>
        </div>
      </div>
      <article class="glass list-card"><header><h3>Members and payees</h3><span class="muted small" id="c-mcount"></span></header><ul class="people" id="c-members"></ul></article>
      <article class="glass list-card"><header><h3>Activity</h3><span class="muted small">from Aevum events</span></header><ul class="feed" id="c-feed"><li class="empty">Reading events…</li></ul></article>
    </section>`;
  const ring = createRing($("#c-ring")!);
  let c: Circle | null = null;
  let evs: Ev[] = [];
  let lastBlock: bigint | null = null;
  let tip = { block: 0n, ts: 0 };
  let stopped = false;
  let failures = 0;

  const meOf = (cc: Circle) => cc.members.find((m) => same(m.address, wallet?.address));
  const nameOf = (a?: unknown) => {
    const m = c?.members.find((x) => same(x.address, String(a)));
    if (wallet && same(String(a), wallet.address)) return "You";
    return m ? esc(m.payeeName) : short(String(a));
  };
  const isBot = (m: Member) => Boolean(c?.practice && BOTS.has(m.payeeName) && !same(m.address, wallet?.address));

  const refresh = () => { load(); refreshBalance(); };

  async function load() {
    try {
      c = await loadCircle(addr);
      failures = 0;
      render();
    } catch (e) {
      failures++;
      if (!c) {
        $("#c-head")!.innerHTML = `<div class="boot">${failures > 2 ? `This doesn't look like a Biu Wui circle, or Aevum isn't answering. <a href="#">Back</a>` : `<span class="spinner"></span> Retrying… ${esc(explain(e))}`}</div>`;
      }
    }
  }

  async function loadEvents() {
    try {
      const b = await publicClient.getBlock();
      tip = { block: b.number, ts: Number(b.timestamp) };
      const fresh = await circleEvents(addr, b.number, lastBlock == null ? null : lastBlock + 1n);
      evs = lastBlock == null ? fresh : [...evs, ...fresh.filter((x) => !evs.some((y) => y.tx === x.tx && y.logIndex === x.logIndex))];
      lastBlock = b.number;
      renderFeed();
    } catch {
      if (lastBlock == null) $("#c-feed")!.innerHTML = `<li class="empty">Couldn't read events yet. Retrying…</li>`;
    }
  }

  function renderFeed() {
    if (!c) return;
    const items = evs.map((e) => ({ e, d: describe(e, nameOf, c!) })).filter((x) => x.d).reverse().slice(0, 60);
    $("#c-feed")!.innerHTML = items.length
      ? items.map(({ e, d }) => `<li class="${d!.cls ?? ""}"><span class="ic cjk">${d!.ic}</span><span class="what">${d!.text}</span><a class="when" href="${txLink(e.tx)}" target="_blank" rel="noopener">${tip.block ? ago(Number(tip.block - e.block) * BLOCK_SEC) : ""} ↗</a></li>`).join("")
      : `<li class="empty">No activity yet.</li>`;
  }

  function tick() {
    if (!c || stopped) return;
    const t = $("#c-timer");
    const rd = c.rd;
    let progress: number | null = null;
    if (c.phase === 0) {
      const left = Number(c.joinBy) - now();
      t && (t.textContent = left > 0 ? `joining closes in ${clock(left)}` : "joining closed");
    } else if (c.phase === 1 && rd) {
      const left = Number(rd.bidEnd) - now();
      progress = Math.min(1, Math.max(0, 1 - left / Math.max(1, c.roundLength)));
      t && (t.textContent = rd.closed ? (rd.released ? "released" : "waiting for approvals") : left > 0 ? `${clock(left)} left to pay and bid` : "bidding over");
    } else t && (t.textContent = "");
    drawRing(progress);
    // a deadline just passed: buttons change
    if (rd && !rd.closed && c.phase === 1 && Number(rd.bidEnd) - now() === -2) render();
  }

  function drawRing(progress: number | null) {
    if (!c) return;
    const rd = c.rd;
    const ms: RingMember[] = c.members.map((m) => ({
      name: m.payeeName,
      me: same(m.address, wallet?.address),
      bot: isBot(m),
      paid: c!.phase <= 1 && m.paid,
      won: m.won && !(c!.phase === 1 && rd?.closed && !rd.released && same(rd.winner, m.address)),
      winner: Boolean(c!.phase === 1 && rd?.closed && !rd.released && same(rd.winner, m.address)),
      approved: Boolean(c!.phase === 1 && rd?.closed && !rd.released && m.approved),
      bid: rd && !rd.closed && same(rd.bestBidder, m.address) && rd.bestDiscount > 0n ? `−${fmt(rd.bestDiscount)}` : null,
    }));
    for (let i = ms.length; i < c.size; i++) ms.push({ name: "", empty: true });
    const potV = c.phase === 0 ? c.share * BigInt(c.members.length) : c.phase === 1 && rd ? rd.collected : 0n;
    const label = c.phase === 0 ? `pledged · ${c.members.length} of ${c.size}` : c.phase === 1 ? `round ${c.round} of ${c.size}` : PHASES[c.phase].toLowerCase();
    ring.set({ pot: `${fmt(potV)}<small style="font-size:.5em;opacity:.8"> tUSD8</small>`, label, members: ms, potGlow: Boolean(rd?.closed && !rd.released), progress });
  }

  function render() {
    if (!c) return;
    const me = meOf(c);
    const rd = c.rd;
    const phase = PHASES[c.phase];
    document.title = `${c.name} · Biu Wui 標會`;
    $("#c-head")!.innerHTML = `
      <div class="c-title"><span class="phase p${c.phase}">${phase}</span><h1>${esc(c.name)}</h1>
        <p class="muted">${fmt(c.share)} tUSD8 a round · ${c.size} seats · pot ${fmt(c.chit)} tUSD8 · ${c.phase === 1 ? `round ${c.round} of ${c.size}` : `${c.members.length} joined`}</p></div>
      <div class="c-head-btns"><button class="btn-glass" data-a="share">Share link</button><a class="btn-glass" href="${addrLink(c.address)}" target="_blank" rel="noopener">Explorer ↗</a></div>`;

    // banners: every pending payee change, loudly; practice bots; read-only
    const b: string[] = [];
    for (const m of c.members.filter((x) => x.pending)) {
      const mine = same(m.address, wallet?.address);
      const left = Number(m.pending!.effectiveAt) - now();
      b.push(`<div class="banner warn"><span class="b-ic cjk">!</span><div><b>${mine ? "Your" : `${esc(m.payeeName)}'s`} payee is changing</b> to “${esc(m.pending!.name)}” · ${short(m.pending!.payout)} ${left > 0 ? `in ${clock(left)}` : "(ready to take effect)"}.
        ${mine ? "If you didn't ask for this, cancel it now." : "If this looks wrong, tell them: they can cancel it with one signature."}</div>${mine ? `<button class="btn-ink" data-a="cancelPayee">Cancel it</button>` : ""}</div>`);
    }
    if (c.practice && c.phase === 0) b.push(`<div class="banner"><span class="b-ic">🤖</span><div><b>Ah Ming and Kitty are friendly bots.</b> They take the other seats within about 30 seconds, then pay, bid now and then, and approve, so you can play full rounds.</div></div>`);
    else if (c.practice && c.phase === 1) b.push(`<div class="banner"><span class="b-ic">🤖</span><div>Practice circle: <b>Ah Ming and Kitty are friendly bots.</b> Our secretary bot also closes and releases rounds on time. Try bidding to win the pot early.</div></div>`);
    if (!wallet) b.push(`<div class="banner"><span class="b-ic cjk">印</span><div>You're viewing this circle. <b>Choose a wallet</b> to join or act (no gas needed).</div><button class="btn-red" data-a="wallet">Choose</button></div>`);
    $("#c-banners")!.innerHTML = b.join("");

    // your moves
    const moves: string[] = [];
    const t = now();
    const btn = (a: string, label: string, sub: string, cls = "btn-red") => `<button class="move ${cls}" data-a="${a}"><span>${label}</span><small>${sub}</small></button>`;
    let headline = "";
    if (c.phase === 0) {
      if (me) {
        headline = `You're in. Waiting for ${c.size - c.members.length} more to join.`;
        moves.push(btn("leave", "Leave and get my pledge back", "Only before the circle is full", "btn-glass"));
      } else if (t <= Number(c.joinBy) && c.members.length < c.size) {
        headline = "Join this circle";
        moves.push(btn("join", `Join with a ${fmt(c.share)} pledge`, "Refunded if the circle doesn't fill"));
      } else headline = "Joining is closed.";
      if (t > Number(c.joinBy)) moves.push(btn("cancelUnfilled", "Cancel the unfilled circle", "Anyone can · every pledge comes back", "btn-ink"));
    } else if (c.phase === 1 && rd) {
      const open = !rd.closed && t <= Number(rd.bidEnd);
      if (open) {
        if (me && !me.paid) moves.push(btn("pay", `Pay this round · ${fmt(c.share)}`, "One signature, no gas"));
        if (me && me.paid && !me.won) moves.push(btn("bid", "Bid a discount", rd.bestDiscount > 0n ? `Best so far ${fmt(rd.bestDiscount)}` : "No bids yet"));
        headline = me ? (me.paid ? (me.won ? "You've paid. You already won a pot, so you can't bid." : "You've paid. Bid if you want the pot now.") : "Pay your share for this round.") : "Bidding is open.";
      } else if (!rd.closed) {
        headline = "Bidding is over.";
        moves.push(btn("close", "Close the auction", "Anyone can · the highest bid wins", "btn-ink"));
      } else if (!rd.released) {
        const payee = payeeAtClose(c);
        headline = `Round ${c.round}: pot goes to ${esc(payee)} · ${short(rd.payTo)}, fixed at close.`;
        if (me && !me.approved) moves.push(btn("approve", "Approve release", `Pot goes to ${esc(payee)} · ${short(rd.payTo)}`));
        if (rd.approvals >= c.quorumNeeded) moves.push(btn("release", "Release the pot", `${rd.approvals} of ${c.quorumNeeded} approved · anyone can`, "btn-ink"));
        else if (me?.approved) headline += ` You approved; ${c.quorumNeeded - rd.approvals} more needed.`;
      }
      if (c.stalled) moves.push(btn("dissolve", "Dissolve the stalled circle", "Anyone can · what's left goes back pro rata", "btn-ink"));
      if (me) {
        moves.push(me.order.active
          ? btn("revoke", "Revoke standing order", `${me.order.used} of ${me.order.maxRounds} rounds used`, "btn-glass")
          : btn("order", "Set a standing order", "Never miss a round · capped, revocable", "btn-glass"));
      }
    } else {
      headline = c.phase === 2 ? "This circle is completed." : c.phase === 3 ? "This circle was dissolved." : "This circle was cancelled.";
    }
    if (me && c.phase <= 1) moves.push(me.pending ? btn("cancelPayee", "Cancel pending payee change", `Waiting: ${esc(me.pending.name)}`, "btn-glass") : btn("payee", "Change payee", `Waits ${act.dur(c.payeeDelay)}, visible to all`, "btn-glass"));
    if (me && me.withdrawable > 0n) moves.unshift(btn("withdraw", `Withdraw ${fmt(me.withdrawable)} tUSD8`, `To your payee ${esc(me.payeeName)}`));
    if (!me && c.phase === 1) headline = headline || "You're not a member of this circle.";
    $("#c-moves")!.innerHTML = `<p class="kicker red">${me ? "Your move" : "This round"}</p><h2>${headline || "Nothing to do right now."}</h2><div class="move-list">${moves.join("")}</div>`;

    // facts
    const f: [string, string][] = [];
    if (rd && c.phase === 1) {
      f.push(["Collected this round", `${fmt(rd.collected)} tUSD8 · ${c.members.filter((m) => m.paid).length} of ${c.size} paid`]);
      f.push(["Best bid", rd.bestDiscount > 0n ? `${fmt(rd.bestDiscount)} by ${nameOf(rd.bestBidder)}` : "none yet"]);
      if (rd.closed) {
        f.push(["Winner", `${nameOf(rd.winner)} at ${fmt(rd.discount)} discount`]);
        f.push(["Approvals", `${rd.approvals} of ${c.quorumNeeded} needed`]);
        if (c.quote) f.push(["Release pays", `${fmt(c.quote.payout)} now · ${fmt(c.quote.securityHeld)} held · ${fmt(c.quote.dividend)} dividend`]);
      }
    }
    f.push(["Max discount · fee", `${c.maxDiscountBps / 100}% · ${c.feeBps / 100}%`]);
    f.push(["Bidding per round · grace", `${act.dur(c.roundLength)} · ${act.dur(c.graceLength)}`]);
    f.push(["Payee-change delay", act.dur(c.payeeDelay)]);
    f.push(["Organiser", `${short(c.organiser)}${same(c.organiser, wallet?.address) ? " (you)" : ""}`]);
    $("#c-facts")!.innerHTML = `<dl class="rows">${f.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;

    // members
    $("#c-mcount")!.textContent = `${c.members.length} of ${c.size}`;
    $("#c-members")!.innerHTML = c.members.length
      ? c.members.map((m) => {
          const tags = [
            c!.phase <= 1 && m.paid ? `<span class="tag gold">paid</span>` : "",
            m.won ? `<span class="tag red">won</span>` : "",
            m.order.active ? `<span class="tag">standing order ${m.order.used}/${m.order.maxRounds}</span>` : "",
            isBot(m) ? `<span class="tag soft">bot</span>` : "",
            m.pending ? `<span class="tag warn">payee changing</span>` : "",
          ].join("");
          const mine = same(m.address, wallet?.address);
          const payout = m.withdrawable > 0n && !mine ? `<button class="link" data-a="withdrawFor" data-m="${m.address}">pay out ${fmt(m.withdrawable)}</button>` : "";
          return `<li><span class="pav ${mine ? "me" : isBot(m) ? "bot" : ""}">${mine ? "You" : esc([...m.payeeName][0] ?? "?")}</span>
            <span class="pname">${esc(m.payeeName)}${mine ? " <em>you</em>" : ""}<small>payee ${short(m.payee)}${same(m.payee, m.address) ? "" : ` · member ${short(m.address)}`}</small><span class="tags">${tags}</span></span>${payout}</li>`;
        }).join("")
      : `<li class="empty">Nobody yet.</li>`;
    tick();
    renderFeed();
  }

  function payeeAtClose(cc: Circle) {
    const rd = cc.rd!;
    const w = cc.members.find((m) => same(m.address, rd.winner));
    if (w && same(w.payee, rd.payTo)) return w.payeeName;
    // the payee changed after close: find the name it had then
    const ev = [...evs].reverse().find((e) => (e.name === "PayeeChanged" || e.name === "Joined") && same(String(e.args.member), rd.winner) && same(String(e.args.payout), rd.payTo));
    return ev ? String(ev.args.payeeName) : `${w?.payeeName ?? "winner"}'s payee at close`;
  }

  screen.onclick = async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
    if (!el || !c) return;
    const a = el.dataset.a!;
    if (a === "share") {
      const url = `${location.origin}/app#circle=${c.address}`;
      if (navigator.share) navigator.share({ title: c.name, text: `Join my Biu Wui circle “${c.name}”`, url }).catch(() => {});
      else { await navigator.clipboard?.writeText(url); toast("Link copied"); }
      return;
    }
    if (a === "wallet") return chooseWallet(() => { route(); });
    const anyoneCan: Record<string, () => void> = {
      close: () => act.anyone(c!, refresh, { title: "Close the auction", lead: "Bidding is over. Closing applies the fixed rules: the highest bid wins (or, with no bids, the earliest-joined member who hasn't won). The winner's payee is fixed now.", fn: "closeAuction" }),
      release: () => act.anyone(c!, refresh, { title: "Release the pot", lead: `Enough members approved. The pot goes to <b>${esc(payeeAtClose(c!))}</b> · ${short(c!.rd!.payTo)}; the dividend is shared by all.`, fn: "release" }),
      cancelUnfilled: () => act.anyone(c!, refresh, { title: "Cancel the unfilled circle", lead: "The joining deadline passed without enough members. Cancelling lets every member withdraw their pledge in full.", fn: "cancelUnfilled" }),
      dissolve: () => act.anyone(c!, refresh, { title: "Dissolve the stalled circle", lead: "The round stalled past its grace period. Everything left (except dividends already earned) goes back in proportion to what each member put in minus took out.", fn: "dissolve" }),
      withdraw: () => act.anyone(c!, refresh, { title: "Withdraw to your payee", lead: `Pays out your dividends, security or refund (${fmt(meOf(c!)!.withdrawable)} tUSD8) to your payee. Money can only go there.`, fn: "withdrawFor", args: [wallet!.address] }),
      withdrawFor: () => act.anyone(c!, refresh, { title: "Pay out to this member's payee", lead: "Anyone can trigger it; the money only goes to that member's own locked payee.", fn: "withdrawFor", args: [el.dataset.m] }),
    };
    if (anyoneCan[a]) return anyoneCan[a]();
    if (!wallet) return chooseWallet(() => route());
    const w = wallet;
    const m: Record<string, () => void> = {
      join: () => act.join(c!, w, refresh),
      pay: () => act.pay(c!, w, refresh),
      bid: () => act.bid(c!, w, refresh),
      approve: () => act.approve(c!, w, refresh, payeeAtClose(c!)),
      order: () => act.standingOrder(c!, w, refresh),
      revoke: () => act.revokeOrder(c!, w, refresh),
      payee: () => act.changePayee(c!, w, refresh),
      cancelPayee: () => act.cancelPayee(c!, w, refresh),
      leave: () => act.leave(c!, w, refresh),
    };
    m[a]?.();
  };

  load();
  loadEvents();
  const t1 = setInterval(() => !document.hidden && load(), 5000);
  const t2 = setInterval(() => !document.hidden && loadEvents(), 12000);
  const t3 = setInterval(tick, 1000);
  view = { stop: () => { stopped = true; clearInterval(t1); clearInterval(t2); clearInterval(t3); } };
}

// ---------------------------------------------------------------- router

function route() {
  view?.stop();
  view = null;
  screen.onclick = null;
  scrollTo({ top: 0 });
  const h = location.hash.slice(1);
  const circle = h.match(/circle=(0x[0-9a-fA-F]{40})/)?.[1] as Address | undefined;
  document.body.dataset.screen = circle ? "circle" : h === "open" ? "open" : wallet ? "home" : "welcome";
  document.title = "Biu Wui 標會 · app";
  if (circle) return circleView(circle);
  if (h === "open") return openForm();
  if (h === "demo") return circleView(DEMO_CIRCLE);
  return wallet ? home() : welcome();
}

async function boot() {
  hydrateChops();
  $("#wallet-pill")!.addEventListener("click", walletSheet);
  wallet = await restoreWallet();
  renderTopbar();
  route();
  refreshBalance();
  addEventListener("hashchange", route);
  onInjectedChange(async () => { wallet = await restoreWallet(); refreshBalance(); route(); });
  setInterval(() => !document.hidden && refreshBalance(), 20000);
  if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    navigator.serviceWorker.register("/sw.js", { scope: "/app" }).catch(() => {});
  }
}
boot();

