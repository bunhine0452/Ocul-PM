// TE-03 — terminal rendering defaults: a still cursor (receipt rule 6), glyph rescaling for wide Nerd Font
// icons, a contrast floor that follows the theme, the fit addon taking only the real scrollbar (addon-fit 0.11
// is the xterm 6 build and always took 14px on xterm 5.5), and links inside a full-screen program that uses
// the mouse (Claude Code) opening only with Cmd/Ctrl — a plain click there belongs to the program.
import { afterEach, describe, expect, it, vi } from "vitest";

type FakeTerm = {
  options: Record<string, unknown>;
  buffer: { active: { type: string } };
  modes: { mouseTrackingMode: string };
};

const h = vi.hoisted(() => ({
  terms: [] as FakeTerm[],
  webLinks: [] as Array<(e: MouseEvent, uri: string) => void>,
  opened: [] as string[],
  reject: false,
  theme: { background: "#1b1f1d" } as Record<string, string>,
  themeChanged: null as null | (() => void),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    unicode = { activeVersion: "6" };
    buffer = { active: { type: "normal", getLine: () => undefined } };
    modes = { mouseTrackingMode: "none" };
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts };
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
    open() {}
    focus() {}
    write() {}
    refresh() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    constructor(handler: (e: MouseEvent, uri: string) => void) {
      h.webLinks.push(handler);
    }
  },
}));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@/features/terminal/imeBridge", () => ({ attachImeBridge: () => ({ dispose() {} }) }));
vi.mock("@/api/fileOpen", () => ({
  fileOpenApi: {
    url: (uri: string) => (h.reject ? Promise.reject(new Error("blocked")) : Promise.resolve(void h.opened.push(uri))),
  },
}));
vi.mock("@/features/terminal/termTheme", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/terminal/termTheme")>();
  return {
    ...real,
    readTerminalTheme: () => ({ ...h.theme }),
    observeTerminalTheme: (fn: () => void) => {
      h.themeChanged = fn;
      return () => {};
    },
  };
});
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => [],
    open: async (projectId: number) => ({
      id: h.terms.length,
      project_id: projectId,
      label: "zsh",
      started_at: "",
      alive: true,
      exit_code: null,
      status: null,
      busy: false,
      unseen: false,
    }),
    write: async () => {},
    resize: async () => {},
    close: async () => {},
    ack: async () => {},
  },
}));

import { FitAddon } from "@xterm/addon-fit";
import { createImagePathProvider, createOscLinkHandler, shouldOpenLink, type LinkTerm } from "@/features/terminal/fileLinks";
import { closeTerm, openTerm } from "@/features/terminal/termStore";
import { contrastFloor } from "@/features/terminal/termTheme";

const opened: number[] = [];
afterEach(() => {
  for (const id of opened.splice(0)) closeTerm(id);
  h.theme = { background: "#1b1f1d" };
  h.opened = [];
  h.reject = false;
});

async function open(): Promise<FakeTerm> {
  opened.push(await openTerm(1));
  return h.terms[h.terms.length - 1];
}

const tracking = (type: "normal" | "alternate", mode: LinkTerm["modes"]["mouseTrackingMode"]): LinkTerm => ({
  buffer: { active: { type } },
  modes: { mouseTrackingMode: mode },
});
const click = (mod = false) => new MouseEvent("click", { metaKey: mod, clientX: 4, clientY: 5 });
const RANGE = { start: { x: 1, y: 1 }, end: { x: 1, y: 1 } };

describe("terminal options", () => {
  it("keeps the cursor still and rescales glyphs that overflow their cell", async () => {
    const term = await open();
    expect(term.options.cursorBlink).toBe(false);
    expect(term.options.rescaleOverlappingGlyphs).toBe(true);
  });

  it("floors contrast at 3 on a dark background and 4.5 on a light one, for every session on a theme switch", async () => {
    const a = await open();
    const b = await open();
    expect([a.options.minimumContrastRatio, b.options.minimumContrastRatio]).toEqual([3, 3]);
    h.theme = { background: "#faf9f5" };
    h.themeChanged?.();
    expect([a.options.minimumContrastRatio, b.options.minimumContrastRatio]).toEqual([4.5, 4.5]);
  });

  it("reads hex and rgb backgrounds and falls back to the dark floor", () => {
    expect(contrastFloor("#faf9f5")).toBe(4.5);
    expect(contrastFloor("#fff")).toBe(4.5);
    expect(contrastFloor("rgb(250, 249, 245)")).toBe(4.5);
    expect(contrastFloor("#1b1f1d")).toBe(3);
    expect(contrastFloor(undefined)).toBe(3);
    expect(contrastFloor("color-mix(in srgb, red, blue)")).toBe(3);
  });
});

