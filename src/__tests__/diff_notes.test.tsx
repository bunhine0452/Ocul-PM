import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// 변경 줄 메모 (10-30, Orca 「Annotate AI Diffs」) — 줄마다 메모를 달고, 한 번에 묶어 Claude 에게.
import { setLangSetting, t } from "@/i18n";
import { PatchView } from "@/features/diff/PatchView";
import {
  applyResolution,
  clearNotes,
  composeNotes,
  hydrateNotes,
  markSent,
  removeNote,
  resolveNotes,
  saveNote,
  startNote,
  useDiffNotes,
  type DiffNote,
} from "@/features/diff/diffNoteStore";

const PATCH = [
  "@@ -10,3 +10,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
].join("\n");

afterEach(() => {
  act(() => clearNotes(1));
  cleanup();
});

function Count() {
  return <span data-testid="count">{useDiffNotes(1).notes.length}</span>;
}

describe("diff notes", () => {
  it("adds a note from the gutter, saves with Cmd+Enter and edits it in place", () => {
    setLangSetting("en");
    render(
      <>
        <PatchView patch={PATCH} mode="unified" notes={{ projectId: 1, file: "src/a.ts" }} />
        <Count />
      </>,
    );
    // 새 쪽 11행(추가 줄)의 「+」.
    const plus = screen.getAllByRole("button", { name: "Note on line 11" });
    fireEvent.click(plus[plus.length - 1]);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "use a named constant" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByText("use a named constant")).toBeTruthy();

    // 카드를 누르면 같은 줄을 고친다 — 메모는 여전히 하나.
    fireEvent.click(screen.getByText("use a named constant"));
    const again = screen.getByRole("textbox");
    fireEvent.change(again, { target: { value: "name it RETRIES" } });
    fireEvent.keyDown(again, { key: "Enter", metaKey: true });
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByText("name it RETRIES")).toBeTruthy();
  });

  it("cancels with Escape and leaves nothing behind", () => {
    setLangSetting("en");
    render(
      <>
        <PatchView patch={PATCH} mode="split" notes={{ projectId: 1, file: "src/a.ts" }} />
        <Count />
      </>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Note on line 10" })[0]);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("draws no note controls where notes are off (journal detail)", () => {
    render(<PatchView patch={PATCH} mode="unified" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("composes one batch grouped by file and ordered by line", () => {
    setLangSetting("en");
    const at = (file: string, side: "new" | "old", line: number, code: string, text: string) => {
      startNote(1, { file, side, line, code });
      saveNote(1, text);
    };
    act(() => {
      at("src/b.ts", "new", 30, "return x;", "handle null");
      at("src/a.ts", "new", 11, "const b = 3;", "why 3?\nexplain");
      at("src/a.ts", "old", 11, "const b = 2;", "keep the old default");
      at("src/a.ts", "new", 2, "x", "   ");
    });
    let notes: ReturnType<typeof useDiffNotes>["notes"] = [];
    function Grab() {
      notes = useDiffNotes(1).notes;
      return null;
    }
    render(<Grab />);
    // 빈 메모는 남지 않는다.
    expect(notes).toHaveLength(3);
    expect(composeNotes(notes, t)).toBe(
      [
        "src/a.ts",
        "- line 11 `const b = 3;` — why 3?\n  explain",
        "- removed line 11 `const b = 2;` — keep the old default",
        "",
        "src/b.ts",
        "- line 30 `return x;` — handle null",
      ].join("\n"),
    );
    act(() => removeNote(1, { file: "src/b.ts", side: "new", line: 30 }));
    expect(notes).toHaveLength(2);
  });
});

// Orca 를 넘어서 (#notes-track) — 보낸 메모는 남고, 파일의 지금 내용과 견줘 고쳐졌는지를 저절로 안다.
describe("sent notes track themselves", () => {
  const sent = (line: number, code: string, extra: Partial<DiffNote> = {}): DiffNote => ({
    file: "src/a.ts",
    side: "new",
    line,
    code,
    text: "fix it",
    sent: true,
    fixed: false,
    ...extra,
  });

  it("judges against the current file: same line open, moved line follows, gone is fixed", () => {
    const file = ["import x;", "", "const b = 3;", "const RETRIES = 3;"].join("\n");
    const [same, moved, gone, oldSide, draft] = resolveNotes(
      [
        sent(3, "const b = 3;"),
        sent(1, "const RETRIES = 3;"),
        sent(2, "const c = 4;"),
        sent(2, "removed();", { side: "old" }),
        { ...sent(3, "const b = 3;"), sent: false },
      ],
      new Map([["src/a.ts", file]]),
    );
    expect([same.fixed, same.line]).toEqual([false, 3]);
    expect([moved.fixed, moved.line]).toEqual([false, 4]);
    expect(gone.fixed).toBe(true);
    expect(oldSide.fixed).toBe(false); // 지운 줄의 메모는 판정하지 않는다
    expect(draft.fixed).toBe(false); // 안 보낸 메모도
    // 읽지 못한(지워진) 파일의 메모는 고쳐짐 — 줄이 남지 않았다.
    expect(resolveNotes([sent(1, "x")], new Map([["src/a.ts", null]]))[0].fixed).toBe(true);
  });

  it("marks only drafts as sent, keeps them, shows the verdict on the card, and loads once", () => {
    setLangSetting("en");
    act(() => {
      startNote(1, { file: "src/a.ts", side: "new", line: 11, code: "+const b = 3;" });
      saveNote(1, "why 3?");
      markSent(1);
    });
    let notes: DiffNote[] = [];
    function Grab() {
      notes = useDiffNotes(1).notes;
      return null;
    }
    render(
      <>
        <Grab />
        <PatchView patch={PATCH} mode="unified" notes={{ projectId: 1, file: "src/a.ts" }} />
      </>,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].sent).toBe(true);
    expect(screen.getByText(t("diff.notes.open"))).toBeTruthy();
    // 파일에서 그 줄이 사라지면 「고쳐짐」.
    act(() => applyResolution(1, new Map([["src/a.ts", "const a = 1;\nconst b = 4;\n"]])));
    expect(notes[0].fixed).toBe(true);
    expect(screen.getByText(t("diff.notes.fixed"))).toBeTruthy();
    // 영속분은 창이 열린 뒤 한 번만 싣는다 — 두 번째 부름은 지금 것을 덮지 않는다.
    act(() => hydrateNotes(7, [sent(1, "x")]));
    act(() => hydrateNotes(7, []));
    let seven: DiffNote[] = [];
    function GrabSeven() {
      seven = useDiffNotes(7).notes;
      return null;
    }
    render(<GrabSeven />);
    expect(seven).toHaveLength(1);
  });
});
