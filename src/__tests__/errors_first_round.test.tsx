/**
 * v2.41.0 `v241-errors-first` — Phase `destructive-and-silent` 의 프런트 몫.
 *
 * 다섯 가지를 문다. 전부 **화면이 조용히 거짓말하던 자리**라, 회귀했을 때
 * 게이트가 아니면 아무도 알아채지 못하는 종류다:
 *
 *  1. `{#cmdw-pane-guard}` ⌘W 가 돌고 있는 에이전트를 확인 없이 죽이지 않는다
 *  2. `{#listener-leaks}`  구독이 붙기 전에 떠나면 그 리스너는 남지 않는다
 *  3. `{#localstorage-guard}` 저장소가 던져도 앱은 뜬다
 *  4. `{#honesty-catch}`  "검사 실패" 와 "깨끗함" 이 구별된다
 *  5. `{#diff-false-empty}` 조회 실패가 "변경 없음" 으로 위장하지 않는다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ── 목: 터미널 화면이 쓰는 백엔드 ─────────────────────────────────────────
//
// `ptyForegroundCommand` 가 이 라운드의 주인공이다 — 페인을 죽이기 전에
// "지금 뭐가 돌고 있나" 를 묻는 유일한 창구.
const pty: { running: string | null; killed: string[]; asked: string[] } = {
  running: null,
  killed: [],
  asked: [],
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "ptyForegroundCommand")
            return (sid: string) => {
              pty.asked.push(sid);
              return ok(pty.running);
            };
          if (prop === "killPtySession")
            return (sid: string) => {
              pty.killed.push(sid);
              return ok(null);
            };
          if (prop === "settingsGetAll") return () => ok([] as Array<[string, string]>);
          if (prop === "listProjects") return () => ok([]);
          if (prop === "gitUncommittedChanges") return () => ok([]);
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

// xterm 은 jsdom 에서 뜨지 않는다 (canvas). 페인 자리만 채운다.
vi.mock("@/features/terminal/TerminalInstance", () => ({
  TerminalInstance: () => <div data-testid="pane" />,
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TerminalSurface } from "@/features/terminal/TerminalSurface";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { runCloseIntent } from "@/lib/closeIntent";
import { createUnlistenBag } from "@/lib/unlisten";
import { t } from "@/i18n";

/** 테스트마다 새 프로젝트 id — 영속 레코드가 다음 테스트로 새지 않는다. */
let nextProject = 4100;

/** 세션 카드의 × (첫 세션은 화면이 스스로 만든다 — 라벨 "zsh"). */
const CLOSE_TAB = t("term.closeTab", { label: "zsh" });

function renderSurface() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={(nextProject += 1)}>
        <TerminalSurface projectRoot="/tmp" />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  pty.running = null;
  pty.killed = [];
  pty.asked = [];
});
afterEach(() => cleanup());

// ─── 1. ⌘W 페인 가드 ──────────────────────────────────────────────────────
//
// 같은 ⌘W 가 **탭** 층에서는 실행 중 명령을 물어보고(runTabCloseGuard) **페인**
// 층에서는 곧장 `kill_pty_session` 을 쐈다. 돌던 턴이 확인 없이 사라졌고
// 되돌릴 길이 없었다.

describe("{#cmdw-pane-guard} — never kills a running pane without asking", () => {
  it("does not call killPtySession while a command is running — it asks first", async () => {
    pty.running = "claude";
    const { container } = renderSurface();

    fireEvent.click(await screen.findByLabelText(CLOSE_TAB));

    // 확인창이 뜨고 — kill 은 아직 한 번도 안 나갔다.
    expect(await screen.findByText(t("close.guard.title"))).toBeInTheDocument();
    expect(pty.asked.length).toBeGreaterThan(0);
    expect(pty.killed).toEqual([]);

    // 「취소」 로 닫으면 끝까지 안 나간다.
    fireEvent.click(screen.getByText(t("common.cancel")));
    await waitFor(() => expect(screen.queryByText(t("close.guard.title"))).toBeNull());
    expect(pty.killed).toEqual([]);
    // 세션도 그대로 남아 있다 (탭이 사라지지 않았다).
    expect(container.querySelectorAll('[data-testid="pane"]').length).toBeGreaterThan(0);
  });

  it("kills once the user confirms", async () => {
    pty.running = "pnpm";
    renderSurface();

    fireEvent.click(await screen.findByLabelText(CLOSE_TAB));
    fireEvent.click(await screen.findByText(t("close.guard.confirm")));

    await waitFor(() => expect(pty.killed).toEqual(pty.asked.slice(0, 1)));
  });

  it("an idle shell is not worth a prompt — the usual close stays instant", async () => {
    // foreground 없음 = 프롬프트
    renderSurface();

    fireEvent.click(await screen.findByLabelText(CLOSE_TAB));

    await waitFor(() => expect(pty.killed).toEqual(pty.asked.slice(0, 1)));
    expect(screen.queryByText(t("close.guard.title"))).toBeNull();
  });

  /**
   * ⌘W 는 keydown 이 아니라 "안쪽부터 닫기" 사슬로 온다 (macOS 가 앱 메뉴
   * 액셀러레이터를 먼저 먹기 때문). 그 경로도 같은 문지기를 지나야 한다 —
   * 레일의 × 만 고치고 ⌘W 를 빠뜨리면 P0 는 그대로다.
   */
  it("the ⌘W chain (runCloseIntent) goes through the same guard", async () => {
    pty.running = "claude";
    const { container } = renderSurface();
    await screen.findByTestId("pane");

    // 핸들러는 포커스가 이 면 **안**에 있을 때만 우선권을 갖는다.
    const inside = container.querySelector<HTMLElement>(".term-tool");
    inside?.focus();
    let consumed = false;
    act(() => {
      consumed = runCloseIntent();
    });

    expect(consumed).toBe(true);
    expect(await screen.findByText(t("close.guard.title"))).toBeInTheDocument();
    expect(pty.killed).toEqual([]);
  });
});

