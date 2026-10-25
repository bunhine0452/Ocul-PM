/**
 * 터미널 시안 A — 머리줄 한 줄 · 보기 메뉴 `Aa` · 상태만 남긴 상태바 (2026-10-25).
 *
 * 예전 터미널 화면은 위에 줄이 셋(화면 툴바 · 세션 줄 · 페인 머리띠)이었고, 상태바에
 * 키캡 넷·밀도 세그먼트·글자 크기 스테퍼가 상시로 떠 있었다. 세션 이름 자리에는
 * 셸 제목 `.` 이 굳어 점 하나만 보였다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/bindings", () => ({ commands: {}, events: {} }));

import { TerminalHeadBar } from "@/features/terminal/TerminalHeadBar";
import { TerminalStatusBar } from "@/features/terminal/TerminalStatusBar";
import { TerminalViewMenu } from "@/features/terminal/TerminalViewMenu";
import { canAutoRename, shellTitleToTabLabel } from "@/features/terminal/tabTitle";
import type { TerminalFont } from "@/features/terminal/useTerminalFont";
import type { TerminalTab } from "@/contexts/WorkspaceContext";

afterEach(cleanup);

const tab: TerminalTab = { id: "t1", label: "ai-pm", shell: "", cwd: "" };

function headBar(extra: Partial<React.ComponentProps<typeof TerminalHeadBar>> = {}) {
  return render(
    <TerminalHeadBar
      railCollapsed={false}
      onToggleRail={() => {}}
      activeTab={tab}
      onSearch={() => {}}
      onSplit={() => {}}
      zoomed={false}
      onUnzoom={() => {}}
      dragRegion={false}
      viewMenu={<button type="button">Aa</button>}
      {...extra}
    >
      <button type="button">도크로</button>
    </TerminalHeadBar>,
  );
}

describe("머리줄 — 화면에서는 화면 툴바 한 줄", () => {
  it("screenTitle 이 있으면 툴바 하나에 「터미널 / 세션」과 도구가 다 들어간다", () => {
    const { container } = headBar({ screenTitle: "터미널" });
    const toolbars = container.querySelectorAll(".toolbar");
    expect(toolbars).toHaveLength(1);
    expect(container.querySelector(".term-head")).toBeNull();
    const bar = toolbars[0]!;
    expect(bar.textContent).toContain("터미널");
    expect(bar.textContent).toContain("ai-pm");
    expect(bar.textContent).toContain("Aa");
    expect(bar.textContent).toContain("도크로");
  });

  it("도크·분리 창(screenTitle 없음)은 예전처럼 얇은 머리줄이다", () => {
    const { container } = headBar();
    expect(container.querySelector(".toolbar")).toBeNull();
    expect(container.querySelector(".term-head")?.textContent).toContain("ai-pm");
  });
});

describe("보기 메뉴 Aa", () => {
  const font = (): TerminalFont => ({
    fontSize: 12,
    fontDraft: null,
    setFontDraft: vi.fn(),
    setFont: vi.fn(),
    fontDelta: vi.fn(),
    fontReset: vi.fn(),
    commitFontDraft: vi.fn(),
  });

  it("누르면 글자 크기와 줄 간격이 열리고, Escape 로 닫힌다", () => {
    const f = font();
    const onDensity = vi.fn();
    render(<TerminalViewMenu font={f} density="standard" onDensity={onDensity} />);
    const btn = screen.getByRole("button", { name: /보기/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /글자 크게/ }));
    expect(f.fontDelta).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "조밀" }));
    expect(onDensity).toHaveBeenCalledWith("compact");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("상태바 — 상태만", () => {
  it("키캡·스테퍼·밀도 세그먼트가 없고, 셸 통합이 꺼졌을 때만 켜기 링크가 있다", () => {
    const onEnable = vi.fn();
    const { container, rerender } = render(
      <TerminalStatusBar
        compact={false}
        shellStatus="off"
        onEnableShell={onEnable}
        fontSize={12}
        density="standard"
        watchTone="off"
        watchLabel="감시 꺼짐"
      />,
    );
    expect(container.querySelector("kbd")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("12px · 표준");
    fireEvent.click(screen.getByRole("button", { name: "켜기" }));
    expect(onEnable).toHaveBeenCalled();

    rerender(
      <TerminalStatusBar
        compact
        shellStatus="active"
        onEnableShell={onEnable}
        fontSize={12}
        density="standard"
        watchTone="on"
        watchLabel=".oculpm 감시중"
      />,
    );
    expect(screen.queryByRole("button", { name: "켜기" })).toBeNull();
    expect(container.textContent).not.toContain("12px");
  });
});

describe("세션 이름 — 기호뿐인 셸 제목은 이름이 아니다", () => {
  it("`.` 같은 제목은 버리고, 회전 기호는 떼어 낸다", () => {
    expect(shellTitleToTabLabel(".")).toBeNull();
    expect(shellTitleToTabLabel("✳")).toBeNull();
    expect(shellTitleToTabLabel("✳ Claude Code")).toBe("Claude Code");
    expect(shellTitleToTabLabel("⠂ 저장 흐름 보강")).toBe("저장 흐름 보강");
    // 홈·루트는 기호뿐이어도 자리 이름이다.
    expect(shellTitleToTabLabel("~")).toBe("~");
  });

  it("이미 `.` 로 굳은 탭은 다음 제목에서 낫는다", () => {
    expect(canAutoRename(".")).toBe(true);
    expect(canAutoRename("my build")).toBe(false);
  });
});
