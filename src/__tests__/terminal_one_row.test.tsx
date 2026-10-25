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
import { t } from "@/i18n";

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
      <button type="button">{t("term.dock.move")}</button>
    </TerminalHeadBar>,
  );
}

describe("head bar — one toolbar row on the screen", () => {
  it("with screenTitle, one toolbar carries title / session and every tool", () => {
    const { container } = headBar({ screenTitle: t("term.title") });
    const toolbars = container.querySelectorAll(".toolbar");
    expect(toolbars).toHaveLength(1);
    expect(container.querySelector(".term-head")).toBeNull();
    const bar = toolbars[0]!;
    expect(bar.textContent).toContain(t("term.title"));
    expect(bar.textContent).toContain("ai-pm");
    expect(bar.textContent).toContain("Aa");
    expect(bar.textContent).toContain(t("term.dock.move"));
  });

  it("dock and detached window (no screenTitle) keep the thin head bar", () => {
    const { container } = headBar();
    expect(container.querySelector(".toolbar")).toBeNull();
    expect(container.querySelector(".term-head")?.textContent).toContain("ai-pm");
  });
});

describe("view menu Aa", () => {
  const font = (): TerminalFont => ({
    fontSize: 12,
    fontDraft: null,
    setFontDraft: vi.fn(),
    setFont: vi.fn(),
    fontDelta: vi.fn(),
    fontReset: vi.fn(),
    commitFontDraft: vi.fn(),
  });

  it("opens font size and density, closes on Escape", () => {
    const f = font();
    const onDensity = vi.fn();
    render(<TerminalViewMenu font={f} density="standard" onDensity={onDensity} />);
    const btn = screen.getByRole("button", { name: t("term.view.label") });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: t("term.fontLarger") }));
    expect(f.fontDelta).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: t("term.density.compact") }));
    expect(onDensity).toHaveBeenCalledWith("compact");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("status bar — status only", () => {
  it("has no keycaps, stepper or density segment; offers enable only when shell integration is off", () => {
    const onEnable = vi.fn();
    const { container, rerender } = render(
      <TerminalStatusBar
        compact={false}
        shellStatus="off"
        onEnableShell={onEnable}
        fontSize={12}
        density="standard"
        watchTone="off"
        watchLabel={t("term.watchOff")}
      />,
    );
    expect(container.querySelector("kbd")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain(`12px · ${t("term.density.standard")}`);
    fireEvent.click(screen.getByRole("button", { name: t("term.status.enable") }));
    expect(onEnable).toHaveBeenCalled();

    rerender(
      <TerminalStatusBar
        compact
        shellStatus="active"
        onEnableShell={onEnable}
        fontSize={12}
        density="standard"
        watchTone="on"
        watchLabel={t("term.watchRunning")}
      />,
    );
    expect(screen.queryByRole("button", { name: t("term.status.enable") })).toBeNull();
    expect(container.textContent).not.toContain("12px");
  });
});

describe("session name — a symbol-only shell title is not a name", () => {
  it("drops titles like `.` and strips the spinner glyph", () => {
    expect(shellTitleToTabLabel(".")).toBeNull();
    expect(shellTitleToTabLabel("✳")).toBeNull();
    expect(shellTitleToTabLabel("✳ Claude Code")).toBe("Claude Code");
    expect(shellTitleToTabLabel("⠂ Saving flow")).toBe("Saving flow");
    // 홈·루트는 기호뿐이어도 자리 이름이다.
    expect(shellTitleToTabLabel("~")).toBe("~");
  });

  it("a tab already stuck on `.` heals on the next title", () => {
    expect(canAutoRename(".")).toBe(true);
    expect(canAutoRename("my build")).toBe(false);
  });
});
