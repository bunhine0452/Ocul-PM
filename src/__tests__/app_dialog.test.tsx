import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach } from "vitest";
import { useState } from "react";

import { AppDialog } from "@/components/ui/AppDialog";

// v2 U13 (docs/20260706_v2/01-ux-spec.md §5) — 모달 프리미티브 계약:
// 초기 포커스 / Tab 순환 트랩 / Esc 닫기 / 트리거 포커스 복원.

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        열기
      </button>
      <AppDialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        label="테스트 다이얼로그"
      >
        <button data-testid="first">첫 버튼</button>
        <input data-testid="mid" placeholder="입력" />
        <button data-testid="last">마지막 버튼</button>
      </AppDialog>
    </div>
  );
}

afterEach(() => cleanup());

describe("AppDialog", () => {
  it("열리면 내부 첫 포커서블로 포커스가 이동한다", () => {
    const { getByTestId } = render(<Harness />);
    getByTestId("trigger").focus();
    fireEvent.click(getByTestId("trigger"));
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("Tab 이 다이얼로그 안에서 순환한다 (트랩)", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId("trigger"));
    const dialog = getByTestId("last").closest("[role=dialog]")!;
    // 마지막 요소에서 Tab → 첫 요소로 순환.
    getByTestId("last").focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
    // 첫 요소에서 Shift+Tab → 마지막 요소로 순환.
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("last"));
  });

  it("Esc 로 닫히고 트리거로 포커스가 복원된다", () => {
    const onClose = vi.fn();
    const { getByTestId, queryByRole } = render(<Harness onClose={onClose} />);
    const trigger = getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    expect(queryByRole("dialog")).not.toBeNull();
    fireEvent.keyDown(getByTestId("first"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("백드롭 클릭으로 닫힌다 (패널 내부 클릭은 무시)", () => {
    const onClose = vi.fn();
    const { getByTestId, getByRole } = render(<Harness onClose={onClose} />);
    fireEvent.click(getByTestId("trigger"));
    fireEvent.mouseDown(getByTestId("first")); // 패널 내부 — 유지
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = getByRole("dialog").parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
