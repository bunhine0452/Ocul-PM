// B6 문제 패널 — 순수 정렬·스토어·패널 (docs/20260902_vscode-borrows/05-problems.md).
//
// 이 패널의 값은 "무엇을 먼저 보여 주는가" 와 "빈 목록이 무엇을 뜻하는가" 다.
// 둘 다 조용히 틀려도 화면은 멀쩡해 보이므로 여기서 잠근다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";
import type { LspDiagnostic, LspSeverity } from "@/lib/bindings";

import {
  filterBySeverity,
  groupByFile,
  ITEMS_PER_FILE,
  totalCounts,
} from "@/features/code/problemsModel";
import { problemsStore, useProblems } from "@/features/code/problemsStore";
import { CodeProblems } from "@/features/code/CodeProblems";
import { t } from "@/i18n";

function diag(
  line: number,
  severity: LspSeverity = "error",
  message = "boom",
  character = 0,
): LspDiagnostic {
  return {
    start_line: line,
    start_character: character,
    end_line: line,
    end_character: character + 1,
    severity,
    message,
    source: null,
  };
}

const paths = (files: { path: string }[]) => files.map((f) => f.path);

afterEach(cleanup);

describe("groupByFile", () => {
  it("오류 있는 파일이 먼저, 그 다음 오류 수, 그 다음 경로", () => {
    const files = groupByFile([
      ["b.ts", [diag(1, "warning")]],
      ["z.ts", [diag(1), diag(2)]],
      ["a.ts", [diag(1, "warning"), diag(2, "warning"), diag(3, "warning")]],
      ["c.ts", [diag(1)]],
    ]);
    // z(오류2) > c(오류1) > a·c 없는 경고 파일들은 경로순.
    expect(paths(files)).toEqual(["z.ts", "c.ts", "a.ts", "b.ts"]);
  });

  it("파일 안은 줄 → 열 오름차순", () => {
    const [file] = groupByFile([
      ["a.ts", [diag(9, "error", "c"), diag(2, "error", "b", 7), diag(2, "error", "a", 1)]],
    ]);
    expect(file.items.map((d) => d.message)).toEqual(["a", "b", "c"]);
  });

  it("원본 배열을 뒤집지 않는다", () => {
    const items = [diag(9), diag(2)];
    groupByFile([["a.ts", items]]);
    expect(items.map((d) => d.start_line)).toEqual([9, 2]);
  });

  it("빈 파일은 카드를 세우지 않는다", () => {
    expect(groupByFile([["a.ts", []]])).toEqual([]);
  });

  it("심각도별 개수를 센다", () => {
    const [file] = groupByFile([
      ["a.ts", [diag(1), diag(2, "warning"), diag(3, "info"), diag(4, "hint")]],
    ]);
    expect(file.counts).toEqual({ error: 1, warning: 1, info: 1, hint: 1 });
  });
});

describe("filterBySeverity", () => {
  const files = groupByFile([
    ["a.ts", [diag(1), diag(2, "warning"), diag(3, "info")]],
    ["b.ts", [diag(1, "warning")]],
    ["c.ts", [diag(1, "hint")]],
  ]);

  it("오류만", () => {
    const out = filterBySeverity(files, "error");
    expect(paths(out)).toEqual(["a.ts"]);
    expect(out[0].items).toHaveLength(1);
  });

  it("경고 이상 — 오류도 남는다", () => {
    const out = filterBySeverity(files, "warning");
    expect(paths(out)).toEqual(["a.ts", "b.ts"]);
    expect(out[0].items).toHaveLength(2);
  });

  it("hint 이상은 전부", () => {
    expect(paths(filterBySeverity(files, "hint"))).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("개수도 걸러진 것 기준으로 다시 센다", () => {
    expect(filterBySeverity(files, "error")[0].counts).toEqual({
      error: 1,
      warning: 0,
      info: 0,
      hint: 0,
    });
  });
});

describe("totalCounts", () => {
  it("전부 합친다", () => {
    const files = groupByFile([
      ["a.ts", [diag(1), diag(2, "warning")]],
      ["b.ts", [diag(1), diag(2)]],
    ]);
    expect(totalCounts(files)).toEqual({ error: 3, warning: 1, info: 0, hint: 0 });
  });
  it("빈 목록은 0", () => {
    expect(totalCounts([])).toEqual({ error: 0, warning: 0, info: 0, hint: 0 });
  });
});

describe("problemsStore", () => {
  beforeEach(() => problemsStore._reset());

  it("이벤트가 오면 그 파일이 는다", () => {
    problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [diag(1)] });
    expect([...problemsStore.get(1).keys()]).toEqual(["a.ts"]);
  });

  it("빈 배열은 삭제다 — 서버가 '이제 없다' 를 그렇게 말한다", () => {
    problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [diag(1)] });
    problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [] });
    expect(problemsStore.get(1).size).toBe(0);
  });

  it("프로젝트끼리 섞이지 않는다", () => {
    problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [diag(1)] });
    problemsStore.applyPublished({ project_id: 2, path: "b.ts", diagnostics: [diag(1)] });
    expect([...problemsStore.get(1).keys()]).toEqual(["a.ts"]);
    expect([...problemsStore.get(2).keys()]).toEqual(["b.ts"]);
    problemsStore.clearProject(1);
    expect(problemsStore.get(1).size).toBe(0);
    expect(problemsStore.get(2).size).toBe(1);
  });

  it("스냅샷은 이벤트가 한 번이라도 말한 경로를 덮지 않는다", () => {
    // a.ts 는 떴다가 고쳐졌다 — 맵에 없다는 것만 보면 스냅샷이 되살린다.
    problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [diag(1)] });
    problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [] });
    problemsStore.applyPublished({ project_id: 1, path: "b.ts", diagnostics: [diag(9)] });
    problemsStore.seed(1, [
      { path: "a.ts", diagnostics: [diag(1)] }, // 방금 고친 파일 — 되살아나면 안 된다
      { path: "b.ts", diagnostics: [diag(1)] },
      { path: "c.ts", diagnostics: [diag(1)] },
    ]);
    expect([...problemsStore.get(1).keys()].sort()).toEqual(["b.ts", "c.ts"]);
    expect(problemsStore.get(1).get("b.ts")?.[0].start_line).toBe(9);
  });

  it("바뀐 것이 없으면 구독자를 깨우지 않는다", () => {
    const seen = vi.fn();
    const off = problemsStore.subscribe(seen);
    problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [] });
    expect(seen).not.toHaveBeenCalled();
    problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [diag(1)] });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("없는 프로젝트는 늘 같은 빈 것을 준다 (useSyncExternalStore 계약)", () => {
    expect(problemsStore.get(7)).toBe(problemsStore.get(9));
  });
});

