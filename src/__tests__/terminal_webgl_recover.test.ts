// TE-07 — the WebGL renderer heals itself and a new session opens at the right size: a lost context is
// re-attached at most once a minute (it used to stay on the DOM renderer for good after the second loss), the
// glyph atlas is cleared every 32 pages (truecolor shimmer grew it without bound), a released renderer gives
// its GL context back at once (the WebGL canvas's, not the 2D link layer addon-webgl 0.18 puts in front of it),
// a new session is sized from the pane and the last measured cell instead of 80x24, and a display-scale change
// refits the visible sessions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Webgl = {
  disposed: boolean;
  loss: (() => void) | null;
  page: (() => void) | null;
  clears: number;
};

type Cell = { width: number; height: number };
type FakeTerm = { cols: number; element: HTMLElement; _core: { _renderService: { dimensions: { css: { cell: Cell } } } } };

const h = vi.hoisted(() => ({
  webgls: [] as Webgl[],
  terms: [] as FakeTerm[],
  opens: [] as Array<[number, number]>,
  fits: 0,
  loseContext: 0,
  dprChange: [] as Array<() => void>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols: number;
    rows: number;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: "6" };
    buffer = { active: { type: "normal", getLine: () => undefined } };
    modes = { mouseTrackingMode: "none" };
    element: HTMLElement;
    _core = { _renderService: { dimensions: { css: { cell: { width: 7, height: 16 } } } } };
    constructor(opts: { cols?: number; rows?: number }) {
      this.cols = opts.cols ?? 80;
      this.rows = opts.rows ?? 24;
      this.element = document.createElement("div");
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      this.element.appendChild(screen);
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
    onResize() {
      return { dispose() {} };
    }
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    refresh() {}
    open() {}
    focus() {}
    write() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      h.fits += 1;
    }
  },
}));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    rec: Webgl = { disposed: false, loss: null, page: null, clears: 0 };
    canvases: HTMLCanvasElement[] = [];
    constructor() {
      h.webgls.push(this.rec);
    }
    // As addon-webgl 0.18 does it: the 2D link layer goes into .xterm-screen before the WebGL canvas, and
    // disposing takes both out of the page.
    activate(term: { element: HTMLElement }) {
      const link = document.createElement("canvas");
      link.className = "xterm-link-layer";
      this.canvases = [link, document.createElement("canvas")];
      for (const c of this.canvases) term.element.querySelector(".xterm-screen")!.appendChild(c);
    }
    onContextLoss(cb: () => void) {
      this.rec.loss = cb;
    }
    onAddTextureAtlasCanvas(cb: () => void) {
      this.rec.page = cb;
    }
    clearTextureAtlas() {
      this.rec.clears += 1;
    }
    dispose() {
      this.rec.disposed = true;
      for (const c of this.canvases) c.remove();
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@/features/terminal/imeBridge", () => ({ attachImeBridge: () => ({ dispose() {} }) }));
vi.mock("@/lib/oculpmLog", () => ({ oculpmLog: { warn: () => {}, info: () => {} } }));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => [],
    open: async (projectId: number, cols: number, rows: number) => {
      h.opens.push([cols, rows]);
      return {
        id: h.opens.length,
        project_id: projectId,
        label: "zsh",
        started_at: "",
        alive: true,
        exit_code: null,
        status: null,
        busy: false,
        unseen: false,
      };
    },
    write: async () => {},
    resize: async () => {},
    close: async () => {},
    ack: async () => {},
  },
}));

import {
  ATLAS_CLEAR_EVERY,
  WEBGL_RETRY_MS,
  closeTerm,
  mountTerm,
  openTerm,
  setTermFontSize,
} from "@/features/terminal/termStore";

const opened: number[] = [];
let size = { width: 800, height: 600 };

