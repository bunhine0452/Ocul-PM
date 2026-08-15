/**
 * 탭 스트립 — 크롬식 탭 (01b-chrome-tabs.md §4/§6).
 *
 * 산술은 `multi_window.test.tsx` 가 순수 함수로 고정한다. 여기서는 그 산술이
 * **포인터 이벤트에 제대로 배선됐는지**와 접근성 구조를 본다 — 드래그는 배선을
 * 틀려도 타입이 잡아주지 않는 자리다.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

import { TabStrip } from "@/features/shell/TabStrip";
import { DETACH_THRESHOLD_PX } from "@/features/shell/tabOrder";
import type { Project, TabInfo } from "@/lib/bindings";

afterEach(() => cleanup());

// a11y_screens 와 같은 방식 — 커스텀 matcher 대신 위반 목록을 평평하게 비교해
// 실패 시 어떤 규칙이 몇 노드에서 깨졌는지 그대로 보인다.
const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: {
    // jsdom 은 계산 스타일 캐스케이드가 불완전 — 대비 검사는 실제 레이아웃
    // 엔진이 필요하다 (a11y_screens 와 동일한 이유로 끈다).
    "color-contrast": { enabled: false },
    // 스트립은 프로덕션에서 창 루트 안의 한 조각이라 그 자체가 랜드마크가 아니다.
    region: { enabled: false },
  },
} as const;

/** 프로젝트 탭 — tab_id 와 project_id 는 서로 다른 네임스페이스라 일부러 어긋낸다. */
const tab = (id: number, name: string): TabInfo => ({
  tab_id: 100 + id,
  project_id: id,
  name,
  root_path: `/x/${name}`,
  // 고르지 않은 상태 — 프런트가 이름 해시로 아이콘·색을 유도한다.
  icon: null,
  color: null,
});

/** 시작 탭 — project_id 가 없고 이름은 프런트가 사전에서 붙인다. */
const startTab = (tabId: number): TabInfo => ({
  tab_id: tabId,
  project_id: null,
  name: "",
  root_path: "",
  icon: null,
  color: null,
});

const project = (id: number, name: string): Project => ({
  id,
  name,
  root_path: `/x/${name}`,
  created_at: 0,
  icon: null,
  color: null,
});

function renderStrip(over: Partial<React.ComponentProps<typeof TabStrip>> = {}) {
  const props = {
    tabs: [tab(1, "ai-pm"), tab(2, "saju"), tab(3, "landing")],
    activeId: 101,
    isMac: false,
    busyProjects: new Set<number>(),
    closedProjects: [project(9, "docs-site")],
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onReorder: vi.fn(),
    onDetach: vi.fn(),
    onNewTab: vi.fn(),
    onOpenProject: vi.fn(),
    ...over,
  };
  return { props, ...render(<TabStrip {...props} />) };
}

