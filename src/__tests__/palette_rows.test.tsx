/**
 * ⌘K 의 줄이 다른 화면과 같은 말을 한다 (11-15 최종 검수).
 *
 *  - 일지 줄의 「오늘 · 어제」 는 일지 목록과 같은 오늘(백엔드의 프로젝트 작업일)로 — 로컬 달력을 오늘로 치면
 *    04:00 에 날이 바뀌는 프로젝트에서 같은 일지를 목록은 「오늘」, 팔레트는 「어제」 라 불렀다.
 *  - 이 창의 세션은 탭과 같은 이름 · 번호 — 같은 프롬프트로 돈 시도 셋이 같은 제목 세 줄이었고, 제목 없는 codex
 *    세션은 「zsh」 로 섰다. 기다림 칩은 오늘 · 프로젝트 줄과 같은 「기다림」, 사유는 회색 글자 · title.
 *  - 「프로젝트 색 바꾸기」 의 머리도 다른 동작처럼 선 아이콘이고, 지금 색 점은 줄 끝.
 *  - 바닥의 키 표기는 단축키 표와 한 벌 — ↑ · ↓ 키캡 둘, ↩ (그 밖 OS 는 Enter).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";

const fx = vi.hoisted(() => ({
  sessions: [] as unknown[],
  hits: [] as unknown[],
}));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => fx.sessions, onSessionsChanged: async () => () => {} },
}));
vi.mock("@/api/window", () => ({
  windowApi: { attention: async () => new Map(), openProjectIds: async () => [], openProjectWindow: async () => null },
}));
vi.mock("@/api/projects", () => ({ projectsApi: { brief: async () => null } }));
vi.mock("@/api/plan", () => ({ planApi: { list: async () => [] } }));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: { searchJournal: async () => ({ hits: fx.hits, total: fx.hits.length }) },
}));
// 나란히 돌린 시도 셋 — 레인 순번은 이 창의 레인 짝이 정한다(`race.laneNumberOf`).
vi.mock("@/features/terminal/race", () => ({
  laneNumberOf: (id: number) => ({ 11: 1, 12: 2, 13: 3 })[id] ?? null,
  useRace: () => ({ lanes: [], sessions: new Map(), expanded: false }),
}));

import { CommandPalette } from "@/components/CommandPalette";
import { WorkspaceProvider, useProjectRuntime } from "@/contexts/WorkspaceContext";
import { __resetSessionNumbersForTests } from "@/features/terminal/status";
import { t } from "@/i18n";
import type { OculpmStatus, Project, TermInfo } from "@/lib/bindings";
import { __setPlatformForTests } from "@/lib/platform";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

const PROJECTS: Project[] = [
  { id: 1, name: "ai-pm", root_path: "/Users/me/ai-pm", created_at: 2, icon: null, color: "teal" },
  { id: 2, name: "naeri", root_path: "/Users/me/naeri", created_at: 1, icon: null, color: null },
];

const WORKING = { state: "working", kind: null, msg: null, since: "2026-11-15T09:00:00Z" };

function session(id: number, over: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: 1,
    label: "claude",
    started_at: "2026-11-15T09:00:00Z",
    alive: true,
    exit_code: null,
    status: WORKING as TermInfo["status"],
    busy: true,
    unseen: false,
    ...over,
  };
}

/** 백엔드가 준 이 프로젝트의 오늘 — 프로젝트 tz · day_starts_at 을 반영한 작업일. */
function BackendWorkday({ workday }: { workday: string }) {
  const { setOculpmStatus } = useProjectRuntime();
  useEffect(() => {
    setOculpmStatus({ initialized: true, current_workday: workday } as OculpmStatus);
  }, [setOculpmStatus, workday]);
  return null;
}

function renderPalette(workday?: string) {
  return render(
    <WorkspaceProvider projectId={1}>
      {workday ? <BackendWorkday workday={workday} /> : null}
      <CommandPalette open onOpenChange={() => {}} onOpenSettings={() => {}} projects={PROJECTS} onSelectProject={() => {}} />
    </WorkspaceProvider>,
  );
}

