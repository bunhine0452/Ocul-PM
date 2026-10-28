import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Sidebar } from "@/components/Sidebar";
import { Toolbar } from "@/components/Toolbar";
import { TodayNums } from "@/features/today/TodayNums";
import { evidenceInbox, evidenceSection } from "@/features/oculpm/evidenceInbox";
import { lastResultLine, lastResultStore } from "@/features/terminal/lastResultStore";
import { buildDecisionBody } from "@/features/discussion/discussionDecide";
import { HOLD_SWITCH_VIEWS, parseHiddenViews, toggleHiddenView } from "@/lib/density";
import { consumeResumeOnOpen, requestResumeOnOpen, _resetResumeOnOpen } from "@/lib/resumeIntent";
import type { JournalEntrySummary } from "@/lib/bindings";
import { t } from "@/i18n";

// ─── UI 밀도 라운드 3 — 시안의 나머지 ──────────────────────────────────────
//
// 설정 「표시」의 베타 스위치가 사이드바 행을 **접는다**(숨기지 않는다), 보류 등급 화면의 툴바에
// 「베타 · 결함 수정만」 알약, 오늘 머리글의 숫자 셋, 터미널의 결과 끝 줄과 검증 칸 받은함,
// 논의의 「X 로 결정」, 시작 탭의 「이 맥락으로 이어서 작업」 뜻.

vi.mock("@/hooks/useDensity", () => ({
  useDensity: () => ({ density: "simple", set: () => {}, toggle: () => {} }),
  DensityShortcut: () => null,
}));

const settingsState = vi.hoisted(() => ({ hiddenHoldViews: "", kbdHints: false }));
vi.mock("@/contexts/SettingsContext", () => ({
  useOptionalSettings: () => ({
    settings: { hiddenHoldViews: settingsState.hiddenHoldViews, kbdHints: settingsState.kbdHints },
    set: () => Promise.resolve(),
    loaded: true,
  }),
}));

afterEach(() => {
  cleanup();
  settingsState.hiddenHoldViews = "";
  settingsState.kbdHints = false;
  evidenceInbox._reset();
  lastResultStore._reset();
  _resetResumeOnOpen();
});

describe("베타 화면 스위치 — 접힘이지 숨김이 아니다", () => {
  it("쉼표 문자열 ↔ 집합, 모르는 id 는 버린다", () => {
    expect([...parseHiddenViews("terminal,bogus,ai")]).toEqual(["terminal", "ai"]);
    expect(toggleHiddenView("", "code")).toBe("code");
    expect(toggleHiddenView("code,ai", "code")).toBe("ai");
    expect(HOLD_SWITCH_VIEWS).toHaveLength(5);
  });

  it("꺼 둔 베타 화면의 행은 사이드바에서 빠지되, 그 화면이 열려 있으면 돌아온다", () => {
    settingsState.hiddenHoldViews = "terminal,code,claudecode,codex,ai";
    const { unmount } = render(
      <Sidebar view="today" onNavigate={() => {}} projectName="p" projectPath="~/p" onOpenProjectSwitcher={() => {}} isDark={false} onToggleTheme={() => {}} />,
    );
    // 다섯 다 꺼지면 베타 단 자체가 없다 — 토글은 도구 단 하나뿐.
    expect(document.querySelectorAll(".nav-section-toggle")).toHaveLength(1);
    unmount();
    render(
      <Sidebar view="terminal" onNavigate={() => {}} projectName="p" projectPath="~/p" onOpenProjectSwitcher={() => {}} isDark={false} onToggleTheme={() => {}} />,
    );
    // 지금 열린 터미널은 꺼 뒀어도 보인다 — 있는 곳이 안 보이면 안 된다.
    expect(screen.getByText(t("nav.terminal"))).toBeTruthy();
  });

  it("단축키 힌트 설정이 켜지면 간단 밀도에서도 ⌘번호가 보인다", () => {
    settingsState.kbdHints = true;
    render(
      <Sidebar view="today" onNavigate={() => {}} projectName="p" projectPath="~/p" onOpenProjectSwitcher={() => {}} isDark={false} onToggleTheme={() => {}} />,
    );
    expect(document.querySelectorAll(".side-nav-scroll .nav-kbd").length).toBeGreaterThan(0);
  });

  it("조용한 수 — 일지 N · 변경 N 배지", () => {
    render(
      <Sidebar
        view="today"
        onNavigate={() => {}}
        projectName="p"
        projectPath="~/p"
        onOpenProjectSwitcher={() => {}}
        isDark={false}
        onToggleTheme={() => {}}
        badges={{ journal: 7, diff: 2 }}
      />,
    );
    const counts = [...document.querySelectorAll(".nav-badge.count")].map((el) => el.textContent);
    expect(counts).toEqual(["7", "2"]);
  });
});

describe("툴바 — 보류 등급의 알약", () => {
  it("beta 를 주면 「베타 · 결함 수정만」, 아니면 없다", () => {
    const { rerender } = render(<Toolbar title="x" beta />);
    expect(screen.getByText(t("toolbar.beta"))).toBeTruthy();
    rerender(<Toolbar title="x" />);
    expect(screen.queryByText(t("toolbar.beta"))).toBeNull();
  });
});

