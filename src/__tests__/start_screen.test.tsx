import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── 메인 화면(프로젝트 선택) ────────────────────────────────────────────
//
// 두 축을 지킨다:
//  1. **첫 사용자 온보딩** — 프로젝트가 0개일 때만 "이렇게 동작해요" 가이드가
//     뜬다. 여기 문자열들은 계약이다 (수동 기록이 아니라는 멘탈 모델을 주는
//     유일한 지점).
//  2. **목록이 절대 비지 않는다** — 프로젝트 0개거나 검색 결과 0건이어도
//     `명령` 섹션이 남아 ⏎ 가 항상 무언가를 한다.
//
// axe 는 3가지 상태에서 돌린다 (온보딩 / 행 렌더 / 검색 후). 온보딩 상태에서만
// 돌리면 행의 스트레치 오픈 구조가 조용히 깨져도 그린이 뜬다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

const EMPTY_BRIEF = {
  projects: [],
  today_workday: "20260731",
  since_workday: "20260718",
  today_total: 0,
  active_projects: 0,
  feed: [],
};

vi.mock("@/lib/bindings", () => ({
  commands: {
    listBlueprints: () => Promise.resolve({ status: "ok", data: [] }),
    deleteBlueprint: () => Promise.resolve({ status: "ok", data: null }),
    homeBrief: () => Promise.resolve({ status: "ok", data: EMPTY_BRIEF }),
  },
}));

import { StartScreen, type StartScreenProps } from "@/features/onboarding/StartScreen";

function project(over: Partial<StartScreenProps["projects"][number]> = {}) {
  return {
    id: 1,
    name: "aurora-web",
    root_path: "/x/aurora-web",
    created_at: 0,
    // 겉모습은 고르지 않은 상태가 기본 — 프런트가 이름 해시로 유도한다.
    icon: null,
    color: null,
    ...over,
  };
}

// `Partial<StartScreenProps>` 로 타이핑해야 없어진 prop 이 컴파일 에러로
// 드러난다 — JSX 스프레드는 초과 프로퍼티를 검사하지 않는다.
function renderStart(over: Partial<StartScreenProps> = {}) {
  const props: StartScreenProps = {
    projects: [],
    indexingId: null,
    openWindows: [],
    error: null,
    onSelectProject: vi.fn(),
    onAddProject: vi.fn(),
    onRenameProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onOpenSettings: vi.fn(),
    onStartGreenfield: vi.fn(),
    onResumeBlueprint: vi.fn(),
    onProjectsChanged: vi.fn(),
    ...over,
  };
  return { ...render(<StartScreen {...props} />), props };
}

afterEach(() => cleanup());

describe("메인 화면 — 첫 사용자 온보딩", () => {
  it("프로젝트가 없으면 '이렇게 동작해요' 가이드를 보여준다", () => {
    const { getByText } = renderStart({ projects: [] });
    expect(getByText("Ocul-PM 은 이렇게 동작해요")).toBeInTheDocument();
    expect(getByText("평소처럼 에이전트로 코딩")).toBeInTheDocument();
    expect(getByText("자동으로 기록·정리")).toBeInTheDocument();
  });

  it("프로젝트가 있으면 가이드를 숨긴다", () => {
    const { queryByText } = renderStart({ projects: [project()] });
    expect(queryByText("Ocul-PM 은 이렇게 동작해요")).toBeNull();
  });

  it("'프로젝트 추가하고 시작하기' 는 폴더 선택으로 연결된다", () => {
    const { getByLabelText, props } = renderStart({ projects: [] });
    fireEvent.click(getByLabelText("프로젝트 추가하고 시작하기"));
    expect(props.onAddProject).toHaveBeenCalled();
  });
});

describe("메인 화면 — 목록은 비지 않는다", () => {
  it("프로젝트가 0개여도 명령 행으로 진입로가 남는다", () => {
    const { getByText } = renderStart({ projects: [] });
    expect(getByText("기존 폴더 불러오기")).toBeInTheDocument();
    expect(getByText("새 프로젝트 시작하기")).toBeInTheDocument();
    expect(getByText("설정 열기")).toBeInTheDocument();
  });

  it("명령 행을 누르면 대응 콜백이 실행된다", () => {
    const { getByText, props } = renderStart({ projects: [] });
    fireEvent.click(getByText("새 프로젝트 시작하기"));
    expect(props.onStartGreenfield).toHaveBeenCalled();
  });

  it("검색 결과가 0건이어도 명령 섹션은 남는다", () => {
    const { getByLabelText, getByText, queryByText } = renderStart({
      projects: [project()],
    });
    fireEvent.change(getByLabelText("프로젝트 검색"), { target: { value: "zzzzz" } });
    expect(getByText(/일치하는 프로젝트가 없어요/)).toBeInTheDocument();
    expect(queryByText("aurora-web")).toBeNull();
    expect(getByText("기존 폴더 불러오기")).toBeInTheDocument();
  });
});

