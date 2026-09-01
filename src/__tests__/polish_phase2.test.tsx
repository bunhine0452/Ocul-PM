import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  // WorkspaceProvider 가 마운트되며 여러 채널을 구독한다 — no-op 채널.
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
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
  beforeEach(() => indexProgressStore.clear());

  it("set/clear 가 구독자에게 닿고, 같은 참조면 조용하다", () => {
    const { result } = renderHook(() => useIndexProgress(1));
    expect(result.current).toBeNull();
    const p = { current: 3, total: 10, current_file: "src/a.ts" };
    act(() => indexProgressStore.set(1, p));
    expect(result.current).toBe(p);
    act(() => indexProgressStore.clear(1));
    expect(result.current).toBeNull();
    act(() => indexProgressStore.clear(1));
    expect(result.current).toBeNull();
  });

  // 2026-09-01 — 크롬식 탭은 프로젝트 둘을 동시에 색인할 수 있고 이 모듈은
  // 창에 하나다. 버킷이 없으면 슬롯 하나를 두 탭이 번갈아 덮어써, 각 검색
  // 화면의 "n/m 색인 중" 이 남의 숫자로 튀고 먼저 끝난 쪽의 clear 가 아직
  // 도는 쪽의 진행률까지 지운다.
  it("두 프로젝트가 동시에 색인해도 서로의 진행률을 덮어쓰지 않는다", () => {
    const a = renderHook(() => useIndexProgress(1));
    const b = renderHook(() => useIndexProgress(2));
    const pa = { current: 3, total: 10, current_file: "src/a.ts" };
    const pb = { current: 7, total: 99, current_file: "lib/b.rs" };

    act(() => {
      indexProgressStore.set(1, pa);
      indexProgressStore.set(2, pb);
    });
    expect(a.result.current).toBe(pa);
    expect(b.result.current).toBe(pb);

    // 1 이 먼저 끝나도 2 의 진행률은 그대로다.
    act(() => indexProgressStore.clear(1));
    expect(a.result.current).toBeNull();
    expect(b.result.current).toBe(pb);
  });
});

// ─── Phase 4 — 설계: 오류 규약 · 스토어 헬퍼 · 포매터 · 워크데이 산술 ─────────

import { ApiError, call, toAppError } from "@/api/invoke";
import { tError } from "@/i18n/errors";
import { createIntentSlot, createSignal, createStore } from "@/lib/createStore";
import { formatBytes, relativeTime, toEpochMs } from "@/lib/format";
import { recentWorkdays, shiftWorkday } from "@/lib/workday";

describe("오류 규약 — call 래퍼와 tError 가 문자열·AppError·전송 실패를 한 모양으로", () => {
  it("봉투의 AppError 는 code/detail 그대로, 문자열은 unknown, reject 는 메시지", async () => {
    await expect(call("x", Promise.resolve({ status: "ok", data: 1 }))).resolves.toBe(1);
    const e1 = await call("x", Promise.resolve({ status: "error", error: { code: "acp_not_running", detail: null } })).catch((e) => e);
    expect(e1).toBeInstanceOf(ApiError);
    expect((e1 as ApiError).code).toBe("acp_not_running");
    const e2 = await call("y", Promise.resolve({ status: "error", error: "No API key configured for anthropic" })).catch((e) => e);
    expect((e2 as ApiError).code).toBe("unknown");
    expect((e2 as ApiError).detail).toContain("anthropic");
    const e3 = await call("z", Promise.reject(new Error("ipc down"))).catch((e) => e);
    expect((e3 as ApiError).code).toBe("unknown");
    expect((e3 as ApiError).message).toBe("ipc down");
    expect(toAppError("s")).toEqual({ code: "unknown", detail: "s" });
  });

  it("tError 는 코드가 사전에 있으면 문장, 없으면 영어 원문, unknown 은 옛 정규식 표", () => {
    expect(tError({ code: "acp_not_running", detail: null })).toBe(ko["err.code.acp_not_running"]);
    expect(tError({ code: "acp_node_too_old", detail: "Node.js 20+ required" })).toContain("Node.js 20+ required");
    expect(tError({ code: "made_up_code", detail: "raw english" })).toBe("raw english");
    expect(tError({ code: "unknown", detail: "No API key configured for openai" })).toBe(
      ko["err.noApiKey"].replace("{provider}", "openai"),
    );
    expect(tError(null)).toBe("");
  });
});