const rect = (left: number, right: number, top: number, bottom: number) =>
  ({
    left, right, top, bottom,
    width: right - left, height: bottom - top,
    x: left, y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/**
 * jsdom 은 레이아웃을 계산하지 않아 `getBoundingClientRect` 가 전부 0 이고
 * 포인터 캡처 API 도 없다. 드래그 산술이 의미를 가지려면 탭 폭·스트립 세로
 * 범위를 심고 캡처를 무해한 no-op 으로 채워야 한다.
 *
 * 포인터를 받는 건 `role="tab"` 이 아니라 그 **바깥 껍데기**다 (닫기 버튼과
 * 위젯 중첩을 피하려고 분리했다) — 그래서 여기서도 껍데기를 집는다.
 */
function stubGeometry(tabWidth = 100, stripTop = 6, stripBottom = 44) {
  const shells = Array.from(
    document.querySelectorAll<HTMLElement>(".tabstrip-tab"),
  );
  shells.forEach((el, i) => {
    el.getBoundingClientRect = () =>
      rect(i * tabWidth, (i + 1) * tabWidth, stripTop, stripBottom);
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
  });
  const strip = shells[0].closest(".tabstrip") as HTMLElement;
  strip.getBoundingClientRect = () => rect(0, 400, stripTop, stripBottom);
  return shells;
}

describe("탭 스트립 — 구조와 접근성", () => {
  it("tablist / tab / tabpanel 연결이 성립한다", () => {
    renderStrip();
    const list = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    // `+` 버튼과 드래그 리전은 tablist 밖에 있어야 한다.
    expect(list.querySelector(".tabstrip-new")).toBeNull();
    // 탭 안에 포커스 가능한 자식이 없어야 한다 — 위젯 중첩(nested-interactive) 방지.
    expect(tabs[0].querySelector("button, [tabindex]")).toBeNull();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[0]).toHaveAttribute("aria-controls", "tabpanel-t101");
  });

  it("로빙 tabindex — 활성 탭만 탭 순회에 들어간다", () => {
    renderStrip({ activeId: 102 });
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
  });

  it("axe 위반이 없다", async () => {
    // 탭 본문은 프로덕션에서 TabbedWindow 가 그린다 — `aria-controls` 가
    // 가리키는 대상이 없으면 axe 가 (정당하게) 걸고 넘어지므로 여기서 세운다.
    const { container } = render(
      <>
        <TabStrip
          tabs={[startTab(1), tab(1, "ai-pm")]}
          activeId={1}
          isMac={false}
          busyProjects={new Set([1])}
          closedProjects={[project(9, "docs-site")]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onReorder={vi.fn()}
          onDetach={vi.fn()}
          onNewTab={vi.fn()}
          onOpenProject={vi.fn()}
        />
        <div role="tabpanel" id="tabpanel-t1" aria-labelledby="tab-t1" />
        <div role="tabpanel" id="tabpanel-t101" aria-labelledby="tab-t101" hidden />
      </>,
    );
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });

  it("닫기 어포던스에 대상이 드러나는 이름이 있다", () => {
    renderStrip();
    expect(screen.getByTitle("saju 탭 닫기")).toBeInTheDocument();
  });
});

describe("탭 스트립 — 키보드", () => {
  it("좌우 화살표가 이웃 탭으로 이동하고 끝에서 감싼다", () => {
    const { props } = renderStrip({ activeId: 101 });
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(props.onActivate).toHaveBeenCalledWith(102);
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(props.onActivate).toHaveBeenLastCalledWith(103);
  });

  it("Enter 로 활성화한다", () => {
    const { props } = renderStrip();
    fireEvent.keyDown(screen.getAllByRole("tab")[2], { key: "Enter" });
    expect(props.onActivate).toHaveBeenCalledWith(103);
  });

  /** × 버튼이 탭 밖으로 나갔으므로 키보드 등가물이 반드시 있어야 한다. */
  it("Delete 로 탭을 닫는다", () => {
    const { props } = renderStrip();
    fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "Delete" });
    expect(props.onClose).toHaveBeenCalledWith(102);
  });
});

