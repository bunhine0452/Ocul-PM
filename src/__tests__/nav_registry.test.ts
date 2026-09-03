import { describe, expect, it } from "vitest";
import {
  NAV_ENTRIES,
  NAV_SHORTCUT_KEYS,
  navShortcutLabel,
  navViewForKey,
} from "@/lib/navRegistry";

// v2 U1 (docs/20260706_v2/01-ux-spec.md §1) — 내비 단일 소스 계약.
// 팔레트 화면 누락 / ⌘번호·사이드바 순서 불일치가 재발하면 여기서 잡힌다.

describe("navRegistry", () => {
  it("모든 화면 id 가 유일하다", () => {
    const ids = NAV_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("main 6 + tools 5 + ai 4 = 15개 화면을 커버한다", () => {
    expect(NAV_ENTRIES.filter((e) => e.group === "main")).toHaveLength(6);
    // 2026-08-24 — AI 면(Claude Code · AI 대화 · 스킬·규칙)을 tools 에서 분리.
    expect(NAV_ENTRIES.filter((e) => e.group === "tools")).toHaveLength(5);
    expect(NAV_ENTRIES.filter((e) => e.group === "ai")).toHaveLength(4);
  });

  it("⌘번호는 배열(=사이드바 표시) 순서를 그대로 따른다", () => {
    NAV_SHORTCUT_KEYS.forEach((key, idx) => {
      expect(navViewForKey(key)).toBe(NAV_ENTRIES[idx].id);
    });
    // 대표 케이스 고정: ⌘1=Today, ⌘3=문제 해결(구 ⌘3=diff 불일치의 회귀 방지), ⌘0=터미널.
    expect(navViewForKey("1")).toBe("today");
    expect(navViewForKey("3")).toBe("discussion");
    expect(navViewForKey("0")).toBe("terminal");
  });

  it("11번째 이후 항목은 번호가 없다 (ai 는 ⌘\\ 오버레이가 보조 통로)", () => {
    expect(navShortcutLabel("ai")).toBeUndefined();
    expect(navShortcutLabel("skills")).toBeUndefined();
    // 11번째 이후는 번호가 없으므로 **그들끼리는** 재배치해도 ⌘번호가 안 밀린다
    // (2026-08-24 — 코드를 도구 곁으로, AI 면을 뒤로). 앞 10개의 번호는 불변.
    expect(navShortcutLabel("claudecode")).toBeUndefined();
    expect(navShortcutLabel("code")).toBeUndefined();
    expect(navShortcutLabel("docs")).toBe("⌘9");
    expect(navShortcutLabel("terminal")).toBe("⌘0");
  });

  /**
   * 번호가 걸린 **앞 10칸을 못 박는다.**
   *
   * 새 화면을 목록 중간에 끼우면 ⌘번호가 통째로 밀리는데, 개수만 세는 위
   * 테스트는 그걸 통과시킨다 (2026-09-03 Codex 화면 추가 때 실제로 그랬다 —
   * 다행히 12번째라 밀린 번호는 없었다). 여기 배열이 바뀌면 사용자의 손가락이
   * 기억하는 번호가 바뀐 것이므로, 일부러 고칠 때만 고친다.
   */
  it("⌘번호가 걸린 앞 10칸은 고정이다", () => {
    expect(NAV_ENTRIES.slice(0, NAV_SHORTCUT_KEYS.length).map((e) => e.id)).toEqual([
      "today",
      "journal",
      "discussion",
      "planner",
      "diff",
      "retro",
      "search",
      "graph",
      "docs",
      "terminal",
    ]);
  });

  it("번호 없는 키 입력은 undefined (⌘\\ 등 다른 핸들러로 폴스루)", () => {
    expect(navViewForKey("\\")).toBeUndefined();
    expect(navViewForKey("k")).toBeUndefined();
  });
});