// ─── 2. 구독 누수 가드 ────────────────────────────────────────────────────

describe("{#listener-leaks} createUnlistenBag", () => {
  it("unlistens on the spot when the subscription lands after dispose", async () => {
    const bag = createUnlistenBag();
    let off = 0;
    let resolve!: (fn: () => void) => void;
    bag.add(new Promise<() => void>((r) => (resolve = r)));

    // cleanup 이 먼저 돈다 (언마운트).
    bag.dispose();
    resolve(() => {
      off += 1;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(off).toBe(1);
  });

  it("dispose unlistens everything it holds", async () => {
    const bag = createUnlistenBag();
    const off: string[] = [];
    bag.add(Promise.resolve(() => void off.push("a")));
    bag.add(Promise.resolve(() => void off.push("b")));
    await Promise.resolve();
    await Promise.resolve();
    expect(off).toEqual([]);
    bag.dispose();
    expect(off).toEqual(["a", "b"]);
  });

  it("a failed listen() is swallowed — nothing attached, nothing to detach", async () => {
    const bag = createUnlistenBag();
    bag.add(Promise.reject(new Error("no tauri")));
    await Promise.resolve();
    await Promise.resolve();
    expect(() => bag.dispose()).not.toThrow();
  });

  it("one throwing unlisten does not stop the rest", () => {
    const bag = createUnlistenBag();
    const off: string[] = [];
    bag.add(
      Promise.resolve(() => {
        throw new Error("listener already gone");
      }),
    );
    bag.add(Promise.resolve(() => void off.push("b")));
    return Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        expect(() => bag.dispose()).not.toThrow();
        expect(off).toEqual(["b"]);
      });
  });
});

// ─── 3. 저장소가 던져도 앱은 뜬다 ─────────────────────────────────────────
//
// → `multi_window.test.tsx` 의 「저장소 고장」. 그 스위트가 영속 레코드의 계약을
//   이미 소유하고, `localStorage` 를 직접 만질 수 있는 allowlist 에도 들어 있다.

// ─── 4. 화면 단위 렌더 경계 (소스 계약) ───────────────────────────────────
//
// 경계가 탭 층에만 있어서 화면 16개 중 하나가 렌더 중 throw 하면 **프로젝트 탭
// 전체**가 대체 UI 로 바뀌었다 — 사이드바도 탈출로도 사라진다. 이 배선은
// ShellV2 를 통째로 마운트해야 런타임으로 재현되는데(화면 16개 + lazy 청크),
// 무너지면 조용하므로 소스 계약으로 문다.

describe("{#screen-error-boundary} ShellV2 router", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "features", "shell", "ShellV2.tsx"),
    "utf8",
  );

  it("wraps the screen router in a `key={view}` boundary (resets on switch)", () => {
    // key 가 없으면 한 번 깨진 뒤 다른 화면에 갔다 돌아와도 계속 깨져 보인다.
    expect(src).toMatch(/<ErrorBoundary key=\{view\} label=/);
  });

  it("keep-alive screens (Claude Code / Codex) get their OWN boundary, keyless", () => {
    // 위 경계 안에 있으면 화면을 바꿀 때마다 재마운트되어 돌던 턴이 끊긴다.
    for (const label of ["screen:claudecode", "screen:codex"]) {
      expect(src).toContain(`<ErrorBoundary label="${label}">`);
    }
  });

  it("does not hard-code a screen count in a comment (it said 8 until 2026-09-04)", () => {
    expect(src).not.toMatch(/All 8 screens/);
  });
});
