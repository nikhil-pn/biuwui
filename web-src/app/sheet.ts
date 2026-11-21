// Sheets: a bottom sheet on phones, a centred card on desktop. The action sheet walks a member through
// signing (a red chop lands on the paper) → sent by the relayer (tx link) → confirmed on Aevum.
import type { Hex, TransactionReceipt } from "viem";
import { chopSvg } from "../lib/chop";
import { esc, publicClient, txLink } from "../lib/chain";
import { explain, Friendly } from "./api";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function openSheet(inner: string, onClose?: () => void) {
  const root = document.createElement("div");
  root.className = "sheet-root";
  root.innerHTML = `<div class="sheet-backdrop"></div>
    <section class="sheet glass strong" role="dialog" aria-modal="true">
      <div class="sheet-grab"></div>
      <div class="sheet-top"><button class="sheet-x" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="sheet-body">${inner}</div>
    </section>`;
  document.body.append(root);
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => root.classList.add("open"));
  const prevFocus = document.activeElement as HTMLElement | null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.classList.add("closing");
    removeEventListener("keydown", onKey);
    setTimeout(() => {
      root.remove();
      if (!document.querySelector(".sheet-root")) document.body.classList.remove("sheet-open");
      prevFocus?.focus?.();
    }, reduced() ? 0 : 260);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  addEventListener("keydown", onKey);
  root.querySelector(".sheet-backdrop")!.addEventListener("click", close);
  root.querySelector(".sheet-x")!.addEventListener("click", close);
  const body = root.querySelector<HTMLElement>(".sheet-body")!;
  setTimeout(() => (body.querySelector<HTMLElement>("input,button.btn-red") ?? root.querySelector<HTMLElement>(".sheet-x"))?.focus(), 60);
  return { root, body, close };
}

type Line = { el: HTMLElement; done(text?: string): void; fail(text?: string): void; html(h: string): void };

export type Ctx = {
  line(text: string): Line;
  /** Ask the wallet to sign; the chop lands when the signature comes back. */
  sign<T>(what: string, chop: string, f: () => Promise<T>): Promise<T>;
  /** Send through the relayer and wait for Aevum to confirm. */
  submit(what: string, f: () => Promise<{ hash: Hex }>): Promise<TransactionReceipt>;
  note(html: string): void;
};

export type Action = {
  title: string;
  lead?: string;
  rows?: [string, string][];
  form?: string;
  chops?: string[]; // seals waiting on the pad, faint, before signing
  confirm: string;
  gasless?: boolean; // false for anyone-can-call actions: no chop, just submit
  validate?: (form: HTMLFormElement) => string | null;
  run: (ctx: Ctx, form: HTMLFormElement) => Promise<void>;
  after?: () => void;
  doneLabel?: string;
  onDone?: () => void;
};

