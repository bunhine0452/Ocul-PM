import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-UI 4 — 변경 diff 전용 화면 ─────────────────────────────────────────
//
// DiffScreenV2 wraps the EXISTING diff pipeline: recentChanges (file list) +
// commands.computeDiff (body) + LocalDiffView's pure parsers (imported
// unchanged). These tests mock computeDiff and seed recentChanges via the
// persisted WorkspaceContext envelope, then assert: 4.0 목록(기록 없음 먼저 ·
// 일지별 묶음), 기록 없음 배너(요청 복사 · 직접 기록), diff body parses,
// unified/split toggle persists, snapshots_unavailable hint, and axe is clean.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

// computeDiff resolves async + the providers hydrate on mount; the first few
// body renders in a cold jsdom worker can exceed the 1000ms findByText default
// (later identical renders are ~30ms). Use a generous timeout for body waits.
const BODY_WAIT = { timeout: 3000 } as const;

const GIT_PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " context line",
  "-old line",
  "+new line",
].join("\n");

// Mutable per-test: which DiffResult computeDiff returns for a path.
const diffByPath: Record<string, unknown> = {};
// Mutable per-test: diffBinaryPreview payload per path (이미지 프리뷰).
const previewByPath: Record<string, unknown> = {};
// Mutable per-test: readProjectFile 을 실패시킬지 (무한 "읽는 중…" 버그 가드).
let readFileFails = false;
// Mutable per-test: oculpmGroupChanges 결과 (null = 그룹 없음 → 평면 목록).
let groupsResult: unknown = null;
// Mutable per-test: 일지 요약 (증거 등급) — 묶음의 일지를 요약 행으로 푸는 `oculpmWorkdayBrief` 의 답.
let briefEntries: unknown[] = [];
// Mutable per-test: `git status` 조회가 실패한다 (봉투 오류 / 진짜 Error).
let gitStatus: "ok" | "error" | "throw" = "ok";

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "computeDiff")
            return (_pid: number, path: string) =>
              ok(
                diffByPath[path] ?? {
                  path,
                  source: { source: "git", patch: GIT_PATCH },
                },
              );
          if (prop === "diffBinaryPreview")
            return (_pid: number, path: string) =>
              ok(previewByPath[path] ?? { old: null, new: null });
          if (prop === "oculpmGroupChanges") return () => ok(groupsResult);
          if (prop === "oculpmWorkdayBrief")
            return () => ok({ days: [{ workday: "20260820", entries: briefEntries }] });
          if (prop === "oculpmGetFileChanges") return () => ok([] as unknown[]);
          // 실제 백엔드는 **배열**을 준다. 예전에는 `ok(null)` 이 와도 화면이
          // `.catch` 로 조용히 삼켜 "변경 없음"과 구별되지 않았다 (2026-09-04에
          // 그 침묵을 없앴다) — 목이 진짜 모양을 흉내 내야 그 계약이 지켜진다.
          if (prop === "gitUncommittedChanges")
            return () =>
              gitStatus === "throw"
                ? Promise.reject(new Error("전송 계층 실패"))
                : gitStatus === "error"
                  ? Promise.resolve({ status: "error" as const, error: "git 을 찾지 못했어요" })
                  : ok([] as unknown[]);
          if (prop === "openInEditor") return () => ok(null);
          if (prop === "settingsGetAll") return () => ok([] as Array<[string, string]>);
          if (prop === "readProjectFile")
            return () =>
              readFileFails
                ? Promise.resolve({
                    status: "error" as const,
                    error: "Failed to read file: permission denied",
                  })
                : ok("새 파일 첫 줄\n새 파일 둘째 줄");
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import {
  cleanTitle,
  recordRequestText,
  splitChanges,
  visiblePaths,
} from "@/features/diff/changeGroups";
import {
  autoBaseline,
  mergeChanges,
  toBaselineChanges,
} from "@/features/diff/changeList";
import { WorkspaceProvider, storageKeyFor } from "@/contexts/WorkspaceContext";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { SettingsProvider } from "@/contexts/SettingsContext";