describe("메인 화면 — 검색", () => {
  const projects = [
    project({ id: 1, name: "aurora-web", root_path: "/x/aurora-web" }),
    project({ id: 2, name: "ledger-api", root_path: "/x/ledger-api" }),
    project({ id: 3, name: "회고 정리", root_path: "/x/retro" }),
  ];

  // 매칭 구간은 <mark> 로 쪼개지므로 getByText 로는 잡히지 않는다.
  // 접근 가능한 이름(aria-label)으로 질의한다 — RTL 권장 우선순위이기도 하다.
  it("이름으로 거른다", () => {
    const { getByLabelText, queryAllByLabelText } = renderStart({ projects });
    fireEvent.change(getByLabelText("프로젝트 검색"), { target: { value: "ledger" } });
    expect(queryAllByLabelText(/ledger-api 열기/).length).toBeGreaterThan(0);
    expect(queryAllByLabelText(/aurora-web 열기/)).toHaveLength(0);
  });

  it("초성으로도 찾는다", () => {
    const { getByLabelText, queryAllByLabelText } = renderStart({ projects });
    fireEvent.change(getByLabelText("프로젝트 검색"), { target: { value: "ㅎㄱ" } });
    expect(queryAllByLabelText(/회고 정리 열기/).length).toBeGreaterThan(0);
    expect(queryAllByLabelText(/ledger-api 열기/)).toHaveLength(0);
  });

  it("검색 중에는 일치 건수를 알린다", () => {
    const { getByLabelText, getByText } = renderStart({ projects });
    fireEvent.change(getByLabelText("프로젝트 검색"), { target: { value: "a" } });
    expect(getByText(/곳 일치/)).toBeInTheDocument();
  });

  it("검색 입력에서 ⏎ 는 1위 결과를 연다 (포커스 이동 없이)", () => {
    const { getByLabelText, props } = renderStart({ projects });
    const input = getByLabelText("프로젝트 검색");
    fireEvent.change(input, { target: { value: "ledger" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSelectProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ledger-api" }),
    );
  });

  it("Esc 는 먼저 질의를 지운다", () => {
    const { getByLabelText } = renderStart({ projects });
    const input = getByLabelText("프로젝트 검색") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ledger" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
  });
});

describe("메인 화면 — 프로젝트 행", () => {
  const projects = [
    project({ id: 1, name: "aurora-web" }),
    project({ id: 2, name: "ledger-api", root_path: "/x/ledger-api" }),
    project({ id: 3, name: "nova-cli", root_path: "/x/nova-cli" }),
    project({ id: 4, name: "pastel-ui", root_path: "/x/pastel-ui" }),
  ];

  it("이름을 누르면 그 프로젝트가 열린다", () => {
    const { getAllByLabelText, props } = renderStart({ projects });
    // 사령탑/판/행 어디에 있든 "열기" aria-label 을 갖는다.
    fireEvent.click(getAllByLabelText(/aurora-web 열기/)[0]);
    expect(props.onSelectProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "aurora-web" }),
    );
  });

  it("이름 변경·제거 버튼이 항상 접근 가능하다 (hover 전용이 아니다)", () => {
    const { getAllByLabelText, props } = renderStart({ projects });
    fireEvent.click(getAllByLabelText("ledger-api 이름 변경")[0]);
    expect(props.onRenameProject).toHaveBeenCalled();
    fireEvent.click(getAllByLabelText("ledger-api 제거")[0]);
    expect(props.onDeleteProject).toHaveBeenCalled();
  });

  it("인덱싱 중인 프로젝트를 표시한다", () => {
    const { getAllByRole } = renderStart({ projects, indexingId: 1 });
    const statuses = getAllByRole("status").map((n) => n.textContent);
    expect(statuses.some((t) => t?.includes("인덱싱"))).toBe(true);
  });

  /**
   * 카드 전체가 클릭 판정이다 — 이름 버튼 하나가 `::after` 로 카드를 덮는
   * 방식(스트레치 오픈). 카드를 통째로 `<button>` 으로 감싸면 안의 ✎/🗑 이
   * 중첩 인터랙티브가 되어 axe 위반이므로 이 구조여야 한다.
   */
  it("카드 전체가 열기 히트박스다 (중첩 인터랙티브 없이)", () => {
    const { container } = renderStart({ projects });
    const card = container.querySelector(".hg-card:not(.hg-add)")!;
    // 히트박스 앵커는 카드 안의 '열기' 버튼이고, 카드는 그 ::after 의 기준이다.
    expect(card.querySelector(".hg-name.home-open")).toBeTruthy();
    // 카드 자체는 버튼이 아니다 — 그랬다면 안의 액션 버튼이 중첩된다.
    expect(card.tagName).toBe("LI");
    expect(card.getAttribute("role")).toBeNull();
  });

  it("프로젝트마다 색·아이콘이 카드에 실린다", () => {
    const { container } = renderStart({
      projects: [
        project({ id: 1, name: "aurora-web", color: "rose", icon: "rabbit" }),
        project({ id: 2, name: "ledger-api", root_path: "/x/ledger-api" }),
      ],
    });
    const cards = container.querySelectorAll(".hg-card:not(.hg-add)");
    // 고른 값은 그대로.
    expect(cards[0].getAttribute("data-pc")).toBe("rose");
    // 안 고른 프로젝트도 색이 **있다** — 이름 해시로 유도된다.
    expect(cards[1].getAttribute("data-pc")).toBeTruthy();
    expect(container.querySelectorAll(".hg-mark svg").length).toBe(2);
  });

  /** 대격변 계약 — 프로젝트는 티어로 나뉘지 않고 **전부** 격자에 그려진다. */
  it("프로젝트를 하나도 접지 않고 전부 격자에 그린다", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      project({ id: i + 1, name: `proj-${i + 1}`, root_path: `/x/proj-${i + 1}` }),
    );
    const { container } = renderStart({ projects: many });
    // 추가 카드(.hg-add)는 프로젝트가 아니므로 뺀다.
    const cards = container.querySelectorAll(".hg-card:not(.hg-add)");
    expect(cards).toHaveLength(9);
  });

  it("이미 다른 탭에서 열린 프로젝트에 '열림' 배지를 붙인다", () => {
    const { container } = renderStart({ projects, openWindows: [1] });
    const opened = Array.from(container.querySelectorAll(".hg-chip")).map((n) => n.textContent);
    expect(opened).toContain("열림");
  });

  it("에러는 alert 로 노출된다", () => {
    const { getByRole } = renderStart({ projects, error: "프로젝트를 불러오지 못했어요" });
    expect(within(getByRole("alert")).getByText(/불러오지 못했어요/)).toBeInTheDocument();
  });
});

