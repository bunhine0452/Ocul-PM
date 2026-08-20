import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-UI 4 — 변경 diff 전용 화면 ─────────────────────────────────────────
//
// DiffScreenV2 wraps the EXISTING diff pipeline: recentChanges (file list) +
// commands.computeDiff (body) + LocalDiffView's pure parsers (imported
// unchanged). These tests mock computeDiff and seed recentChanges via the
// persisted WorkspaceContext envelope, then assert: file list renders, diff
// body parses, unified/split toggle persists, "검토 완료" pushes diffReadPaths,
// snapshots_unavailable hint, and axe is clean.

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
  buildGroupViews,
  cleanTitle,
  collapsePlanRefs,
  visiblePathsOf,
} from "@/features/diff/changeGroups";
import { WorkspaceProvider, storageKeyFor } from "@/contexts/WorkspaceContext";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { SettingsProvider } from "@/contexts/SettingsContext";

describe("collapsePlanRefs", () => {
  it("collapses many items of one plan into a single chip (keeps items)", () => {
    const refs = [
      { plan_id: "p1", plan_title: "이오름 리디자인", item_title: "마이페이지" },
      { plan_id: "p1", plan_title: "이오름 리디자인", item_title: "쿠폰" },
      { plan_id: "p1", plan_title: "이오름 리디자인", item_title: "PDF" },
    ];
    const out = collapsePlanRefs(refs);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("이오름 리디자인");
    expect(out[0].items).toEqual(["마이페이지", "쿠폰", "PDF"]);
  });

  it("keeps distinct plans separate, in insertion order", () => {
    const refs = [
      { plan_id: "p1", plan_title: "A", item_title: "a1" },
      { plan_id: "p2", plan_title: "B", item_title: "b1" },
      { plan_id: "p1", plan_title: "A", item_title: "a2" },
    ];
    const out = collapsePlanRefs(refs);
    expect(out.map((p) => p.planId)).toEqual(["p1", "p2"]);
    expect(out[0].items).toEqual(["a1", "a2"]);
  });
});

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

