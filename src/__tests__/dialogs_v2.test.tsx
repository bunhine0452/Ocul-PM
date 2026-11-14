/**
 * 대화상자 한 벌과 스크롤되는 단축키 표 (11-15).
 *
 * 확인 · 딥링크 · 처음 쓰는 법 · 단축키 표가 머리 · 발 · 단추를 저마다 들고 있었다(네 벌, 단추 체계 두 벌 —
 * shadcn Button 은 딥링크 하나만 썼다). 480×520 창(창 정리)에서는 단축키 표(약 33줄)가 잘리고 스크롤도
 * 안 됐다. 이제 AppDialog 의 DialogHead · DialogBody · DialogFoot 한 벌이고, 본문만 스크롤한다.
 *
 * jsdom 은 레이아웃을 하지 않는다 — 그래서 대화상자 한 벌의 **실제 CSS**(primitives.css 의 `.dlg-*`)를
 * 문서에 얹고, 계산된 스타일로 「누가 스크롤 칸인가」 를 문다. 그림은 하네스 스크린샷이 본다.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { axe } from "vitest-axe";

import type { DeepLink } from "@/lib/bindings";

let emitDeepLink: ((payload: DeepLink) => void) | null = null;
vi.mock("@/api/deeplink", () => ({
  onDeepLink: (cb: (link: DeepLink) => void) => {
    emitDeepLink = cb;
    return () => {};
  },
}));

import { ShortcutCheatsheet, orderShortcutGroups, splitKeyLabel, viewOnScreen } from "@/components/ShortcutCheatsheet";
import { AppDialog } from "@/components/ui/AppDialog";
import { DeepLinkSheet } from "@/features/deeplink/DeepLinkSheet";
import { TourDialog } from "@/features/tour/TourDialog";
import { useConfirm } from "@/hooks/useConfirm";
import { t } from "@/i18n";
import { NAV_ENTRIES } from "@/lib/navRegistry";
import { requestCheatsheet } from "@/lib/projectActions";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";

import { ROOT, read, walk } from "./designFs";

const PRIM = read("styles/primitives.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel: string) => {
  for (const m of PRIM.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].trim() === sel) return m[2];
  throw new Error(`no ${sel}`);
};

// 대화상자 한 벌의 규칙만 문서에 얹는다 — jsdom 의 getComputedStyle 이 스타일시트를 따른다.
beforeAll(() => {
  const css = [...PRIM.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /^\s*\.dlg-/.test(m[1]))
    .map((m) => `${m[1].trim()} {${m[2]}}`)
    .join("\n");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
});

afterEach(() => {
  cleanup();
  emitDeepLink = null;
  for (const el of document.querySelectorAll("body > .topbar")) el.remove();
});

/** 프로젝트 창의 윗줄 흉내 — 탭은 navRegistry 순서, `view` 의 탭에 aria-current. */
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

async function openCheatsheet() {
  render(<ShortcutCheatsheet />);
  act(() => requestCheatsheet());
  return screen.findByRole("dialog");
}

const groupTitles = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll(".keys-group h3")).map((h) => h.firstChild?.textContent ?? "");

