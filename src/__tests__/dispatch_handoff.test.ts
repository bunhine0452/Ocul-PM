import { beforeEach, describe, expect, test, vi } from "vitest";

// 디스패치 핸드오프 (2026-08-23) — 플래너 ▶실행 / 회고 "Claude Code 로" 가
// **어디에 무엇으로** 꽂히는가. 두 가지 회귀를 못 박는다:
//   ① ⌘J 로 열어 둔 도크가 있으면 화면을 빼앗지 않는다.
//   ② 그 페인에서 이미 Claude Code 가 돌고 있으면 `cat` 한 줄 명령이 아니라
//      프롬프트 본문을 붙여넣는다 (돌던 세션을 버리지 않는다).

const writeToPty = vi.fn();
const ptyForegroundCommand = vi.fn();

vi.mock("@/lib/bindings", () => ({
  commands: {
    writeToPty: (...args: unknown[]) => writeToPty(...args),
    ptyForegroundCommand: (...args: unknown[]) => ptyForegroundCommand(...args),
  },
}));

import {
  bracketedPaste,
  choosePayload,
  handoffDispatch,
  sanitizeForPaste,
  terminalOnScreen,
} from "@/features/terminal/dispatchTarget";
import {
  consumePendingDispatch,
  hasPendingDispatch,
  hasPendingDispatchFor,
  setPendingDispatch,
  subscribePendingDispatch,
  type PendingDispatch,
} from "@/features/terminal/dispatchBus";
import { activeSid } from "@/features/terminal/activePane";
import { leaf, splitPane } from "@/lib/termPanes";
import type { TerminalTab } from "@/contexts/WorkspaceContext";

const PENDING: PendingDispatch = {
  projectId: 1,
  command: "claude \"$(cat '/p/.oculpm/index/dispatch/plan-a.md')\"",
  prompt: "ocul-pm 플래너 디스패치\n\n## 대상 항목\n- {#a} [ ] 첫 항목",
};

const ESC = "\u001b";

function tab(over: Partial<TerminalTab> = {}): TerminalTab {
  return { id: "p1-aaa", label: "zsh", shell: "zsh", cwd: "/p", ...over };
}

beforeEach(() => {
  writeToPty.mockReset();
  ptyForegroundCommand.mockReset();
  consumePendingDispatch();
});

describe("choosePayload", () => {
  test("셸이 놀고 있으면 종전대로 한 줄 명령을 쓴다", () => {
    const chosen = choosePayload(PENDING, "-zsh");
    expect(chosen.data).toBe(PENDING.command);
    expect(chosen.agent).toBeNull();
  });

  test("포그라운드를 모르면 셸로 본다 (셸 통합·ps 실패)", () => {
    expect(choosePayload(PENDING, null).data).toBe(PENDING.command);
  });

  test("Claude Code 가 돌고 있으면 본문을 붙여넣기로 감싼다", () => {
    const chosen = choosePayload(PENDING, "claude");
    expect(chosen.agent?.label).toBe("Claude Code");
    expect(chosen.data).toBe(`${ESC}[200~${PENDING.prompt}${ESC}[201~`);
    // 새 `claude` 를 띄우는 명령이 섞여 들어가면 돌던 세션이 그걸 텍스트로 받는다.
    expect(chosen.data).not.toContain("cat");
  });

  test("에이전트가 아닌 장기 실행 명령은 셸 취급 — 남의 stdin 에 밀어넣지 않는다", () => {
    expect(choosePayload(PENDING, "vim README.md").data).toBe(PENDING.command);
    // `echo claude` 는 명령 위치가 아니다 (agentDetect 계약).
    expect(choosePayload(PENDING, "echo claude").data).toBe(PENDING.command);
  });

  test("본문을 못 실어 보내는 생산자는 에이전트가 돌아도 명령 쪽이다", () => {
    const noPrompt: PendingDispatch = { projectId: 1, command: "claude \"hi\"", prompt: null };
    expect(choosePayload(noPrompt, "claude").data).toBe(noPrompt.command);
  });
});

describe("sanitizeForPaste", () => {
  test("ESC 를 걷어내 붙여넣기가 조기 종료되지 않는다", () => {
    // 일지 발췌에 ANSI 가 섞여 있어도 커서 제어로 둔갑하지 못한다.
    const dirty = `앞${ESC}[31m빨강${ESC}[201~탈출${ESC}[0m뒤`;
    const clean = sanitizeForPaste(dirty);
    expect(clean).not.toContain(ESC);
    expect(bracketedPaste(dirty).split(`${ESC}[201~`)).toHaveLength(2);
  });

  test("개행·탭은 남기고 CRLF 는 정규화하며 꼬리 공백은 턴다", () => {
    expect(sanitizeForPaste("a\r\nb\tc\n\n")).toBe("a\nb\tc");
  });
});

describe("terminalOnScreen", () => {
  const base = { terminalDockOpen: false, terminalDetached: false, uiV2View: "planner" };

  test("도크를 열어 두었으면 화면을 옮길 이유가 없다", () => {
    expect(terminalOnScreen({ ...base, terminalDockOpen: true })).toBe(true);
  });

  test("터미널 화면·분리 창도 이미 보이는 쪽", () => {
    expect(terminalOnScreen({ ...base, uiV2View: "terminal" })).toBe(true);
    expect(terminalOnScreen({ ...base, terminalDetached: true })).toBe(true);
  });

  test("아무것도 안 열려 있으면 데려가야 한다", () => {
    expect(terminalOnScreen(base)).toBe(false);
  });
});

