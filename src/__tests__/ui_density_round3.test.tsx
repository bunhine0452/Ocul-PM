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

describe("beta switches — folded, not hidden", () => {
  it("comma string ↔ set, unknown ids are dropped", () => {
    expect([...parseHiddenViews("terminal,bogus,ai")]).toEqual(["terminal", "ai"]);
    expect(toggleHiddenView("", "code")).toBe("code");
    expect(toggleHiddenView("code,ai", "code")).toBe("ai");
    expect(HOLD_SWITCH_VIEWS).toHaveLength(5);
  });

  it("a switched-off beta row leaves the sidebar but returns while that screen is open", () => {
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

  it("the kbd-hints setting shows shortcuts in the simple density too", () => {
    settingsState.kbdHints = true;
    render(
      <Sidebar view="today" onNavigate={() => {}} projectName="p" projectPath="~/p" onOpenProjectSwitcher={() => {}} isDark={false} onToggleTheme={() => {}} />,
    );
    expect(document.querySelectorAll(".side-nav-scroll .nav-kbd").length).toBeGreaterThan(0);
  });

  it("quiet counts — journal N · diff N badges", () => {
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

describe("toolbar — the hold-tier pill", () => {
  it("beta renders the pill, otherwise nothing", () => {
    const { rerender } = render(<Toolbar title="x" beta />);
    expect(screen.getByText(t("toolbar.beta"))).toBeTruthy();
    rerender(<Toolbar title="x" />);
    expect(screen.queryByText(t("toolbar.beta"))).toBeNull();
  });
});

describe("today header — three numbers", () => {
  const entry = (type: JournalEntrySummary["type"], evidence: number): JournalEntrySummary =>
    ({ type, evidence, relative_path: `${type}-${evidence}`, title: "", slug: "", workday: "", status: "done", difficulty: null, checkbox: null, session_id: "", agent_id: "a", agent_version: null, verified_by_user: false, verified_stale: false, created_at: "", updated_at: null, tags: [], files_count: 0, parse_ok: true, parse_warnings: [] }) as JournalEntrySummary;

  it("evidence counts bug/feature/refactor only — chores are not asked for evidence", () => {
    render(<TodayNums today={[entry("feature", 2), entry("bug", 1), entry("chore", 0)]} unrecorded={2} nextCount={3} />);
    const nums = [...document.querySelectorAll(".today-nums b")].map((b) => b.textContent);
    expect(nums).toEqual(["1 / 2", "2", "3"]);
  });

  it("unknown values stay as a dash", () => {
    render(<TodayNums today={[]} unrecorded={null} nextCount={null} />);
    expect([...document.querySelectorAll(".today-nums b")].map((b) => b.textContent)).toEqual(["—", "—", "—"]);
  });
});

describe("terminal — result tail and the verification inbox", () => {
  it("one last result per pane, the latest across panes wins", () => {
    lastResultStore.set({ sid: "a", command: "pnpm test", exitCode: 0, durationMs: 1200, lastLine: "4 passed", at: 1 });
    lastResultStore.set({ sid: "b", command: "cargo clippy", exitCode: 1, durationMs: 40000, lastLine: "error: x", at: 2 });
    const latest = lastResultStore.latest(["a", "b"]);
    expect(latest?.sid).toBe("b");
    expect(lastResultLine(lastResultStore.get("a")!)).toBe("`pnpm test` · 4 passed · exit 0");
  });

  it("inbox is per project, deduped, drained on take — folds into a verification section", () => {
    evidenceInbox.push(1, "`pnpm test` · 4 passed · exit 0");
    evidenceInbox.push(1, "`pnpm test` · 4 passed · exit 0");
    evidenceInbox.push(2, "other");
    expect(evidenceInbox.list(1)).toHaveLength(1);
    // i18n-ignore-next-line -- 디스크 문서 규격의 섹션 머리 (표시 문자열 아님)
    expect(evidenceSection(evidenceInbox.list(1))).toBe("## 검증\n\n- `pnpm test` · 4 passed · exit 0\n");
    expect(evidenceInbox.drain(1)).toHaveLength(1);
    expect(evidenceInbox.list(1)).toHaveLength(0);
    expect(evidenceInbox.list(2)).toHaveLength(1);
    expect(evidenceSection([])).toBe("");
  });
});

describe("discussion — decide X", () => {
  it("one line in the conclusion, one row in the log — existing text untouched", () => {
    // i18n-ignore-next-line -- 논의 문서 픽스처 (디스크 규격, 표시 문자열 아님)
    const doc = "## 문제 정의\n\n무엇을 걷나.\n\n## 후보 해결 방안\n\n### A. 걷는다 {#o1}\n";
    // i18n-ignore-next-line -- 위와 같은 픽스처
    const next = buildDecisionBody(doc, "user", "**A 로 결정** — 걷는다. 사유: 비용 0", new Date("2026-10-28T10:00:00+09:00"));
    expect(next.startsWith(doc.trimEnd())).toBe(true);
    // i18n-ignore-next-line -- 위와 같은 픽스처
    expect(next).toContain("## 결론");
    // i18n-ignore-next-line -- 위와 같은 픽스처
    expect(next).toContain("**A 로 결정** — 걷는다. 사유: 비용 0");
    // 로그 행 — 시각은 로컬 오프셋을 따르므로 작성자·본문 열만 묻는다.
    // i18n-ignore-next-line -- 위와 같은 픽스처
    expect(next).toMatch(/\| 2026-10-28T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \| user \| \*\*A 로 결정\*\*/);
  });
});

describe("start tab — the resume-on-open intent", () => {
  it("consumed once for the matching project; another project's intent stays", () => {
    requestResumeOnOpen(7);
    expect(consumeResumeOnOpen(3)).toBe(false);
    expect(consumeResumeOnOpen(7)).toBe(true);
    expect(consumeResumeOnOpen(7)).toBe(false);
  });
});

describe("toolbar pill and sidebar say the same thing", () => {
  it("the pill contains the beta tier tag — same words as landing and README", () => {
    expect(t("toolbar.beta")).toContain(t("sidebar.betaTag"));
  });

  it("the folded tools tier opens from its toggle — folded, not hidden", () => {
    render(
      <Sidebar view="today" onNavigate={() => {}} projectName="p" projectPath="~/p" onOpenProjectSwitcher={() => {}} isDark={false} onToggleTheme={() => {}} />,
    );
    const toggle = document.querySelector<HTMLButtonElement>(".nav-section-toggle")!;
    fireEvent.click(toggle);
    expect(screen.getByText(t("nav.search"))).toBeTruthy();
  });
});