describe("AppDialog — the body is the scroll element", () => {
  // 창 크기를 흉내 내도 jsdom 은 배치를 하지 않는다 — 그래서 「어느 창에서든 마지막 묶음에 닿는다」 를 구조로 문다:
  // 판은 창 안에서 자르고(최대 높이 · overflow hidden), 줄어 스크롤하는 칸은 본문 하나, 마지막 묶음은 그 안.
  // 실제 기하(760×520 · 480×520 에서 끝까지 내린 그림)는 하네스 스크린샷 keys-*-480x520 이 본다.
  it("head and foot hold, only the body shrinks and scrolls, and the last group is inside it", async () => {
    const dialog = await openCheatsheet();

    // 판은 넘치는 것을 자르고(위 18vh + 아래 여백을 뺀 높이), 세로로 쌓는다.
    const panel = getComputedStyle(dialog);
    expect(dialog.className).toContain("dlg-panel");
    expect(panel.display).toBe("flex");
    expect(panel.flexDirection).toBe("column");
    expect(panel.overflow).toBe("hidden");
    expect(rule(".dlg-panel")).toMatch(/max-height:\s*calc\(82vh - var\(--space-8\)\)/);
    expect(rule(".dlg-scrim")).toMatch(/padding:\s*18vh/);

    // 판 안에서 스크롤하는 칸은 본문 하나다.
    const scrollers = [dialog, ...dialog.querySelectorAll<HTMLElement>("*")].filter((el) =>
      ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
    );
    expect(scrollers.map((el) => el.className)).toEqual(["dlg-body"]);
    const body = scrollers[0];
    expect(getComputedStyle(body).minHeight).toMatch(/^0(px)?$/);
    for (const fixed of [".dlg-head"]) {
      expect(getComputedStyle(dialog.querySelector(fixed)!).flex).toMatch(/^(none|0 0 auto)$/);
    }

    // 마지막 묶음(창 · 터미널 …)이 본문 안에 있다 — 본문을 끝까지 내리면 닿는다.
    const groups = dialog.querySelectorAll(".keys-group");
    expect(groups.length).toBeGreaterThanOrEqual(6);
    expect(body.contains(groups[groups.length - 1])).toBe(true);
  });

  it("a dialog not yet on the kit still scrolls — the panel's direct child shrinks and scrolls (race diff at 520 high)", () => {
    render(
      <AppDialog open onClose={() => {}} label="legacy">
        <div className="legacy-body">form</div>
      </AppDialog>,
    );
    const child = getComputedStyle(document.querySelector(".legacy-body")!);
    expect(child.overflowY).toBe("auto");
    expect(child.minHeight).toMatch(/^0(px)?$/);
  });

  it("foot is right-aligned · head is 14/600", () => {
    expect(rule(".dlg-foot,\n.set-modal-actions")).toMatch(/justify-content:\s*flex-end/);
    const title = rule(".dlg-title,\n.set-modal-title");
    expect(title).toMatch(/font-size:\s*var\(--fs-5\)/);
    expect(title).toMatch(/font-weight:\s*var\(--fw-strong\)/);
  });

  it("the light scrim darkens (text 16%) instead of washing out to white", () => {
    expect(rule(".scrim")).toMatch(/color-mix\(in srgb, var\(--text\) 16%, transparent\)/);
    expect(rule(':root[data-theme="dark"] .scrim')).toMatch(/var\(--bg-sidebar\) 74%/);
  });

  it("the tour no longer carries min-height 290 (the panel stands at the top)", () => {
    expect(read("features/tour/tour.css")).not.toMatch(/min-height:\s*290px/);
  });
});