beforeEach(() => {
  vi.useFakeTimers();
  h.webgls = [];
  h.opens = [];
  h.fits = 0;
  h.loseContext = 0;
  size = { width: 800, height: 600 };
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({
    addEventListener: (_: string, cb: () => void) => void h.dprChange.push(cb),
    removeEventListener: () => {},
  }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => size.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => size.height });
  // Like a browser: a canvas that already has a 2D context (the link layer) answers null to "webgl2".
  const gl = {
    getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => void (h.loseContext += 1) } : null),
  };
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string) {
    if (this.classList.contains("xterm-link-layer")) return id === "2d" ? {} : null;
    return id === "webgl2" ? gl : null;
  } as unknown as HTMLCanvasElement["getContext"];
});

afterEach(() => {
  for (const id of opened.splice(0)) closeTerm(id);
  document.body.innerHTML = "";
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

function pane(): HTMLElement {
  const leaf = document.createElement("div");
  leaf.className = "tm-leaf is-active";
  const p = document.createElement("div");
  p.className = "tm-pane";
  leaf.appendChild(p);
  document.body.appendChild(leaf);
  return p;
}

describe("WebGL self-recovery", () => {
  it("re-attaches after a second loss once a minute has passed", async () => {
    mountTerm(await open(), pane());
    expect(h.webgls).toHaveLength(1);
    h.webgls[0].loss?.();
    expect(h.webgls).toHaveLength(2);
    vi.advanceTimersByTime(70_000);
    h.webgls[1].loss?.();
    expect(h.webgls).toHaveLength(3);
    expect(h.webgls[2].disposed).toBe(false);
  });

  it("a quick second loss waits for the minute instead of thrashing, then re-attaches by itself", async () => {
    mountTerm(await open(), pane());
    h.webgls[0].loss?.();
    vi.advanceTimersByTime(5_000);
    h.webgls[1].loss?.();
    expect(h.webgls).toHaveLength(2);
    vi.advanceTimersByTime(WEBGL_RETRY_MS - 5_000);
    expect(h.webgls).toHaveLength(3);
    expect(h.webgls[2].disposed).toBe(false);
  });

  it("clears the glyph atlas every 32 new pages, after the draw that added it", async () => {
    mountTerm(await open(), pane());
    const gl = h.webgls[0];
    for (let i = 0; i < ATLAS_CLEAR_EVERY - 1; i++) gl.page?.();
    await Promise.resolve();
    expect(gl.clears).toBe(0);
    gl.page?.();
    expect(gl.clears).toBe(0);
    await Promise.resolve();
    expect(gl.clears).toBe(1);
  });

  it("gives the GL context back when the renderer is released", async () => {
    const id = await open();
    mountTerm(id, pane());
    expect(h.loseContext).toBe(0);
    closeTerm(id);
    opened.splice(opened.indexOf(id), 1);
    expect(h.webgls[0].disposed).toBe(true);
    expect(h.loseContext).toBe(1);
  });
});

describe("first size of a new session", () => {
  it("is the pane divided by the last measured cell (1400x800 at 7x16 is 200x50), not 80x24", async () => {
    mountTerm(await open(), pane());
    size = { width: 1400, height: 800 };
    await open();
    expect(h.opens[h.opens.length - 1]).toEqual([200, 50]);
  });

  it("refits the visible sessions when the display scale changes", async () => {
    mountTerm(await open(), pane());
    vi.advanceTimersByTime(100);
    h.fits = 0;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    h.dprChange[h.dprChange.length - 1]?.();
    vi.advanceTimersByTime(16);
    expect(h.fits).toBe(1);
  });
});

describe("font size", () => {
  it("re-centres the grid with the new cell — fit alone kept the old cell's margin", async () => {
    mountTerm(await open(), pane());
    const term = h.terms[h.terms.length - 1];
    term.cols = 80;
    term._core._renderService.dimensions.css.cell = { width: 8, height: 18 };
    setTermFontSize(15);
    const screen = term.element.querySelector<HTMLElement>(".xterm-screen")!;
    expect(screen.style.marginLeft).toBe("80px"); // (800 - 80 × 8) / 2
    setTermFontSize(13);
  });
});
