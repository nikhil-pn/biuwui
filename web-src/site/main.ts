// The site: nav, the signing phone in the hero, the round explainer, live stats and the proof tables.
import type { Address } from "viem";
import { chopSvg, hydrateChops, CHOP_FOR } from "../lib/chop";
import { mountFlowDemo } from "../lib/ring";
import { allCircles, circleAbi, esc, fmt, publicClient, short, txLink } from "../lib/chain";

hydrateChops();
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- nav
{
  const btn = $(".nav-menu");
  const sheet = $("#nav-sheet");
  btn?.addEventListener("click", () => {
    const open = sheet!.hidden;
    sheet!.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheet && !sheet.hidden) {
      sheet.hidden = true;
      btn?.setAttribute("aria-expanded", "false");
    }
  });
  const path = location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  document.querySelectorAll<HTMLAnchorElement>(".nav-links a, .nav-sheet a").forEach((a) => {
    if (a.getAttribute("href") === path) a.setAttribute("aria-current", "page");
  });
}

// Phones: hide the sticky "Try it" while another try button is on screen.
{
  const sticky = $(".sticky-try");
  const others = [...document.querySelectorAll<HTMLElement>(".cta .btn-red, .cta-band .btn-red, .foot")];
  if (sticky && others.length && "IntersectionObserver" in window) {
    const seen = new Set<Element>();
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)));
      sticky.classList.toggle("away", seen.size > 0);
    });
    others.forEach((o) => io.observe(o));
  }
}

// ---------------------------------------------------------------- hero: the moment a member signs
{
  const pad = $("#ph-pad");
  if (pad) {
    const scenes = [
      { chop: CHOP_FOR.join, title: "Join with a 0.5 tUSD8 pledge", std: "EIP-3009 authorisation", note: "Joining is a pledge: refunded if the circle doesn't fill." },
      { chop: CHOP_FOR.bid, title: "Bid a 0.10 tUSD8 discount for round 1", std: "EIP-712 Bid", note: "The highest discount wins the pot; everyone shares it." },
      { chop: CHOP_FOR.approve, title: "Approve the release to Kitty's payee", std: "EIP-712 ApproveRelease", note: "You see the payee's name and address before you sign." },
      { chop: CHOP_FOR.order, title: "Standing order: 1 share a round, 2 rounds", std: "EIP-712 + EIP-2612 permit", note: "Capped, expiring, revocable with one more chop." },
    ];
    const steps = [...document.querySelectorAll<HTMLElement>("#ph-steps li")];
    const note = $("#device-note");
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const play = () => {
      timers.splice(0).forEach(clearTimeout);
      const s = scenes[i % scenes.length];
      $("#ph-title")!.textContent = s.title;
      $("#ph-std")!.textContent = s.std;
      pad.innerHTML = chopSvg(s.chop);
      pad.classList.remove("press");
      steps.forEach((li) => li.classList.remove("done"));
      if (note && i > 0) note.textContent = s.note;
      void pad.offsetWidth;
      const wait = reduced ? 0 : 1;
      timers.push(setTimeout(() => { pad.classList.add("press"); steps[0].classList.add("done"); }, 700 * wait));
      timers.push(setTimeout(() => steps[1].classList.add("done"), 1500 * wait));
      timers.push(setTimeout(() => steps[2].classList.add("done"), 2400 * wait));
      i++;
      if (!reduced) timers.push(setTimeout(play, 5200));
    };
    play();
  }
}

// ---------------------------------------------------------------- the round explainer
{
  const ringEl = $("#flow-ring");
  if (ringEl) {
    const items = [...document.querySelectorAll<HTMLElement>("#flow-steps li")];
    mountFlowDemo(ringEl, $("#flow-caption"), $("#flow-dots"), (i) => items.forEach((li, k) => li.classList.toggle("now", k === i)));
  }
}

