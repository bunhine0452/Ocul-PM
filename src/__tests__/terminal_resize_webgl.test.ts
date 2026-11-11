// Terminal resize + WebGL churn (2026-11-11, Windows perf) — a window drag fires ResizeObserver every
// frame; each fit used to go straight to term_resize (a ConPTY reflow + prompt redraw). And every tab
// switch built a fresh WebGL context + glyph atlas. Here: fit once per frame, PTY resize once the size
// settles (the first one still goes at once), WebGL kept across short hides and released after a long one,
// one rebuild after a context loss.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  resizes: [] as Array<[number, number, number]>,
  terms: [] as Array<{
    cols: number;
    rows: number;
    resizeCbs: Array<(s: { cols: number; rows: number }) => void>;
    refreshes: number;
  }>,
  webgls: [] as Array<{ disposed: boolean; loss: (() => void) | null }>,
  fits: 0,
  nextFit: { cols: 100, rows: 30 },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    resizeCbs: Array<(s: { cols: number; rows: number }) => void> = [];
    refreshes = 0;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: "6" };
    buffer = { active: { getLine: () => undefined } };
    constructor() {
      h.terms.push(this);
    }
    loadAddon(a: { activate?: (t: unknown) => void }) {
      a.activate?.(this);
    }
    registerLinkProvider() {
      return { dispose() {} };
    }
    onData() {
      return { dispose() {} };
    }
    onResize(cb: (s: { cols: number; rows: number }) => void) {
      this.resizeCbs.push(cb);
      return { dispose() {} };
    }
    resize(cols: number, rows: number) {
      if (cols === this.cols && rows === this.rows) return;
      this.cols = cols;
      this.rows = rows;
      for (const cb of this.resizeCbs) cb({ cols, rows });
    }
    refresh() {
      this.refreshes += 1;
    }
    open() {}
    focus() {}
    write() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    term: { resize: (c: number, r: number) => void } | null = null;
    activate(t: { resize: (c: number, r: number) => void }) {
      this.term = t;
    }
    fit() {
      h.fits += 1;
      this.term?.resize(h.nextFit.cols, h.nextFit.rows);
    }
  },
}));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    rec = { disposed: false, loss: null as (() => void) | null };
    constructor() {
      h.webgls.push(this.rec);
    }
    onContextLoss(cb: () => void) {
      this.rec.loss = cb;
    }
    dispose() {
      this.rec.disposed = true;
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@/features/terminal/imeBridge", () => ({ attachImeBridge: () => ({ dispose() {} }) }));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => [],
    open: async (projectId: number) => ({
      id: h.terms.length,
      project_id: projectId,
      label: "pwsh",
      started_at: "",
      alive: true,
      exit_code: null,
      status: null,
      busy: false,
      unseen: false,
    }),
    write: async () => {},
    resize: async (id: number, cols: number, rows: number) => void h.resizes.push([id, cols, rows]),
    close: async () => {},
  },
}));

import {
  MAX_WEBGL,
  PTY_RESIZE_DEBOUNCE_MS,
  WEBGL_IDLE_MS,
  closeTerm,
  mountTerm,
  openTerm,
} from "@/features/terminal/termStore";

/** A container whose host reports a size — jsdom has no layout. */
function sizedContainer(): HTMLDivElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

let roCallbacks: Array<() => void> = [];
const opened: number[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  h.resizes = [];
  h.webgls = [];
  h.fits = 0;
  h.nextFit = { cols: 100, rows: 30 };
  roCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        roCallbacks.push(cb);
      }
      observe() {}
      disconnect() {
        roCallbacks = roCallbacks.filter((c) => c !== this.cb);
      }
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
});

afterEach(() => {
  for (const id of opened.splice(0)) closeTerm(id);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // @ts-expect-error -- 지운다: jsdom 기본값(0)으로 되돌린다
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error -- 지운다
  delete HTMLElement.prototype.clientHeight;
});

async function open(): Promise<number> {
  const id = await openTerm(1);
  opened.push(id);
  return id;
}

describe("terminal resize", () => {
  it("fits on mount at once and sends the first PTY size without waiting", async () => {
    const id = await open();
    mountTerm(id, sizedContainer());
    expect(h.fits).toBe(1);
    expect(h.resizes).toEqual([[id, 100, 30]]);
  });

  it("a drag: many observer calls per frame fit once; the PTY gets only the settled size", async () => {
    const id = await open();
    mountTerm(id, sizedContainer());
    h.resizes = [];
    h.fits = 0;
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS + 1); // the mount resize window closes

    // 30 frames of dragging, 3 observer callbacks each, the size changing every frame
    for (let frame = 0; frame < 30; frame++) {
      h.nextFit = { cols: 101 + frame, rows: 30 };
      for (let i = 0; i < 3; i++) for (const cb of roCallbacks) cb();
      vi.advanceTimersByTime(16);
    }
    expect(h.fits).toBe(30); // was 90 (one fit per observer call)
    // first change goes at once, the rest wait until the drag stops
    expect(h.resizes.length).toBe(1);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS + 1);
    expect(h.resizes.length).toBe(2); // was 30 (one ConPTY resize per frame)
    expect(h.resizes[h.resizes.length - 1]).toEqual([id, 130, 30]);
  });
});

describe("terminal WebGL renderer", () => {
  it("keeps the context across a short hide and releases it after a long one", async () => {
    const id = await open();
    const off = mountTerm(id, sizedContainer());
    expect(h.webgls.length).toBe(1);
    off();
    vi.advanceTimersByTime(5_000);
    const off2 = mountTerm(id, sizedContainer());
    expect(h.webgls.length).toBe(1); // same context, no rebuild
    expect(h.webgls[0].disposed).toBe(false);
    off2();
    vi.advanceTimersByTime(WEBGL_IDLE_MS + 1);
    expect(h.webgls[0].disposed).toBe(true);
    mountTerm(id, sizedContainer());
    expect(h.webgls.length).toBe(2);
  });

  it("rebuilds once after a context loss, then stays on the DOM renderer", async () => {
    const id = await open();
    mountTerm(id, sizedContainer());
    h.webgls[0].loss?.();
    expect(h.webgls[0].disposed).toBe(true);
    expect(h.webgls.length).toBe(2);
    h.webgls[1].loss?.();
    expect(h.webgls[1].disposed).toBe(true);
    expect(h.webgls.length).toBe(2);
  });

  it("never holds more than the cap: hidden sessions give theirs back first", async () => {
    const offs: Array<() => void> = [];
    for (let i = 0; i < MAX_WEBGL; i++) offs.push(mountTerm(await open(), sizedContainer()));
    for (const off of offs) off(); // all hidden, still holding
    expect(h.webgls.filter((w) => !w.disposed).length).toBe(MAX_WEBGL);
    mountTerm(await open(), sizedContainer());
    expect(h.webgls.filter((w) => !w.disposed).length).toBe(1);
  });
});
