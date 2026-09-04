/**
 * v2.42.0 `{#workspace-full-consumers}` — 상시 마운트 소비자가 **자기 조각만**
 * 구독한다.
 *
 * ## 무엇이 문제였나
 *
 * 컨텍스트 4분할(`useProjectRuntime` / `useUiPrefs` / `useTerminalSessions`)은
 * 이미 올바르게 돼 있었다. 문제는 **상시 마운트된 세 소비자**(`ShellV2`·
 * `ProjectTab`·`TerminalDock`)가 합친 겉면 `useWorkspace()` 를 쓰고 있었다는
 * 것뿐이다. 측정(docs/20260904_v242-load-bearing/perf-baseline.md §3)은 그
 * 겉면이 **네 방향 전부**에서 깨어난다고 못박았다:
 *
 * | 바뀐 것        | useWorkspace | useUiPrefs | useProjectRuntime | useTerminalSessions |
 * |----------------|--------------|------------|-------------------|---------------------|
 * | uiV2View ×5    | +5           | +5         | 0                 | 0                   |
 * | setIndexing ×5 | +5           | 0          | +5                | 0                   |
 * | openTab ×5     | +5           | 0          | 0                 | +5                  |
 * | selectTab ×5   | +5           | 0          | 0                 | +5                  |
 *
 * 즉 **터미널 탭을 하나 고를 때마다 16화면 라우터가 다시 그려졌다.**
 *
 * ## 이 파일이 무는 것 셋
 *
 *  1. 조각의 격리 자체 (위 표를 단언으로 — 다음 라운드의 회귀 기준선)
 *  2. 실제 컴포넌트 하나(`TerminalDock`)를 띄워 "터미널 탭을 바꿔도 안 그린다"
 *  3. 나머지 둘(`ShellV2`·`ProjectTab`)은 **소스 단언**으로. 16개 지연 청크를
 *     가진 라우터를 jsdom 에 띄우면 배선이 아니라 목을 시험하게 된다 — 여기서
 *     막아야 하는 회귀는 "합친 겉면을 다시 쓰는 것" 한 가지이고, 그건 소스에
 *     그대로 보인다.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  WorkspaceProvider,
  useWorkspace,
  useUiPrefs,
  useProjectRuntime,
  useTerminalSessions,
  type TerminalTab,
} from "@/contexts/WorkspaceContext";

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy({}, { get: () => () => ok(null) }),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

/**
 * xterm 은 jsdom 에서 뜨지 않는다 (canvas). 자리를 채우면서 **도크가 다시
 * 그려진 횟수**를 센다.
 *
 * 왜 여기서 세는가: 도크를 껍데기 컴포넌트나 `<Profiler>` 로 감싸면 0 만 나온다.
 * `WorkspaceProvider` 의 `children` 은 원소 참조가 그대로라 React 가 그 하위
 * 트리를 통째로 건너뛰고, 실제로 깨어나는 것은 **컨텍스트 소비자 자신**뿐이다
 * (감싼 것들은 그 경로에 없다). 도크가 매 렌더 새로 만드는 `headerActions` 를
 * 받는 이 자식이 도크와 정확히 같은 횟수로 그려진다.
 */
const dock = vi.hoisted(() => ({ renders: 0 }));
vi.mock("@/features/terminal/TerminalSurface", () => ({
  TerminalSurface: () => {
    dock.renders++;
    return <div data-testid="surface" />;
  },
}));

import { TerminalDock } from "@/features/terminal/TerminalDock";

afterEach(() => cleanup());

/**
 * 테스트마다 **다른 프로젝트 id** 를 쓴다.
 *
 * `WorkspaceProvider` 는 프로젝트별 영속 레코드를 읽고 쓰므로, 같은 id 를
 * 나눠 쓰면 앞 테스트가 언마운트하며 남긴 값이 다음 테스트의 초기 상태가 된다.
 * 저장소를 비우는 대신 id 를 가르는 이유: `localStorage` 직접 접근은
 * `WorkspaceContext` 만의 것이다 (`pnpm lint:storage` 가 강제한다).
 */
let nextProjectId = 9_100;
const freshProject = () => nextProjectId++;

// 저장소 루트 기준으로 읽는다 — vite 가 `import.meta.url` 을 `/@fs/…` 로 주므로
// 그것으로 경로를 만들면 안 된다 (`errors_first_round.test.tsx` 와 같은 관용구).
const source = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const tab = (id: string): TerminalTab => ({ id, label: id, shell: "zsh", cwd: "/tmp" });

// ── 1. 조각의 격리 ─────────────────────────────────────────────────────────