describe("오늘 머리글의 숫자 셋", () => {
  const entry = (type: JournalEntrySummary["type"], evidence: number): JournalEntrySummary =>
    ({ type, evidence, relative_path: `${type}-${evidence}`, title: "", slug: "", workday: "", status: "done", difficulty: null, checkbox: null, session_id: "", agent_id: "a", agent_version: null, verified_by_user: false, verified_stale: false, created_at: "", updated_at: null, tags: [], files_count: 0, parse_ok: true, parse_warnings: [] }) as JournalEntrySummary;

  it("증거는 결함·기능·리팩토링만 분모로 센다 — 잡일에 증거를 묻지 않는다", () => {
    render(<TodayNums today={[entry("feature", 2), entry("bug", 1), entry("chore", 0)]} unrecorded={2} nextCount={3} />);
    const nums = [...document.querySelectorAll(".today-nums b")].map((b) => b.textContent);
    expect(nums).toEqual(["1 / 2", "2", "3"]);
  });

  it("모르는 값은 — 로 둔다", () => {
    render(<TodayNums today={[]} unrecorded={null} nextCount={null} />);
    expect([...document.querySelectorAll(".today-nums b")].map((b) => b.textContent)).toEqual(["—", "—", "—"]);
  });
});

describe("터미널 — 결과 끝 줄과 검증 칸 받은함", () => {
  it("마지막 결과는 페인별 하나, 여러 페인 중 최근 것을 고른다", () => {
    lastResultStore.set({ sid: "a", command: "pnpm test", exitCode: 0, durationMs: 1200, lastLine: "4 passed", at: 1 });
    lastResultStore.set({ sid: "b", command: "cargo clippy", exitCode: 1, durationMs: 40000, lastLine: "error: x", at: 2 });
    const latest = lastResultStore.latest(["a", "b"]);
    expect(latest?.sid).toBe("b");
    expect(lastResultLine(lastResultStore.get("a")!)).toBe("`pnpm test` · 4 passed · exit 0");
  });

  it("받은함은 프로젝트별, 중복 없음, 가져가면 비운다 — `## 검증` 절로 접힌다", () => {
    evidenceInbox.push(1, "`pnpm test` · 4 passed · exit 0");
    evidenceInbox.push(1, "`pnpm test` · 4 passed · exit 0");
    evidenceInbox.push(2, "other");
    expect(evidenceInbox.list(1)).toHaveLength(1);
    expect(evidenceSection(evidenceInbox.list(1))).toBe("## 검증\n\n- `pnpm test` · 4 passed · exit 0\n");
    expect(evidenceInbox.drain(1)).toHaveLength(1);
    expect(evidenceInbox.list(1)).toHaveLength(0);
    expect(evidenceInbox.list(2)).toHaveLength(1);
    expect(evidenceSection([])).toBe("");
  });
});

describe("논의 — 「X 로 결정」", () => {
  it("결론 절에 한 줄, 토의 로그에 한 행 — 기존 글은 그대로", () => {
    const doc = "## 문제 정의\n\n무엇을 걷나.\n\n## 후보 해결 방안\n\n### A. 걷는다 {#o1}\n";
    const next = buildDecisionBody(doc, "user", "**A 로 결정** — 걷는다. 사유: 비용 0", new Date("2026-10-28T10:00:00+09:00"));
    expect(next.startsWith(doc.trimEnd())).toBe(true);
    expect(next).toContain("## 결론");
    expect(next).toContain("**A 로 결정** — 걷는다. 사유: 비용 0");
    // 로그 행 — 시각은 로컬 오프셋을 따르므로 작성자·본문 열만 묻는다.
    expect(next).toMatch(/\| 2026-10-28T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \| user \| \*\*A 로 결정\*\*/);
  });
});

describe("시작 탭 — 「이 맥락으로 이어서 작업」 뜻", () => {
  it("프로젝트가 맞을 때만 한 번 소비되고, 다른 프로젝트의 뜻은 남는다", () => {
    requestResumeOnOpen(7);
    expect(consumeResumeOnOpen(3)).toBe(false);
    expect(consumeResumeOnOpen(7)).toBe(true);
    expect(consumeResumeOnOpen(7)).toBe(false);
  });
});

describe("툴바 알약과 사이드바가 같은 말을 한다", () => {
  it("알약은 베타 단의 꼬리말과 같은 말을 한다 — 랜딩·README 와도 같다", () => {
    expect(t("toolbar.beta")).toContain(t("sidebar.betaTag"));
  });

  it("접힌 도구 단은 토글로 펼쳐진다 — 숨김이 아니라 접힘", () => {
    render(
      <Sidebar view="today" onNavigate={() => {}} projectName="p" projectPath="~/p" onOpenProjectSwitcher={() => {}} isDark={false} onToggleTheme={() => {}} />,
    );
    const toggle = document.querySelector<HTMLButtonElement>(".nav-section-toggle")!;
    fireEvent.click(toggle);
    expect(screen.getByText(t("nav.search"))).toBeTruthy();
  });
});