describe("activeSid", () => {
  test("활성 탭의 포커스된 페인", () => {
    const t = tab({ panes: splitPane(leaf("p1-aaa"), "p1-aaa", "col", "p1-bbb"), focusSid: "p1-bbb" });
    expect(activeSid([t], t.id)).toBe("p1-bbb");
  });

  test("포커스가 사라진 페인을 가리키면 첫 페인으로 접는다", () => {
    const t = tab({ focusSid: "p1-gone" });
    expect(activeSid([t], t.id)).toBe("p1-aaa");
  });

  test("탭이 하나도 없으면 보낼 곳이 없다", () => {
    expect(activeSid([], null)).toBeNull();
  });
});

describe("handoffDispatch", () => {
  test("살아있는 셸이면 그 자리에 꽂고 대기열을 쓰지 않는다", async () => {
    ptyForegroundCommand.mockResolvedValue({ status: "ok", data: "-zsh" });
    writeToPty.mockResolvedValue({ status: "ok", data: null });

    const result = await handoffDispatch(PENDING, [tab()], "p1-aaa");

    expect(result).toEqual({ kind: "typed" });
    expect(writeToPty).toHaveBeenCalledWith("p1-aaa", PENDING.command);
    expect(hasPendingDispatch()).toBe(false);
  });

  test("돌고 있는 에이전트에는 본문이 간다", async () => {
    ptyForegroundCommand.mockResolvedValue({ status: "ok", data: "claude --resume" });
    writeToPty.mockResolvedValue({ status: "ok", data: null });

    const result = await handoffDispatch(PENDING, [tab()], "p1-aaa");

    expect(result).toEqual({ kind: "pasted", agent: "Claude Code" });
    expect(writeToPty.mock.calls[0][1]).toContain(PENDING.prompt);
  });

  test("세션이 아직 없으면 대기열로 — 터미널이 뜨는 대로 들어간다", async () => {
    // `pty_foreground_command` 는 미지의 세션에 에러를 준다 (생존 확인 겸용).
    ptyForegroundCommand.mockResolvedValue({ status: "error", error: "unknown pty session" });

    const result = await handoffDispatch(PENDING, [tab()], "p1-aaa");

    expect(result).toEqual({ kind: "queued" });
    expect(writeToPty).not.toHaveBeenCalled();
    expect(consumePendingDispatch()).toEqual(PENDING);
  });

  test("탭이 없으면 셸을 찾지도 않고 대기열로", async () => {
    const result = await handoffDispatch(PENDING, [], null);

    expect(result).toEqual({ kind: "queued" });
    expect(ptyForegroundCommand).not.toHaveBeenCalled();
  });
});

describe("dispatchBus 구독", () => {
  test("이미 마운트된 터미널 면에게 새 대기 건을 알린다", () => {
    // 예전 구조는 마운트 시점만 봤다 — 도크를 열어 둔 채 디스패치하면 아무
    // 일도 일어나지 않았다.
    const seen: string[] = [];
    const off = subscribePendingDispatch(() => seen.push("ping"));

    setPendingDispatch(PENDING);
    expect(seen).toEqual(["ping"]);

    off();
    setPendingDispatch(PENDING);
    expect(seen).toEqual(["ping"]);
  });
});

// 2026-09-01 — 크롬식 탭은 프로젝트 여럿을 동시에 물고, 터미널 면은 탭마다
// 마운트된다 (도크를 열어 둔 탭 + 터미널 화면인 탭). 대기 건에 주인이 없으면
// **남의 프로젝트 면**이 먼저 집어 그 셸(cwd = 남의 루트)에 프리필하거나, 그
// 페인에서 돌던 에이전트에 다른 프로젝트의 프롬프트를 붙여넣는다.
describe("dispatchBus 프로젝트 주인", () => {
  test("대기 건은 자기 프로젝트에게만 보인다", () => {
    setPendingDispatch(PENDING); // projectId: 1
    expect(hasPendingDispatch()).toBe(true);
    expect(hasPendingDispatchFor(1)).toBe(true);
    expect(hasPendingDispatchFor(2)).toBe(false);
  });

  test("주인 없는(null) 대기 건은 누구든 집을 수 있다", () => {
    // Greenfield 킥오프처럼 아직 프로젝트가 정해지기 전 예약된 건.
    setPendingDispatch({ ...PENDING, projectId: null });
    expect(hasPendingDispatchFor(1)).toBe(true);
    expect(hasPendingDispatchFor(2)).toBe(true);
    expect(hasPendingDispatchFor(null)).toBe(true);
  });

  test("대기 건이 없으면 아무에게도 보이지 않는다", () => {
    expect(hasPendingDispatchFor(1)).toBe(false);
  });

  test("handoffDispatch 는 큐로 떨어질 때 주인을 보존한다", async () => {
    const result = await handoffDispatch(PENDING, [], null);
    expect(result.kind).toBe("queued");
    expect(hasPendingDispatchFor(1)).toBe(true);
    expect(hasPendingDispatchFor(2)).toBe(false);
  });
});