describe("메인 화면 — 키보드 진입로 (회귀 방지)", () => {
  const projects = [
    project({ id: 1, name: "aurora-web" }),
    project({ id: 2, name: "ledger-api", root_path: "/x/ledger-api" }),
    project({ id: 3, name: "nova-cli", root_path: "/x/nova-cli" }),
    project({ id: 4, name: "pastel-ui", root_path: "/x/pastel-ui" }),
    project({ id: 5, name: "quartz-svc", root_path: "/x/quartz-svc" }),
  ];

  // 로빙 tabindex: 격자 전체에서 '열기' 가능한 탭 스톱은 정확히 하나.
  // 0개가 되면 Tab 으로 목록에 들어갈 방법이 사라진다 (예전 벤토 시절의 회귀).
  it("격자에 '열기' 탭 스톱이 정확히 하나 있다", () => {
    const { container } = renderStart({ projects });
    const grid = container.querySelector(".hg-grid")!;
    expect(grid).toBeTruthy();
    const openStops = Array.from(grid.querySelectorAll('[tabindex="0"]')).filter((el) =>
      /열기|이어서 만들기/.test(el.getAttribute("aria-label") ?? ""),
    );
    expect(openStops).toHaveLength(1);
  });

  it("격자에서 파괴적 액션은 커서 카드 하나만 Tab 에 노출된다", () => {
    const { container } = renderStart({ projects });
    const grid = container.querySelector(".hg-grid")!;
    const deletes = Array.from(
      grid.querySelectorAll('[aria-label$="제거"]'),
    ) as HTMLElement[];
    expect(deletes.length).toBeGreaterThan(1);
    // 전부 Tab 순서에 남아 있으면, 목록을 Tab 으로 훑을 때 프로젝트는 못 열고
    // 삭제 버튼만 줄줄이 지나가게 된다.
    const tabbableDeletes = deletes.filter((b) => b.getAttribute("tabindex") === "0");
    expect(tabbableDeletes.length).toBeLessThanOrEqual(1);
  });

  it("한글 IME 조합 중 ⏎ 는 프로젝트를 열지 않는다", () => {
    const { getByLabelText, props } = renderStart({ projects });
    const input = getByLabelText("프로젝트 검색");
    fireEvent.change(input, { target: { value: "ledger" } });
    // 조합 중 Enter = 후보 확정. 실행이 아니다.
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(props.onSelectProject).not.toHaveBeenCalled();
    // 조합이 끝난 뒤에는 정상 동작.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSelectProject).toHaveBeenCalled();
  });
});

describe("메인 화면 — 접근성 (axe 3상태)", () => {
  it("프로젝트 0개 (온보딩)", async () => {
    const { container, getByText } = renderStart({ projects: [] });
    expect(getByText("Ocul-PM 은 이렇게 동작해요")).toBeInTheDocument();
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("프로젝트 여러 개 (사령탑 + 판 + 행)", async () => {
    const { container } = renderStart({
      projects: [
        project({ id: 1, name: "aurora-web" }),
        project({ id: 2, name: "ledger-api", root_path: "/x/ledger-api" }),
        project({ id: 3, name: "nova-cli", root_path: "/x/nova-cli" }),
        project({ id: 4, name: "pastel-ui", root_path: "/x/pastel-ui" }),
      ],
    });
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("검색 질의 입력 후", async () => {
    const { container, getByLabelText } = renderStart({
      projects: [
        project({ id: 1, name: "aurora-web" }),
        project({ id: 2, name: "ledger-api", root_path: "/x/ledger-api" }),
      ],
    });
    fireEvent.change(getByLabelText("프로젝트 검색"), { target: { value: "led" } });
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