describe("buildGroupViews — 왼쪽 목록 모델", () => {
  const group = (
    entry: string | null,
    files: string[],
    extra: Partial<Record<string, unknown>> = {},
  ) => ({
    entry_path: entry,
    entry_title: entry ? `제목 ${entry}` : null,
    entry_type: entry ? "feature" : null,
    created_at: entry ? "2026-08-20T10:00:00+09:00" : null,
    plan_refs: [],
    files,
    ...extra,
  });
  const changes = (paths: string[]) =>
    paths.map((path, i) => ({ path, op: "M" as const, ts: i + 1, read: false }));

  it("그룹이 없으면 머리글 없는 한 덩어리 — 최신 변경이 위", () => {
    const views = buildGroupViews({
      groups: null,
      changes: changes(["a.ts", "b.ts"]),
      filter: "",
      collapsed: new Set(),
      reviewed: new Set(),
    });
    expect(views).toHaveLength(1);
    expect(views[0].headerless).toBe(true);
    expect(views[0].files).toEqual(["b.ts", "a.ts"]);
  });

  it("접힌 그룹의 파일은 j/k 이동 순서에서 빠진다", () => {
    const groups = [group("e1.md", ["a.ts"]), group("e2.md", ["b.ts", "c.ts"])];
    const views = buildGroupViews({
      groups: groups as never,
      changes: changes(["a.ts", "b.ts", "c.ts"]),
      filter: "",
      collapsed: new Set(["e2.md"]),
      reviewed: new Set(),
    });
    expect(views.map((v) => v.collapsed)).toEqual([false, true]);
    // 접혀 있어도 머리글은 총 개수를 말해 준다.
    expect(views[1].total).toBe(2);
    expect(visiblePathsOf(views)).toEqual(["a.ts"]);
  });

  it("필터가 걸리면 접힘을 무시하고, 일치가 없는 그룹은 빠진다", () => {
    const groups = [group("e1.md", ["src/a.ts"]), group("e2.md", ["docs/b.md"])];
    const views = buildGroupViews({
      groups: groups as never,
      changes: changes(["src/a.ts", "docs/b.md"]),
      filter: "docs",
      collapsed: new Set(["e1.md", "e2.md"]),
      reviewed: new Set(),
    });
    expect(views.map((v) => v.key)).toEqual(["e2.md"]);
    expect(views[0].collapsed).toBe(false);
    expect(visiblePathsOf(views)).toEqual(["docs/b.md"]);
  });

  it("검토 진행도는 필터와 무관하게 그룹 전체 기준으로 센다", () => {
    const groups = [group("e1.md", ["a.ts", "b.ts", "c.ts"])];
    const views = buildGroupViews({
      groups: groups as never,
      changes: changes(["a.ts", "b.ts", "c.ts"]),
      filter: "a",
      collapsed: new Set(),
      reviewed: new Set(["b.ts", "c.ts"]),
    });
    expect(views[0].files).toEqual(["a.ts"]);
    expect(views[0].reviewed).toBe(2);
    expect(views[0].total).toBe(3);
  });

  it("같은 날짜가 이어지면 뒤쪽 그룹에선 날짜를 지운다", () => {
    const groups = [
      group("e1.md", ["a.ts"]),
      group("e2.md", ["b.ts"]),
      group("e3.md", ["c.ts"], { created_at: "2026-08-19T10:00:00+09:00" }),
    ];
    const views = buildGroupViews({
      groups: groups as never,
      changes: changes(["a.ts", "b.ts", "c.ts"]),
      filter: "",
      collapsed: new Set(),
      reviewed: new Set(),
    });
    expect(views.map((v) => v.date)).toEqual(["8. 20.", "", "8. 19."]);
  });

  it("제목의 마크다운을 걷어내고 미기록 그룹을 표시한다", () => {
    const groups = [group("e1.md", ["a.ts"], { entry_title: "**작업** 하나" }), group(null, ["z.ts"])];
    const views = buildGroupViews({
      groups: groups as never,
      changes: changes(["a.ts", "z.ts"]),
      filter: "",
      collapsed: new Set(),
      reviewed: new Set(),
    });
    expect(views[0].title).toBe("작업 하나");
    expect(views[1].untracked).toBe(true);
    expect(views[1].key).toBe("__untracked");
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
) {
  changes.forEach((c, i) => recentChangesStore.push({ ...c, ts: i + 1, read: false }));
  if (Object.keys(extra).length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(extra));
  }
}

function renderDiff() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <DiffScreenV2 projectId={1} projectRoot="/tmp/proj" branch="feat/x" />
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
  recentChangesStore.clear(); // v2 U3 — 모듈 스코프 스토어는 테스트 간 공유된다
  for (const k of Object.keys(diffByPath)) delete diffByPath[k];
  for (const k of Object.keys(previewByPath)) delete previewByPath[k];
  readFileFails = false;
  groupsResult = null;
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
    await waitFor(() =>
      expect(container.querySelectorAll(".diff-files .dfile-name")).toHaveLength(2),
    );
    const names = Array.from(
      container.querySelectorAll(".diff-files .dfile-name"),
    ).map((el) => el.textContent);
    expect(names).toContain("src/a.ts");
    expect(names).toContain("src/b.ts");
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

  it("통합/분할 toggle switches the body layout", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { getByText, container } = renderDiff();
    await waitForBody(container);
    // Unified by default: rows have 2-col grid (no .split).
    expect(container.querySelector(".dl.split")).toBeNull();
    fireEvent.click(getByText("분할"));
    await waitFor(() => expect(container.querySelector(".dl.split")).not.toBeNull());
  });

  it("'검토 완료' marks the file reviewed (checkmark + disabled)", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { getByText, container } = renderDiff();
    await waitForBody(container);
    const btn = getByText("검토 완료").closest("button")!;
    fireEvent.click(btn);
    await waitFor(() => expect(getByText("검토함")).toBeInTheDocument());
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
    expect(await findByText(/아직 baseline 이 없는 새 파일/)).toBeInTheDocument();
    expect(await findByText(/새 파일 첫 줄/)).toBeInTheDocument();
  });

  it("v2 U8 — j/k 가 파일 선택을 이동한다 (입력 필드 밖에서만)", async () => {
    seedRecentChanges([
      { path: "src/a.ts", op: "M" },
      { path: "src/b.ts", op: "M" },
    ]);
    const { container } = renderDiff();
    await waitForBody(container);
    // 기본 선택 = 최신 변경(src/b.ts) — 리스트 표시는 최신순이라 첫 행.
    const activeName = () =>
      container.querySelector(".dfile.active .dfile-name")?.textContent;
    expect(activeName()).toBe("src/b.ts");
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(activeName()).toBe("src/a.ts"));
    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(activeName()).toBe("src/b.ts"));
    // 리스트 경계에서 멈춘다 (순환 없음).
    fireEvent.keyDown(window, { key: "k" });
    expect(activeName()).toBe("src/b.ts");
    // 검색 인풋 포커스 중엔 j/k 무시.
    const input = container.querySelector(".diff-search input") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
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
    const active = container.querySelector(".dfile.active .dfile-name");
    expect(active?.textContent).toBe("src/b.ts");
  });
});

