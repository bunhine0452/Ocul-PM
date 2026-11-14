// 변경: 채운 단추 하나 · 동사 하나 · 일지 없음 띠 한 모양 (11-15 #diff-primary, DF-03).
//
// 영수증 규칙 3 — 채운 단추는 화면의 다음 할 일 하나다: 보낼 메모가 있으면 「메모 N개 맡기기」, 없으면
// 띠의 「Claude 에게 맡기기」. 세 흐름이 같은 작성기를 지나고, 맡긴 뒤의 띠는 「맡김」 이 되어 같은 요청을
// 또 보내지 않게 한다. 「메모 모두 지우기」 는 되돌릴 수 있다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { saveNote, startNote, useDiffNotes } from "@/features/diff/diffNoteStore";
import { t } from "@/i18n";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { getToasts } from "@/lib/toast";
import { entryGroup, fx, looseGroup, renderDiffScreen, resetFx, seed } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

function seedLoose() {
  fx.groups = [entryGroup("20260820/Bugs/1000_bug_a.md", "one", ["src/w1.ts"]), looseGroup(["src/a.ts", "src/b.ts"])];
  seed(["src/w1.ts", "src/a.ts", "src/b.ts"].map((path) => ({ path, op: "M" as const })));
}

const primaries = (el: HTMLElement) => [...el.querySelectorAll(".btn.primary")].map((b) => b.textContent);

describe("one filled button", () => {
  it("is the banner's ask when there are no notes, and the notes button when there are", async () => {
    seedLoose();
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-banner")).not.toBeNull());
    expect(primaries(container)).toEqual([t("diff.unrecorded.ask")]);

    // 메모 편집기의 「남기기」 도 채운 단추가 아니다.
    act(() => startNote(1, { file: "src/b.ts", side: "new", line: 1, code: "x" }));
    expect(primaries(container)).toEqual([t("diff.unrecorded.ask")]);
    act(() => saveNote(1, "rename"));
    await waitFor(() => expect(primaries(container)).toEqual([t("diff.notes.send", { n: 1 })]));
    // 띠의 맡기기는 보통 단추로 남는다.
    expect([...container.querySelectorAll(".chg-banner .btn")].map((b) => b.textContent)).toContain(t("diff.unrecorded.ask"));
  });
});

describe("the banner", () => {
  it("hands the record request to the composer and turns into a hairline 'handed over' once sent", async () => {
    seedLoose();
    const { container, getByText } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-banner")).not.toBeNull());
    fireEvent.click(getByText(t("diff.unrecorded.ask")));
    expect(fx.sent).toHaveLength(1);
    expect(fx.sent[0].prefill).toContain("- src/a.ts");
    expect(fx.sent[0].prefill).toContain("- src/b.ts");
    expect(fx.sent[0].prefill).not.toContain("src/w1.ts");
    // 작성기가 보낸 뒤에야 「맡김」 — 대화상자를 닫으면 그대로다.
    expect(container.querySelector(".chg-banner.is-asked")).toBeNull();
    act(() => fx.sent[0].onSent?.());
    await waitFor(() => expect(container.querySelector(".chg-banner.is-asked")).not.toBeNull());
    expect(container.querySelector(".chg-banner")?.textContent).toContain(t("diff.unrecorded.asked"));
    expect(container.querySelector(".chg-banner")?.textContent).toContain(t("diff.unrecorded.waiting"));
    expect(primaries(container)).toEqual([]);
  });

  it("asks again once the set of unrecorded files changes", async () => {
    seedLoose();
    const { container, getByText } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-banner")).not.toBeNull());
    fireEvent.click(getByText(t("diff.unrecorded.ask")));
    act(() => fx.sent[0].onSent?.());
    await waitFor(() => expect(container.querySelector(".chg-banner.is-asked")).not.toBeNull());
    // 에이전트가 일지 없는 파일을 하나 더 고쳤다 — 맡긴 묶음과 다르다.
    fx.groups = [entryGroup("20260820/Bugs/1000_bug_a.md", "one", ["src/w1.ts"]), looseGroup(["src/a.ts", "src/b.ts", "src/c.ts"])];
    act(() => recentChangesStore.push(1, { path: "src/c.ts", op: "A", ts: 9, read: false }));
    await waitFor(() => expect(container.querySelector(".chg-banner.is-asked")).toBeNull());
    expect(primaries(container)).toEqual([t("diff.unrecorded.ask")]);
  });
});

describe("clearing notes", () => {
  it("can be undone from the toast", async () => {
    seedLoose();
    let count = -1;
    function Count() {
      count = useDiffNotes(1).notes.length;
      return null;
    }
    const { container, getByText } = renderDiffScreen();
    render(<Count />);
    await waitFor(() => expect(container.querySelector(".chg-banner")).not.toBeNull());
    act(() => {
      startNote(1, { file: "src/a.ts", side: "new", line: 1, code: "x" });
      saveNote(1, "one");
      startNote(1, { file: "src/a.ts", side: "new", line: 2, code: "y" });
      saveNote(1, "two");
    });
    expect(count).toBe(2);
    fireEvent.click(getByText(t("diff.notes.clearAll")));
    expect(count).toBe(0);
    const cleared = getToasts().find((x) => x.message === t("diff.notes.cleared", { n: 2 }));
    expect(cleared?.actions?.[0].label).toBe(t("diff.notes.undo"));
    act(() => cleared!.actions![0].onClick());
    expect(count).toBe(2);
  });
});

describe("the band looks the same in both themes", () => {
  it("is a thin warn rule with a faint fill, not a --warn-soft slab", () => {
    const css = readFileSync(join(__dirname, "..", "features", "diff", "changes.css"), "utf8");
    const rule = /\n\.chg-banner \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/border: 1px solid color-mix\(in srgb, var\(--warn\) 45%/);
    expect(rule).not.toMatch(/var\(--warn-soft\)/);
  });
});