describe("useProblems", () => {
  beforeEach(() => problemsStore._reset());

  function Probe({ projectId }: { projectId: number }) {
    const problems = useProblems(projectId);
    return <output data-testid="n">{problems.size}</output>;
  }

  it("이벤트가 오면 다시 그린다", () => {
    render(<Probe projectId={1} />);
    expect(screen.getByTestId("n").textContent).toBe("0");
    act(() => {
      problemsStore.applyPublished({ project_id: 1, path: "a.ts", diagnostics: [diag(1)] });
    });
    expect(screen.getByTestId("n").textContent).toBe("1");
    // 남의 프로젝트는 이 화면을 흔들지 않는다.
    act(() => {
      problemsStore.applyPublished({ project_id: 2, path: "b.ts", diagnostics: [diag(1)] });
    });
    expect(screen.getByTestId("n").textContent).toBe("1");
  });
});

describe("CodeProblems", () => {
  function renderPanel(entries: [string, LspDiagnostic[]][] = [["src/a.ts", [diag(4)]]]) {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const utils = render(
      <CodeProblems problems={new Map(entries)} onOpen={onOpen} onClose={onClose} />,
    );
    return { onOpen, onClose, ...utils };
  }

  it("파일과 항목을 그린다", () => {
    renderPanel([["src/a.ts", [diag(4, "error", "mismatched types")]]]);
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("mismatched types")).toBeTruthy();
    // 줄은 1-based 로 보인다.
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("항목을 누르면 그 자리로 이동한다 (1-based 줄 · 0-based 열)", () => {
    const { onOpen } = renderPanel([["src/a.ts", [diag(4, "error", "boom", 7)]]]);
    fireEvent.click(screen.getByText("boom"));
    expect(onOpen).toHaveBeenCalledWith("src/a.ts", 5, 7);
  });

  it("빈 상태는 '문제 없음' 이 아니라 '아직 아는 문제 없음' 이다", () => {
    renderPanel([]);
    const hint = screen.getByText(t("code.problems.empty"));
    expect(hint.textContent).toContain("아직");
    // 보증서처럼 읽히면 안 된다 — 서버가 본 것까지라는 단서가 문구에 있어야 한다.
    expect(hint.textContent).toContain("언어 서버");
  });

  it("심각도 필터가 목록을 좁힌다", () => {
    renderPanel([
      ["src/a.ts", [diag(1, "error", "hard")]],
      ["src/b.ts", [diag(1, "warning", "soft")]],
    ]);
    expect(screen.getByText("soft")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: t("code.problems.filter.error") }));
    expect(screen.queryByText("soft")).toBeNull();
    expect(screen.getByText("hard")).toBeTruthy();
  });

  it("파일당 50개까지 그리고 나머지는 '더 보기'", () => {
    const many = Array.from({ length: ITEMS_PER_FILE + 3 }, (_, i) => diag(i, "error", `e${i}`));
    renderPanel([["src/a.ts", many]]);
    expect(screen.queryByText(`e${ITEMS_PER_FILE}`)).toBeNull();
    fireEvent.click(screen.getByText(t("code.problems.more", { count: 3 })));
    expect(screen.getByText(`e${ITEMS_PER_FILE}`)).toBeTruthy();
  });

  it("파일 머리를 누르면 접힌다", () => {
    renderPanel([["src/a.ts", [diag(1, "error", "boom")]]]);
    fireEvent.click(screen.getByText("src/a.ts"));
    expect(screen.queryByText("boom")).toBeNull();
  });

  it("a11y 위반이 없다", async () => {
    const summarize = (r: AxeResults) => r.violations.map((v: Result) => ({ id: v.id, help: v.help }));
    const { container } = renderPanel([
      ["src/a.ts", [diag(1, "error", "hard"), diag(2, "warning", "soft")]],
    ]);
    expect(
      summarize(await axe(container, { rules: { "color-contrast": { enabled: false } } })),
    ).toEqual([]);
  });
});
