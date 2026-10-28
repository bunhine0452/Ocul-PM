import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { useConfirm } from "@/hooks/useConfirm";
import { t } from "@/i18n";

// 확인 대화상자(useConfirm) — 2026-09-21 리디자인 계약.
//
// 사용자: "닫으려고 하면 뜨는 모달이 아마추어 같고, 뜬 뒤에 Enter 를 쳐도 안
// 닫힌다." 뒤쪽은 첫 포커서블이 「취소」라서였다 — Enter 가 취소 버튼을 눌러
// 아무 일도 안 일어난 것처럼 보였다. 이제 확인 버튼이 포커스를 받고, 패널
// 어디서든 Enter 는 확인, Esc 는 취소다. (3.x 의 탭 닫기 문지기는 4.0 에서 탭과
// 함께 걷혔다 — 지금은 시작 창의 「목록에서 빼기」 같은 자리가 쓴다.)

const CONFIRM = () => t("start.forget");

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
            title: t("start.forgetTitle", { name: "aurora" }),
            message: t("start.forgetBody"),
            items: [
              { text: "claude", mono: true },
              { text: "pnpm dev", mono: true },
              { text: t("start.forgetBody") },
            ],
            confirmLabel: CONFIRM(),
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

describe("useConfirm", () => {
  it("focuses the confirm button on open, and a single Enter answers", async () => {
    const answers: boolean[] = [];
    render(<Harness onAnswer={(ok) => answers.push(ok)} />);
    fireEvent.click(screen.getByTestId("trigger"));

    const confirmBtn = (await screen.findByText(CONFIRM())).closest("button");
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

  it("items are a list, mono names in mono — and danger is marked", async () => {
    render(<Harness onAnswer={() => {}} />);
    fireEvent.click(screen.getByTestId("trigger"));
    await screen.findByRole("dialog");

    const items = Array.from(document.querySelectorAll(".cf-item")).map((el) => el.textContent);
    expect(items).toEqual(["claude", "pnpm dev", t("start.forgetBody")]);
    expect(document.querySelectorAll(".cf-item.mono").length).toBe(2);
    expect(document.querySelector(".cf.danger .cf-mark")).not.toBeNull();
    expect(document.querySelector(".btn.cf-confirm.danger")).not.toBeNull();
  });
});
