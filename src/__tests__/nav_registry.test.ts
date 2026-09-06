import { describe, expect, it } from "vitest";
import {
  NAV_DESTINATIONS,
  NAV_ENTRIES,
  NAV_SHORTCUT_KEYS,
  navRowViews,
  navShortcutLabel,
  navViewForKey,
} from "@/lib/navRegistry";
import { UI_V2_VIEWS } from "@/contexts/uiV2View";

// v2 U1 (docs/20260706_v2/01-ux-spec.md §1) — 내비 단일 소스 계약.
// 팔레트 화면 누락 / ⌘번호·사이드바 순서 불일치가 재발하면 여기서 잡힌다.

describe("navRegistry", () => {
  it("사이드바 행의 id 가 유일하다", () => {
    const ids = NAV_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("main 6 + tools 4 + ai 3 + ref 2 = 15행 (2026-09-06 IA 재편, 안 A)", () => {
    // main 의 여섯 번째는 「브랜치의 이야기」 — 배열 맨 끝이라 번호는 없다.
    expect(NAV_ENTRIES.filter((e) => e.group === "main")).toHaveLength(6);
    expect(NAV_ENTRIES.filter((e) => e.group === "tools")).toHaveLength(4);
    // Claude Code · Codex · 세션이 「에이전트」 한 행으로 접혔다.
    expect(NAV_ENTRIES.filter((e) => e.group === "ai")).toHaveLength(3);
    // 논의·문서는 참고로 강등 — 행은 남고 ⌘번호만 회수했다.
    expect(NAV_ENTRIES.filter((e) => e.group === "ref")).toHaveLength(2);
    expect(NAV_ENTRIES).toHaveLength(15);
  });

  it("⌘번호는 배열(=사이드바 표시) 순서를 그대로 따른다", () => {
    NAV_SHORTCUT_KEYS.forEach((key, idx) => {
      expect(navViewForKey(key)).toBe(NAV_ENTRIES[idx].id);
    });
  });

  /**
   * 번호가 걸린 **앞 10칸을 못 박는다.**
   *
   * 새 화면을 목록 중간에 끼우면 ⌘번호가 통째로 밀리는데, 개수만 세는 위
   * 테스트는 그걸 통과시킨다. 여기 배열이 바뀌면 사용자의 손가락이 기억하는
   * 번호가 바뀐 것이므로, 일부러 고칠 때만 고친다 —
   * 그때는 `NavRemapNotice` 로 한 번 안내한다.
   */
  it("⌘번호가 걸린 앞 10칸은 고정이다", () => {
    expect(NAV_ENTRIES.slice(0, NAV_SHORTCUT_KEYS.length).map((e) => e.id)).toEqual([
      "today",
      "journal",
      "diff",
      "planner",
      "retro",
      "search",
      "graph",
      "terminal",
      "code",
      "claudecode",
    ]);
  });

  it("재편에서 뜻이 그대로인 번호 셋 (⌘1·⌘2·⌘4)", () => {
    expect(navViewForKey("1")).toBe("today");
    expect(navViewForKey("2")).toBe("journal");
    expect(navViewForKey("4")).toBe("planner");
  });

  it("참고로 내려간 화면은 번호가 없다", () => {
    expect(navShortcutLabel("discussion")).toBeUndefined();
    expect(navShortcutLabel("docs")).toBeUndefined();
    // 브랜치도 배열 맨 끝이라 번호가 없다 (main 에 보이지만 11번째 이후).
    expect(navShortcutLabel("branch")).toBeUndefined();
  });

  it("11번째 이후 항목은 번호가 없다", () => {
    expect(navShortcutLabel("ai")).toBeUndefined();
    expect(navShortcutLabel("skills")).toBeUndefined();
    expect(navShortcutLabel("code")).toBe("⌘9");
    expect(navShortcutLabel("claudecode")).toBe("⌘0");
  });

  it("번호 없는 키 입력은 undefined (⌘\\ 등 다른 핸들러로 폴스루)", () => {
    expect(navViewForKey("\\")).toBeUndefined();
    expect(navViewForKey("k")).toBeUndefined();
  });
});

describe("navRegistry — 에이전트 행의 갈래", () => {
  const agent = NAV_ENTRIES.find((e) => e.children);

  it("갈래를 가진 행은 에이전트 하나뿐이다", () => {
    expect(NAV_ENTRIES.filter((e) => e.children)).toHaveLength(1);
    expect(agent?.id).toBe("claudecode");
  });

  it("세 갈래가 다 살아 있다 — 화면을 없앤 게 아니라 행을 접었다", () => {
    expect(agent && navRowViews(agent)).toEqual(["claudecode", "codex", "sessions"]);
  });

  /**
   * 사이드바에서 행이 사라진 화면도 ⌘K 로는 **각각** 갈 수 있어야 한다.
   * 접기가 곧 숨기기가 되면 세션 화면은 도달 불가능해진다.
   */
  it("팔레트 목적지는 갈래로 펼쳐진다 (부모는 목적지가 아니다)", () => {
    const ids = NAV_DESTINATIONS.map((e) => e.id);
    expect(ids).toContain("codex");
    expect(ids).toContain("sessions");
    expect(new Set(ids).size).toBe(ids.length);
    expect(NAV_DESTINATIONS).toHaveLength(17);
  });

  it("팔레트 목적지에 「에이전트」 별칭이 셋 다 붙어 있다", () => {
    for (const id of ["claudecode", "codex", "sessions"]) {
      const hit = NAV_DESTINATIONS.find((e) => e.id === id);
      expect(hit?.aliasKey).toBeTruthy();
    }
  });
});

describe("navRegistry — 화면 목록과의 정합", () => {
  it("모든 목적지가 실재하는 uiV2View 다", () => {
    for (const dest of NAV_DESTINATIONS) {
      expect(UI_V2_VIEWS).toContain(dest.id);
    }
  });

  it("설정 말고는 도달할 수 없는 화면이 없다", () => {
    const reachable = new Set(NAV_DESTINATIONS.map((e) => e.id));
    const orphans = UI_V2_VIEWS.filter((v) => v !== "settings" && !reachable.has(v));
    expect(orphans).toEqual([]);
  });
});
