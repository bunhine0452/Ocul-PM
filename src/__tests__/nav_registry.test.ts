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

  it("main 6 + tools 7 = 13개 화면을 커버한다", () => {
    expect(NAV_ENTRIES.filter((e) => e.group === "main")).toHaveLength(6);
    // PR-ACP6 에서 "Claude Code" 가 tools 에 추가됐다 (프로바이더 채팅과 분리).
    expect(NAV_ENTRIES.filter((e) => e.group === "tools")).toHaveLength(7);
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
    // 새 화면은 **끝에** 붙여 기존 ⌘번호를 밀지 않는다는 계약의 회귀 방지.
    expect(navShortcutLabel("claudecode")).toBeUndefined();
    expect(navShortcutLabel("docs")).toBe("⌘9");
  });

  it("번호 없는 키 입력은 undefined (⌘\\ 등 다른 핸들러로 폴스루)", () => {
    expect(navViewForKey("\\")).toBeUndefined();
    expect(navViewForKey("k")).toBeUndefined();
  });
});