describe("same head · same foot — deep link · tour · confirm", () => {
  function ConfirmHarness() {
    const { confirm, confirmDialog } = useConfirm();
    const [asked, setAsked] = useState(false);
    return (
      <>
        <button
          onClick={() => {
            setAsked(true);
            void confirm({ title: "Delete it?", message: "This cannot be undone.", danger: true });
          }}
        >
          open
        </button>
        {asked ? confirmDialog : null}
      </>
    );
  }

  async function heads() {
    const out: { name: string; dialog: HTMLElement }[] = [];

    const deep = render(<DeepLinkSheet onAccept={() => {}} />);
    act(() => emitDeepLink!({ action: "open", project: "/Users/me/proj", view: null }));
    out.push({ name: "deeplink", dialog: await screen.findByRole("dialog") });
    expect(await axe(deep.container, { rules: { "color-contrast": { enabled: false } } })).toHaveProperty("violations", []);
    deep.unmount();

    const tour = render(<TourDialog open onClose={() => {}} />);
    out.push({ name: "tour", dialog: await screen.findByRole("dialog") });
    expect(await axe(tour.container, { rules: { "color-contrast": { enabled: false } } })).toHaveProperty("violations", []);
    tour.unmount();

    const cf = render(<ConfirmHarness />);
    fireEvent.click(screen.getByText("open"));
    out.push({ name: "confirm", dialog: await screen.findByRole("dialog") });
    expect(await axe(cf.container, { rules: { "color-contrast": { enabled: false } } })).toHaveProperty("violations", []);
    return out;
  }

  it("all three use .dlg-head > h2.dlg-title and .dlg-foot with at most one filled button (axe 0)", async () => {
    for (const { name, dialog } of await heads()) {
      expect(dialog.querySelector(".dlg-head h2.dlg-title"), name).not.toBeNull();
      // h2 는 머리 하나 — 처음 쓰는 법의 쪽 제목은 h3 다(한 판에 h2 가 둘이면 위계가 뒤집힌다).
      expect(dialog.querySelectorAll("h2"), name).toHaveLength(1);
      const foot = dialog.querySelector(".dlg-foot");
      expect(foot, name).not.toBeNull();
      expect(foot!.querySelectorAll(".btn.primary").length, name).toBeLessThanOrEqual(1);
      // 단추는 앱의 .btn 한 벌 — shadcn Button(data-slot="button")은 걷었다.
      expect(dialog.querySelector('[data-slot="button"]'), name).toBeNull();
    }
  });

  it("deep link — cancel takes focus on open, the accept button carries no key hint", async () => {
    render(<DeepLinkSheet onAccept={() => {}} />);
    act(() => emitDeepLink!({ action: "open", project: "/Users/me/proj", view: null }));
    await screen.findByRole("dialog");
    const cancel = screen.getByRole("button", { name: t("common.cancel") });
    expect(document.activeElement).toBe(cancel);
    const accept = screen.getByRole("button", { name: t("deeplink.open.action") });
    expect(accept.className).toContain("primary");
    expect(accept.querySelector("kbd")).toBeNull();
    expect(screen.getByText("/Users/me/proj").className).toContain("dl-origin-value");
  });

  it("the E2E skip selector still finds the tour's skip button (e2e/scenario.mjs)", () => {
    // 발이 .tour-foot → .dlg-foot 으로 바뀌며 E2E 의 「기동」 단계가 20초 뒤 멈췄다 — 마크업과 함께 문다.
    const sel = /clickCss\(wd, "(\.tour [^"]+)"/.exec(read("../e2e/scenario.mjs"))![1];
    render(<TourDialog open onClose={() => {}} />);
    expect(document.querySelector(sel)?.textContent).toContain(t("tour.skip"));
  });

  it("src/components/ui/button.tsx is gone and nothing imports it", () => {
    expect(existsSync(join(ROOT, "components/ui/button.tsx"))).toBe(false);
    for (const file of walk(ROOT)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/@\/components\/ui\/button["']/);
    }
  });
});