describe("cleanTitle — 제목의 마크다운 마커", () => {
  it("머리표(#) · 목록표 · 체크박스를 벗긴다", () => {
    expect(cleanTitle("# ◎ ACP 에이전트 패널")).toBe("◎ ACP 에이전트 패널");
    expect(cleanTitle("- [x] 사이드바 접기")).toBe("사이드바 접기");
  });

  it("**강조** 는 내용만 남기고, 잘려 짝이 없는 ** 도 지운다", () => {
    expect(cleanTitle("한 프로젝트에서 **대화 여러 개**를")).toBe(
      "한 프로젝트에서 대화 여러 개를",
    );
    expect(cleanTitle("한 프로젝트에서 대화 여러 개를 **")).toBe("한 프로젝트에서 대화 여러 개를");
  });

  it("일반 제목은 그대로 둔다", () => {
    expect(cleanTitle("Today 링의 라인 변화가 늘 0")).toBe("Today 링의 라인 변화가 늘 0");
  });
});

describe("splitChanges — 기록 없음 / 일지에 있음", () => {
  const group = (entry: string | null, files: string[]) => ({
    entry_path: entry,
    entry_title: entry ? `제목 ${entry}` : null,
    entry_type: entry ? "feature" : null,
    created_at: entry ? "2026-08-20T10:00:00+09:00" : null,
    verified_by_user: entry ? false : null,
    verified_stale: entry ? false : null,
    plan_refs: [],
    files,
  });
  const changes = (paths: string[]) =>
    paths.map((path, i) => ({ path, op: "M" as const, ts: i + 1, read: false }));

  it("묶음을 모르면 아무 파일도 「기록 없음」 이라고 말하지 않는다", () => {
    const b = splitChanges(null, changes(["a.ts", "b.ts"]));
    expect(b.known).toBe(false);
    expect(b.unrecorded).toEqual([]);
    expect(b.groups).toEqual([]);
  });

  it("미기록 묶음은 최근 변경이 위, 일지 묶음은 백엔드 순서 그대로", () => {
    const b = splitChanges(
      [group("e1.md", ["a.ts"]), group("e2.md", ["b.ts"]), group(null, ["c.ts", "d.ts"])] as never,
      changes(["a.ts", "b.ts", "c.ts", "d.ts"]),
    );
    expect(b.known).toBe(true);
    expect(b.unrecorded).toEqual(["d.ts", "c.ts"]);
    expect(b.groups.map((g) => g.entry_path)).toEqual(["e1.md", "e2.md"]);
  });

  it("지금 변경 목록에 없는 파일(이미 커밋됨)은 묶음에서도 빠지고, 빈 묶음은 사라진다", () => {
    const b = splitChanges(
      [group("e1.md", ["gone.ts"]), group("e2.md", ["b.ts", "gone.ts"])] as never,
      changes(["b.ts"]),
    );
    expect(b.groups.map((g) => [g.entry_path, g.files])).toEqual([["e2.md", ["b.ts"]]]);
  });

  it("j/k 이동 순서는 보이는 순서다 — 기록 없음 먼저, 접힌 묶음의 파일은 건너뛴다", () => {
    const ch = changes(["a.ts", "b.ts", "c.ts"]);
    const b = splitChanges(
      [group("e1.md", ["a.ts"]), group("e2.md", ["b.ts"]), group(null, ["c.ts"])] as never,
      ch,
    );
    expect(visiblePaths(b, ch, new Set())).toEqual(["c.ts"]);
    expect(visiblePaths(b, ch, new Set(["e2.md"]))).toEqual(["c.ts", "b.ts"]);
    // 묶음을 모르면 평면 — 최신이 위.
    expect(visiblePaths(splitChanges(null, ch), ch, new Set())).toEqual(["c.ts", "b.ts", "a.ts"]);
  });

  it("기록 요청 글은 소개 한 단락 + 파일 줄이고, 많으면 상한 뒤를 「외 N개」 로 접는다", () => {
    const files = Array.from({ length: 45 }, (_, i) => `src/f${i}.ts`);
    const text = recordRequestText(files, "소개", (n) => `외 ${n}개`);
    const lines = text.split("\n");
    expect(lines[0]).toBe("소개");
    expect(lines[2]).toBe("- src/f0.ts");
    expect(lines.filter((l) => l.startsWith("- src/"))).toHaveLength(40);
    expect(lines[lines.length - 1]).toBe("- 외 5개");
  });
});