describe("스토어 헬퍼 — createStore / createSignal / createIntentSlot", () => {
  it("createStore 는 같은 값이면 조용하고 훅은 바뀔 때만 다시 그린다", () => {
    const store = createStore(1);
    const seen: number[] = [];
    const off = store.subscribe(() => seen.push(store.get()));
    store.set(1);
    store.set(2);
    store.update((n) => n + 1);
    expect(seen).toEqual([2, 3]);
    off();
    store.set(9);
    expect(seen).toEqual([2, 3]);
    const { result } = renderHook(() => store.useValue());
    expect(result.current).toBe(9);
  });

  it("createSignal 은 값 없는 사건, createIntentSlot 은 끈적 플래그를 든다", () => {
    const sig = createSignal();
    const hits = vi.fn();
    const off = sig.on(hits);
    sig.emit();
    off();
    sig.emit();
    expect(hits).toHaveBeenCalledTimes(1);

    const slot = createIntentSlot<{ n: number }>("test:slot");
    slot.request({ n: 1 });
    expect(slot.consume()).toEqual({ n: 1 });
    expect(slot.consume()).toBeNull();
    const got = vi.fn();
    const offSlot = slot.subscribe(got);
    slot.request({ n: 2 });
    expect(got).toHaveBeenCalledWith({ n: 2 });
    expect(slot.consume()).toBeNull(); // 구독자가 소비했다
    offSlot();
    const keep = slot.subscribe(() => {}, { consume: false });
    slot.request({ n: 3 });
    expect(slot.consume()).toEqual({ n: 3 }); // consume:false 는 남긴다
    keep();
    slot.hold({ n: 4 });
    expect(slot.consume()).toEqual({ n: 4 });
  });
});

describe("포매터 · 워크데이 산술", () => {
  it("relativeTime 은 words/compact 두 모드와 beyondDays, fallback 을 지킨다", () => {
    const now = Date.parse("2026-08-30T12:00:00+09:00");
    expect(relativeTime("2026-08-30T11:59:40+09:00", now)).toBe(ko["time.justNow"]);
    expect(relativeTime("2026-08-30T11:30:00+09:00", now)).toBe(ko["time.minutesAgo"].replace("{n}", "30"));
    expect(relativeTime("2026-08-30T09:00:00+09:00", now, { style: "compact" })).toBe("3h");
    expect(relativeTime(Math.floor(now / 1000) - 120, now, { style: "compact" })).toBe("2m"); // unix 초
    expect(relativeTime("2026-08-01T09:00:00+09:00", now, { beyondDays: 7 })).toBe(
      new Date(Date.parse("2026-08-01T09:00:00+09:00")).toLocaleDateString(),
    );
    expect(relativeTime("nope", now, { fallback: "—" })).toBe("—");
    expect(toEpochMs(null)).toBeNull();
  });

  it("formatBytes 는 B/KB/MB 와 빈 값 fallback", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined, "?")).toBe("?");
  });

  it("shiftWorkday 는 월말·연말을 넘기고 recentWorkdays 는 오래된 것이 앞", () => {
    expect(shiftWorkday("20260831", 1)).toBe("20260901");
    expect(shiftWorkday("20260101", -1)).toBe("20251231");
    expect(recentWorkdays("20260830", 3)).toEqual(["20260828", "20260829", "20260830"]);
  });
});

