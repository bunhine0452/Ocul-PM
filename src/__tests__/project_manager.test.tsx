import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── 프로젝트 관리 화면 ──────────────────────────────────────────────────
//
// 이 화면이 지켜야 하는 계약 3가지:
//  1. **단건 이름 변경/제거는 위임한다** — App 의 다이얼로그를 부를 뿐, 자체
//     삭제 경로를 만들지 않는다 (제거 옵션이 두 벌로 갈라지는 걸 막는다).
//  2. **일괄 제거는 2단이다** — 선택만으로는 아무것도 지워지지 않고, 확인
//     단계를 거쳐야 IPC 가 나간다. 부분 실패는 침묵하지 않는다.
//  3. **접힌 프로젝트도 전부 보인다** — 메인 화면은 2주 이상 조용한 곳을
//     '색인'으로 접지만, 관리 화면은 평면 목록이라 전부 같은 눈높이다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

const deleteProject = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ status: "ok", data: null } as { status: string; error?: string }),
);

vi.mock("@/lib/bindings", () => ({
  commands: {
    deleteProject: (...args: unknown[]) => deleteProject(...args),
  },
}));

import { ProjectManager, type ProjectManagerProps } from "@/features/projects/ProjectManager";

function project(over: Partial<ProjectManagerProps["projects"][number]> = {}) {
  return {
    id: 1,
    name: "aurora-web",
    root_path: "/x/aurora-web",
    created_at: 0,
    icon: null,
    color: null,
    ...over,
  };
}

const PROJECTS = [
  project({ id: 1, name: "aurora-web", root_path: "/x/aurora-web" }),
  project({ id: 2, name: "ledger-api", root_path: "/x/ledger-api" }),
  project({ id: 3, name: "회고 정리", root_path: "/x/retro" }),
];

function renderManager(over: Partial<ProjectManagerProps> = {}) {
  const props: ProjectManagerProps = {
    projects: PROJECTS,
    brief: null,
    indexingId: null,
    onClose: vi.fn(),
    onOpenProject: vi.fn(),
    onRenameProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onAddProject: vi.fn(),
    onStartGreenfield: vi.fn(),
    onProjectsChanged: vi.fn(),
    ...over,
  };
  return { ...render(<ProjectManager {...props} />), props };
}

afterEach(() => {
  cleanup();
  deleteProject.mockReset();
  deleteProject.mockImplementation(() => Promise.resolve({ status: "ok" }));
});

describe("프로젝트 관리 — 목록", () => {
  it("등록된 프로젝트를 전부 나열한다 (조용한 곳도 접지 않는다)", () => {
    const { getByLabelText } = renderManager();
    expect(getByLabelText("aurora-web 열기")).toBeInTheDocument();
    expect(getByLabelText("ledger-api 열기")).toBeInTheDocument();
    expect(getByLabelText("회고 정리 열기")).toBeInTheDocument();
  });

  it("이름을 누르면 그 프로젝트를 연다", () => {
    const { getByLabelText, props } = renderManager();
    fireEvent.click(getByLabelText("ledger-api 열기"));
    expect(props.onOpenProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ledger-api" }),
    );
  });

  it("검색은 이름·초성으로 거른다", () => {
    const { getByLabelText, queryByLabelText } = renderManager();
    fireEvent.change(getByLabelText("관리할 프로젝트 검색"), { target: { value: "ㅎㄱ" } });
    expect(queryByLabelText("회고 정리 열기")).toBeInTheDocument();
    expect(queryByLabelText("aurora-web 열기")).toBeNull();
  });
});