// 멀티 창 이후 워크스페이스 영속 키는 프로젝트별이다 — 하드코딩 대신
// 컨텍스트가 내보내는 헬퍼를 쓴다 (키가 또 바뀌면 여기가 자동으로 따라간다).
const STORAGE_KEY = storageKeyFor(1);

/** Seed the watcher change buffer (v2 U3 — 세션 휘발 store) + optional
 *  persisted WorkspaceContext fields (diffActivePath 등). */
function seedRecentChanges(
  changes: Array<{ path: string; op: "A" | "M" | "D" }>,
  extra: Record<string, unknown> = {},
  projectId = 1,
) {
  changes.forEach((c, i) =>
    recentChangesStore.push(projectId, { ...c, ts: i + 1, read: false }),
  );
  if (Object.keys(extra).length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(extra));
  }
}

function renderDiff(projectId = 1) {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={projectId}>
        <DiffScreenV2 projectId={projectId} projectRoot="/tmp/proj" branch="feat/x" />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

// The diff body now syntax-highlights each line, so a line's text is split
// across marker + highlight.js token spans (e.g. `new` is a TS keyword). Assert
// against the container's textContent instead of a single text node.
async function waitForBody(container: HTMLElement) {
  await waitFor(() => expect(container.textContent).toContain("new line"), BODY_WAIT);
}

beforeEach(() => {
  localStorage.clear();
  recentChangesStore.clear(); // v2 U3 — 모듈 스코프 스토어는 테스트 간 공유된다 (인자 없으면 전부)
  for (const k of Object.keys(diffByPath)) delete diffByPath[k];
  for (const k of Object.keys(previewByPath)) delete previewByPath[k];
  readFileFails = false;
  groupsResult = null;
  gitStatus = "ok";
});
afterEach(() => cleanup());

describe("PR-UI 4 — Diff screen", () => {
  it("renders the changed-file list", async () => {
    seedRecentChanges([
      { path: "src/a.ts", op: "M" },
      { path: "src/b.ts", op: "A" },
    ]);
    const { container } = renderDiff();
    // 경로는 디렉터리 + 파일명 두 조각으로 그려지므로 텍스트 노드 하나로는
    // 잡히지 않는다 — 행의 textContent 로 확인한다 (합치면 원래 경로).
    await waitFor(() => expect(container.querySelectorAll(".chg-item .chg-name")).toHaveLength(2));
    const names = Array.from(container.querySelectorAll(".chg-item .chg-name")).map((el) => el.textContent);
    expect(names).toContain("src/a.ts");
    expect(names).toContain("src/b.ts");
    // 묶음을 아직 모르면 「기록 없음」 이라고 단언하지 않는다 — 평평한 목록이다.
    expect(container.textContent).not.toContain("일지 없음");
  });

  it("parses + renders the git diff body for the selected file", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { container } = renderDiff();
    // The +/- lines from GIT_PATCH render as .dl rows (syntax-highlighted, so
    // text is split across spans → assert via container.textContent).
    await waitFor(() => {
      expect(container.textContent).toContain("new line");
      expect(container.textContent).toContain("old line");
    }, BODY_WAIT);
    expect(container.querySelector(".dl.add")).not.toBeNull();
    expect(container.querySelector(".dl.del")).not.toBeNull();
  });

  it("empty recentChanges shows the no-change hint", async () => {
    seedRecentChanges([]);
    const { findByText } = renderDiff();
    expect(await findByText(/이 브랜치엔 아직 변경이 없어요/)).toBeInTheDocument();
  });

  /**
   * {#diff-false-empty} — 조회 실패가 "변경 없음" 으로 위장하면 안 된다.
   *
   * 이 화면은 제품 약속 「믿지 말고 보라」의 본체다. `git status` 가 죽어도 화면은
   * 정상 상태와 **글자 하나 다르지 않게** "이 브랜치엔 아직 변경이 없어요" 라고
   * 단언했다 — 사용자는 볼 것이 없다고 믿고 지나간다.
   */
  it.each([["봉투 오류", "error"], ["진짜 Error", "throw"]] as const)(
    "git status 조회가 실패하면(%s) '변경 없음' 이 아니라 사유와 재시도가 뜬다",
    async (_label, mode) => {
      gitStatus = mode;
      seedRecentChanges([]);
      const { findByText, findByRole, queryByText } = renderDiff();

      await findByText(/변경 목록을 불러오지 못했어요/);
      expect(queryByText(/이 브랜치엔 아직 변경이 없어요/)).toBeNull();
      await findByRole("button", { name: "다시 시도" });
    },
  );

  // 2026-09-01 — 크롬식 탭은 한 창에서 프로젝트를 여러 개 물고, watcher 버퍼는
  // 모듈 하나다. 프로젝트별로 갈라지지 않으면 옆 탭의 변경이 이 탭의 「미기록
  // 변경」 목록에 그대로 뜬다 (열어도 computeDiff 가 남의 경로를 받는다).
  it("옆 탭(다른 프로젝트)의 변경은 이 화면에 새지 않는다", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }], {}, 1);
    const { findByText, container } = renderDiff(2);
    expect(await findByText(/이 브랜치엔 아직 변경이 없어요/)).toBeInTheDocument();
    expect(container.querySelectorAll(".chg-item")).toHaveLength(0);
  });

  it("통합/분할 toggle switches the body layout", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { getByText, container } = renderDiff();
    await waitForBody(container);
    // Unified by default: rows have 2-col grid (no .split).
    expect(container.querySelector(".dl.split")).toBeNull();
    fireEvent.click(getByText("나란히"));
    await waitFor(() => expect(container.querySelector(".dl.split")).not.toBeNull());
  });

  it("no baseline → renders the whole file as additions (immediate diff)", async () => {
    seedRecentChanges([{ path: "src/c.ts", op: "A" }]);
    diffByPath["src/c.ts"] = {
      path: "src/c.ts",
      source: { source: "snapshots_unavailable" },
    };
    const { findByText } = renderDiff();
    // readProjectFile content shows as additions + the new-file footer, instead
    // of the old "no baseline" dead-end prompt (dogfood fix).
    expect(await findByText(/아직 비교할 기준본이 없는 새 파일/)).toBeInTheDocument();
    expect(await findByText(/새 파일 첫 줄/)).toBeInTheDocument();
  });

  it("j/k 가 파일 선택을 이동한다 — 키는 화면 컨테이너가 듣는다", async () => {
    seedRecentChanges([
      { path: "src/a.ts", op: "M" },
      { path: "src/b.ts", op: "M" },
    ]);
    const { container } = renderDiff();
    await waitForBody(container);
    // 기본 선택 = 최신 변경(src/b.ts) — 리스트 표시는 최신순이라 첫 행.
    const activeName = () => container.querySelector('.chg-item[aria-current="true"] .chg-name')?.textContent;
    const split = container.querySelector(".chg-split")!;
    expect(activeName()).toBe("src/b.ts");
    fireEvent.keyDown(split, { key: "j" });
    await waitFor(() => expect(activeName()).toBe("src/a.ts"));
    fireEvent.keyDown(split, { key: "k" });
    await waitFor(() => expect(activeName()).toBe("src/b.ts"));
    // 리스트 경계에서 멈춘다 (순환 없음).
    fireEvent.keyDown(split, { key: "k" });
    expect(activeName()).toBe("src/b.ts");
    // 전역 keydown 이 아니다 — 컨테이너 밖(창)의 j 는 아무 일도 하지 않는다.
    fireEvent.keyDown(window, { key: "j" });
    expect(activeName()).toBe("src/b.ts");
  });

  it("pre-selects the diffActivePath handoff from the journal card", async () => {
    seedRecentChanges(
      [
        { path: "src/a.ts", op: "M" },
        { path: "src/b.ts", op: "A" },
      ],
      { diffActivePath: "src/b.ts" },
    );
    const { container } = renderDiff();
    await waitForBody(container);
    // The active file row is src/b.ts (handoff wins over most-recent default).
    const active = container.querySelector('.chg-item[aria-current="true"] .chg-name');
    expect(active?.textContent).toBe("src/b.ts");
  });
});

