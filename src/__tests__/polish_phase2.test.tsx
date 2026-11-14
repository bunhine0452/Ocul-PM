import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";

// ─── 완성도 라운드 Phase 2 (2026-08-30) — 여정 ─────────────────────────────
//
// 순수 모듈(단축키 레지스트리 · 무결성 기록 · 닫기 문지기 · 요청
// 버스)과 두 카드(첫 활성화 · diff 바닥줄 확인 토글)를 jsdom 에서 굳힌다.

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
import {
  onOculpmActivateRequest,
  requestOculpmActivate,
} from "@/lib/projectActions";

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  // WorkspaceProvider 가 마운트되며 여러 채널을 구독한다 — no-op 채널.
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));

import { DiffEntryFooter } from "@/features/diff/DiffEntryFooter";

afterEach(() => {
  cleanup();
  resetIntegrityLog();
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

describe("변경 바닥줄 — 일지의 확인 토글", () => {
  const group = (verified: boolean, stale = false) => ({
    entry_path: "j/1.md",
    entry_title: "제목",
    entry_type: "feature",
    created_at: "2026-08-30T10:00:00+09:00",
    verified_by_user: verified,
    verified_stale: stale,
    plan_refs: [],
    files: ["src/a.ts"],
  });

  it("토글은 aria-pressed 로 상태를 말하고 반대 값으로 부른다", () => {
    const onToggleVerified = vi.fn();
    const { getByRole } = render(
      <DiffEntryFooter projectId={1} group={group(false)} onToggleVerified={onToggleVerified} />,
    );
    const btn = getByRole("button", { name: ko["entry.verify"] });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(onToggleVerified).toHaveBeenCalledWith("j/1.md", true);
  });

  // {#reviewed-hash} — 확인 뒤 본문이 바뀐 일지는 「확인됨」이 아니다.
  it("확인 뒤 바뀐 일지는 토글이 꺼진 채이고, 누르면 다시 묶는다(true)", () => {
    const onToggleVerified = vi.fn();
    const { getByRole } = render(
      <DiffEntryFooter projectId={1} group={group(true, true)} onToggleVerified={onToggleVerified} />,
    );
    const btn = getByRole("button", { name: ko["entry.verify"] });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(onToggleVerified).toHaveBeenCalledWith("j/1.md", true);
  });

  it("확인된 일지는 눌린 토글이고, 누르면 해제(false)를 부른다", () => {
    const onToggleVerified = vi.fn();
    const { getByRole } = render(
      <DiffEntryFooter projectId={1} group={group(true)} onToggleVerified={onToggleVerified} />,
    );
    const btn = getByRole("button", { name: ko["entry.verified"] });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(onToggleVerified).toHaveBeenCalledWith("j/1.md", false);
  });
});

describe("요청 버스 — 활성화는 프로젝트 탭이 받는다", () => {
  it("구독자가 받고, 해제하면 더 받지 않는다", () => {
    const activate = vi.fn();
    const offA = onOculpmActivateRequest(activate);
    requestOculpmActivate();
    expect(activate).toHaveBeenCalledTimes(1);
    offA();
    requestOculpmActivate();
    expect(activate).toHaveBeenCalledTimes(1);
  });
});

// ─── Phase 3 — 성능: 공유 시계 ───────────────────────────────────────────

import { act } from "@testing-library/react";
import { useMinuteTick, useSecondTick } from "@/hooks/useSecondTick";

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

// ─── Phase 4 — WorkspaceContext 분할: 조각 안정성 (터미널 조각은 2026-10-28 에 걷었다) ──

import {
  WorkspaceProvider,
  useProjectRuntime,
  useUiPrefs,
  useWorkspace,
} from "@/contexts/WorkspaceContext";

describe("WorkspaceContext 조각 — 자기 키가 바뀔 때만 새 참조", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WorkspaceProvider projectId={41}>{children}</WorkspaceProvider>
  );

  it("취향이 바뀌어도 런타임 조각은 그대로다 (그 반대도)", () => {
    localStorage.clear();
    const { result } = renderHook(
      () => ({ all: useWorkspace(), prefs: useUiPrefs(), rt: useProjectRuntime() }),
      { wrapper },
    );
    const rt0 = result.current.rt;
    const prefs0 = result.current.prefs;
    act(() => result.current.all.setUiV2View("planner"));
    expect(result.current.prefs).not.toBe(prefs0);
    expect(result.current.prefs.prefs.uiV2View).toBe("planner");
    expect(result.current.rt).toBe(rt0);

    const prefs1 = result.current.prefs;
    act(() => result.current.rt.setSidebarCollapsed(!result.current.rt.sidebarCollapsed));
    const collapsed = result.current.rt.sidebarCollapsed;
    expect(result.current.rt).not.toBe(rt0);
    expect(result.current.prefs).toBe(prefs1);
    // 겉면은 모든 변화를 본다.
    expect(result.current.all.state.uiV2View).toBe("planner");
    expect(result.current.all.state.sidebarCollapsed).toBe(collapsed);
  });

  it("setPrefs 는 바뀐 것이 없으면 조용하다", () => {
    localStorage.clear();
    const { result } = renderHook(() => ({ prefs: useUiPrefs() }), { wrapper });
    const before = result.current.prefs;
    act(() => result.current.prefs.setPrefs((p) => ({ plannerView: p.plannerView })));
    expect(result.current.prefs).toBe(before);
    act(() => result.current.prefs.setPrefs(() => ({ uiV2View: "diff" })));
    expect(result.current.prefs.prefs.uiV2View).toBe("diff");
  });
});
