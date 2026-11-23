// 변경: 봤음 · 본 뒤 바뀜 · 검증 없는 묶음 먼저 (11-15 #diff-viewed, DF-05).
//
// 에이전트가 같은 파일을 여러 번 고치면 어디까지 봤는지 잊는다 — 파일마다 (그때 패치 · 시각)을 기억하고,
// 다시 바뀌면 풀려 예외로 다시 선다. 검증 없는 일지(두 번째 예외)는 차례로도 선택으로도 앞에 선다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { saveNote, startNote } from "@/features/diff/diffNoteStore";
import { t } from "@/i18n";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { activeName, entryGroup, fx, looseGroup, renderDiffScreen, resetFx, seed, summaryOf } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

const A = "20260820/Features_to_add/0900_feature_a.md";
const B = "20260820/Bugs/1000_bug_b.md";

/** 일지 둘 — 백엔드 차례는 A(명령 있음) → B(검증 없음). 일지 없는 파일은 없다. */
function seedTwo() {
  fx.groups = [entryGroup(A, "checked work", ["src/a1.ts"]), entryGroup(B, "unchecked fix", ["src/b1.ts", "src/b2.ts"]), looseGroup([])];
  fx.brief = [summaryOf(A, 2), summaryOf(B, 0)];
  seed(["src/a1.ts", "src/b1.ts", "src/b2.ts"].map((path) => ({ path, op: "M" as const })));
}

const row = (el: HTMLElement, path: string) => el.querySelector(`.chg-item[data-path="${path}"]`);
const isViewed = (el: HTMLElement, path: string) => row(el, path)?.classList.contains("is-viewed") ?? false;
const split = (el: HTMLElement) => el.querySelector(".chg-split")!;
const patchOf = (path: string, line: string) => ({
  path,
  source: { source: "git", patch: `diff --git a/${path} b/${path}\n@@ -1,2 +1,2 @@\n context line\n-old line\n+${line}\n` },
  truncated: null,
});

describe("the unchecked group comes first", () => {
  it("sorts the no-verification group first, opens it, and picks its first file", async () => {
    seedTwo();
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/b1.ts"));
    const groups = container.querySelectorAll(".chg-grp");
    expect(groups[0].textContent).toContain("unchecked fix");
    expect(groups[0].getAttribute("aria-expanded")).toBe("true");
    expect(groups[1].getAttribute("aria-expanded")).toBe("false");
  });
});

describe("viewed", () => {
  it("v marks the open file viewed and the list head counts it", async () => {
    seedTwo();
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/b1.ts"));
    await waitFor(() => expect(container.textContent).toContain("new line"));
    expect(container.querySelector(".chg-viewed")).toBeNull();
    fireEvent.keyDown(container.querySelector(".chg-split")!, { key: "v" });
    await waitFor(() => expect(row(container, "src/b1.ts")?.classList.contains("is-viewed")).toBe(true));
    expect(container.querySelector(".chg-viewed")?.textContent).toBe(t("diff.viewedHead") + " 1/3");
    // 머리줄의 토글도 같은 상태 — 다시 누르면 풀린다.
    const toggle = [...container.querySelectorAll(".chg-fh button")].find((b) => b.textContent === t("diff.viewed"))!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(row(container, "src/b1.ts")?.classList.contains("is-viewed")).toBe(false));
  });

  it("unmarks itself when the same file changes again and shows a grey dot", async () => {
    seedTwo();
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain("new line"));
    fireEvent.keyDown(container.querySelector(".chg-split")!, { key: "v" });
    await waitFor(() => expect(row(container, "src/b1.ts")?.classList.contains("is-viewed")).toBe(true));
    act(() => recentChangesStore.push(1, { path: "src/b1.ts", op: "M", ts: Date.now(), read: false }));
    await waitFor(() => expect(row(container, "src/b1.ts")?.classList.contains("is-viewed")).toBe(false));
    expect(row(container, "src/b1.ts")?.querySelector(".chg-changed")?.getAttribute("aria-label")).toBe(t("diff.changedSinceViewed"));
    expect(container.querySelector(".chg-viewed")).toBeNull();
  });

  // 열쇠의 다른 절반 — 시각이 그대로인 자리(git 바탕 행 ts 0 · 최근 커밋)는 패치 해시만이 풀어 준다.
  it("unmarks itself when the file's content changes even though its time did not", async () => {
    seedTwo();
    fx.files.set("src/b1.ts", { ok: "v1" });
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain("new line"));
    fireEvent.keyDown(split(container), { key: "v" });
    await waitFor(() => expect(fx.reads).toContain("src/b1.ts"));
    fx.files.set("src/b1.ts", { ok: "v2" });
    // 다른 파일로 옮기면 내용을 다시 읽는다 — 그사이 바뀌었으면 접히지 않고 「본 뒤 바뀜」 으로 제자리에 선다.
    fireEvent.keyDown(split(container), { key: "j" });
    await waitFor(() => expect(activeName(container)).toBe("src/b2.ts"));
    await waitFor(() => expect(isViewed(container, "src/b1.ts")).toBe(false));
    expect(row(container, "src/b1.ts")?.querySelector(".chg-changed")).not.toBeNull();
  });

  it("stays viewed when Ignore whitespace reads a different patch of the same content, and unmarks when the content changed", async () => {
    seedTwo();
    fx.files.set("src/b1.ts", { ok: "v1" });
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain("new line"));
    fireEvent.keyDown(split(container), { key: "v" });
    await waitFor(() => expect(fx.reads).toContain("src/b1.ts"));
    const toggle = () => [...container.querySelectorAll(".chg-fh button")].find((b) => b.textContent === t("diff.ignoreWhitespace"))!;
    // 보기 방식이 달라 패치가 다른 것이지 파일이 바뀐 것이 아니다 — 다시 읽은 내용이 같다.
    fx.diffByPath["src/b1.ts"] = patchOf("src/b1.ts", "seen without whitespace");
    fireEvent.click(toggle());
    await waitFor(() => expect(fx.reads.filter((p) => p === "src/b1.ts").length).toBeGreaterThan(1));
    expect(isViewed(container, "src/b1.ts")).toBe(true);
    // 그사이 내용이 바뀌었으면 다시 읽은 본문에서 풀린다.
    fx.files.set("src/b1.ts", { ok: "v2" });
    fx.diffByPath["src/b1.ts"] = patchOf("src/b1.ts", "changed line");
    fireEvent.click(toggle());
    await waitFor(() => expect(isViewed(container, "src/b1.ts")).toBe(false));
  });
});

describe("note counts", () => {
  it("shows how many notes a file has at the end of its row", async () => {
    seedTwo();
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/b1.ts"));
    act(() => {
      startNote(1, { file: "src/b2.ts", side: "new", line: 1, code: "x" });
      saveNote(1, "one");
      startNote(1, { file: "src/b2.ts", side: "new", line: 3, code: "y" });
      saveNote(1, "two");
    });
    await waitFor(() => expect(row(container, "src/b2.ts")?.querySelector(".chg-notes")?.textContent).toBe("2"));
    expect(row(container, "src/b1.ts")?.querySelector(".chg-notes")).toBeNull();
  });
});
