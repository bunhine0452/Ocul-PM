// 변경: 잘린 것 · 모르는 것을 말하는 영수증 줄과 머리줄 (11-15 #diff-receipt, DF-07).
//
// 잘린 diff 는 영어 문장 대신 「64 KB / 212 KB 만 보여요」 와 「+N 이상」, 새 파일은 실제 줄 수, 메모 판정은
// 「없음」 만 「바뀜」 으로(권한 오류는 그대로), 최근 커밋은 sha 를, 검증 줄은 끝(결과)을 남긴다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { DiffEntryFooter, splitTail } from "@/features/diff/DiffEntryFooter";
import { PatchView } from "@/features/diff/PatchView";
import { markSent, saveNote, startNote, useDiffNotes, type DiffNote } from "@/features/diff/diffNoteStore";
import { t } from "@/i18n";
import { entryGroup, fx, renderDiffScreen, resetFx, seed } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

const body = (lines: number) =>
  ["diff --git a/src/big.ts b/src/big.ts", `@@ -1,0 +1,${lines} @@`, ...Array.from({ length: lines }, (_, i) => `+line ${i}`)].join("\n");

describe("a cut diff", () => {
  it("ends in a receipt line with mono numbers and reads the counts as a lower bound", async () => {
    seed([{ path: "src/big.ts", op: "M" }]);
    fx.diffByPath["src/big.ts"] = {
      path: "src/big.ts",
      source: { source: "git", patch: body(812) },
      truncated: { shown: 65536, total: 217088 },
    };
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".diff-cut")).not.toBeNull());
    const cut = container.querySelector(".diff-cut")!;
    expect(cut.querySelector(".mono")?.textContent).toBe("64.0 KB / 212.0 KB");
    expect(cut.textContent).toContain(t("diff.cutShown"));
    expect(cut.querySelector("button")?.textContent).toBe(t("diff.openEditor"));
    const stat = container.querySelector(".chg-fh .diff-stat")!;
    expect(stat.textContent).toBe("+812−0" + t("diff.statsMore"));
    // 잘림 문장이 코드 줄로 그려지지 않는다.
    expect(container.textContent).not.toContain("truncated");
  });

  it("turns the sidecar's old marker sentence into the same receipt line (journal detail)", () => {
    const patch = `${body(3)}\n\n... (truncated, 217088 bytes total)`;
    const el = render(<PatchView patch={patch} mode="unified" />).container;
    expect(el.querySelectorAll(".dl")).toHaveLength(3);
    expect(el.querySelector(".diff-cut .mono")?.textContent).toMatch(/ \/ 212\.0 KB$/);
    expect(el.textContent).not.toContain("truncated");
  });
});

describe("a new file", () => {
  it("counts its real lines with no empty + line at the end", async () => {
    seed([{ path: "src/new.ts", op: "A" }]);
    fx.diffByPath["src/new.ts"] = {
      path: "src/new.ts",
      source: { source: "new_file", patch: "diff --git a/src/new.ts b/src/new.ts\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n" },
      truncated: null,
    };
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelectorAll(".dl.add")).toHaveLength(2));
    expect(container.querySelector(".chg-fh .diff-stat")?.textContent).toBe("+2−0");
    expect(container.textContent).toContain(t("diff.newFileNote"));
  });
});

describe("the zero side", () => {
  it("is grey, not red", async () => {
    seed([{ path: "src/new.ts", op: "A" }]);
    fx.diffByPath["src/new.ts"] = { path: "src/new.ts", source: { source: "new_file", patch: "@@ -0,0 +1 @@\n+one\n" }, truncated: null };
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-fh .diff-stat")).not.toBeNull());
    expect(container.querySelector(".chg-fh .diff-stat .zero")?.textContent).toBe("−0");
    expect(container.querySelector(".chg-fh .diff-stat .del")).toBeNull();
  });
});

describe("judging sent notes", () => {
  function sendOne(file: string) {
    act(() => {
      startNote(1, { file, side: "new", line: 1, code: "const keepThisLine = 1;" });
      saveNote(1, "fix it");
      markSent(1);
    });
  }
  let notes: DiffNote[] = [];
  function Grab() {
    notes = useDiffNotes(1).notes;
    return null;
  }

  it("keeps the verdict when the file can't be read for another reason", async () => {
    seed([{ path: "src/a.ts", op: "M" }]);
    fx.files.set("src/a.ts", { err: "Failed to read file: Permission denied (os error 13)" });
    render(<Grab />);
    renderDiffScreen();
    sendOne("src/a.ts");
    await waitFor(() => expect(fx.reads).toContain("src/a.ts"));
    await new Promise((r) => setTimeout(r, 20));
    expect(notes[0].fixed).toBe(false);
  });

  it("says changed when the file is gone", async () => {
    seed([{ path: "src/a.ts", op: "M" }]);
    render(<Grab />);
    renderDiffScreen();
    sendOne("src/a.ts");
    await waitFor(() => expect(notes[0].fixed).toBe(true));
  });
});

describe("the last commit", () => {
  it("names the commit above the list with a mono sha", async () => {
    fx.lastCommit = { sha: "a1b2c3d4e5", short_sha: "a1b2c3d", subject: "ship the thing", changes: [{ path: "src/a.ts", op: "M" }] };
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-commit")).not.toBeNull());
    expect(container.querySelector(".chg-commit .mono")?.textContent).toBe("a1b2c3d");
    expect(container.querySelector(".chg-commit")?.textContent).toBe("a1b2c3d · ship the thing");
  });
});

describe("the verification footer", () => {
  const LINE = "pnpm test 1040 passed · typecheck 0 · cargo test 1099 passed · clippy -D warnings 0, eyes not checked";

  it("keeps the end of the line, shows the whole line on hover, and has no check mark before pressing", async () => {
    fx.journal = { body_markdown: `[x] t\n\n## Verification\n- ${LINE}\n` };
    const { container, getByRole } = render(
      <DiffEntryFooter projectId={1} group={entryGroup("20260820/Bugs/1000_bug_a.md", "t", ["src/a.ts"])} onToggleVerified={() => {}} />,
    );
    await waitFor(() => expect(container.querySelector(".def-line")?.getAttribute("title")).toBe(LINE));
    expect(container.querySelector(".def-tail")?.textContent).toBe(" · clippy -D warnings 0, eyes not checked");
    expect(getByRole("button", { name: t("diff.copyVerify") })).toBeTruthy();
    const read = getByRole("button", { name: t("diff.markRead") });
    expect(read.querySelector("svg")).toBeNull();
    expect(splitTail("short")).toEqual(["", "short"]);
  });
});