describe("workspace slice isolation", () => {
  it("each slice wakes only in its own direction; the merged surface wakes in all four", async () => {
    const n = { full: 0, prefs: 0, runtime: 0, terminal: 0 };
    const Full = () => (useWorkspace(), n.full++, null);
    const Prefs = () => (useUiPrefs(), n.prefs++, null);
    const Runtime = () => (useProjectRuntime(), n.runtime++, null);
    const Term = () => (useTerminalSessions(), n.terminal++, null);

    let api: {
      setUiV2View: ReturnType<typeof useUiPrefs>["setUiV2View"];
      setIndexing: ReturnType<typeof useProjectRuntime>["setIndexing"];
      openTab: ReturnType<typeof useTerminalSessions>["openTab"];
      selectTab: ReturnType<typeof useTerminalSessions>["selectTab"];
    } | null = null;
    function Driver() {
      const { setUiV2View } = useUiPrefs();
      const { setIndexing } = useProjectRuntime();
      const { openTab, selectTab } = useTerminalSessions();
      api = { setUiV2View, setIndexing, openTab, selectTab };
      return null;
    }

    render(
      <WorkspaceProvider projectId={freshProject()}>
        <Full />
        <Prefs />
        <Runtime />
        <Term />
        <Driver />
      </WorkspaceProvider>,
    );

    /** 한 방향으로 5회 바꾼 뒤 각 소비자의 **추가** 렌더 수. */
    const deltas = async (run: () => void) => {
      const base = { ...n };
      for (let i = 0; i < 5; i++) await act(async () => run());
      return {
        full: n.full - base.full,
        prefs: n.prefs - base.prefs,
        runtime: n.runtime - base.runtime,
        terminal: n.terminal - base.terminal,
      };
    };

    const views = ["journal", "diff", "planner", "retro", "search"] as const;
    let i = 0;
    expect(await deltas(() => api!.setUiV2View(views[i++]))).toEqual({
      full: 5, prefs: 5, runtime: 0, terminal: 0,
    });

    const ids = [1, null, 2, null, 3];
    i = 0;
    expect(await deltas(() => api!.setIndexing(ids[i++]))).toEqual({
      full: 5, prefs: 0, runtime: 5, terminal: 0,
    });

    i = 0;
    expect(await deltas(() => api!.openTab(tab(`t${i++}`)))).toEqual({
      full: 5, prefs: 0, runtime: 0, terminal: 5,
    });

    i = 0;
    expect(await deltas(() => api!.selectTab(`t${i++}`))).toEqual({
      full: 5, prefs: 0, runtime: 0, terminal: 5,
    });
  });
});

// ── 2. 실제 소비자 — 터미널 도크 ───────────────────────────────────────────

describe("the terminal dock does not subscribe to the session slice", () => {
  const mountDock = async () => {
    dock.renders = 0;
    let sessions: ReturnType<typeof useTerminalSessions> | null = null;
    let prefs: ReturnType<typeof useUiPrefs> | null = null;
    const Driver = () => ((sessions = useTerminalSessions()), (prefs = useUiPrefs()), null);
    const id = freshProject();
    render(
      <WorkspaceProvider projectId={id}>
        <TerminalDock projectId={id} projectRoot="/tmp" />
        <Driver />
      </WorkspaceProvider>,
    );
    await act(async () => {});
    return { sessions: sessions!, prefs: prefs! };
  };

  it("opening and selecting terminal tabs does not re-render the dock", async () => {
    const { sessions } = await mountDock();
    const before = dock.renders;
    expect(before).toBeGreaterThan(0); // 마운트는 세어졌다 — 프로브가 살아 있다

    for (let i = 0; i < 5; i++) await act(async () => sessions.openTab(tab(`t${i}`)));
    for (let i = 0; i < 5; i++) await act(async () => sessions.selectTab(`t${i}`));

    // 예전(`useWorkspace()`)에는 여기서 +10 이었다.
    expect(dock.renders - before).toBe(0);
  });

  it("still re-renders when its own slice (the dock position) changes", async () => {
    const { prefs } = await mountDock();
    const before = dock.renders;
    await act(async () => prefs.setPrefs(() => ({ terminalDockPos: "right" })));
    expect(dock.renders - before).toBeGreaterThan(0);
  });
});

// ── 3. 나머지 둘 — 합친 겉면으로 돌아가지 않는다 ───────────────────────────

describe("always-mounted consumers do not use the merged surface", () => {
  const ALWAYS_MOUNTED = [
    "src/features/shell/ShellV2.tsx",
    "src/windows/ProjectTab.tsx",
    "src/features/terminal/TerminalDock.tsx",
  ];

  it.each(ALWAYS_MOUNTED)("%s does not call useWorkspace()", (rel) => {
    // 주석의 언급(왜 옮겼는지)은 남겨 두므로 **호출**만 찾는다.
    expect(source(rel)).not.toMatch(/(?<!\/\/.*)\buseWorkspace\(\)/);
  });

  it.each(ALWAYS_MOUNTED)("%s does not write whole-state directly (setState)", (rel) => {
    // `setState((prev) => ({ ...prev, … }))` 는 조각을 우회해 전체 객체를 새로
    // 만든다 — 네 조각이 전부 새 참조를 받아 격리가 무의미해진다.
    expect(source(rel)).not.toMatch(/\bsetState\(/);
  });
});
