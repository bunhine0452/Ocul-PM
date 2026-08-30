import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";

// ─── 완성도 라운드 Phase 2 (2026-08-30) — 여정 ─────────────────────────────
//
// 순수 모듈(단축키 레지스트리 · 무결성 기록 · 그룹 뷰 · 닫기 문지기 · 요청
// 버스)과 두 카드(첫 활성화 · diff 그룹 확인 토글)를 jsdom 에서 굳힌다.

import { ko } from "@/i18n/ko";
import { en } from "@/i18n/en";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";
import { buildShortcutGroups, navShortcutGroup } from "@/lib/shortcutRegistry";
import {
  INTEGRITY_LOG_MAX,
  clearIntegrityLog,
  pushIntegrityWarning,
  resetIntegrityLog,
  useIntegrityLog,
} from "@/lib/integrityLog";
import { buildGroupViews } from "@/features/diff/changeGroups";
import {
  hasRunningWork,
  registerTabCloseGuard,
  runTabCloseGuard,
} from "@/lib/closeIntent";
import {
  onOculpmActivateRequest,
  onReindexRequest,
  requestOculpmActivate,
  requestReindex,
} from "@/lib/projectActions";
import { acpWorkingKey, countAcpWorkingFor, resetAcpWorking, setAcpWorking } from "@/features/chat/acpBusyBus";

vi.mock("@/lib/bindings", () => ({
  commands: {},
  events: {},
}));

import { FirstRunCard } from "@/features/today/FirstRunCard";
import { DiffFileList } from "@/features/diff/DiffFileList";

afterEach(() => {
  cleanup();
  resetIntegrityLog();
  resetAcpWorking();
});

describe("단축키 레지스트리 — navRegistry 에서 파생, 중복 없음", () => {
  it("화면 이동 그룹은 ⌘번호가 있는 nav 항목과 1:1 이다", () => {
    const nav = navShortcutGroup();
    const expected = NAV_ENTRIES.filter((e) => navShortcutLabel(e.id));
    expect(nav.rows.map((r) => r.labelKey)).toEqual(expected.map((e) => e.labelKey));
    expect(nav.rows.map((r) => r.keys)).toEqual(expected.map((e) => navShortcutLabel(e.id)));
  });

  it("그룹 안에서 같은 키 조합이 두 번 나오지 않고, 라벨 키는 양 언어에 있다", () => {
    for (const g of buildShortcutGroups()) {
      const keys = g.rows.map((r) => r.keys);
      expect(new Set(keys).size, `dup in ${g.id}`).toBe(keys.length);
      expect(ko[g.titleKey]).toBeTruthy();
      expect(en[g.titleKey]).toBeTruthy();
      for (const r of g.rows) {
        expect(ko[r.labelKey], `ko ${r.labelKey}`).toBeTruthy();
        expect(en[r.labelKey], `en ${r.labelKey}`).toBeTruthy();
      }
    }
  });

  it("전역 그룹은 ⌘/ 자신을 안내한다", () => {
    const global = buildShortcutGroups().find((g) => g.id === "global")!;
    expect(global.rows.some((r) => r.keys === "⌘/" && r.labelKey === "keys.cheatsheet")).toBe(true);
  });
});

describe("무결성 경고 기록 — 세션 링 버퍼", () => {
  const warn = (kind: string, path: string, message = "m") => ({ kind, path, message });

  it("같은 (kind, path) 가 연달아 오면 한 줄로 합치고 시각만 갱신한다", () => {
    pushIntegrityWarning(1, warn("frontmatter_parse", "a.md"), 1000);
    pushIntegrityWarning(1, warn("frontmatter_parse", "a.md", "again"), 2000);
    pushIntegrityWarning(1, warn("orphan_session", "b.md"), 3000);
    const { result } = renderHook(() => useIntegrityLog());
    expect(result.current.map((i) => [i.kind, i.path, i.at, i.message])).toEqual([
      ["orphan_session", "b.md", 3000, "m"],
      ["frontmatter_parse", "a.md", 2000, "again"],
    ]);
  });

  it("최대 개수를 넘으면 오래된 것부터 버리고, 프로젝트별로 지운다", () => {
    for (let i = 0; i < INTEGRITY_LOG_MAX + 5; i++) pushIntegrityWarning(i % 2, warn("k", `f${i}.md`), i);
    const { result, rerender } = renderHook(() => useIntegrityLog());
    expect(result.current).toHaveLength(INTEGRITY_LOG_MAX);
    expect(result.current[0].path).toBe(`f${INTEGRITY_LOG_MAX + 4}.md`);
    clearIntegrityLog(0);
    rerender();
    expect(result.current.every((i) => i.projectId === 1)).toBe(true);
    clearIntegrityLog();
    rerender();
    expect(result.current).toHaveLength(0);
  });
});

