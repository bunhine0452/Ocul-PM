import { describe, expect, test } from "vitest";
import {
  buildRailItem,
  formatCwdCrumb,
  formatElapsed,
} from "@/features/terminal/railModel";
import {
  TERM_DENSITIES,
  TERM_DENSITY_DEFAULT,
  clampTermDensity,
  termLineHeight,
  termPanePad,
} from "@/features/terminal/density";
import { initialShellState, type ShellState } from "@/features/terminal/oscShell";

// 세로 세션 레일(2026-08-28)의 순수 재료. 렌더에서 분리한 이유는 눈으로
// 확인하기 어려운 것들이기 때문이다 — 1초마다 바뀌는 타이머 표기, 사용자가
// 지은 이름과 에이전트 이름의 우선순위, 통합이 꺼진 세션의 "모른다" 표시.

const active = (over: Partial<ShellState> = {}): ShellState => ({
  ...initialShellState,
  active: true,
  ...over,
});

describe("formatElapsed", () => {
  test("분:초 — 폭이 흔들리지 않게 초는 두 자리로 채운다", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(252_000)).toBe("4:12");
  });

  test("한 시간을 넘으면 시:분:초", () => {
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });

  test("음수·NaN 은 0:00 — 시계가 깨진 값을 그대로 그리지 않는다", () => {
    expect(formatElapsed(-1)).toBe("0:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
  });
});

describe("buildRailItem", () => {
  test("셸 통합이 없으면 아무것도 지어내지 않는다", () => {
    const item = buildRailItem({ id: "a", label: "zsh", shell: undefined, paneCount: 1 }, 1_000);
    expect(item.tone).toBe("off");
    expect(item.detail).toBe("");
    expect(item.elapsedMs).toBeNull();
    expect(item.agent).toBeNull();
  });

  test("에이전트가 돌면 아이콘용 정보와 경과 시간을 싣는다", () => {
    const shell = active({ running: { command: "claude --resume", startedAt: 1_000 } });
    const item = buildRailItem({ id: "a", label: "zsh", shell, paneCount: 1 }, 253_000);
    expect(item.agent?.id).toBe("claude-code");
    expect(item.tone).toBe("running");
    expect(item.elapsedMs).toBe(252_000);
  });

  test("자동 이름이면 에이전트 이름으로 바꿔 보여준다", () => {
    const shell = active({ running: { command: "claude", startedAt: 0 } });
    expect(buildRailItem({ id: "a", label: "zsh 2", shell, paneCount: 1 }, 0).label).toBe(
      "Claude Code",
    );
  });

  test("사용자가 손으로 지은 이름은 에이전트가 덮지 않는다", () => {
    const shell = active({ running: { command: "claude", startedAt: 0 } });
    expect(buildRailItem({ id: "a", label: "리팩터링", shell, paneCount: 1 }, 0).label).toBe(
      "리팩터링",
    );
  });

  test("실패한 마지막 명령은 fail 톤 — 실행 중이 아니므로 타이머는 없다", () => {
    const shell = active({ last: { command: "pnpm test", exitCode: 1, durationMs: 4_000 } });
    const item = buildRailItem({ id: "a", label: "zsh", shell, paneCount: 2 }, 9_999);
    expect(item.tone).toBe("fail");
    expect(item.elapsedMs).toBeNull();
    expect(item.paneCount).toBe(2);
  });
});

describe("formatCwdCrumb", () => {
  const root = "/Users/me/git/ai-pm";

  test("프로젝트 루트 안쪽은 루트 이름 + 상대 경로", () => {
    expect(formatCwdCrumb(`${root}/src/features`, root)).toBe("ai-pm/src/features");
    expect(formatCwdCrumb(root, root)).toBe("ai-pm");
  });

  test("루트 밖(에이전트가 cd 한 경우)은 뒤 두 조각만", () => {
    expect(formatCwdCrumb("/tmp/build/out", root)).toBe("…/build/out");
    expect(formatCwdCrumb("/tmp", root)).toBe("/tmp");
  });

  test("이름이 겹치는 형제 디렉터리를 루트 안쪽으로 오해하지 않는다", () => {
    expect(formatCwdCrumb("/Users/me/git/ai-pm-old/src", root)).toBe("…/ai-pm-old/src");
  });

  test("cwd 를 모르면 빈 문자열 — 부르는 쪽이 세션 이름으로 물러선다", () => {
    expect(formatCwdCrumb(null, root)).toBe("");
  });
});

describe("density", () => {
  test("모르는 값은 기본값으로 되돌린다", () => {
    expect(clampTermDensity("nope")).toBe(TERM_DENSITY_DEFAULT);
    expect(clampTermDensity(null)).toBe(TERM_DENSITY_DEFAULT);
    expect(clampTermDensity("comfortable")).toBe("comfortable");
  });

  test("줄 높이는 넉넉→조밀 순으로 단조 감소하고 1.0 아래로 내려가지 않는다", () => {
    const heights = TERM_DENSITIES.map(termLineHeight);
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(1);
  });

  test("페인 여백도 같은 방향으로 줄어든다", () => {
    const pads = TERM_DENSITIES.map(termPanePad);
    expect(pads).toEqual([...pads].sort((a, b) => b - a));
  });
});
