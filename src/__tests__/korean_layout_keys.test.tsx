// 두벌식 자판에서도 한 글자 키가 듣는다 (11-15 합류 G-10). 한글 입력 상태로 j 를 누르면 `key` 가 「ㅓ」 로(Windows 의
// 입력기는 「Process」 로) 온다. 셸 레인의 `readChord` 가 자리(`code`)로 라틴 글자를 되찾고, 일지 · 계획 · 변경 화면이
// 모두 그것으로 키를 읽는다. 화면마다 따로 있는 시험은 라틴 글자만 보냈다(변경 화면의 j/k 만 두벌식이었다).
// [ · ] 는 두벌식에서도 같은 글자라 여기서 따로 보내지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async (orig) => (await import("./screenMux")).muxBindings(await orig<typeof import("@/lib/bindings")>()));
vi.mock("@/api/oculpm", async (orig) => (await import("./screenMux")).muxOculpm(await orig<typeof import("@/api/oculpm")>()));
vi.mock("@/api/plan", async (orig) => (await import("./screenMux")).muxPlan(await orig<typeof import("@/api/plan")>()));
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { JournalScreenV2, __resetJournalMemory } from "@/features/oculpm/JournalScreenV2";
import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { __setPlatformForTests } from "@/lib/platform";
import { activeName, entryGroup, fx, looseGroup, renderDiffScreen, resetFx, seed, summaryOf } from "./helpers/diffScreenFx";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";
import { detail, item, pfx, plan, resetPlanFixtures, stage } from "./plannerHarness";
import { mux } from "./screenMux";

/** 두벌식에서 그 자리의 글자 — `key` 는 자모, `code` 는 라틴 자리. */
const HANGUL: Record<string, string> = { j: "ㅓ", k: "ㅏ", v: "ㅍ", r: "ㄱ", n: "ㅜ", p: "ㅔ", e: "ㄷ" };
const press = (el: Element, latin: string, key = HANGUL[latin]) =>
  fireEvent.keyDown(el, { key, code: `Key${latin.toUpperCase()}` });

afterEach(cleanup);

describe("journal — j · k · v", () => {
  const rows = ["one", "two", "three"].map((n, i) =>
    entry({ relative_path: `20260531/F/130${i}_${n}.md`, title: `Missing ${n}`, evidence: 0, created_at: `2026-05-31T1${3 - i}:00:00+09:00` }),
  );
  const selected = (c: HTMLElement) => c.querySelector('.jl-item[aria-selected="true"] .jl-ti')?.textContent;
  const renderJournal = () =>
    render(
      <WorkspaceProvider projectId={1}>
        <JournalScreenV2 projectId={1} todayKey="20260531" oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
      </WorkspaceProvider>,
    );

  beforeEach(() => {
    mux.screen = "journal";
    __resetJournalMemory();
    resetJournalFixtures();
    jfx.byWorkday["20260531"] = rows;
  });

  it("ㅓ · ㅏ move between entries, ㅍ marks the open one read", async () => {
    const { container } = renderJournal();
    const split = container.querySelector(".jl-split")!;
    await waitFor(() => expect(selected(container)).toBe("Missing one"));
    press(split, "j");
    await waitFor(() => expect(selected(container)).toBe("Missing two"));
    press(split, "k");
    await waitFor(() => expect(selected(container)).toBe("Missing one"));
    await waitFor(() => expect(container.querySelector(".jd-title")?.textContent).toBe("Missing one"));
    press(split, "v");
    await waitFor(() => expect(jfx.verified).toEqual([{ relativePath: rows[0].relative_path, verified: true }]));
  });

  it("Windows: the IME's 「Process」 on the J key moves too", async () => {
    __setPlatformForTests("windows");
    const { container } = renderJournal();
    await waitFor(() => expect(selected(container)).toBe("Missing one"));
    press(container.querySelector(".jl-split")!, "j", "Process");
    await waitFor(() => expect(selected(container)).toBe("Missing two"));
  });
});

describe("planner — j · k · r", () => {
  beforeEach(() => {
    mux.screen = "planner";
    resetPlanFixtures();
  });

  it("ㅓ · ㅏ move between items, ㄱ runs the next one", async () => {
    const a = plan("a", { title: "Keys plan" });
    stage([detail(a, [item("x", "todo", 0, { title: "Alpha" }), item("y", "todo", 1, { title: "Bravo" })])]);
    const { container } = render(
      <SettingsProvider>
        <WorkspaceProvider projectId={1}>
          <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
        </WorkspaceProvider>
      </SettingsProvider>,
    );
    await screen.findByRole("heading", { level: 2, name: "Keys plan" });
    const body = container.querySelector(".plv-body") as HTMLElement;
    body.focus();
    press(body, "j");
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Alpha");
    press(document.activeElement!, "j");
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Bravo");
    press(document.activeElement!, "k");
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Alpha");
    press(body, "r");
    await waitFor(() => expect(pfx.dispatch).toEqual([["a", "x"]]));
  });
});

describe("changes — j · k · n · p · v · e", () => {
  const TWO_HUNKS = ["diff --git a/src/w1.ts b/src/w1.ts", "@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -20,2 +20,2 @@", " x", "-y", "+Y"].join("\n");
  const original = Element.prototype.scrollIntoView;
  let scrolled: Element[] = [];

  beforeEach(() => {
    mux.screen = "diff";
    resetFx();
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("files, hunks, viewed and the editor all hear the Korean layout", async () => {
    // 검증 없는 일지 묶음(처음 펼쳐진다) + 일지 없는 파일 — 처음 고른 것은 일지 없는 파일이다.
    fx.groups = [entryGroup("20260820/Bugs/1000_bug_a.md", "watch race", ["src/w1.ts"]), looseGroup(["src/loose.ts"])];
    fx.brief = [summaryOf("20260820/Bugs/1000_bug_a.md", 0)];
    fx.diffByPath["src/w1.ts"] = { path: "src/w1.ts", source: { source: "git", patch: TWO_HUNKS }, truncated: null };
    seed([
      { path: "src/w1.ts", op: "M" },
      { path: "src/loose.ts", op: "M" },
    ]);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/loose.ts"));
    const split = container.querySelector(".chg-split")!;
    press(split, "j");
    await waitFor(() => expect(activeName(container)).toBe("src/w1.ts"));
    press(split, "k");
    await waitFor(() => expect(activeName(container)).toBe("src/loose.ts"));
    press(split, "j");
    await waitFor(() => expect(container.querySelectorAll(".diff-code .hunk-head")).toHaveLength(2));
    scrolled = [];
    press(split, "n");
    expect(scrolled).toHaveLength(1);
    press(split, "p");
    expect(scrolled).toHaveLength(2);
    press(split, "v");
    await waitFor(() => expect(container.querySelector('.chg-item[aria-current="true"]')?.classList.contains("is-viewed")).toBe(true));
    press(split, "e");
    await waitFor(() => expect(fx.openInEditor).toHaveBeenCalledWith("/tmp/proj", "src/w1.ts", expect.any(String), 2));
  });
});