// ---------------------------------------------------------------- live block number
{
  const els = [...document.querySelectorAll<HTMLElement>("[data-live-block]")];
  if (els.length) {
    const tick = async () => {
      try {
        const n = await publicClient.getBlockNumber({ cacheTime: 0 });
        els.forEach((e) => (e.textContent = `#${n.toLocaleString("en-US")}`));
      } catch {
        /* keep the last value */
      }
    };
    tick();
    setInterval(tick, 6000);
  }
}

// ---------------------------------------------------------------- live stats (three cheap multicalls)
if ($("#st-circles")) {
  (async () => {
    try {
      const circles = (await allCircles()).map((c) => c.circle);
      $("#st-circles")!.textContent = String(circles.length);
      const ms = await publicClient.multicall({
        contracts: circles.map((c) => ({ address: c, abi: circleAbi, functionName: "members" }) as const),
        allowFailure: true,
      });
      const pairs: { c: Address; m: Address }[] = [];
      ms.forEach((r, i) => r.status === "success" && (r.result as readonly Address[]).forEach((m) => pairs.push({ c: circles[i], m })));
      $("#st-members")!.textContent = String(pairs.length);
      const paid = await publicClient.multicall({
        contracts: pairs.map((p) => ({ address: p.c, abi: circleAbi, functionName: "paidIn", args: [p.m] }) as const),
        allowFailure: true,
      });
      const total = paid.reduce((s, r) => s + (r.status === "success" ? (r.result as bigint) : 0n), 0n);
      $("#st-volume")!.innerHTML = `${fmt(total)} <small>tUSD8</small>`;
    } catch {
      ["#st-circles", "#st-members", "#st-volume"].forEach((s) => $(s) && $(s)!.textContent === "–" && ($(s)!.textContent = "offline"));
    }
  })();
}

// ---------------------------------------------------------------- proof data (copied from docs/proof at build time)
type Proof = { chainId: number; circle: Address; ranAt: string; steps: { step: string; tx: `0x${string}`; url: string }[] };

async function proofs(): Promise<Proof[]> {
  const r = await fetch("/data/proof.json");
  return r.ok ? r.json() : [];
}

/** Rows grouped by round, with a separator row when the round changes. */
function stepRows(p: Proof, withTx: boolean) {
  let last = "";
  return p.steps
    .map((s, i) => {
      const m = s.step.match(/^Round (\d+)/);
      const group = m
        ? `Round ${m[1]}`
        : s.step.startsWith("Pay out")
          ? "Completed: pay-outs"
          : i < 4
            ? "Set-up: fund members, open the circle"
            : last.startsWith("Round")
              ? last
              : "Joining: signed pledges";
      const sep = group !== last ? `<tr class="round-sep"><td colspan="${withTx ? 3 : 2}">${esc(group)}</td></tr>` : "";
      last = group;
      const t = s.step.replace(/^Round \d+: /, "");
      const text = esc(t[0].toUpperCase() + t.slice(1));
      return `${sep}<tr><td class="n">${i + 1}</td><td>${text}</td>${withTx ? `<td class="mono tx"><a href="${txLink(s.tx)}" target="_blank" rel="noopener">${short(s.tx)} ↗</a></td>` : ""}</tr>`;
    })
    .join("");
}

{
  const el = $("#proof-steps");
  if (el) {
    proofs().then((ps) => {
      const p = ps[0];
      if (!p) return;
      $("#proof-circle")!.innerHTML = `<a href="https://explorer-test.qday.info/address/${p.circle}" target="_blank" rel="noopener"><code>${p.circle}</code> ↗</a>`;
      $("#proof-when")!.textContent = new Date(p.ranAt).toUTCString().replace(" GMT", " UTC");
      el.innerHTML = stepRows(p, true);
    });
  }
  const how = $("#how-steps");
  if (how) proofs().then((ps) => ps[0] && (how.innerHTML = stepRows(ps[0], true)));
}
