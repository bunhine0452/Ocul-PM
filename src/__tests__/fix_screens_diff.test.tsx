// 최종 검수 고침 (11-15 fix-screens) — 변경 화면. 목록이 비어도 채운 단추는 하나(RC-14), 바닥줄의 검증 줄은 본문
// 서체에 기계 글씨만 mono(V-08), 반영된 메모는 오늘의 「바뀜」 과 다른 낱말(RC-07), 띠의 동작은 오늘 · 터미널과 같은
// 이름(RC-09).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { DiffEntryFooter } from "@/features/diff/DiffEntryFooter";
import { markSent, saveNote, startNote } from "@/features/diff/diffNoteStore";
import { t } from "@/i18n";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { entryGroup, fx, looseGroup, renderDiffScreen, resetFx, seed } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

const primaries = (el: HTMLElement) => [...el.querySelectorAll(".btn.primary")].map((b) => b.textContent);
const LAST = { sha: "a1b2c3d4e5", short_sha: "a1b2c3d", subject: "ship the thing", changes: [{ path: "src/b.ts", op: "M" }] };

describe("RC-14 — one filled button when the 'before commit' list empties with an unsent note", () => {
  /** 메모를 쓰고 보내기 전에 커밋한다 — 「커밋 전」 을 고른 채 목록이 빈다. */
  async function noteThenCommit(withNote: boolean) {
    fx.lastCommit = LAST;
    seed([{ path: "src/a.ts", op: "M" }]);
    const view = renderDiffScreen();
    const working = await screen.findByRole("radio", { name: `${t("diff.modeWorking")} 1` });
    fireEvent.click(working);
    if (withNote) {
      act(() => {
        startNote(1, { file: "src/a.ts", side: "new", line: 1, code: "const keepThisLine = 1;" });
        saveNote(1, "rename");
      });
    }
    act(() => recentChangesStore.clear());
    await screen.findByRole("button", { name: t("diff.lastCommit") });
    return view;
  }

  it("the unsent notes' 'hand N notes' is the filled one; the empty state's 'last commit' steps down", async () => {
    const { container } = await noteThenCommit(true);
    expect(primaries(container)).toEqual([t("diff.notes.send", { n: 1 })]);
    expect(screen.getByRole("button", { name: t("diff.lastCommit") }).className).not.toContain("primary");
  });

  it("with no notes the empty state's 'last commit' is the screen's one filled button", async () => {
    const { container } = await noteThenCommit(false);
    expect(primaries(container)).toEqual([t("diff.lastCommit")]);
  });
});

describe("V-08 — the footer's verification line is body type with mono only around commands and results", () => {
  it("no mono on the whole line; the tooltip and copy are plain text", async () => {
    fx.journal = { body_markdown: "[x] t\n\n## Verification\n- after merge: `pnpm test` 1652 passed · not eyeballed\n" };
    const { container } = render(
      <DiffEntryFooter projectId={1} group={entryGroup("20260820/Bugs/1000_bug_a.md", "t", ["src/a.ts"])} onToggleVerified={() => {}} />,
    );
    await waitFor(() => expect(container.querySelector(".def-line .mono")).not.toBeNull());
    const line = container.querySelector(".def-line")!;
    expect(line.className).toBe("def-line");
    expect([...line.querySelectorAll(".mono")].map((m) => m.textContent)).toEqual(["pnpm test 1652 passed"]);
    expect(line.getAttribute("title")).toBe("after merge: pnpm test 1652 passed · not eyeballed");
    expect(line.textContent).toBe("after merge: pnpm test 1652 passed · not eyeballed");
  });
});

describe("RC-07 — a note whose line changed is 'taken effect', not Today's amber 'changed'", () => {
  it("the toolbar tally and the note chip use the notes' own word", async () => {
    seed([{ path: "src/a.ts", op: "M" }]);
    const { container } = renderDiffScreen();
    act(() => {
      startNote(1, { file: "src/a.ts", side: "new", line: 1, code: "const keepThisLine = 1;" });
      saveNote(1, "fix it");
      markSent(1);
    });
    // 파일이 사라졌다 — 그 줄은 반영된 것으로 본다.
    await waitFor(() => expect(container.querySelector(".chip.sm.ok")?.textContent).toBe(t("diff.notes.progress", { fixed: 1, n: 1 })));
    expect(container.querySelector(".chip.sm.ok")?.textContent).not.toContain(t("today.check.kind.stale"));
  });
});

describe("RC-09 — the banner asks for an entry with the same verb as Today and the terminal band", () => {
  it("one name for one action", async () => {
    fx.groups = [entryGroup("20260820/Bugs/1000_bug_a.md", "one", ["src/w1.ts"]), looseGroup(["src/a.ts", "src/b.ts"])];
    seed(["src/w1.ts", "src/a.ts", "src/b.ts"].map((path) => ({ path, op: "M" as const })));
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-banner")).not.toBeNull());
    const ask = [...container.querySelectorAll(".chg-banner .btn")].map((b) => b.textContent);
    expect(ask).toContain(t("today.check.askJournal"));
    expect(ask).toContain(t("terminal.askRecord"));
  });
});