const hit = (path: string, workday: string, title: string) => ({
  relative_path: path,
  workday,
  entry_type: "bug",
  status: "done",
  title,
  snippet: "",
  matched_field: "title",
  why: "title",
  score: null,
});

beforeEach(() => {
  __resetSessionNumbersForTests();
  fx.sessions = [];
  fx.hits = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("journal rows say 「today」 the way the journal list does", () => {
  it("day_starts_at 04:00 · local 11-16 01:30 · backend workday 20261115 → a 20261115 entry is today, 20261114 yesterday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 1, 30));
    fx.hits = [hit("a.md", "20261115", "cache fix"), hit("b.md", "20261114", "cache warm")];
    renderPalette("20261115");
    fireEvent.change(screen.getByPlaceholderText(t("palette.placeholder")), { target: { value: "cache" } });
    const group = await screen.findByRole("group", { name: t("palette.group.journal") });
    const rows = within(group).getAllByRole("option");
    expect(rows[0].querySelector(".palette-meta")?.textContent).toBe(t("journal.day.today"));
    expect(rows[1].querySelector(".palette-meta")?.textContent).toBe(t("journal.day.yesterday"));
  });
});

describe("session rows — the tab's name and number", () => {
  it("three parallel attempts read 1 · 2 · 3 and 「attempt n」, an untitled codex session reads codex", async () => {
    fx.sessions = [
      session(11),
      session(12),
      session(13),
      session(21, { label: "zsh", status: { ...WORKING, app: "codex" } as TermInfo["status"] }),
    ];
    renderPalette();
    const group = await screen.findByRole("group", { name: t("palette.group.sessions") });
    const labels = within(group)
      .getAllByRole("option")
      .map((o) => o.querySelector(".palette-label")!.textContent);
    expect(labels).toEqual([
      `1 ${t("race.lane", { n: 1 })}`,
      `2 ${t("race.lane", { n: 2 })}`,
      `3 ${t("race.lane", { n: 3 })}`,
      "4 codex",
    ]);
    expect(group.querySelector(".palette-num")?.className).toBe("palette-num");
  });

  it("another window's session has no number; a waiting one wears 「waiting」 with the reason in grey and in its title", async () => {
    fx.sessions = [
      session(11),
      session(31, {
        project_id: 2,
        status: { state: "blocked", kind: "permission", msg: null, since: "2026-11-15T09:20:00Z" } as TermInfo["status"],
      }),
    ];
    renderPalette();
    const group = await screen.findByRole("group", { name: t("palette.group.sessions") });
    const waiting = within(group).getAllByRole("option")[0];
    expect(waiting.querySelector(".palette-label")?.textContent).toBe("claude");
    expect(waiting.querySelector(".palette-num")).toBeNull();
    const chip = waiting.querySelector(".chip.warn")!;
    expect(chip.textContent).toBe(t("palette.waiting"));
    expect(chip.getAttribute("title")).toBe(t("terminal.state.permission"));
    const metas = [...waiting.querySelectorAll(".palette-meta")].map((m) => m.textContent);
    expect(metas).toEqual(["naeri", t("terminal.state.permission")]);
  });
});

describe("the project colour action and the foot", () => {
  it("leads with a line icon like the other actions; the current colour dot sits at the end", async () => {
    renderPalette();
    const row = await screen.findByRole("option", { name: new RegExp(t("palette.projectColor")) });
    expect(row.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(row.lastElementChild?.classList.contains("proj-dot")).toBe(true);
    expect(row.lastElementChild?.getAttribute("data-pc")).toBe("teal");
  });

  it("foot keys match the sheet: ↑ · ↓ as two keycaps and ↩ (Enter off the mac)", async () => {
    const { unmount } = renderPalette();
    const foot = () => [...document.querySelectorAll(".palette-foot kbd")].map((k) => k.textContent);
    await waitFor(() => expect(foot()).toEqual(["↑", "↓", "↩"]));
    unmount();
    __setPlatformForTests("windows");
    renderPalette();
    await act(async () => {});
    expect(foot()).toEqual(["↑", "↓", "Enter"]);
  });
});
