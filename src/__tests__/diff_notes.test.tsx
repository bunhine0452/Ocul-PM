import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// 변경 줄 메모 (10-30, Orca 「Annotate AI Diffs」) — 줄마다 메모를 달고, 한 번에 묶어 Claude 에게.
import { setLangSetting, t } from "@/i18n";
import { PatchView } from "@/features/diff/PatchView";
import {
  clearNotes,
  composeNotes,
  removeNote,
  saveNote,
  startNote,
  useDiffNotes,
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
