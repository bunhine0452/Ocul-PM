/**
 * 단축키 표 — 「지금 화면」 은 다섯 화면 모두, ⌘/ 는 다시 누르면 닫는다, 키 표기는 한 벌 (11-15 최종 검수).
 *
 *  - 계획 묶음의 id 가 "plan" 인데 화면 id 는 "planner" 라, 계획 화면에서만 첫 묶음이 「화면 이동」 이었고 「지금 화면」
 *    칩도 없었다. `cheatsheet_view_contract` 는 `viewOnScreen` 만 물고 묶음 id 와의 짝은 안 물었다.
 *  - 표 자신이 aria-modal 이라, 열린 뒤의 두 번째 ⌘/ 를 전역 키의 모달 가드가 먹어 Esc 로만 닫혔다 — 프로젝트 창 ·
 *    시작 창 둘 다.
 *  - Enter 가 묶음마다 ↩ · Enter 로, 줄 옮기기가 두 줄 · 덧말 · 한 줄로 갈렸고, Windows 에서는 홀로 선 ↩ 가 그대로였다.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/projects", () => ({
  projectsApi: {
    list: async () => [{ id: 1, name: "ocul-pm", root_path: "/Users/me/dev/ocul-pm", created_at: 1, icon: null, color: null }],
    brief: async () => ({ projects: [], today_workday: "", since_workday: "", today_total: 0, active_projects: 0, feed: [] }),
  },
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    adoptProject: async () => true,
    openProjectIds: async () => [],
    onOpenProjectsChanged: async () => () => {},
    attention: async () => new Map(),
    onAttentionChanged: async () => () => {},
    openProjectWindow: async () => null,
  },
}));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: { compareWorkday: async () => ({ workday: "", sessions: [], unrecorded_total: 0 }) },
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => [], onSessionsChanged: async () => () => {} },
}));

import { ShortcutCheatsheet, keyGroups, orderShortcutGroups } from "@/components/ShortcutCheatsheet";
import { StartWindow } from "@/features/start/StartWindow";
import { useConfirm } from "@/hooks/useConfirm";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { t } from "@/i18n";
import { kbd } from "@/lib/kbd";
import { NAV_ENTRIES } from "@/lib/navRegistry";
import { __setPlatformForTests } from "@/lib/platform";
import { requestCheatsheet } from "@/lib/projectActions";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  for (const el of document.querySelectorAll("body > .topbar, body > [data-fake-modal]")) el.remove();
});

/** 프로젝트 창의 윗줄 흉내 — 탭은 navRegistry 순서, `view` 의 탭에 aria-current (dialogs_v2 와 같은 꼴). */
function fakeTopbar(view: string) {
  const bar = document.createElement("header");
  bar.className = "topbar";
  const nav = document.createElement("nav");
  nav.className = "topnav";
  for (const e of NAV_ENTRIES) {
    const b = document.createElement("button");
    if (e.id === view) b.setAttribute("aria-current", "page");
    nav.appendChild(b);
  }
  bar.appendChild(nav);
  document.body.appendChild(bar);
}

const sheet = () => screen.queryByRole("dialog", { name: t("keys.title") });
/** 실제 키는 포커스가 선 요소에서 올라온다 — 표가 열리면 표의 본문이다. */
const pressSlash = () => fireEvent.keyDown(document.activeElement ?? window, { key: "/", code: "Slash", metaKey: true });

describe("the current screen's group leads — on all five screens", () => {
  it("every screen has a group named after it, and that group is first", () => {
    const ids = buildShortcutGroups().map((g) => g.id);
    for (const e of NAV_ENTRIES) {
      expect(ids, e.id).toContain(e.id);
      expect(orderShortcutGroups(buildShortcutGroups(), e.id, true)[0].id, e.id).toBe(e.id);
    }
  });

  it("on the planner the plan group is first and wears the only 「this screen」 chip", async () => {
    fakeTopbar("planner");
    render(<ShortcutCheatsheet />);
    act(() => requestCheatsheet());
    const dialog = await screen.findByRole("dialog", { name: t("keys.title") });
    const first = dialog.querySelector(".keys-group h3")!;
    expect(first.textContent).toContain(t("nav.planner"));
    expect(first.querySelector(".chip")?.textContent).toBe(t("dialog.keysHere"));
    expect(dialog.querySelectorAll(".keys-group .chip")).toHaveLength(1);
  });
});

