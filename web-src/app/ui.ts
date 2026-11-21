/**
 * App building blocks: glass sheets (bottom sheet on phones, centred dialog on desktop), toasts,
 * and the wallet-style "confirm, then watch it happen" flow every on-chain action goes through.
 */

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------------------------------------------------------------- sheets

export interface Sheet {
  el: HTMLElement;
  body: HTMLElement;
  close(): void;
  /** Replace the content, optionally with a back button to `back`. */
  show(html: string, back?: () => void): void;
}

let openSheets = 0;

export function openSheet(html: string, opts: { onClose?: () => void; wide?: boolean } = {}): Sheet {
  const root = document.createElement("div");
  root.className = "sheet-root";
  root.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet glass strong${opts.wide ? " wide" : ""}" role="dialog" aria-modal="true">
      <div class="sheet-grab" aria-hidden="true"></div>
      <div class="sheet-top">
        <button class="sheet-back" aria-label="Back" hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button class="sheet-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="sheet-body"></div>
    </section>`;
  document.body.append(root);
  openSheets++;
  document.body.classList.add("sheet-open");
  const body = root.querySelector<HTMLElement>(".sheet-body")!;
  const backBtn = root.querySelector<HTMLButtonElement>(".sheet-back")!;
  let backFn: (() => void) | undefined;

  const sheet: Sheet = {
    el: root,
    body,
    close() {
      if (!root.isConnected) return;
      root.classList.add("closing");
      setTimeout(() => {
        root.remove();
        openSheets--;
        if (!openSheets) document.body.classList.remove("sheet-open");
      }, 260);
      document.removeEventListener("keydown", onKey);
      opts.onClose?.();
    },
    show(content, back) {
      body.innerHTML = content;
      backFn = back;
      backBtn.hidden = !back;
      body.scrollTop = 0;
    },
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && sheet.close();
  document.addEventListener("keydown", onKey);
  root.querySelector(".sheet-backdrop")!.addEventListener("click", () => sheet.close());
  root.querySelector(".sheet-x")!.addEventListener("click", () => sheet.close());
  backBtn.addEventListener("click", () => backFn?.());
  sheet.show(html);
  requestAnimationFrame(() => root.classList.add("open"));
  return sheet;
}

// ---------------------------------------------------------------- toasts

export function toast(text: string, kind: "ok" | "err" | "info" = "info", ms = 3800) {
  const host = document.getElementById("toasts")!;
  const t = document.createElement("div");
  t.className = `toast glass strong ${kind}`;
  t.textContent = text;
  host.append(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => {
    t.classList.remove("in");
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ---------------------------------------------------------------- progress lines

export interface Progress {
  step(text: string): { done(note?: string): void; fail(): void };
}

/** A list of steps that tick off one by one, inside `el`. */
export function progressIn(el: HTMLElement): Progress {
  el.innerHTML = "";
  el.className = "progress";
  return {
    step(text) {
      const li = document.createElement("div");
      li.className = "pline busy";
      li.innerHTML = `<span class="pdot"></span><span class="ptext">${esc(text)}</span>`;
      el.append(li);
      return {
        done(note) {
          li.className = "pline done";
          if (note) li.querySelector(".ptext")!.innerHTML += ` <span class="pnote">${note}</span>`;
        },
        fail() {
          li.className = "pline fail";
        },
      };
    },
  };
}

/** Turn wallet, relayer and contract errors into one plain sentence. */
export function friendly(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; details?: string; message?: string };
  const m = `${err?.shortMessage ?? ""} ${err?.details ?? ""} ${err instanceof Error ? err.message : String(e)}`;
  if (err?.code === 4001 || /user rejected|user denied|rejected the request|cancelled/i.test(m)) return "You cancelled the signature. Nothing was sent.";
  const table: [RegExp, string][] = [
    [/TooLate/, "Bidding for this round has already closed."],
    [/TooEarly/, "Bidding is still open. Try again when the timer ends."],
    [/AlreadyPaid/, "You have already paid this round."],
    [/AlreadyApproved/, "You have already approved this release."],
    [/AlreadyMember/, "You're already in this circle."],
    [/NotEligible/, "Only members who paid this round and haven't taken a pot yet can bid."],
    [/BidNotHigher/, "Someone bid a bigger discount. Bid higher to win."],
    [/DiscountTooHigh/, "That discount is above this circle's cap."],
    [/NoQuorum/, "The release needs more approvals first."],
    [/CircleFull/, "This circle is already full."],
    [/JoinWindowClosed/, "Joining has closed for this circle."],
    [/NothingToWithdraw/, "There's nothing to pay out right now."],
    [/NotStalled/, "The circle isn't stuck, so it can't be dissolved."],
    [/timed? ?out|Timeout/i, "The network is slow to confirm. It may still go through; check again in a minute."],
    [/Failed to fetch|NetworkError|network/i, "Couldn't reach the QDay Aevum testnet. Check your connection and try again."],
  ];
  for (const [re, text] of table) if (re.test(m)) return text;
  return (err?.shortMessage || (err instanceof Error ? err.message : String(e))).replace(/\s+/g, " ").slice(0, 200);
}