describe("fit addon", () => {
  it("takes only the real scrollbar width off the columns", () => {
    const parent = document.createElement("div");
    parent.style.width = "717px";
    parent.style.height = "800px";
    const element = document.createElement("div");
    element.style.padding = "0px";
    parent.appendChild(element);
    document.body.appendChild(parent);
    const fit = new FitAddon();
    fit.activate({
      element,
      options: { scrollback: 5000 },
      _core: {
        _renderService: { dimensions: { css: { cell: { width: 7, height: 16 } } } },
        viewport: { scrollBarWidth: 10 },
      },
    } as never);
    // (717 - 10) / 7 = 101 columns; the xterm 6 build took 14px and gave 100.
    expect(fit.proposeDimensions()).toEqual({ cols: 101, rows: 50 });
    parent.remove();
  });
});

describe("links inside a full-screen program", () => {
  it("open with a plain click in the normal buffer but only with Cmd/Ctrl while the program tracks the mouse", () => {
    expect(shouldOpenLink(click(), tracking("normal", "none"))).toBe(true);
    expect(shouldOpenLink(click(), tracking("alternate", "vt200"))).toBe(false);
    expect(shouldOpenLink(click(true), tracking("alternate", "vt200"))).toBe(true);
    expect(shouldOpenLink(click(), tracking("alternate", "none"))).toBe(true);

    const openUrl = vi.fn();
    const passed = vi.fn();
    const inTui = createOscLinkHandler({ openUrl, onImage: vi.fn(), term: tracking("alternate", "vt200"), onPassedThrough: passed });
    inTui.activate(click(), "https://example.com/pr/1", RANGE);
    expect(openUrl).toHaveBeenCalledTimes(0);
    expect(passed).toHaveBeenCalledTimes(1);
    inTui.activate(click(true), "https://example.com/pr/1", RANGE);
    expect(openUrl).toHaveBeenCalledTimes(1);

    const normalOpen = vi.fn();
    createOscLinkHandler({ openUrl: normalOpen, onImage: vi.fn(), term: tracking("normal", "none") }).activate(
      click(),
      "https://example.com/pr/1",
      RANGE,
    );
    expect(normalOpen).toHaveBeenCalledTimes(1);
  });

  it("image paths: a plain click goes to the program, Cmd-click reveals the file instead of enlarging it", () => {
    const onImage = vi.fn();
    const inTui = createOscLinkHandler({ openUrl: vi.fn(), onImage, term: tracking("alternate", "any") });
    inTui.activate(click(), "file:///tmp/shot.png", RANGE);
    expect(onImage).not.toHaveBeenCalled();
    inTui.activate(click(true), "file:///tmp/shot.png", RANGE);
    expect(onImage).toHaveBeenLastCalledWith({ kind: "reveal", path: "/tmp/shot.png", x: 4, y: 5 });

    const line = (text: string) => ({
      length: text.length,
      getCell: (x: number) => (x < text.length ? { getChars: () => text[x], getWidth: () => 1 } : undefined),
    });
    const provider = createImagePathProvider(() => line("see /tmp/a.png"), onImage, () => 80, tracking("alternate", "vt200"));
    let links: Array<{ activate: (e: MouseEvent, text: string) => void }> = [];
    provider.provideLinks(1, (found) => (links = (found ?? []) as typeof links));
    onImage.mockClear();
    links[0].activate(click(), "/tmp/a.png");
    expect(onImage).not.toHaveBeenCalled();
    links[0].activate(click(true), "/tmp/a.png");
    expect(onImage).toHaveBeenCalledWith(expect.objectContaining({ kind: "reveal", path: "/tmp/a.png" }));
  });

  it("the web-links addon goes through the same gate, and a refused open is swallowed", async () => {
    const term = await open();
    const handler = h.webLinks[h.webLinks.length - 1];
    term.buffer.active.type = "alternate";
    term.modes.mouseTrackingMode = "vt200";
    handler(click(), "https://example.com/a");
    await Promise.resolve();
    expect(h.opened).toEqual([]);
    handler(click(true), "https://example.com/a");
    await Promise.resolve();
    expect(h.opened).toEqual(["https://example.com/a"]);
    term.buffer.active.type = "normal";
    h.reject = true;
    handler(click(), "https://example.com/b");
    await new Promise((r) => setTimeout(r, 0));
  });
});