// ─── Phase 4 — WorkspaceContext 3분할: 조각 안정성 · 잃어버린 갱신 ─────────

import {
  WorkspaceProvider,
  storageKeyFor,
  useProjectRuntime,
  useTerminalSessions,
  useUiPrefs,
  useWorkspace,
  type TerminalTab,
} from "@/contexts/WorkspaceContext";

describe("WorkspaceContext 조각 — 자기 키가 바뀔 때만 새 참조", () => {
  const tab = (id: string): TerminalTab => ({ id, label: id, shell: "zsh", cwd: "/x" });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WorkspaceProvider projectId={41}>{children}</WorkspaceProvider>
  );

  it("취향이 바뀌어도 터미널·런타임 조각은 그대로다 (그 반대도)", () => {
    localStorage.clear();
    const { result } = renderHook(
      () => ({ all: useWorkspace(), prefs: useUiPrefs(), term: useTerminalSessions(), rt: useProjectRuntime() }),
      { wrapper },
    );
    const term0 = result.current.term;
    const rt0 = result.current.rt;
    const prefs0 = result.current.prefs;
    act(() => result.current.all.setUiV2View("planner"));
    expect(result.current.prefs).not.toBe(prefs0);
    expect(result.current.prefs.prefs.uiV2View).toBe("planner");
    expect(result.current.term).toBe(term0);
    expect(result.current.rt).toBe(rt0);

    const prefs1 = result.current.prefs;
    act(() => result.current.term.openTab(tab("t1")));
    expect(result.current.term).not.toBe(term0);
    expect(result.current.term.terminalActiveId).toBe("t1");
    expect(result.current.prefs).toBe(prefs1);
    expect(result.current.rt).toBe(rt0);

    act(() => result.current.rt.setIndexing(41));
    expect(result.current.rt.indexingProjectId).toBe(41);
    expect(result.current.prefs).toBe(prefs1);
    // 겉면은 모든 변화를 본다.
    expect(result.current.all.state.uiV2View).toBe("planner");
    expect(result.current.all.state.terminalActiveId).toBe("t1");
  });

  it("setPrefs 는 바뀐 것이 없으면 조용하고, openTab 은 화면도 옮긴다", () => {
    localStorage.clear();
    const { result } = renderHook(() => ({ prefs: useUiPrefs(), term: useTerminalSessions() }), { wrapper });
    const before = result.current.prefs;
    act(() => result.current.prefs.setPrefs((p) => ({ searchScope: p.searchScope })));
    expect(result.current.prefs).toBe(before);
    act(() => result.current.term.openTab(tab("cc"), { view: "terminal" }));
    expect(result.current.prefs.prefs.uiV2View).toBe("terminal");
  });

  it("다른 창이 남긴 터미널 탭을 storage 이벤트로 곧장 받아들인다 (잃어버린 갱신 제거)", () => {
    localStorage.clear();
    const { result } = renderHook(() => ({ all: useWorkspace(), term: useTerminalSessions() }), { wrapper });
    act(() => result.current.term.setSessions(() => ({ terminalTabs: [tab("a")], terminalActiveId: "a" })));
    act(() => result.current.all.setTerminalDetached(true));
    // 분리 창이 탭을 하나 더 만들어 디스크에 남기고, 브라우저가 storage 이벤트를 쏜다.
    const key = storageKeyFor(41);
    const disk = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...disk, terminalTabs: [tab("a"), tab("b")], terminalActiveId: "b" }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(result.current.term.terminalTabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(result.current.term.terminalActiveId).toBe("b");
    // 분리 중이 아닐 때는 이 창이 주인이라 디스크를 따르지 않는다.
    act(() => result.current.all.setTerminalDetached(false));
    localStorage.setItem(key, JSON.stringify({ ...disk, terminalTabs: [tab("zzz")], terminalActiveId: "zzz" }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(result.current.term.terminalTabs.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
