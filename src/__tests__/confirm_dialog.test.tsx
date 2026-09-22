import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { useConfirm } from "@/hooks/useConfirm";
import { runningWorkItems } from "@/lib/closeIntent";
import { t } from "@/i18n";

// 확인 대화상자(useConfirm) — 2026-09-21 리디자인 계약.
//
// 사용자: "닫으려고 하면 뜨는 모달이 아마추어 같고, 뜬 뒤에 Enter 를 쳐도 안
// 닫힌다." 뒤쪽은 첫 포커서블이 「취소」라서였다 — Enter 가 취소 버튼을 눌러
// 아무 일도 안 일어난 것처럼 보였다. 이제 확인 버튼이 포커스를 받고, 패널
// 어디서든 Enter 는 확인, Esc 는 취소다.

function Harness({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const [asked, setAsked] = useState(false);
  return (
    <div>
      <button
        data-testid="trigger"
        onClick={() => {
          setAsked(true);
          void confirm({
            title: t("close.guard.title"),
            message: t("close.guard.detail"),
            items: runningWorkItems(["claude", "pnpm dev", "a", "b", "c", "d"], 2, t),
            confirmLabel: t("close.guard.confirm"),
            danger: true,
          }).then(onAnswer);
        }}
      >
        open
      </button>
      {asked ? confirmDialog : null}
    </div>
  );
}

afterEach(() => cleanup());

describe("useConfirm — close guard", () => {
  it("focuses the confirm button on open, and a single Enter answers", async () => {
    const answers: boolean[] = [];
    render(<Harness onAnswer={(ok) => answers.push(ok)} />);
    fireEvent.click(screen.getByTestId("trigger"));

    const confirmBtn = (await screen.findByText(t("close.guard.confirm"))).closest("button");
    expect(confirmBtn).not.toBeNull();
    expect(document.activeElement).toBe(confirmBtn);

    // 포커스가 버튼이 아닌 패널 자체에 있어도 Enter 는 확인이다.
    const panel = screen.getByRole("dialog");
    panel.focus();
    fireEvent.keyDown(panel, { key: "Enter" });
    await waitFor(() => expect(answers).toEqual([true]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Enter on the cancel button cancels, and Esc always cancels", async () => {
    const answers: boolean[] = [];
    render(<Harness onAnswer={(ok) => answers.push(ok)} />);
    fireEvent.click(screen.getByTestId("trigger"));
    const cancel = (await screen.findByText(t("common.cancel"))).closest("button")!;

    // 버튼 위의 Enter 는 패널 핸들러가 가로채지 않는다 (버튼 자신이 click 을 낸다).
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Enter" });
    expect(answers).toEqual([]);
    fireEvent.click(cancel);
    await waitFor(() => expect(answers).toEqual([false]));

    fireEvent.click(screen.getByTestId("trigger"));
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(answers).toEqual([false, false]));
  });

  it("running work is a list, not a sentence — four mono names, then 'and n more', then sessions", async () => {
    render(<Harness onAnswer={() => {}} />);
    fireEvent.click(screen.getByTestId("trigger"));
    await screen.findByRole("dialog");

    const items = Array.from(document.querySelectorAll(".cf-item")).map((el) => el.textContent);
    expect(items).toEqual([
      "claude",
      "pnpm dev",
      "a",
      "b",
      t("close.guard.more", { n: 2 }),
      t("close.guard.agents", { n: 2 }),
    ]);
    expect(document.querySelectorAll(".cf-item.mono").length).toBe(4);
    // 위험 표식 + 단색 위험 버튼.
    expect(document.querySelector(".cf.danger .cf-mark")).not.toBeNull();
    expect(document.querySelector(".btn.cf-confirm.danger")).not.toBeNull();
  });
});
