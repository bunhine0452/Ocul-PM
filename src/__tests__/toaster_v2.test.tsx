/**
 * 알림 기둥 하나 (11-15).
 *
 * 토스트(bottom 16 · right 16)와 업데이트 배너(bottom · right 18)가 같은 모서리에 겹쳤다. 배너 CTA 는 강조색
 * 채운 단추라 모든 화면에 두 번째 채운 단추였고(영수증 규칙 3), info 토스트는 늘 초록 ✓ 라 하지 못한 일도
 * 성공처럼 보였다. 닫기 × 는 opacity .6 · 누를 자리 16px. 읽음을 다섯 번 누르면 토스트가 다섯 장이었다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  entries: [] as Array<[string, string]>,
  sets: [] as Array<[string, string]>,
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const special: Record<string, (...a: unknown[]) => unknown> = {
    settingsGetAll: () => ok(fx.entries),
    settingsSet: (k: unknown, v: unknown) => {
      fx.sets.push([String(k), String(v)]);
      return ok(null);
    },
    installKind: () => Promise.reject(new Error("no ipc")),
    updateCheckClaim: () => Promise.resolve(true),
    updateCheckReport: () => Promise.resolve(null),
  };
  return {
    commands: new Proxy({}, { get: (_t, prop: string) => special[prop] ?? (() => ok(null)) }),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve({ version: "4.11.0", body: "", downloadAndInstall: () => Promise.resolve() })),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }) }));

import { UpdateBanner } from "@/components/UpdateBanner";
import { Toaster } from "@/components/ui/Toaster";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";
import { dismissToast, getToasts, toast } from "@/lib/toast";

import { read } from "./designFs";

afterEach(() => {
  for (const x of [...getToasts()]) dismissToast(x.id);
  fx.entries = [];
  fx.sets.length = 0;
  cleanup();
  vi.useRealTimers();
});

const PRIM = read("styles/primitives.css").replace(/\/\*[\s\S]*?\*\//g, "");
const APP = read("App.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel: string) => {
  for (const m of PRIM.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].trim() === sel) return m[2];
  throw new Error(`no ${sel}`);
};

describe("one column — the banner is the column's pinned row", () => {
  it("banner and toasts are children of the same container, the banner is the bottom pinned row", async () => {
    render(
      <>
        <Toaster />
        <UpdateBanner />
      </>,
    );
    act(() => void toast.info("Copied"));
    const banner = (await screen.findByText(/v4\.11\.0/)).closest(".update-banner")!;
    const item = screen.getByText("Copied").closest(".toast")!;
    const column = document.querySelector("[data-toaster]")!;
    expect(banner.closest("[data-toaster]")).toBe(column);
    expect(item.closest("[data-toaster]")).toBe(column);
    // 고정 줄 — 기둥의 마지막 칸(모서리에 가장 가까운 자리).
    expect(column.lastElementChild?.contains(banner)).toBe(true);
    // 기둥 하나만 모서리에 고정된다 — 배너가 따로 떠 있지 않다.
    expect(rule(".toaster")).toMatch(/position:\s*fixed/);
    expect(APP).not.toMatch(/\.update-banner\s*\{/);
  });

  it("the banner CTA is not a filled button · close is a 26px icon button", async () => {
    render(<UpdateBanner />);
    const cta = await screen.findByRole("button", { name: t("update.now") });
    expect(cta.className).toContain("btn");
    expect(cta.className).toContain("sm");
    expect(cta.className).not.toContain("primary");
    const x = screen.getByRole("button", { name: t("update.dismiss") });
    expect(x.className).toContain("iconbtn");
    expect(x.className).toContain("sm");
    expect(APP).not.toMatch(/update-banner-cta/);
  });

  it("dismissal is stored per version in settings — other windows skip the same version", async () => {
    render(
      <SettingsProvider>
        <Toaster />
        <UpdateBanner />
      </SettingsProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("update.dismiss") }));
    await waitFor(() => expect(fx.sets).toContainEqual(["update_dismissed", "4.11.0"]));
    expect(document.querySelector(".update-banner")).toBeNull();
  });

  it("an already dismissed version never shows", async () => {
    fx.entries = [["update_dismissed", "4.11.0"]];
    render(
      <SettingsProvider>
        <UpdateBanner />
      </SettingsProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.querySelector(".update-banner")).toBeNull();
  });
});

describe("toasts — colour only for exceptions · one button kit", () => {
  it("info has no check mark — only warnings and failures carry a mark", () => {
    render(<Toaster />);
    act(() => {
      toast.info("Could not open the entry");
      toast.warning("Could not read the front matter");
    });
    const info = screen.getByText("Could not open the entry").closest(".toast")!;
    expect(info.querySelector(".toast-ico")).toBeNull();
    // 표식이 없다 — 남은 svg 는 닫기 단추의 × 하나다.
    expect(Array.from(info.querySelectorAll("svg")).every((s) => s.closest("button"))).toBe(true);
    const warn = screen.getByText("Could not read the front matter").closest(".toast")!;
    expect(warn.querySelector(".toast-ico svg")).not.toBeNull();
  });

  it("actions are .btn sm, close is .iconbtn sm (no dimming)", () => {
    render(<Toaster />);
    act(() => void toast.info("Moved", { actions: [{ label: "Undo", onClick: () => {} }] }));
    const action = screen.getByRole("button", { name: "Undo" });
    expect(action.className).toBe("btn sm");
    const close = screen.getByRole("button", { name: t("common.close") });
    expect(close.className).toBe("iconbtn sm");
    expect(close.className).not.toMatch(/opacity/);
  });
});

describe("the same key folds — one toast · a count", () => {
  it("the same dedupKey three times → one toast showing 3", () => {
    render(<Toaster />);
    act(() => {
      for (let i = 0; i < 3; i++) {
        toast.info("Marked as read", { dedupKey: "read", actions: [{ label: "Undo", onClick: () => {} }] });
      }
    });
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].count).toBe(3);
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
    const count = document.querySelector(".toast .toast-count")!;
    expect(count.textContent).toBe("3");
    expect(count.getAttribute("aria-label")).toBe(t("toast.repeat", { n: 3 }));
  });

  it("a fold replaces the text and restarts the clock", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    render(<Toaster />);
    // 열쇠는 시험마다 다르게 — 접기 창(recentByKey)은 모듈 하나의 기억이다.
    act(() => void toast.info("One read", { dedupKey: "read-clock" }));
    act(() => void vi.advanceTimersByTime(4_000));
    act(() => void toast.info("Two read", { dedupKey: "read-clock" }));
    expect(screen.getByText(/Two read/)).toBeInTheDocument();
    expect(screen.queryByText(/One read/)).toBeNull();
    act(() => void vi.advanceTimersByTime(4_000)); // 처음 시계(5초)였다면 이미 닫혔다
    expect(getToasts()).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1_100));
    expect(getToasts()).toHaveLength(0);
  });

  it("a repeat inside the window after dismissal is dropped as before · window 0 shows a new one", () => {
    const first = toast.warning("Could not read the file", { dedupKey: "integrity:x" })!;
    dismissToast(first);
    expect(toast.warning("Could not read the file", { dedupKey: "integrity:x" })).toBeNull();
    const a = toast.info("Read", { dedupKey: "read-now", dedupWindowMs: 0 })!;
    dismissToast(a);
    expect(toast.info("Read", { dedupKey: "read-now", dedupWindowMs: 0 })).not.toBeNull();
  });
});