export function runAction(a: Action) {
  const signed = a.gasless !== false;
  const rows = a.rows?.length
    ? `<dl class="rows glass">${a.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`
    : "";
  const pad = signed
    ? `<div class="pad" aria-hidden="true">${(a.chops ?? ["簽名"]).map((c) => `<div class="stamp-pad waiting">${chopSvg(c)}</div>`).join("")}</div>`
    : "";
  const sheet = openSheet(`
    <form class="tx" novalidate>
      <h2>${esc(a.title)}</h2>
      ${a.lead ? `<p class="lead">${a.lead}</p>` : ""}
      ${rows}
      ${a.form ? `<div class="fields">${a.form}</div>` : ""}
      ${pad}
      <ol class="progress" aria-live="polite"></ol>
      <p class="err" role="alert" hidden></p>
      <div class="tx-actions">
        <button class="btn-red block-btn go" type="submit">${esc(a.confirm)}</button>
        ${signed ? `<p class="fine center">${signed ? "A signature, not a transaction. The relayer pays the gas." : ""}</p>` : ""}
      </div>
    </form>`);
  const form = sheet.body.querySelector<HTMLFormElement>("form")!;
  const go = form.querySelector<HTMLButtonElement>(".go")!;
  const progress = form.querySelector<HTMLElement>(".progress")!;
  const err = form.querySelector<HTMLElement>(".err")!;
  const pads = [...form.querySelectorAll<HTMLElement>(".stamp-pad")];
  let padIdx = 0;
  let busy = false;
  let finished = false;

  const line = (text: string): Line => {
    const li = document.createElement("li");
    li.className = "busy";
    li.innerHTML = `<span class="tick"></span><span class="t">${esc(text)}</span>`;
    progress.append(li);
    return {
      el: li,
      done: (t) => { li.className = "done"; if (t) li.querySelector(".t")!.innerHTML = t; },
      fail: (t) => { li.className = "failed"; if (t) li.querySelector(".t")!.textContent = t; },
      html: (h) => { li.querySelector(".t")!.innerHTML = h; },
    };
  };

  const ctx: Ctx = {
    line,
    note: (h) => { const p = document.createElement("li"); p.className = "note"; p.innerHTML = h; progress.append(p); },
    async sign(what, chop, f) {
      const l = line(`Sign in your wallet: ${what}`);
      let p = pads[padIdx];
      if (!p) {
        p = document.createElement("div");
        p.className = "stamp-pad waiting";
        form.querySelector(".pad")?.append(p);
        pads.push(p);
      }
      p.innerHTML = chopSvg(chop);
      p.classList.add("asking");
      try {
        const out = await f();
        p.classList.remove("waiting", "asking");
        void p.offsetWidth;
        p.classList.add("press");
        navigator.vibrate?.(18);
        padIdx++;
        l.done(`Signed: ${esc(what)}`);
        return out;
      } catch (e) {
        p.classList.remove("asking");
        l.fail();
        throw e;
      }
    },
    async submit(what, f) {
      const l = line(`Sending: ${what}`);
      let hash: Hex;
      try {
        ({ hash } = await f());
      } catch (e) {
        l.fail();
        throw e;
      }
      l.done(`Sent by the relayer · <a href="${txLink(hash)}" target="_blank" rel="noopener">view tx ↗</a>`);
      const c = line("Confirming on Aevum…");
      const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1500 });
      if (rc.status !== "success") {
        c.fail("The transaction reverted on chain.");
        throw new Friendly("The transaction reverted on chain. Nothing changed; please refresh and try again.");
      }
      c.done(`Confirmed in block #${rc.blockNumber.toLocaleString("en-US")}`);
      return rc;
    },
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (finished) {
      sheet.close();
      a.onDone?.();
      return;
    }
    if (busy) return;
    const bad = a.validate?.(form);
    if (bad) {
      err.textContent = bad;
      err.hidden = false;
      return;
    }
    err.hidden = true;
    busy = true;
    go.disabled = true;
    go.innerHTML = `<span class="spinner light"></span> Working…`;
    form.querySelectorAll<HTMLInputElement>(".fields input, .fields select").forEach((i) => (i.disabled = true));
    try {
      await a.run(ctx, form);
      finished = true;
      go.disabled = false;
      go.textContent = a.doneLabel ?? "Done";
      a.after?.();
    } catch (x) {
      err.textContent = explain(x);
      err.hidden = false;
      go.disabled = false;
      go.textContent = "Try again";
      form.querySelectorAll<HTMLInputElement>(".fields input, .fields select").forEach((i) => (i.disabled = false));
      progress.querySelectorAll("li.busy").forEach((li) => (li.className = "failed"));
    } finally {
      busy = false;
    }
  });
  return sheet;
}

/** A short message at the bottom of the screen. */
export function toast(text: string) {
  const t = document.createElement("div");
  t.className = "toast glass strong";
  t.setAttribute("role", "status");
  t.textContent = text;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, 2600);
}