describe("프로젝트 관리 — 단건 작업은 App 다이얼로그에 위임한다", () => {
  it("이름 변경·제거 버튼은 콜백만 부르고 스스로 지우지 않는다", () => {
    const { getByLabelText, props } = renderManager();

    fireEvent.click(getByLabelText("ledger-api 이름 변경"));
    expect(props.onRenameProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ledger-api" }),
    );

    fireEvent.click(getByLabelText("ledger-api 제거"));
    expect(props.onDeleteProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ledger-api" }),
    );
    // 단건 경로는 App 다이얼로그가 확인을 받는다 — 여기서 IPC 가 나가면 안 된다.
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("추가 진입로가 있다", () => {
    const { getByText, props } = renderManager();
    fireEvent.click(getByText("폴더 불러오기"));
    expect(props.onAddProject).toHaveBeenCalled();
  });

  it("'새 프로젝트' 는 마법사에 자리를 내주고 닫힌다 (겹침 방지)", () => {
    const { getByText, props } = renderManager();
    fireEvent.click(getByText("새 프로젝트"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onStartGreenfield).toHaveBeenCalled();
  });
});

describe("프로젝트 관리 — 일괄 제거는 2단", () => {
  it("선택만으로는 아무것도 지우지 않는다", () => {
    const { getByLabelText, getByText } = renderManager();
    fireEvent.click(getByLabelText("aurora-web 선택"));
    expect(getByText("1곳")).toBeInTheDocument();
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("확인을 거쳐야 선택한 만큼 제거가 나간다", async () => {
    const { getByLabelText, getByText, props } = renderManager();

    fireEvent.click(getByLabelText("aurora-web 선택"));
    fireEvent.click(getByLabelText("ledger-api 선택"));
    fireEvent.click(getByText("선택 제거"));

    // 확인 단계: 대상 이름이 문구에 그대로 적힌다.
    expect(getByText("aurora-web, ledger-api")).toBeInTheDocument();
    expect(deleteProject).not.toHaveBeenCalled();

    fireEvent.click(getByText("2곳 제거"));

    await waitFor(() => expect(deleteProject).toHaveBeenCalledTimes(2));
    // 디스크 옵션은 기본 꺼짐 — 폴더를 건드리지 않는 게 기본값이어야 한다.
    expect(deleteProject).toHaveBeenCalledWith(1, false, false);
    expect(deleteProject).toHaveBeenCalledWith(2, false, false);
    await waitFor(() => expect(props.onProjectsChanged).toHaveBeenCalled());
  });

  it("디스크 옵션을 켜면 그대로 전달된다", async () => {
    const { getByLabelText, getByText } = renderManager();
    fireEvent.click(getByLabelText("aurora-web 선택"));
    fireEvent.click(getByText("선택 제거"));
    fireEvent.click(getByText(/폴더도 삭제/));
    fireEvent.click(getByText("1곳 제거"));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith(1, true, false));
  });

  it("부분 실패를 침묵하지 않는다", async () => {
    deleteProject.mockImplementationOnce(() =>
      Promise.resolve({ status: "error", error: "locked" }),
    );
    const { getByLabelText, getByText, findByRole } = renderManager();
    fireEvent.click(getByLabelText("aurora-web 선택"));
    fireEvent.click(getByText("선택 제거"));
    fireEvent.click(getByText("1곳 제거"));
    expect(await findByRole("alert")).toHaveTextContent("aurora-web");
  });

  it("취소하면 선택은 남고 제거는 나가지 않는다", () => {
    const { getByLabelText, getByText } = renderManager();
    fireEvent.click(getByLabelText("aurora-web 선택"));
    fireEvent.click(getByText("선택 제거"));
    fireEvent.click(getByText("취소"));
    expect(getByText("1곳")).toBeInTheDocument();
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("App 다이얼로그로 지워져 목록에서 빠진 프로젝트는 선택에서도 빠진다", () => {
    const { getByLabelText, getByText, queryByText, rerender, props } = renderManager();
    fireEvent.click(getByLabelText("aurora-web 선택"));
    fireEvent.click(getByLabelText("ledger-api 선택"));
    expect(getByText("2곳")).toBeInTheDocument();

    rerender(<ProjectManager {...props} projects={PROJECTS.filter((p) => p.id !== 1)} />);

    expect(getByText("1곳")).toBeInTheDocument();
    expect(queryByText("2곳")).toBeNull();
  });
});

describe("프로젝트 관리 — 정렬", () => {
  it("열 머리를 누르면 정렬 상태를 aria-sort 로 알린다", () => {
    const { getByText, container } = renderManager();
    const th = () => container.querySelector('th[aria-sort]:not([aria-sort="none"])');

    // 기본은 '마지막 활동' 내림차순.
    expect(th()?.textContent).toContain("마지막 활동");
    expect(th()?.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(getByText("프로젝트"));
    expect(th()?.textContent).toContain("프로젝트");
    expect(th()?.getAttribute("aria-sort")).toBe("ascending");

    // 같은 열을 다시 누르면 방향이 뒤집힌다.
    fireEvent.click(getByText("프로젝트"));
    expect(th()?.getAttribute("aria-sort")).toBe("descending");
  });
});

describe("프로젝트 관리 — 닫기", () => {
  it("Esc 로 닫는다", () => {
    const { props } = renderManager();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("확인 단계의 Esc 는 확인만 취소한다 (화면은 남는다)", () => {
    const { getByLabelText, getByText, props } = renderManager();
    fireEvent.click(getByLabelText("aurora-web 선택"));
    fireEvent.click(getByText("선택 제거"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(getByText("선택 제거")).toBeInTheDocument();
  });
});

describe("프로젝트 관리 — 접근성 (axe)", () => {
  it("목록 상태", async () => {
    const { container } = renderManager();
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("일괄 제거 확인 상태", async () => {
    const { container, getByLabelText, getByText } = renderManager();
    fireEvent.click(getByLabelText("aurora-web 선택"));
    fireEvent.click(getByText("선택 제거"));
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("프로젝트 0곳 (빈 상태)", async () => {
    const { container, getByText } = renderManager({ projects: [] });
    expect(getByText("아직 등록된 프로젝트가 없어요")).toBeInTheDocument();
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