// ── 4.0 — 예외부터: 기록 없음이 먼저, 그다음 일지별 ─────────────────────────
describe("변경 목록 — 기록 없음 먼저 · 일지별 묶음", () => {
  const entryGroup = (path: string, title: string, files: string[], type = "bug") => ({
    entry_path: path,
    entry_title: title,
    entry_type: type,
    created_at: "2026-08-20T10:00:00+09:00",
    verified_by_user: false,
    verified_stale: false,
    plan_refs: [],
    files,
  });
  const untracked = (files: string[]) => ({
    entry_path: null,
    entry_title: null,
    entry_type: null,
    created_at: null,
    verified_by_user: null,
    verified_stale: null,
    plan_refs: [],
    files,
  });
  const summaryOf = (path: string, evidence: number) => ({
    relative_path: path,
    workday: "20260820",
    type: "bug",
    slug: "x",
    status: "done",
    title: "t",
    session_id: "s",
    agent_id: "claude-code",
    verified_by_user: false,
    verified_stale: false,
    evidence,
    created_at: "2026-08-20T10:00:00+09:00",
    files_count: 1,
  });
  const clipboard = { writeText: vi.fn(() => Promise.resolve()) };

  beforeEach(() => {
    briefEntries = [];
    clipboard.writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  });

  /** 기록 없는 파일 둘 + 일지 둘(파일 셋) — 시안 Changes 의 모양. */
  function seedMixed() {
    groupsResult = [
      entryGroup("20260820/Bugs/1000_bug_a.md", "새 폴더 감시 경합", ["src/w1.ts", "src/w2.ts"]),
      entryGroup("20260820/Features_to_add/0900_feature_b.md", "자동화 모듈을 걷는다", ["src/auto.ts"], "refactor"),
      untracked(["src/today.tsx", "src/ko.ts"]),
    ];
    seedRecentChanges(
      ["src/w1.ts", "src/w2.ts", "src/auto.ts", "src/ko.ts", "src/today.tsx"].map((path) => ({
        path,
        op: "M" as const,
      })),
    );
  }

  it("파일명은 잘리지 않는 조각으로 따로 그린다 (디렉터리만 줄어들도록)", async () => {
    seedRecentChanges([{ path: "src/contexts/WorkspaceContext.tsx", op: "M" }]);
    const { container } = renderDiff();
    await waitForBody(container);
    const row = container.querySelector(".chg-item")!;
    expect(row.querySelector(".chg-dir")?.textContent).toBe("src/contexts/");
    expect(row.querySelector(".chg-base")?.textContent).toBe("WorkspaceContext.tsx");
    // 합치면 여전히 원래 경로다 (툴팁·복사 기대를 깨지 않는다).
    expect(row.querySelector(".chg-name")?.textContent).toBe("src/contexts/WorkspaceContext.tsx");
  });

  it("「기록 없음」 묶음이 먼저 서고 개수를 말한다, 그다음 「일지에 있음」 이 일지 수와 함께", async () => {
    seedMixed();
    const { container } = renderDiff();
    await waitFor(() => expect(container.querySelectorAll(".chg-bh")).toHaveLength(2));
    const heads = Array.from(container.querySelectorAll(".chg-bh")).map((h) => h.textContent);
    expect(heads[0]).toBe("일지 없음2개 파일");
    expect(heads[1]).toBe("일지에 있음3개 파일 · 일지 2");
    // 기록 없음 쪽 파일은 바로 보이고, 일지 쪽 파일은 묶음을 펼치기 전엔 안 보인다.
    const sections = container.querySelectorAll(".chg-list section");
    expect(sections[0].querySelectorAll(".chg-name")).toHaveLength(2);
    expect(sections[1].querySelectorAll(".chg-name")).toHaveLength(0);
    expect(sections[1].querySelectorAll(".chg-grp")).toHaveLength(2);
  });

  it("처음에는 기록 없는 파일부터 골라 배너를 띄운다 — 최근 변경이 위", async () => {
    seedMixed();
    const { container, findByText } = renderDiff();
    expect(await findByText("이 변경을 남긴 일지가 없어요")).toBeInTheDocument();
    const rows = container.querySelectorAll(".chg-list section:first-of-type .chg-name");
    expect(Array.from(rows).map((r) => r.textContent)).toEqual(["src/today.tsx", "src/ko.ts"]);
    expect(container.querySelector('.chg-item[aria-current="true"] .chg-name')?.textContent).toBe("src/today.tsx");
  });

  it("일지 묶음 행은 제목 · 파일 수 · 증거를 말한다 (명령 있음 ✓ / 증거 없음 !)", async () => {
    seedMixed();
    briefEntries = [
      summaryOf("20260820/Bugs/1000_bug_a.md", 0),
      summaryOf("20260820/Features_to_add/0900_feature_b.md", 2),
    ];
    const { container } = renderDiff();
    await waitFor(() => expect(container.querySelectorAll(".chg-grp")).toHaveLength(2));
    await waitFor(() => expect(container.textContent).toContain("! 검증 없음"));
    const grp = Array.from(container.querySelectorAll(".chg-grp"));
    expect(grp[0].querySelector(".chg-ti")?.textContent).toBe("새 폴더 감시 경합");
    expect(grp[0].querySelector(".chg-count")?.textContent).toBe("2");
    expect(grp[0].textContent).toContain("! 검증 없음");
    expect(grp[1].textContent).toContain("✓ 명령");
  });

  it("일지 묶음을 펼쳐 파일을 고르면 배너가 사라지고 그 일지의 검증 줄이 선다", async () => {
    seedMixed();
    const { container, findByText, queryByText } = renderDiff();
    await findByText("이 변경을 남긴 일지가 없어요");
    const first = container.querySelector(".chg-grp") as HTMLElement;
    expect(first.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(first);
    await waitFor(() => expect(first.getAttribute("aria-expanded")).toBe("true"));
    const nested = container.querySelectorAll(".chg-item.nested");
    expect(nested).toHaveLength(2);
    fireEvent.click(nested[0]);
    await waitFor(() => expect(queryByText("이 변경을 남긴 일지가 없어요")).toBeNull());
    expect(container.querySelector(".diff-entry-foot")).not.toBeNull();
  });

  it("「기록 요청 복사」 는 기록 없음 묶음의 파일 목록을 에이전트에게 붙일 글로 복사한다", async () => {
    seedMixed();
    const { findByText, getByText } = renderDiff();
    await findByText("이 변경을 남긴 일지가 없어요");
    fireEvent.click(getByText("기록 요청 복사"));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
    const text = (clipboard.writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain("작업 일지에 기록돼 있지 않아요");
    expect(text).toContain("- src/today.tsx");
    expect(text).toContain("- src/ko.ts");
    // 일지에 있는 파일은 요청에 싣지 않는다.
    expect(text).not.toContain("src/w1.ts");
  });

  it("「직접 기록」 은 수동 일지 작성기를 그 파일들로 미리 채워 연다", async () => {
    seedMixed();
    const { findByText, getByText, container } = renderDiff();
    await findByText("이 변경을 남긴 일지가 없어요");
    fireEvent.click(getByText("직접 기록"));
    expect(await findByText("수동 일지 작성")).toBeInTheDocument();
    const chips = Array.from(container.ownerDocument.querySelectorAll(".entry-files .scope-chip.on")).map(
      (c) => c.textContent,
    );
    expect(chips.sort()).toEqual(["src/ko.ts", "src/today.tsx"]);
  });

  it("기록 없는 파일이 없으면 배너도 「기록 없음」 묶음도 없다", async () => {
    groupsResult = [entryGroup("20260820/Bugs/1000_bug_a.md", "하나뿐인 일지", ["src/a.ts"]), untracked([])];
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { container, queryByText } = renderDiff();
    await waitFor(() => expect(container.querySelectorAll(".chg-bh")).toHaveLength(1));
    expect(container.querySelector(".chg-bh")?.textContent).toBe("일지에 있음1개 파일 · 일지 1");
    expect(queryByText("이 변경을 남긴 일지가 없어요")).toBeNull();
  });
});

describe("바이너리/이미지 diff — 파일 카드 렌더", () => {
  it("이미지 파일은 텍스트 diff 대신 이전/현재 프리뷰 카드를 그린다", async () => {
    seedRecentChanges([{ path: "assets/logo.png", op: "M" }]);
    diffByPath["assets/logo.png"] = {
      path: "assets/logo.png",
      source: { source: "binary", is_image: true, old_size: 1024, new_size: 2048 },
    };
    previewByPath["assets/logo.png"] = {
      old: { mime: "image/png", base64: "QUFB", size: 1024 },
      new: { mime: "image/png", base64: "QkJC", size: 2048 },
    };
    const { container, findByText } = renderDiff();
    expect(await findByText("이미지 파일")).toBeInTheDocument();
    // 이전/현재 프리뷰 두 장이 data URI 로 붙는다.
    await waitFor(() => {
      const imgs = Array.from(container.querySelectorAll(".diff-binary-img img"));
      expect(imgs).toHaveLength(2);
      expect((imgs[0] as HTMLImageElement).src).toBe("data:image/png;base64,QUFB");
      expect((imgs[1] as HTMLImageElement).src).toBe("data:image/png;base64,QkJC");
    }, BODY_WAIT);
    // 사이즈 요약 (1.0 KB → 2.0 KB) + 증가 delta.
    expect(container.textContent).toContain("1.0 KB");
    expect(container.textContent).toContain("2.0 KB");
    // 텍스트 diff 행은 없어야 한다.
    expect(container.querySelector(".dl")).toBeNull();
  });

  it("기타 바이너리는 사이즈 카드만 (프리뷰 없음, 신규 파일 old=—)", async () => {
    seedRecentChanges([{ path: "db/cache.db", op: "A" }]);
    diffByPath["db/cache.db"] = {
      path: "db/cache.db",
      source: { source: "binary", is_image: false, old_size: null, new_size: 500 },
    };
    const { container, findByText } = renderDiff();
    expect(await findByText("바이너리 파일")).toBeInTheDocument();
    expect(container.textContent).toContain("500 B");
    expect(container.querySelector(".diff-binary-img")).toBeNull();
    expect(container.querySelector(".dl")).toBeNull();
  });

  it("readProjectFile 실패 시 '읽는 중…' 에 갇히지 않고 안내를 띄운다", async () => {
    seedRecentChanges([{ path: "locked.ts", op: "A" }]);
    diffByPath["locked.ts"] = {
      path: "locked.ts",
      source: { source: "snapshots_unavailable" },
    };
    readFileFails = true;
    const { findByText, queryByText } = renderDiff();
    expect(await findByText(/파일을 읽을 수 없어요/)).toBeInTheDocument();
    expect(queryByText(/파일을 읽는 중/)).toBeNull();
  });
});

describe("diff 라인 번호 — @@ 헤더 기반 실제 번호", () => {
  it("unified 거터가 hunk 시작 오프셋을 반영한다", async () => {
    seedRecentChanges([{ path: "src/off.ts", op: "M" }]);
    diffByPath["src/off.ts"] = {
      path: "src/off.ts",
      source: {
        source: "git",
        patch: [
          "diff --git a/src/off.ts b/src/off.ts",
          "--- a/src/off.ts",
          "+++ b/src/off.ts",
          "@@ -40,3 +40,3 @@",
          " context line",
          "-old line",
          "+new line",
        ].join("\n"),
      },
    };
    const { container } = renderDiff();
    await waitFor(() => expect(container.textContent).toContain("new line"), BODY_WAIT);
    const guts = Array.from(container.querySelectorAll(".dl .dl-gut")).map(
      (el) => el.textContent,
    );
    // context = new 쪽 40, deletion = old 쪽 41, addition = new 쪽 41.
    expect(guts).toEqual(["40", "41", "41"]);
  });
});

describe("PR-UI 4 — Diff a11y", () => {
  it("has no axe violations with a diff loaded", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { container } = renderDiff();
    await waitForBody(container);
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("기록 없음 배너와 일지 묶음이 함께 선 목록도 위반이 없다", async () => {
    groupsResult = [
      ...["j/1.md", "j/2.md"].map((p, i) => ({
        entry_path: p,
        entry_title: `일지 ${i}`,
        entry_type: "bug",
        created_at: "2026-08-20T10:00:00+09:00",
        verified_by_user: false,
        verified_stale: false,
        plan_refs: [],
        files: [`src/g${i}a.ts`, `src/g${i}b.ts`],
      })),
      { entry_path: null, entry_title: null, entry_type: null, created_at: null, verified_by_user: null, verified_stale: null, plan_refs: [], files: ["src/lost.ts"] },
    ];
    seedRecentChanges(
      [...[0, 1].flatMap((i) => ["a", "b"].map((s) => `src/g${i}${s}.ts`)), "src/lost.ts"].map((path) => ({
        path,
        op: "M" as const,
      })),
    );
    const { container, findByText } = renderDiff();
    await findByText("이 변경을 남긴 일지가 없어요");
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});

// ── 목록의 순수 규칙 (분할 라운드 {#planner-diff-split} 에서 화면 밖으로) ────
//
// 위 화면 테스트들은 이 규칙을 렌더 너머로만 건드린다 — 병합 우선순위와 정렬
// 순서, 기준선 자동 선택은 여기서 직접 못박는다.

describe("changeList — 목록 병합과 기준선", () => {
  const live = (path: string, op: "A" | "M" | "D", ts: number) => ({
    path,
    op,
    ts,
    read: false,
  });

  it("git 행을 ts=0 · read=true 로 옮긴다 (바탕은 새 소식이 아니다)", () => {
    expect(toBaselineChanges([{ path: "src/a.ts", op: "M" }])).toEqual([
      { path: "src/a.ts", op: "M", ts: 0, read: true },
    ]);
  });

  it("같은 경로는 워처 항목이 이긴다 — 최신 op 와 진짜 시각을 갖고 있다", () => {
    const merged = mergeChanges(toBaselineChanges([{ path: "src/a.ts", op: "M" }]), [
      live("src/a.ts", "D", 500),
    ]);
    expect(merged).toEqual([{ path: "src/a.ts", op: "D", ts: 500, read: false }]);
  });

  it("git 바탕(ts=0)이 먼저 서고 라이브 편집이 최신으로 뒤에 온다", () => {
    const merged = mergeChanges(
      toBaselineChanges([
        { path: "src/z.ts", op: "M" },
        { path: "src/b.ts", op: "M" },
      ]),
      [live("src/live.ts", "A", 10)],
    );
    // ts 가 같으면 경로 사전순 — 목록이 렌더마다 흔들리지 않게.
    expect(merged.map((c) => c.path)).toEqual(["src/b.ts", "src/z.ts", "src/live.ts"]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const git = toBaselineChanges([
      { path: "src/z.ts", op: "M" },
      { path: "src/b.ts", op: "M" },
    ]);
    mergeChanges(git, []);
    expect(git.map((c) => c.path)).toEqual(["src/z.ts", "src/b.ts"]);
  });

  it("작업트리에 변경이 있으면 작업트리를 본다", () => {
    expect(autoBaseline(3, 7)).toBe("working");
  });

  it("작업트리가 깨끗하면 직전 커밋으로 넘어간다", () => {
    expect(autoBaseline(0, 7)).toBe("last_commit");
  });

  it("돌아갈 커밋이 없으면 작업트리에 남는다 (빈 화면이 정답인 경우)", () => {
    expect(autoBaseline(0, 0)).toBe("working");
  });
});
