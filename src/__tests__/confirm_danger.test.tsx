/**
 * 위험 확인은 손이 한 번 더 간다 (11-15).
 *
 * ⌘W 뒤에 뜨는 「터미널 세션을 끝낼까요?」 에서 위험 단추가 포커스를 쥐고 있어, 무심코 친 ↩ 한 번이
 * 일하던 Claude 세션을 끝냈다. 이제 위험 질문은 열리면 「취소」 가 포커스를 받고, 확정은 ⌘↩ 뿐이다.
 * 보통 질문은 그대로 — 확인이 포커스를 받고 ↩ 한 번이 답이다 (confirm_dialog.test.tsx).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { useConfirm } from "@/hooks/useConfirm";
import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";

const END = () => t("terminal.closeAsk.confirm");

function Harness({ danger, onAnswer }: { danger: boolean; onAnswer: (ok: boolean) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const [asked, setAsked] = useState(false);
  return (
    <div>
      <button
        data-testid="trigger"
        onClick={() => {
          setAsked(true);
          void confirm({
            title: t("terminal.closeAsk.title", { n: 1 }),
            message: t("terminal.closeAsk.body"),
            items: [{ text: "claude · ai-pm", mono: true }],
            confirmLabel: END(),
            danger,
          }).then(onAnswer);
        }}
      >
        open
      </button>
      {asked ? confirmDialog : null}
    </div>
  );
}

async function open(danger: boolean) {
  const answers: boolean[] = [];
  render(<Harness danger={danger} onAnswer={(ok) => answers.push(ok)} />);
  fireEvent.click(screen.getByTestId("trigger"));
  const dialog = await screen.findByRole("dialog");
  const cancel = screen.getByRole("button", { name: t("common.cancel") });
  const confirmBtn = screen.getByRole("button", { name: END() });
  return { answers, dialog, cancel, confirmBtn };
}

afterEach(() => cleanup());

describe("danger confirm — first focus on cancel, only ⌘↩ confirms", () => {
  it("the first activeElement is cancel", async () => {
    const { cancel, confirmBtn } = await open(true);
    expect(document.activeElement).toBe(cancel);
    expect(document.activeElement).not.toBe(confirmBtn);
  });

  it("a bare ↩ anywhere on the panel does not confirm", async () => {
    const { answers, dialog } = await open(true);
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 20));
    expect(answers).toEqual([]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("⌘↩ confirms — even with focus on cancel", async () => {
    const { answers, cancel } = await open(true);
    cancel.focus();
    const ev = fireEvent.keyDown(cancel, { key: "Enter", metaKey: true });
    // 기본 동작(취소 단추 누르기)은 막는다.
    expect(ev).toBe(false);
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("⇧⌘↩ (the terminal's zoom key) and ⌥⌘↩ do nothing — no confirm, no button press", async () => {
    const { answers, cancel } = await open(true);
    cancel.focus();
    for (const extra of [{ shiftKey: true }, { altKey: true }]) {
      const ev = fireEvent.keyDown(cancel, { key: "Enter", metaKey: true, ...extra });
      // 기본 동작(포커스된 「취소」 누르기)도 막는다 — 줌을 누른 손이 질문을 닫지 않는다.
      expect(ev).toBe(false);
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(answers).toEqual([]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Windows · Linux use Ctrl+Enter, and the hint says so", async () => {
    __setPlatformForTests("windows");
    const { answers, cancel, confirmBtn } = await open(true);
    expect(confirmBtn.querySelector(".dlg-key")?.textContent).toBe("Ctrl+Enter");
    fireEvent.keyDown(cancel, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(answers).toEqual([true]));
  });

  it("the danger button hint is ⌘↩, not ↩", async () => {
    const { confirmBtn, cancel } = await open(true);
    expect(confirmBtn.querySelector(".dlg-key")?.textContent).toBe("⌘↩");
    expect(cancel.querySelector(".dlg-key")?.textContent).toBe("Esc");
    // 키 표기는 접근명에 섞이지 않는다.
    expect(confirmBtn).toHaveAccessibleName(END());
  });

  it("Esc always cancels", async () => {
    const { answers, dialog } = await open(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(answers).toEqual([false]));
  });
});

describe("plain confirm unchanged — focus on confirm, one ↩", () => {
  it("first focus is the confirm button and its hint is ↩", async () => {
    const { confirmBtn } = await open(false);
    expect(document.activeElement).toBe(confirmBtn);
    expect(confirmBtn.querySelector(".dlg-key")?.textContent).toBe("↩");
  });

  it("⌘↩ confirms too", async () => {
    const { answers, dialog } = await open(false);
    fireEvent.keyDown(dialog, { key: "Enter", metaKey: true });
    await waitFor(() => expect(answers).toEqual([true]));
  });
});

describe("one dialog kit — head · body · foot", () => {
  it("the confirm stands on .dlg-head · .dlg-body · .dlg-foot", async () => {
    const { dialog } = await open(true);
    expect(dialog.querySelector(".dlg-head .dlg-title")?.textContent).toBe(t("terminal.closeAsk.title", { n: 1 }));
    expect(dialog.querySelector(".dlg-body .cf-item.mono")?.textContent).toBe("claude · ai-pm");
    const foot = dialog.querySelector(".dlg-foot")!;
    expect(foot.querySelectorAll("button")).toHaveLength(2);
    // 위험 질문의 표식은 빨간 삼각형(머리) — 초록 틴트 네모는 걷었다.
    expect(dialog.querySelector(".cf.danger .dlg-head .cf-mark")).not.toBeNull();
  });
});
