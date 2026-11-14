// TE-05 — output flow control, webview side: what xterm has drawn (write callbacks) goes back to the backend
// in 32K steps (`term_ack`); the backend stops reading the PTY while too much is undrawn. If xterm falls far
// behind anyway (window frozen for a long time), new output is dropped and acked at once, and one line says
// how much was skipped — xterm itself would drop silently at 50MB.
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onEvent: null as null | ((ev: unknown) => void),
  acks: [] as number[],
  writes: [] as string[],
  drawnBytes: 0,
  held: [] as Array<() => void>,
  hold: false,
  gate: null as null | Promise<void>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: "6" };
    buffer = { active: { type: "normal", getLine: () => undefined } };
    modes = { mouseTrackingMode: "none" };
    loadAddon() {}
    registerLinkProvider() {
      return { dispose() {} };
    }
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    write(data: string, cb?: () => void) {
      h.writes.push(data);
      if (!cb) return;
      const done = () => {
        h.drawnBytes += data.length;
        cb();
      };
      if (h.hold) h.held.push(done);
      else queueMicrotask(done);
    }
    open() {}
    focus() {}
    refresh() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@/features/terminal/imeBridge", () => ({ attachImeBridge: () => ({ dispose() {} }) }));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => [],
    open: async (projectId: number, _c: number, _r: number, _p: string | null, onEvent: (ev: unknown) => void) => {
      h.onEvent = onEvent;
      if (h.gate) await h.gate;
      return {
        id: 7,
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
    ack: async (_id: number, bytes: number) => void h.acks.push(bytes),
    write: async () => {},
    resize: async () => {},
    close: async () => {},
  },
}));

import { ACK_BYTES, DROP_BYTES, closeTerm, openTerm } from "@/features/terminal/termStore";
import { t } from "@/i18n";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  closeTerm(7);
  h.onEvent = null;
  h.acks = [];
  h.writes = [];
  h.drawnBytes = 0;
  h.held = [];
  h.hold = false;
  h.gate = null;
});

describe("terminal output flow control", () => {
  it("acks exactly what xterm drew, in 32K steps (10MB in, about 10MB / 32K acks)", async () => {
    await openTerm(1);
    const chunk = "x".repeat(8192);
    let sent = 0;
    for (let i = 0; i < 1280; i++) {
      h.onEvent?.({ kind: "output", data: chunk, n: chunk.length });
      sent += chunk.length;
    }
    await settle();
    expect(sent).toBe(10 * 1024 * 1024);
    expect(h.drawnBytes).toBe(sent);
    expect(sum(h.acks)).toBe(sent);
    expect(h.acks.length).toBe(sent / ACK_BYTES);
    expect(h.acks.every((n) => n >= ACK_BYTES)).toBe(true);
  });

  it("output drawn before the session id is known is acked once the id arrives", async () => {
    let release = () => {};
    h.gate = new Promise<void>((resolve) => (release = resolve));
    const opening = openTerm(1);
    await vi.waitFor(() => expect(h.onEvent).not.toBeNull());
    const chunk = "y".repeat(ACK_BYTES);
    h.onEvent?.({ kind: "output", data: chunk, n: chunk.length });
    await settle();
    expect(h.drawnBytes).toBe(ACK_BYTES);
    expect(h.acks).toEqual([]);
    release();
    await opening;
    expect(h.acks).toEqual([ACK_BYTES]);
  });

  it("drops and acks new output while xterm is far behind, then says how much it skipped", async () => {
    await openTerm(1);
    h.hold = true;
    const mb = "z".repeat(1024 * 1024);
    for (let i = 0; i < 40; i++) h.onEvent?.({ kind: "output", data: mb, n: mb.length });
    const accepted = h.writes.length;
    const skipped = 40 - accepted;
    expect(accepted).toBe(DROP_BYTES / mb.length + 1);
    expect(sum(h.acks)).toBe(skipped * mb.length);
    h.hold = false;
    for (const done of h.held.splice(0)) done();
    h.onEvent?.({ kind: "output", data: "after", n: 5 });
    await settle();
    const note = h.writes.find((w) => w.includes(t("terminal.notify.skipped", { mb: skipped })));
    expect(note).toBeDefined();
    expect(h.writes[h.writes.length - 1]).toBe("after");
    expect(h.drawnBytes).toBe(accepted * mb.length + 5);
  });
});