describe("shortcut sheet — the current screen first, flowing in columns", () => {
  it("view terminal → the first group is the terminal, tagged as this screen", async () => {
    fakeTopbar("terminal");
    expect(viewOnScreen()).toBe("terminal");
    const dialog = await openCheatsheet();
    expect(groupTitles(dialog)[0]).toBe(t("keys.g.terminal"));
    const first = dialog.querySelector(".keys-group h3")!;
    expect(first.querySelector(".chip.hairline")?.textContent).toBe(t("dialog.keysHere"));
    expect(dialog.querySelectorAll(".keys-group .chip").length).toBe(1);
  });

  it("a project window has no start-screen group", async () => {
    fakeTopbar("today");
    const dialog = await openCheatsheet();
    expect(groupTitles(dialog)).not.toContain(t("keys.g.start"));
    // 오늘은 자기 묶음이 없다 — 순서는 레지스트리 그대로.
    expect(groupTitles(dialog)[0]).toBe(t("keys.g.nav"));
  });

  it("the start window (no top bar) puts the start-screen group first", async () => {
    const dialog = await openCheatsheet();
    expect(groupTitles(dialog)[0]).toBe(t("keys.g.start"));
  });

  it("re-reads the current screen on every open", async () => {
    fakeTopbar("journal");
    const dialog = await openCheatsheet();
    expect(groupTitles(dialog)[0]).toBe(t("keys.g.journal"));
    act(() => requestCheatsheet()); // 닫기 (같은 키가 토글한다)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    document.querySelector("body > .topbar")!.remove();
    fakeTopbar("diff");
    act(() => requestCheatsheet());
    expect(groupTitles(await screen.findByRole("dialog"))[0]).toBe(t("keys.g.diff"));
  });

  it("group order — the pure function", () => {
    const ids = (v: Parameters<typeof orderShortcutGroups>[1], p: boolean) =>
      orderShortcutGroups(buildShortcutGroups(), v, p).map((g) => g.id);
    expect(ids("terminal", true)[0]).toBe("terminal");
    expect(ids("diff", true)[0]).toBe("diff");
    expect(ids("today", true)).not.toContain("start");
    expect(ids(null, false)[0]).toBe("start");
    // 아무것도 잃지 않는다.
    expect([...ids("terminal", true)].sort()).toEqual(buildShortcutGroups().map((g) => g.id).filter((id) => id !== "start").sort());
  });

  it("a trailing parenthetical becomes a grey second line", async () => {
    expect(splitKeyLabel("Close window (the session first)")).toEqual(["Close window", "the session first"]);
    expect(splitKeyLabel("New window")).toEqual(["New window", null]);
    const dialog = await openCheatsheet();
    const subs = Array.from(dialog.querySelectorAll(".keys-row dt .keys-sub")).map((s) => s.textContent);
    expect(subs).toContain(splitKeyLabel(t("keys.navHistory"))[1]);
    expect(rule(".keys-sub")).toMatch(/color:\s*var\(--text-2\)/);
  });

  it("groups flow in 240px CSS columns without breaking across them · × closes (axe 0)", async () => {
    expect(rule(".keys-cols")).toMatch(/columns:\s*240px/);
    expect(rule(".keys-group")).toMatch(/break-inside:\s*avoid/);
    const dialog = await openCheatsheet();
    // 첫 포커스는 표(본문) — 화살표로 바로 내린다. × 가 먼저 포커스 테를 쥐지 않는다.
    expect(document.activeElement).toBe(dialog.querySelector(".dlg-body"));
    const results = await axe(dialog, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: t("common.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("the trap holds — Tab never leaves the dialog", () => {
  it("shortcut sheet: the body is a Tab stop · Tab from it wraps to × · ⇧Tab from × comes back", async () => {
    const dialog = await openCheatsheet();
    const body = dialog.querySelector<HTMLElement>(".dlg-body")!;
    const close = screen.getByRole("button", { name: t("common.close") });
    expect(document.activeElement).toBe(body);
    expect(body.tabIndex).toBe(0);
    // 열자마자 첫 포커스로 앉은 동안은 테가 없다 — 한 번 떠났다가 돌아오면 다른 Tab 자리와 같은 테.
    expect(body.hasAttribute("data-quiet")).toBe(true);
    // 기본 동작(브라우저의 Tab 이동)을 막고 판 안에서 옮긴다 — 막지 않으면 덮개 뒤로 나갔다.
    expect(fireEvent.keyDown(body, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(close);
    expect(body.hasAttribute("data-quiet")).toBe(false);
    expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(body);
    expect(rule(".dlg-body[data-quiet]:focus")).toMatch(/outline:\s*none/);
    expect(rule(".dlg-body:focus-visible")).toMatch(/outline-offset:\s*var\(--focus-offset-inset\)/);
  });

  it("any dialog: focus on the panel itself or a tabIndex -1 spot stays inside, in DOM order", () => {
    render(
      <AppDialog open onClose={() => {}} label="spots">
        <button>first</button>
        <p tabIndex={-1}>middle spot</p>
        <button>last</button>
        <p tabIndex={-1}>end spot</p>
      </AppDialog>,
    );
    const dialog = screen.getByRole("dialog");
    const [first, last] = [screen.getByText("first"), screen.getByText("last")];
    const tab = (from: HTMLElement, shiftKey = false) => {
      from.focus();
      expect(fireEvent.keyDown(from, { key: "Tab", shiftKey })).toBe(false);
      return document.activeElement;
    };
    // 뒤에 아무것도 없는 칸(단축키 표의 본문이 그랬다) — 밖으로 나가지 않고 처음으로 되감는다.
    expect(tab(screen.getByText("end spot"))).toBe(first);
    expect(tab(screen.getByText("end spot"), true)).toBe(last);
    // 사이의 칸 — 브라우저의 순서 그대로 다음 · 앞.
    expect(tab(screen.getByText("middle spot"))).toBe(last);
    expect(tab(screen.getByText("middle spot"), true)).toBe(first);
    // 판 자체(본문 글자를 눌렀을 때) — ⇧Tab 이 판 앞의 문서로 새지 않는다.
    expect(tab(dialog, true)).toBe(last);
    expect(tab(dialog)).toBe(first);
  });
});