describe("탭 스트립 — 포인터", () => {
  it("움직이지 않은 포인터는 클릭 — 재배열이 아니라 활성화다", () => {
    const { props } = renderStrip();
    const tabs = stubGeometry();
    fireEvent.pointerDown(tabs[1], { button: 0, clientX: 150, clientY: 20 });
    fireEvent.pointerUp(tabs[1], { clientX: 150, clientY: 20 });
    expect(props.onActivate).toHaveBeenCalledWith(102);
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onDetach).not.toHaveBeenCalled();
  });

  it("스트립 안에서 끌면 순서가 바뀐다", () => {
    const { props } = renderStrip();
    const tabs = stubGeometry();
    // 첫 탭(중심 50)을 세 번째 탭 중심(250) 너머로 끈다.
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 50, clientY: 20 });
    fireEvent.pointerMove(tabs[0], { clientX: 260, clientY: 20 });
    fireEvent.pointerUp(tabs[0], { clientX: 260, clientY: 20 });
    expect(props.onReorder).toHaveBeenCalledWith([102, 103, 101]);
    expect(props.onDetach).not.toHaveBeenCalled();
  });

  it("스트립 밖으로 충분히 끌면 떼어내기 — 화면 좌표를 넘긴다", () => {
    const { props } = renderStrip();
    const tabs = stubGeometry();
    fireEvent.pointerDown(tabs[1], { button: 0, clientX: 150, clientY: 20 });
    fireEvent.pointerMove(tabs[1], {
      clientX: 170,
      clientY: 44 + DETACH_THRESHOLD_PX + 30,
      screenX: 900,
      screenY: 500,
    });
    fireEvent.pointerUp(tabs[1], { clientX: 170, clientY: 300, screenX: 900, screenY: 500 });
    expect(props.onDetach).toHaveBeenCalledWith(102, 900, 500);
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("떼어내다 스트립으로 돌아오면 다시 순서 변경이다", () => {
    const { props } = renderStrip();
    const tabs = stubGeometry();
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 50, clientY: 20 });
    fireEvent.pointerMove(tabs[0], { clientX: 60, clientY: 300 });
    fireEvent.pointerMove(tabs[0], { clientX: 260, clientY: 20 });
    fireEvent.pointerUp(tabs[0], { clientX: 260, clientY: 20 });
    expect(props.onDetach).not.toHaveBeenCalled();
    expect(props.onReorder).toHaveBeenCalledWith([102, 103, 101]);
  });

  it("닫기에서 시작한 포인터는 탭 드래그로 번지지 않는다", () => {
    const { props } = renderStrip();
    stubGeometry();
    fireEvent.click(screen.getByTitle("saju 탭 닫기"));
    expect(props.onClose).toHaveBeenCalledWith(102);
    expect(props.onActivate).not.toHaveBeenCalled();
  });
});

describe("탭 스트립 — 새 탭", () => {
  /** Chrome 과 같다 — `+` 는 곧바로 시작 탭을 연다 (메뉴를 거치지 않는다). */
  it("+ 클릭은 새 시작 탭", () => {
    const { props } = renderStrip();
    fireEvent.click(screen.getByRole("button", { name: "새 탭" }));
    expect(props.onNewTab).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("+ 우클릭은 아직 안 열린 프로젝트 지름길", () => {
    const { props } = renderStrip();
    fireEvent.contextMenu(screen.getByRole("button", { name: "새 탭" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /docs-site/ }));
    expect(props.onOpenProject).toHaveBeenCalledWith(9);
  });

  it("전부 열려 있으면 안내와 시작 화면 진입만 남는다", () => {
    const { props } = renderStrip({ closedProjects: [] });
    fireEvent.contextMenu(screen.getByRole("button", { name: "새 탭" }));
    expect(screen.getByText("모든 프로젝트가 이미 열려 있습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /시작 화면 열기/ }));
    expect(props.onNewTab).toHaveBeenCalled();
  });
});

describe("탭 스트립 — 시작 탭 · 활동 점", () => {
  it("시작 탭은 사전 라벨을 쓰고 닫기도 그 이름으로 안내한다", () => {
    renderStrip({ tabs: [startTab(1), tab(1, "ai-pm")], activeId: 1 });
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("새 탭");
    expect(screen.getByTitle("새 탭 탭 닫기")).toBeInTheDocument();
  });

  /** 백그라운드 탭에서 에이전트가 도는지는 화면으로 알 수 없다 — 점이 유일한 신호. */
  it("세션이 도는 프로젝트 탭에만 활동 점이 붙는다", () => {
    renderStrip({ busyProjects: new Set([2]) });
    expect(screen.getByLabelText("saju — 세션 진행 중")).toBeInTheDocument();
    expect(screen.queryByLabelText("ai-pm — 세션 진행 중")).toBeNull();
  });

  /**
   * 드래그 리전은 곧 타이틀바다 — 더블클릭은 Tauri 가 창 확대/복원으로 쓴다.
   * 여기에 "새 탭"을 겹쳐 걸면 창 크기를 조절할 때마다 탭이 하나씩 늘어난다.
   */
  it("빈 스트립 더블클릭은 탭을 만들지 않는다 (창 확대는 Tauri 몫)", () => {
    const { props, container } = renderStrip();
    fireEvent.doubleClick(container.querySelector(".tabstrip-drag")!);
    expect(props.onNewTab).not.toHaveBeenCalled();
  });
});