describe("변경 그룹 뷰 — verified_by_user 가 머리글까지 온다", () => {
  const group = (path: string | null, verified: boolean | null) => ({
    entry_path: path,
    entry_title: path ? "제목" : null,
    entry_type: path ? "feature" : null,
    created_at: path ? "2026-08-30T10:00:00+09:00" : null,
    verified_by_user: verified,
    plan_refs: [],
    files: ["src/a.ts"],
  });

  it("일지 그룹은 값을 그대로, 미추적·평면은 null", () => {
    const views = buildGroupViews({
      groups: [group("j/1.md", true), group("j/2.md", false), group(null, null)],
      changes: [],
      filter: "",
      collapsed: new Set(),
      reviewed: new Set(),
    });
    expect(views.map((v) => v.verified)).toEqual([true, false, null]);
    const flat = buildGroupViews({
      groups: null,
      changes: [{ path: "src/a.ts", op: "M", ts: 1, read: false }],
      filter: "",
      collapsed: new Set(),
      reviewed: new Set(),
    });
    expect(flat[0].verified).toBeNull();
  });

  it("머리글의 확인 토글은 aria-pressed 로 상태를 말하고 반대 값으로 부른다", () => {
    const onToggleVerified = vi.fn();
    const { getByRole } = render(
      <DiffFileList
        changes={[{ path: "src/a.ts", op: "M", ts: 1, read: false }]}
        groups={[group("j/1.md", false)]}
        selected={null}
        reviewedPaths={[]}
        impact={null}
        onSelect={() => {}}
        onToggleVerified={onToggleVerified}
        onOpenAffected={() => {}}
      />,
    );
    const btn = getByRole("button", { name: ko["entry.verifyTitle"] });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(onToggleVerified).toHaveBeenCalledWith("j/1.md", true);
  });
});

describe("탭 닫기 문지기 — 창은 묻고, 탭은 알린다", () => {
  it("등록이 없으면 null, 있으면 보고를 돌려주고, 해제하면 다시 null", async () => {
    expect(await runTabCloseGuard(7)).toBeNull();
    const off = registerTabCloseGuard(7, async () => ({ foreground: ["pnpm"], agents: 0 }));
    expect(await runTabCloseGuard(7)).toEqual({ foreground: ["pnpm"], agents: 0 });
    off();
    expect(await runTabCloseGuard(7)).toBeNull();
  });

  it("문지기가 던지면 그냥 닫는다 (null)", async () => {
    const off = registerTabCloseGuard(8, async () => {
      throw new Error("boom");
    });
    expect(await runTabCloseGuard(8)).toBeNull();
    off();
  });

  it("hasRunningWork 는 포그라운드 명령이나 작업 중 세션이 있을 때만 참", () => {
    expect(hasRunningWork(null)).toBe(false);
    expect(hasRunningWork({ foreground: [], agents: 0 })).toBe(false);
    expect(hasRunningWork({ foreground: ["node"], agents: 0 })).toBe(true);
    expect(hasRunningWork({ foreground: [], agents: 2 })).toBe(true);
  });

  it("ACP 버스는 프로젝트별로 센다", () => {
    setAcpWorking(acpWorkingKey(1, "s1"), true);
    setAcpWorking(acpWorkingKey(1, "s2"), true);
    setAcpWorking(acpWorkingKey(2, "s3"), true);
    expect(countAcpWorkingFor(1)).toBe(2);
    expect(countAcpWorkingFor(2)).toBe(1);
    expect(countAcpWorkingFor(3)).toBe(0);
  });
});