describe("⌘/ toggles the sheet", () => {
  function projectWindow() {
    const spies = { onOpenPalette: vi.fn(), onClosePalette: vi.fn(), uiV2Nav: vi.fn() };
    renderHook(() => useGlobalShortcuts(spies));
    render(<ShortcutCheatsheet />);
    return spies;
  }

  it("project window: ⌘/ opens, ⌘/ again closes — the sheet is a modal of its own", async () => {
    fakeTopbar("today");
    projectWindow();
    act(() => void pressSlash());
    expect(await screen.findByRole("dialog", { name: t("keys.title") })).toBeInTheDocument();
    act(() => void pressSlash());
    await waitFor(() => expect(sheet()).toBeNull());
    // 창(window)에 바로 보낸 키도 같다 — 포커스가 어디 있든.
    act(() => void fireEvent.keyDown(window, { key: "/", metaKey: true }));
    expect(await screen.findByRole("dialog", { name: t("keys.title") })).toBeInTheDocument();
    act(() => void fireEvent.keyDown(window, { key: "/", metaKey: true }));
    await waitFor(() => expect(sheet()).toBeNull());
  });

  it("does not open over another dialog — the guard still holds for everything but the sheet itself", async () => {
    fakeTopbar("today");
    const spies = projectWindow();
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    other.setAttribute("aria-modal", "true");
    other.dataset.fakeModal = "";
    document.body.appendChild(other);
    act(() => void fireEvent.keyDown(window, { key: "/", metaKey: true }));
    act(() => void fireEvent.keyDown(window, { key: "2", metaKey: true }));
    expect(sheet()).toBeNull();
    expect(spies.uiV2Nav).not.toHaveBeenCalled();
    other.remove();
    act(() => void fireEvent.keyDown(window, { key: "/", metaKey: true }));
    expect(await screen.findByRole("dialog", { name: t("keys.title") })).toBeInTheDocument();
  });

  it("start window: the same two presses open and close it", async () => {
    render(
      <>
        <StartWindow />
        <ShortcutCheatsheet />
      </>,
    );
    await screen.findByText("ocul-pm", { selector: ".prow-name" });
    act(() => void pressSlash());
    expect(await screen.findByRole("dialog", { name: t("keys.title") })).toBeInTheDocument();
    act(() => void pressSlash());
    await waitFor(() => expect(sheet()).toBeNull());
  });
});

describe("one notation for keys", () => {
  const MOVING = ["today", "journal", "planner", "diff", "start"];

  it("macOS: Enter is ↩ in every group — no 「Enter」, no ⏎", () => {
    const rows = buildShortcutGroups().flatMap((g) => g.rows.map((r) => `${g.id} ${r.keys}`));
    expect(rows.filter((r) => /Enter|⏎/.test(r))).toEqual([]);
    const byLabel = new Map(buildShortcutGroups().flatMap((g) => g.rows.map((r) => [r.labelKey, r.keys] as const)));
    for (const key of ["keys.todayAct", "keys.entryOpen", "keys.planStatus", "start.keysOpen"] as const) {
      expect(byLabel.get(key), key).toBe("↩");
    }
  });

  it("row moves are one row per group, j / k first, the arrows joined with ·", () => {
    for (const g of buildShortcutGroups().filter((x) => MOVING.includes(x.id))) {
      const moves = g.rows.filter((r) => /^(j \/ k|↑ \/ ↓)/.test(r.keys));
      expect(moves.map((r) => r.keys), g.id).toHaveLength(1);
      expect(moves[0].keys, g.id).toMatch(/^j \/ k( · ↑ \/ ↓)?$/);
      expect(t(moves[0].labelKey), g.id).not.toMatch(/\(/);
    }
    // 화살표도 듣는 화면 — 오늘 · 일지(목록 안) · 시작 창.
    for (const id of ["today", "journal", "start"]) {
      expect(buildShortcutGroups().find((g) => g.id === id)!.rows.some((r) => r.keys === "j / k · ↑ / ↓"), id).toBe(true);
    }
  });

  it("the sheet draws 「j / k · ↑ / ↓」 as four keycaps with a grey dot between the pairs", async () => {
    expect(keyGroups("j / k · ↑ / ↓")).toEqual([["j", "k"], ["↑", "↓"]]);
    expect(keyGroups("/ · ⌘F")).toEqual([["/"], ["⌘F"]]);
    expect(keyGroups("⌘[ / ⌘]")).toEqual([["⌘[", "⌘]"]]);
    fakeTopbar("today");
    render(<ShortcutCheatsheet />);
    act(() => requestCheatsheet());
    const dialog = await screen.findByRole("dialog", { name: t("keys.title") });
    const row = [...dialog.querySelectorAll(".keys-row")].find((r) => r.querySelector("dt")?.textContent === t("keys.rowMove"))!;
    expect([...row.querySelectorAll("dd kbd")].map((k) => k.textContent)).toEqual(["j", "k", "↑", "↓"]);
    expect(row.querySelectorAll("dd .keys-or")).toHaveLength(1);
  });

  it("Windows · Linux: a lone ↩ becomes Enter — the today row, dictionary hints and the confirm key", async () => {
    for (const os of ["windows", "linux"] as const) {
      __setPlatformForTests(os);
      const today = buildShortcutGroups().find((g) => g.id === "today")!;
      expect(today.rows.find((r) => r.labelKey === "keys.todayAct")?.keys, os).toBe("Enter");
      for (const g of buildShortcutGroups()) for (const r of g.rows) expect(r.keys, `${os} ${g.id}`).not.toMatch(/[↩⏎]/);
      expect(kbd("↩ 로 보내요"), os).toBe("Enter 로 보내요"); // i18n-ignore -- 사전 문구 꼴이 검사 재료다
      expect(t("today.check.sendHint"), os).not.toMatch(/[↩⏎]/);
    }
    __setPlatformForTests("windows");
    render(<ConfirmHarness />);
    fireEvent.click(screen.getByTestId("ask"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector(".cf-confirm .dlg-key")?.textContent).toBe("Enter");
  });
});

function ConfirmHarness() {
  const { confirm, confirmDialog } = useConfirm();
  const [asked, setAsked] = useState(false);
  return (
    <div>
      <button
        data-testid="ask"
        onClick={() => {
          setAsked(true);
          void confirm({ title: t("start.forgetTitle", { name: "x" }), message: t("start.forgetBody") });
        }}
      >
        ask
      </button>
      {asked ? confirmDialog : null}
    </div>
  );
}
