// The chop (hanko / 印章): a vermilion seal. Every signature a member makes is shown as one.
// Characters are cut white into the red (白文), with a rough, inked edge from one shared SVG filter.

let defsAdded = false;

/** Add the shared ink filter to the page once. */
export function ensureChopDefs() {
  if (defsAdded || typeof document === "undefined") return;
  defsAdded = true;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.innerHTML = `<defs><filter id="chop-rough" x="-6%" y="-6%" width="112%" height="112%">
    <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feTurbulence type="fractalNoise" baseFrequency="1.9" numOctaves="1" seed="3" result="s"/>
    <feColorMatrix in="s" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -16 12.4" result="m"/>
    <feComposite in="d" in2="m" operator="in"/>
  </filter></defs>`;
  document.body.prepend(svg);
}

/** SVG markup for a seal with one or two characters (two are stacked, read top to bottom). */
export function chopSvg(chars: string, cls = "") {
  ensureChopDefs();
  const cs = [...chars].slice(0, 2);
  if (cs.length === 1) {
    return `<svg class="chop ${cls}" viewBox="0 0 64 64" aria-hidden="true"><g filter="url(#chop-rough)">
      <rect class="ink" x="2" y="2" width="60" height="60" rx="9"/>
      <rect class="rim" x="7" y="7" width="50" height="50" rx="5" stroke-width="2.2"/>
      <text class="cut" x="32" y="33" font-size="36" text-anchor="middle" dominant-baseline="central">${cs[0]}</text></g></svg>`;
  }
  return `<svg class="chop ${cls}" viewBox="0 0 64 104" aria-hidden="true"><g filter="url(#chop-rough)">
    <rect class="ink" x="2" y="2" width="60" height="100" rx="9"/>
    <rect class="rim" x="7" y="7" width="50" height="90" rx="5" stroke-width="2.2"/>
    <text class="cut" x="32" y="31" font-size="35" text-anchor="middle" dominant-baseline="central">${cs[0]}</text>
    <text class="cut" x="32" y="74" font-size="35" text-anchor="middle" dominant-baseline="central">${cs[1]}</text></g></svg>`;
}

/** Replace every `[data-chop="標會"]` placeholder with its seal. */
export function hydrateChops(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-chop]").forEach((el) => {
    el.innerHTML = chopSvg(el.dataset.chop || "簽");
  });
}

/** The seal for each signed action (two characters, the way a Hong Kong office would stamp it). */
export const CHOP_FOR: Record<string, string> = {
  open: "開會", // open the circle
  join: "入會", // join
  pay: "已付", // paid
  bid: "出標", // bid
  approve: "批准", // approve
  order: "月供", // standing order (monthly instalment)
  permit: "授權", // permit
  revoke: "取消", // cancel
  payee: "收款", // payee
  cancelPayee: "取消",
  leave: "退會", // leave
};