// ── 2026-08-20 도그푸딩 — 일지가 쌓이면 왼쪽 목록이 난잡해지던 것 ──────────
describe("변경된 파일 목록 — 접힘 · 필터 · 경로 표시", () => {
  const entryGroup = (path: string, title: string, files: string[]) => ({
    entry_path: path,
    entry_title: title,
    entry_type: "feature",
    created_at: "2026-08-20T10:00:00+09:00",
    plan_refs: [],
    files,
  });

  it("파일명은 잘리지 않는 조각으로 따로 그린다 (디렉터리만 줄어들도록)", async () => {
    seedRecentChanges([{ path: "src/contexts/WorkspaceContext.tsx", op: "M" }]);
    const { container } = renderDiff();
    await waitForBody(container);
    const row = container.querySelector(".diff-files .dfile")!;
    expect(row.querySelector(".dfile-dir")?.textContent).toBe("src/contexts/");
    expect(row.querySelector(".dfile-base")?.textContent).toBe("WorkspaceContext.tsx");
    // 합치면 여전히 원래 경로다 (툴팁·복사 기대를 깨지 않는다).
    expect(row.querySelector(".dfile-name")?.textContent).toBe(
      "src/contexts/WorkspaceContext.tsx",
    );
  });

  it("그룹이 셋 이상이면 처음부터 하나만 펼친다", async () => {
    groupsResult = [
      entryGroup("j/1.md", "가장 최근 일지", ["a.ts"]),
      entryGroup("j/2.md", "그 전 일지", ["b.ts"]),
      entryGroup("j/3.md", "더 전 일지", ["c.ts"]),
    ];
    seedRecentChanges([
      { path: "a.ts", op: "M" },
      { path: "b.ts", op: "M" },
      { path: "c.ts", op: "M" },
    ]);
    const { container } = renderDiff();
    // 머리글 셋은 다 보이지만 파일 행은 펼친 그룹 것만.
    await waitFor(() => {
      expect(container.querySelectorAll(".diff-group-head")).toHaveLength(3);
      expect(container.querySelectorAll(".diff-files .dfile")).toHaveLength(1);
    });
    // 접힌 머리글도 파일 수는 말해 준다.
    const counts = Array.from(container.querySelectorAll(".dfl-progress")).map(
      (el) => el.textContent,
    );
    expect(counts).toEqual(["1", "1", "1"]);
  });

  it("머리글의 화살표로 그룹을 펼치고 접는다", async () => {
    groupsResult = [
      entryGroup("j/1.md", "최근", ["a.ts"]),
      entryGroup("j/2.md", "이전", ["b.ts"]),
      entryGroup("j/3.md", "그 이전", ["c.ts"]),
    ];
    seedRecentChanges([
      { path: "a.ts", op: "M" },
      { path: "b.ts", op: "M" },
      { path: "c.ts", op: "M" },
    ]);
    const { container } = renderDiff();
    await waitFor(() =>
      expect(container.querySelectorAll(".diff-files .dfile")).toHaveLength(1),
    );
    const folds = container.querySelectorAll(".dfl-fold");
    expect(folds[1].getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(folds[1]);
    await waitFor(() =>
      expect(container.querySelectorAll(".diff-files .dfile")).toHaveLength(2),
    );
  });

  it("필터는 접힌 그룹까지 훑고, 지우면 원래 접힘으로 돌아온다", async () => {
    groupsResult = [
      entryGroup("j/1.md", "최근", ["src/a.ts", "src/b.ts", "src/c.ts"]),
      entryGroup("j/2.md", "이전", ["docs/guide.md", "docs/spec.md"]),
      entryGroup("j/3.md", "그 이전", ["scripts/x.mjs", "scripts/y.mjs", "scripts/z.mjs"]),
    ];
    seedRecentChanges(
      ["src/a.ts", "src/b.ts", "src/c.ts", "docs/guide.md", "docs/spec.md", "scripts/x.mjs", "scripts/y.mjs", "scripts/z.mjs"].map(
        (path) => ({ path, op: "M" as const }),
      ),
    );
    const { container } = renderDiff();
    await waitFor(() =>
      expect(container.querySelectorAll(".diff-files .dfile")).toHaveLength(3),
    );
    const input = container.querySelector(".dfl-filter input") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "docs/" } });
    await waitFor(() => {
      const names = Array.from(container.querySelectorAll(".diff-files .dfile-name")).map(
        (el) => el.textContent,
      );
      expect(names).toEqual(["docs/guide.md", "docs/spec.md"]);
    });
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() =>
      expect(container.querySelectorAll(".diff-files .dfile")).toHaveLength(3),
    );
  });

  it("일치가 없으면 빈 목록 대신 안내를 띄운다", async () => {
    seedRecentChanges(
      Array.from({ length: 9 }, (_, i) => ({ path: `src/f${i}.ts`, op: "M" as const })),
    );
    const { container, findByText } = renderDiff();
    await waitForBody(container);
    const input = container.querySelector(".dfl-filter input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "존재하지않는파일" } });
    expect(await findByText("일치하는 파일이 없어요.")).toBeInTheDocument();
  });

  it("파일이 적으면 필터 상자를 띄우지 않는다", async () => {
    seedRecentChanges([{ path: "src/a.ts", op: "M" }]);
    const { container } = renderDiff();
    await waitForBody(container);
    expect(container.querySelector(".dfl-filter")).toBeNull();
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

  it("접힘 · 필터가 붙은 그룹 목록도 위반이 없다", async () => {
    groupsResult = ["j/1.md", "j/2.md", "j/3.md"].map((p, i) => ({
      entry_path: p,
      entry_title: `일지 ${i}`,
      entry_type: "bug",
      created_at: "2026-08-20T10:00:00+09:00",
      plan_refs: [],
      files: [`src/g${i}a.ts`, `src/g${i}b.ts`, `src/g${i}c.ts`],
    }));
    seedRecentChanges(
      [0, 1, 2].flatMap((i) =>
        ["a", "b", "c"].map((s) => ({ path: `src/g${i}${s}.ts`, op: "M" as const })),
      ),
    );
    const { container } = renderDiff();
    await waitFor(() => expect(container.querySelector(".dfl-filter")).not.toBeNull());
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