describe("요청 버스 — 활성화·색인은 프로젝트 탭이 받는다", () => {
  it("구독자가 받고, 해제하면 더 받지 않는다", () => {
    const activate = vi.fn();
    const reindex = vi.fn();
    const offA = onOculpmActivateRequest(activate);
    const offR = onReindexRequest(reindex);
    requestOculpmActivate();
    requestReindex();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(reindex).toHaveBeenCalledTimes(1);
    offA();
    offR();
    requestOculpmActivate();
    requestReindex();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(reindex).toHaveBeenCalledTimes(1);
  });
});

describe("첫 활성화 카드 — 쓴 것을 그대로 나열한다", () => {
  it("config · AGENTS.md · .gitignore 줄이 각각 나오고, 버튼이 동작한다", () => {
    const onDismiss = vi.fn();
    const onNavigate = vi.fn();
    const { getByText, getByRole } = render(
      <FirstRunCard
        info={{ createdDirs: [".oculpm"], wroteConfig: true, wroteGitignore: true, agentFiles: ["AGENTS.md"], at: 1 }}
        onDismiss={onDismiss}
        onNavigate={onNavigate}
      />,
    );
    expect(getByText(ko["today.firstRun.title"])).toBeInTheDocument();
    expect(getByText(/AGENTS\.md/)).toBeInTheDocument();
    expect(getByText(/\.gitignore/)).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: ko["today.firstRun.viewChanges"] }));
    expect(onNavigate).toHaveBeenCalledWith("diff");
    fireEvent.click(getByRole("button", { name: ko["today.firstRun.dismiss"] }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("gitignore 를 안 건드렸으면 그 줄은 없다", () => {
    const { queryByText } = render(
      <FirstRunCard
        info={{ createdDirs: [], wroteConfig: true, wroteGitignore: false, agentFiles: [], at: 1 }}
        onDismiss={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(queryByText(/\.gitignore/)).toBeNull();
  });
});


// ─── Phase 3 — 성능: 공유 시계 · 색인 진행률 스토어 ───────────────────────

import { act } from "@testing-library/react";
import { useMinuteTick, useSecondTick } from "@/hooks/useSecondTick";
import { indexProgressStore, useIndexProgress } from "@/lib/indexProgressStore";

describe("공유 1초 시계 — 켜진 구독자가 있을 때만 하나의 인터벌", () => {
  it("켜진 훅은 틱마다 새 now 를, 꺼진 훅은 다시 그리지 않는다", () => {
    vi.useFakeTimers();
    try {
      const on = renderHook(() => useSecondTick(true));
      const off = renderHook(() => useSecondTick(false));
      const first = on.result.current;
      const offFirst = off.result.current;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(on.result.current).toBeGreaterThanOrEqual(first);
      expect(on.result.current).not.toBe(first);
      // 꺼진 구독자는 렌더되지 않았으므로 값이 그대로다.
      expect(off.result.current).toBe(offFirst);
      on.unmount();
      off.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("마지막 구독자가 꺼지면 인터벌도 멈춘다", () => {
    vi.useFakeTimers();
    try {
      const a = renderHook(() => useSecondTick(true));
      expect(vi.getTimerCount()).toBe(1);
      const b = renderHook(() => useSecondTick(true));
      expect(vi.getTimerCount()).toBe(1);
      a.unmount();
      expect(vi.getTimerCount()).toBe(1);
      b.unmount();
      expect(vi.getTimerCount()).toBe(0);
      const m = renderHook(() => useMinuteTick(true));
      expect(vi.getTimerCount()).toBe(1);
      m.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("색인 진행률 스토어 — 컨텍스트 밖", () => {
  it("set/clear 가 구독자에게 닿고, 같은 참조면 조용하다", () => {
    const { result } = renderHook(() => useIndexProgress());
    expect(result.current).toBeNull();
    const p = { current: 3, total: 10, current_file: "src/a.ts" };
    act(() => indexProgressStore.set(p));
    expect(result.current).toBe(p);
    act(() => indexProgressStore.clear());
    expect(result.current).toBeNull();
    act(() => indexProgressStore.clear());
    expect(result.current).toBeNull();
  });
});
