// diff 기본기 (11-15 #diff-basics, DF-04) — 바뀐 단어 · 공백 무시 · 생성 파일 접기 · 줄로 열기.
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { PatchView } from "@/features/diff/PatchView";
import { isLockFile } from "@/features/diff/changeList";
import { markRanges, wordRanges } from "@/features/diff/diffWords";
import { t } from "@/i18n";
import { activeName, entryGroup, fx, looseGroup, renderDiffScreen, resetFx, seed } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

describe("changed words", () => {
  it("marks only the changed token of a paired line", () => {
    const el = render(createElement(PatchView, { patch: "@@ -1 +1 @@\n-const a = 1\n+const a = 2", mode: "unified" })).container;
    const words = (sel: string) => [...el.querySelectorAll(`${sel} .dl-word`)].map((w) => w.textContent);
    expect(words(".dl.del")).toEqual(["1"]);
    expect(words(".dl.add")).toEqual(["2"]);
  });

  it("joins neighbours across spaces, skips whitespace-only and mostly-different lines", () => {
    expect(wordRanges("call(foo bar)", "call(baz qux)")).toEqual([[[5, 12]], [[5, 12]]]);
    expect(wordRanges("  x = 1", "    x = 1")).toEqual([[], []]);
    expect(wordRanges("alpha beta gamma", "one two three")).toBeNull();
  });

  it("wraps marks inside highlight spans without crossing tags", () => {
    expect(markRanges('<span class="k">const</span> a &amp; b', [[4, 9]])).toBe(
      '<span class="k">cons<span class="dl-word">t</span></span><span class="dl-word"> a &amp;</span> b',
    );
  });
});

describe("ignore whitespace", () => {
  it("asks compute_diff with ignore_whitespace when toggled", async () => {
    seed([{ path: "src/a.ts", op: "M" }]);
    const { container, getByRole } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain("new line"));
    const last = () => fx.computeCalls[fx.computeCalls.length - 1]?.[4];
    expect(last()).toBe(false);
    const toggle = getByRole("button", { name: t("diff.ignoreWhitespace") });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(last()).toBe(true));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("says only whitespace changed when the patch has no hunks", async () => {
    seed([{ path: "src/a.ts", op: "M" }]);
    fx.diffByPath["src/a.ts"] = { path: "src/a.ts", source: { source: "git", patch: "" }, truncated: null };
    const { container, getByRole } = renderDiffScreen();
    await waitFor(() => expect(fx.computeCalls.length).toBeGreaterThan(0));
    fireEvent.click(getByRole("button", { name: t("diff.ignoreWhitespace") }));
    await waitFor(() => expect(container.textContent).toContain(t("diff.onlyWhitespace")));
  });

  // 기준본 없는 빈 새 파일은 「커밋과 같아요」 가 아니고, 공백 무시는 그 본문에 걸리지 않는다.
  it("is blocked with a reason on a new file, which says it is empty rather than unchanged", async () => {
    seed([{ path: "src/__init__.py", op: "A" }]);
    const patch = "diff --git a/src/__init__.py b/src/__init__.py\n--- /dev/null\n+++ b/src/__init__.py\n";
    fx.diffByPath["src/__init__.py"] = { path: "src/__init__.py", source: { source: "new_file", patch }, truncated: null };
    const { container, getByRole } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain(t("diff.emptyNewFile")));
    const toggle = getByRole("button", { name: t("diff.ignoreWhitespace") });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.title).toBe(t("diff.ignoreWhitespaceGitOnly"));
  });
});

describe("generated files fold to one line at the end", () => {
  it("folds Cargo.lock without changing the unrecorded count", async () => {
    expect(isLockFile("src-tauri/Cargo.lock")).toBe(true);
    expect(isLockFile("src/lock.ts")).toBe(false);
    fx.groups = [entryGroup("20260820/Bugs/1000_bug_a.md", "one", ["src/w1.ts"]), looseGroup(["Cargo.lock", "src/a.ts", "src/gen.ts"])];
    fx.generated = ["src/gen.ts"];
    seed(["src/w1.ts", "Cargo.lock", "src/a.ts", "src/gen.ts"].map((path) => ({ path, op: "M" as const })));
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-gen")).not.toBeNull());
    const loose = container.querySelector(".chg-list section")!;
    expect(loose.querySelector(".chg-bh")?.textContent).toBe(t("diff.unrecorded.label") + t("diff.fileCount", { n: 3 }));
    expect([...loose.querySelectorAll(".chg-name")].map((n) => n.textContent)).toEqual(["src/a.ts"]);
    const gen = container.querySelector(".chg-gen")!;
    expect(gen.textContent).toBe(t("diff.generated") + "2");
    expect(gen.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(gen);
    await waitFor(() => expect(gen.getAttribute("aria-expanded")).toBe("true"));
    expect([...gen.parentElement!.querySelectorAll(".chg-item.nested .chg-name")].map((n) => n.textContent)).toEqual([
      "src/gen.ts",
      "Cargo.lock",
    ]);
  });

  // 표지가 묶음보다 늦게 오면 처음 고르기가 표지 파일(bindings.ts 같은)을 골랐다 — 표지를 기다린다.
  it("the first pick waits for the markers and never opens on a marked file", async () => {
    fx.groups = [looseGroup(["src/gen.ts", "src/a.ts"])];
    fx.generated = ["src/gen.ts"];
    let release = () => {};
    fx.generatedGate = new Promise<void>((r) => (release = r));
    seed(["src/a.ts", "src/gen.ts"].map((path) => ({ path, op: "M" as const })));
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-bh")?.textContent).toContain(t("diff.unrecorded.label")));
    release();
    await waitFor(() => expect(activeName(container)).toBe("src/a.ts"));
  });
});

describe("open the line in the editor", () => {
  it("cmd-clicking a new-side line number opens that line", async () => {
    seed([{ path: "src/off.ts", op: "M" }]);
    fx.diffByPath["src/off.ts"] = {
      path: "src/off.ts",
      source: { source: "git", patch: "diff --git a/src/off.ts b/src/off.ts\n@@ -10,3 +10,3 @@\n a\n b\n-c\n+C\n" },
      truncated: null,
    };
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".dl.add")).not.toBeNull());
    const gut = container.querySelector(".dl.add .dl-gut") as HTMLElement;
    expect(gut.textContent).toBe("12");
    expect(gut.title).toBe(t("diff.openLineTitle"));
    fireEvent.click(gut);
    expect(fx.openInEditor).not.toHaveBeenCalled();
    fireEvent.click(gut, { metaKey: true });
    expect(fx.openInEditor).toHaveBeenCalledWith("/tmp/proj", "src/off.ts", expect.any(String), 12);
    // 지운 줄의 번호는 옛 쪽이라 열지 않는다.
    expect((container.querySelector(".dl.del .dl-gut") as HTMLElement).title).toBe("");
  });
});
