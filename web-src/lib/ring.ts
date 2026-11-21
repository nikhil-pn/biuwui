// The circle drawn as it is: the pot (a red packet) in the middle, members around it, gold coins
// moving between them. Used live in the app and as a looping explainer on the site.
import { esc } from "./chain";

export type RingMember = {
  name: string;
  me?: boolean;
  bot?: boolean;
  empty?: boolean;
  paid?: boolean;
  won?: boolean;
  winner?: boolean;
  approved?: boolean;
  bid?: string | null;
};
export type RingState = { pot: string; label?: string; potGlow?: boolean; members: RingMember[]; progress?: number | null };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createRing(el: HTMLElement) {
  el.classList.add("ring");
  el.innerHTML = `
    <svg class="ring-orbit" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38"/>
      <circle class="arc" cx="50" cy="50" r="38" transform="rotate(-90 50 50)" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"/></svg>
    <div class="ring-pot"><span class="ring-amount num"></span><span class="ring-label"></span></div>
    <div class="ring-members"></div>`;
  const pot = el.querySelector<HTMLElement>(".ring-pot")!;
  const arc = el.querySelector<SVGCircleElement>(".arc")!;
  const membersEl = el.querySelector<HTMLElement>(".ring-members")!;
  let n = 0;

  const pos = (i: number) => {
    const a = (-90 + (360 / Math.max(n, 1)) * i) * (Math.PI / 180);
    return { x: 50 + 38 * Math.cos(a), y: 50 + 38 * Math.sin(a) };
  };

  function set(state: RingState) {
    el.querySelector(".ring-amount")!.innerHTML = state.pot;
    el.querySelector(".ring-label")!.textContent = state.label ?? "";
    pot.classList.toggle("glow", Boolean(state.potGlow));
    // the vermilion arc: how much of the bidding time has gone
    arc.setAttribute("stroke-dashoffset", String(state.progress == null ? 100 : 100 - Math.max(0, Math.min(1, state.progress)) * 100));
    if (state.members.length !== n) {
      n = state.members.length;
      membersEl.innerHTML = state.members
        .map((_, i) => {
          const p = pos(i);
          return `<div class="ring-m" style="left:${p.x}%;top:${p.y}%"><span class="ring-av"></span><span class="ring-name"></span><span class="ring-badge"></span></div>`;
        })
        .join("");
    }
    state.members.forEach((m, i) => {
      const node = membersEl.children[i] as HTMLElement;
      node.className =
        "ring-m" + (m.me ? " me" : "") + (m.bot ? " bot" : "") + (m.empty ? " empty" : "") + (m.paid ? " paid" : "") +
        (m.won ? " won" : "") + (m.winner ? " winner" : "") + (m.approved ? " approved" : "");
      node.querySelector(".ring-av")!.textContent = m.empty ? "+" : m.me ? "You" : [...(m.name || "?")][0].toUpperCase();
      node.querySelector(".ring-name")!.innerHTML = esc(m.empty ? "open seat" : m.me ? "You" : m.name);
      const badge = node.querySelector<HTMLElement>(".ring-badge")!;
      badge.textContent = m.bid ? m.bid : m.winner ? "★" : m.approved ? "✓" : "";
      badge.className = "ring-badge" + (m.bid ? " bid" : m.winner ? " star" : m.approved ? " tick" : "");
    });
  }

  /** Fly `count` gold coins from a member (index) or "pot" to another. */
  function coin(from: number | "pot", to: number | "pot", count = 1) {
    if (reduced()) return;
    const at = (w: number | "pot") => (w === "pot" ? { x: 50, y: 50 } : pos(w));
    const a = at(from);
    const b = at(to);
    for (let k = 0; k < count; k++) {
      const c = document.createElement("span");
      c.className = "ring-coin";
      el.append(c);
      c.animate(
        [
          { left: `${a.x}%`, top: `${a.y}%`, opacity: 0, transform: "translate(-50%,-50%) scale(.6)" },
          { opacity: 1, offset: 0.15 },
          { left: `${b.x}%`, top: `${b.y}%`, opacity: 0.9, transform: "translate(-50%,-50%) scale(1)" },
        ],
        { duration: 750, delay: k * 120, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" },
      ).onfinish = () => c.remove();
    }
  }

  return { set, coin };
}

const DEMO = ["Ah Ming", "Kitty", "Wing", "Mei"];
export const FLOW_STEPS = [
  { t: "Pay", label: "into the pot", caption: "Everyone pays the same share: 4 × 10 tUSD8. Each payment is a signature, so nobody needs gas." },
  { t: "Bid", label: "bidding open", caption: "Kitty needs the money now and bids a 4 tUSD8 discount. Wing bids 2. The highest discount wins." },
  { t: "Close", label: "Kitty wins", caption: "Bidding ends and anyone closes the auction. Kitty wins, and her payee (a name and an address) is fixed now." },
  { t: "Approve", label: "3 of 4 approve", caption: "More than half of the members approve the release, each with one signed chop." },
  { t: "Release", label: "paid out", caption: "Kitty's payee gets the pot minus her discount (part is held as security for her later shares). The discount, less a small organiser fee, goes back to everyone as a dividend: a little 利是." },
];

/** The five-step explainer, looping. Optional `dotsEl` gets clickable step pills. */
export function mountFlowDemo(el: HTMLElement, captionEl?: HTMLElement | null, dotsEl?: HTMLElement | null, onStep?: (i: number) => void) {
  const ring = createRing(el);
  let step = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const base = (): RingMember[] => DEMO.map((name) => ({ name }));

  function show(i: number, auto = true) {
    step = i;
    const m = base();
    m.forEach((x) => (x.paid = true));
    let pot = "40";
    if (i === 1) { m[1].bid = "−4"; m[2].bid = "−2"; }
    if (i >= 2) { m[1].winner = true; }
    if (i >= 3) { m[0].approved = true; m[2].approved = true; m[3].approved = true; }
    if (i >= 4) pot = "0";
    ring.set({ pot: `${pot}<small style="font-size:.5em;opacity:.8"> tUSD8</small>`, label: FLOW_STEPS[i].label, members: m, potGlow: i === 0, progress: i === 1 ? 0.7 : i === 0 ? 0.2 : 1 });
    if (i === 0) [0, 1, 2, 3].forEach((k) => setTimeout(() => ring.coin(k, "pot"), k * 280));
    if (i === 4) {
      ring.coin("pot", 1, 3);
      setTimeout(() => [0, 1, 2, 3].forEach((k) => ring.coin("pot", k)), 900);
    }
    if (captionEl) captionEl.textContent = FLOW_STEPS[i].caption;
    if (dotsEl) [...dotsEl.children].forEach((d, k) => d.classList.toggle("on", k === i));
    onStep?.(i);
    clearTimeout(timer);
    if (auto && !reduced()) timer = setTimeout(() => show((step + 1) % FLOW_STEPS.length), i === 4 ? 5200 : 3800);
  }

  if (dotsEl) {
    dotsEl.innerHTML = FLOW_STEPS.map((s, i) => `<button type="button" class="flow-dot" data-i="${i}">${i + 1}. ${s.t}</button>`).join("");
    dotsEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (b) show(Number(b.dataset.i), false);
    });
  }
  show(0);
  return { show, stop: () => clearTimeout(timer) };
}
