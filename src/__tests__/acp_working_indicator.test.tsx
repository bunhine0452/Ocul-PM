import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { Sidebar } from "@/components/Sidebar";
import {
  acpWorkingKey,
  resetAcpWorking,
  setAcpAttention,
  setAcpWorking,
} from "@/features/chat/acpBusyBus";

// 2026-08-16 — "다른 화면으로 가면 돌던 세션이 안 보인다".
//
// 화면을 옮겨도 턴은 계속 돈다(ShellV2 keep-alive). 그러면 **돌고 있다는 사실**도
// 화면을 따라와야 한다 — 사이드바의 Claude Code 줄이 그 자리다.

afterEach(() => {
  cleanup();
  resetAcpWorking();
});

function renderSidebar(currentProjectId = 1) {
  return render(
    <Sidebar
      view="today"
      onNavigate={() => {}}
      projectName="ai-pm"
      projectPath="~/dev/ai-pm"
      onOpenProjectSwitcher={() => {}}
      currentProjectId={currentProjectId}
      isDark={false}
      onToggleTheme={() => {}}
    />,
  );
}

describe("사이드바 작업 중 표시", () => {
  it("도는 세션이 없으면 배지가 없다", () => {
    renderSidebar();
    expect(screen.queryByText("1개 작업 중")).toBeNull();
    expect(document.querySelector(".nav-badge.working")).toBeNull();
  });

  it("턴이 시작되면 수와 도는 고리가 나타나고, 끝나면 사라진다", () => {
    renderSidebar();

    act(() => setAcpWorking(acpWorkingKey(1, "s-1"), true));
    expect(document.querySelector(".nav-badge.working")?.textContent).toBe("1");
    expect(document.querySelector(".nav-ico.working")).not.toBeNull();

    act(() => setAcpWorking(acpWorkingKey(1, "s-1"), false));
    expect(document.querySelector(".nav-badge.working")).toBeNull();
    expect(document.querySelector(".nav-ico.working")).toBeNull();
  });

  it("한 프로젝트 안의 세션만 센다 — 같은 세션을 두 번 세지는 않는다", () => {
    // 2026-09-01 — 예전엔 `working.size` 를 그대로 그려 **모든 프로젝트의 합**이
    // 탭마다 붙었다 (아무것도 안 도는 탭이 "2 실행 중"). 사이드바는 탭마다
    // 서므로 자기 프로젝트만 세야 한다.
    renderSidebar(1);

    act(() => {
      setAcpWorking(acpWorkingKey(1, "s-1"), true);
      setAcpWorking(acpWorkingKey(1, "s-2"), true);
      // 같은 키를 다시 켜도 수가 늘면 안 된다 (effect 는 여러 번 돈다).
      setAcpWorking(acpWorkingKey(1, "s-1"), true);
      // 남의 프로젝트 세션은 이 사이드바에 보이면 안 된다.
      setAcpWorking(acpWorkingKey(2, "s-9"), true);
    });
    expect(document.querySelector(".nav-badge.working")?.textContent).toBe("2");

    act(() => setAcpWorking(acpWorkingKey(1, "s-2"), false));
    expect(document.querySelector(".nav-badge.working")?.textContent).toBe("1");
  });

  it("남의 프로젝트에서만 돌면 이 탭의 배지는 뜨지 않는다", () => {
    renderSidebar(1);
    act(() => setAcpWorking(acpWorkingKey(2, "s-2"), true));
    expect(document.querySelector(".nav-badge.working")).toBeNull();
    expect(document.querySelector(".nav-ico.working")).toBeNull();
  });

  // 2026-09-06 IA 재편 — Claude Code 줄이 「에이전트」 한 행으로 접혔다.
  // 배지가 붙는 자리는 여전히 그 한 줄이고, 수는 갈래들의 합이다.
  it("배지는 에이전트 줄에만 붙는다", () => {
    renderSidebar();
    act(() => setAcpWorking(acpWorkingKey(1, "s-1"), true));

    const badges = document.querySelectorAll(".nav-badge.working");
    expect(badges).toHaveLength(1);
    const row = badges[0]?.closest(".nav-item");
    expect(row?.textContent).toContain("에이전트");
  });

  /**
   * 행을 하나로 줄였다고 "Codex 가 돈다" 가 사라지면 안 된다 — 접힌 행의
   * 배지는 갈래의 **합**이다. 이게 IA 재편이 지켜야 할 계약이다.
   */
  it("Claude 와 Codex 가 함께 돌면 에이전트 줄의 수가 합쳐진다", () => {
    renderSidebar();
    act(() => {
      setAcpWorking(acpWorkingKey(1, "s-1"), true);
      setAcpWorking(acpWorkingKey(1, "s-2", "codex"), true);
    });

    const badge = document.querySelector(".nav-badge.working");
    expect(badge?.textContent).toBe("2");
  });
});

describe("사이드바 승인 대기 표시", () => {
  /** 승인 대기는 기다린다고 안 풀린다 — 작업 배지보다 우선해 보여야 한다. */
  it("승인 대기가 뜨면 작업 배지 대신 주의 배지가 붙는다", () => {
    renderSidebar();

    act(() => {
      setAcpWorking(acpWorkingKey(1, "s-1"), true);
      setAcpAttention(acpWorkingKey(1, "s-1"), true);
    });
    expect(document.querySelector(".nav-badge.attention")?.textContent).toBe("1");
    expect(document.querySelector(".nav-badge.working")).toBeNull();

    act(() => setAcpAttention(acpWorkingKey(1, "s-1"), false));
    expect(document.querySelector(".nav-badge.attention")).toBeNull();
    // 승인이 풀리면 작업 배지가 돌아온다 — 턴은 계속 도는 중이다.
    expect(document.querySelector(".nav-badge.working")?.textContent).toBe("1");
  });

  it("리셋은 승인 대기도 같이 비운다", () => {
    renderSidebar();
    act(() => setAcpAttention(acpWorkingKey(1, "s-1"), true));
    act(() => resetAcpWorking());
    expect(document.querySelector(".nav-badge.attention")).toBeNull();
  });
});
