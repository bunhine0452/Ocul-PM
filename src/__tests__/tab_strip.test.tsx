/**
 * 탭 스트립 — 크롬식 탭 (01b-chrome-tabs.md §4/§6).
 *
 * 산술은 `multi_window.test.tsx` 가 순수 함수로 고정한다. 여기서는 그 산술이
 * **포인터 이벤트에 제대로 배선됐는지**와 접근성 구조를 본다 — 드래그는 배선을
 * 틀려도 타입이 잡아주지 않는 자리다.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

import { TabStrip } from "@/features/shell/TabStrip";
import { DETACH_THRESHOLD_PX } from "@/features/shell/tabOrder";
import type { Project, TabInfo } from "@/lib/bindings";

afterEach(() => cleanup());

/**
 * 포인터 이동 한 번 + 프레임 한 번.
 *
 * 드래그 판정은 rAF 로 묶여 있다 (2026-08-29). 포인터는 초당 60~120 번 오는데
 * 그때마다 모든 탭의 rect 를 읽고 상태를 갈아 끼우면 재배열이 손을 못 따라온다
 * — 프레임당 한 번만 판정하고, 겨눈 자리가 그대로면 상태를 건드리지 않는다.
 * 그래서 배선의 결과를 보려면 여기서도 프레임을 한 번 돌려야 한다.
 */
const movePointer = async (el: Element, init: Record<string, number>) => {
  fireEvent.pointerMove(el, init);
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
};

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
  theme_id: null,
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
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
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
  const shells = Array.from(document.querySelectorAll<HTMLElement>(".tabstrip-tab"));
  shells.forEach((el, i) => {
    el.getBoundingClientRect = () => rect(i * tabWidth, (i + 1) * tabWidth, stripTop, stripBottom);
    // 받는 쪽 산술은 `offsetLeft/offsetWidth` 를 본다 — `getBoundingClientRect`
    // 는 transform 이 반영된 값이라, 자리를 벌리려 밀어 둔 탭이 다음 판정으로
    // 되먹임돼 자리가 진동한다. jsdom 은 offset* 도 0 이므로 함께 심는다.
    Object.defineProperty(el, "offsetLeft", { value: i * tabWidth, configurable: true });
    Object.defineProperty(el, "offsetWidth", { value: tabWidth, configurable: true });
  });
  const strip = shells[0].closest(".tabstrip") as HTMLElement;
  strip.getBoundingClientRect = () => rect(0, 400, stripTop, stripBottom);
  // 포인터 캡처는 **스트립**이 쥔다 — 떼어내는 순간 탭은 언마운트되므로 탭에
  // 걸면 그때 캡처가 함께 사라져 남은 move/up 이 오지 않는다.
  strip.setPointerCapture = () => {};
  strip.releasePointerCapture = () => {};
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

  it("스트립 안에서 끌면 순서가 바뀐다", async () => {
    const { props } = renderStrip();
    const tabs = stubGeometry();
    // 첫 탭(중심 50)을 세 번째 탭 중심(250) 너머로 끈다.
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 50, clientY: 20 });
    await movePointer(tabs[0], { clientX: 260, clientY: 20 });
    fireEvent.pointerUp(tabs[0], { clientX: 260, clientY: 20 });
    expect(props.onReorder).toHaveBeenCalledWith([102, 103, 101]);
    expect(props.onDetach).not.toHaveBeenCalled();
  });

  /**
   * 크롬과 같은 규약: 줄을 벗어나는 **그 순간** 탭이 창이 된다 (놓을 때가
   * 아니다). 넘기는 좌표는 화면 좌표가 아니라 **새 창 안의 앵커** — 잡았던
   * 자리가 커서 밑에 그대로 오도록 하는 지점이다. 창을 옮기는 일은 Rust 가
   * OS 커서로 하므로(줌에 안 흔들린다) 프런트는 "무엇을 커서 밑에 둘지" 만 말한다.
   */
  it("스트립 밖으로 충분히 끌면 그 자리에서 창이 된다 — 잡았던 자리가 앵커", async () => {
    const onTearOff = vi.fn().mockResolvedValue(true);
    const { props } = renderStrip({ onTearOff });
    const tabs = stubGeometry();
    // 두 번째 탭(100..200) 의 안쪽 50px, 스트립 위(6) 에서 14px 아래를 잡았다.
    fireEvent.pointerDown(tabs[1], { button: 0, clientX: 150, clientY: 20 });
    await movePointer(tabs[1], { clientX: 170, clientY: 44 + DETACH_THRESHOLD_PX + 30 });
    // 새 창에서 이 탭은 첫 자리(offsetLeft 0) 에 앉으므로 앵커는 (0+50, 6+14).
    expect(onTearOff).toHaveBeenCalledWith(102, 50, 20);
    expect(props.onDetach).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("한 제스처에 창은 한 번만 만든다", async () => {
    const onTearOff = vi.fn().mockResolvedValue(true);
    renderStrip({ onTearOff });
    const tabs = stubGeometry();
    const out = 44 + DETACH_THRESHOLD_PX + 30;
    fireEvent.pointerDown(tabs[1], { button: 0, clientX: 150, clientY: 20 });
    await movePointer(tabs[1], { clientX: 170, clientY: out });
    await movePointer(tabs[1], { clientX: 240, clientY: out + 40 });
    await movePointer(tabs[1], { clientX: 300, clientY: out + 80 });
    expect(onTearOff).toHaveBeenCalledTimes(1);
  });

  it("떼어내다 스트립으로 돌아오면 다시 순서 변경이다", async () => {
    const { props } = renderStrip();
    const tabs = stubGeometry();
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 50, clientY: 20 });
    await movePointer(tabs[0], { clientX: 60, clientY: 300 });
    await movePointer(tabs[0], { clientX: 260, clientY: 20 });
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

describe("탭 스트립 — 창 간 드래그 (다시 붙이기)", () => {
  /**
   * 내보내는 쪽. 스트립 밖으로 나간 동안에만 "다른 창 위인가"를 묻는다 —
   * 안에서 물으면 IPC 만 태우고 재배열이 끊긴다.
   */
  it("스트립 밖에서만 대상 창을 물어본다 — 스트립 높이를 함께 넘긴다", async () => {
    const onDragHover = vi.fn();
    const { props } = renderStrip({ onDragHover });
    const tabs = stubGeometry();
    fireEvent.pointerDown(tabs[1], { button: 0, clientX: 150, clientY: 20 });
    // 스트립 안 — 묻지 않는다.
    await movePointer(tabs[1], { clientX: 220, clientY: 20 });
    expect(onDragHover).not.toHaveBeenCalled();
    // 밖 — 묻는다. 높이는 스트립 rect 그대로(6..44 = 38).
    await movePointer(tabs[1], { clientX: 220, clientY: 44 + DETACH_THRESHOLD_PX + 30 });
    expect(onDragHover).toHaveBeenCalledWith(102, 38);
    expect(props.onDetach).not.toHaveBeenCalled();
  });

  it("손을 놓으면 백엔드가 마무리한다 — 합치기냐 그 자리 창이냐", async () => {
    const onTearOff = vi.fn().mockResolvedValue(true);
    const onDropTearOff = vi.fn().mockResolvedValue(undefined);
    const { props } = renderStrip({ onTearOff, onDropTearOff });
    const tabs = stubGeometry();
    const far = { clientX: 220, clientY: 44 + DETACH_THRESHOLD_PX + 30 };
    fireEvent.pointerDown(tabs[1], { button: 0, clientX: 150, clientY: 20 });
    await movePointer(tabs[1], far);
    fireEvent.pointerUp(tabs[1], far);
    await waitFor(() => expect(onDropTearOff).toHaveBeenCalled());
    // 판정은 전부 백엔드 몫이다 — 스트립은 떼어내지도 재배열하지도 않는다.
    expect(props.onDetach).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  /**
   * 탭이 **하나뿐인 창도** 떼어내기를 물어본다 — 여기가 떼어낸 창이 드래그로
   * 되돌아오는 유일한 길이다. 백엔드는 새 창을 만드는 대신 그 창 자체를 손에
   * 들고(`carry_whole`), 남의 스트립에 놓으면 합쳐지며 창이 하나 줄어든다.
   *
   * 스트립이 탭 수를 보고 미리 거절하던 시절에는(2026-08-29~08-31) 받는 창에
   * 캐럿까지 그려 놓고 놓으면 아무 일도 안 일어났다.
   */
  it("탭이 하나뿐인 창도 떼어내기를 물어본다 — 되돌아올 유일한 길", async () => {
    const onTearOff = vi.fn().mockResolvedValue(true);
    const onDropTearOff = vi.fn().mockResolvedValue(undefined);
    const { props } = renderStrip({
      tabs: [tab(1, "ai-pm")],
      activeId: 101,
      onTearOff,
      onDropTearOff,
    });
    const tabs = stubGeometry();
    const far = { clientX: 220, clientY: 44 + DETACH_THRESHOLD_PX + 30 };
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 50, clientY: 20 });
    await movePointer(tabs[0], far);
    await waitFor(() => expect(onTearOff).toHaveBeenCalled());
    fireEvent.pointerUp(tabs[0], far);
    // 마무리는 백엔드 몫 — 합칠지 그 자리에 남을지는 겨누던 창이 정한다.
    await waitFor(() => expect(onDropTearOff).toHaveBeenCalled());
    expect(props.onDetach).not.toHaveBeenCalled();
  });

  // `false` 는 이제 "탭이 하나" 가 아니라 **들 수 없었다**는 뜻이다
  // (레지스트리가 모르는 탭 등). 그때는 이 줄의 드래그로 남는다.
  it("손에 들지 못했으면 아무 일도 안 한다", async () => {
    const onTearOff = vi.fn().mockResolvedValue(false);
    const onDropTearOff = vi.fn().mockResolvedValue(undefined);
    const { props } = renderStrip({ onTearOff, onDropTearOff });
    const tabs = stubGeometry();
    const far = { clientX: 220, clientY: 44 + DETACH_THRESHOLD_PX + 30 };
    fireEvent.pointerDown(tabs[1], { button: 0, clientX: 150, clientY: 20 });
    await movePointer(tabs[1], far);
    await waitFor(() => expect(onTearOff).toHaveBeenCalled());
    fireEvent.pointerUp(tabs[1], far);
    expect(onDropTearOff).not.toHaveBeenCalled();
    expect(props.onDetach).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("스트립으로 돌아오면 남의 창에 남긴 캐럿을 지운다", async () => {
    const onDragCleanup = vi.fn();
    renderStrip({ onDragCleanup });
    const tabs = stubGeometry();
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 50, clientY: 20 });
    await movePointer(tabs[0], { clientX: 60, clientY: 300 });
    expect(onDragCleanup).not.toHaveBeenCalled();
    await movePointer(tabs[0], { clientX: 260, clientY: 20 });
    expect(onDragCleanup).toHaveBeenCalled();
  });

  /**
   * 받는 쪽. 탭 폭은 CSS 가 정하므로 삽입 자리는 **이 컴포넌트만** 계산할 수
   * 있다 — 백엔드는 그 답을 받아 두었다가 놓는 순간에 쓴다.
   */
  it("끌려온 x 로 삽입 자리를 계산해 알리고 자리표시자를 그 자리에 세운다", async () => {
    const onIncomingIndex = vi.fn();
    const { props, rerender } = renderStrip({ onIncomingIndex });
    stubGeometry();
    // 탭 중심은 50 / 150 / 250 — 두 번째 탭 중심 바로 앞이면 자리는 1.
    rerender(<TabStrip {...props} incomingX={140} />);
    await waitFor(() => expect(onIncomingIndex).toHaveBeenCalledWith(1));
    const slot = document.querySelector<HTMLElement>(".tabstrip-slot");
    expect(slot).not.toBeNull();
    // 자리표시자는 그 자리 탭의 왼쪽 모서리에 선다.
    expect(slot?.style.left).toBe("100px");

    // 맨 뒤로 가면 마지막 탭의 오른쪽 모서리.
    rerender(<TabStrip {...props} incomingX={390} />);
    await waitFor(() => expect(onIncomingIndex).toHaveBeenLastCalledWith(3));
    expect(document.querySelector<HTMLElement>(".tabstrip-slot")?.style.left).toBe("300px");

    // 커서가 떠나면 자리도 사라진다.
    rerender(<TabStrip {...props} incomingX={null} />);
    await waitFor(() => expect(document.querySelector(".tabstrip-slot")).toBeNull());
  });

  it("같은 자리를 계속 겨누면 중복 보고하지 않는다", async () => {
    const onIncomingIndex = vi.fn();
    const { props, rerender } = renderStrip({ onIncomingIndex });
    stubGeometry();
    rerender(<TabStrip {...props} incomingX={140} />);
    await waitFor(() => expect(onIncomingIndex).toHaveBeenCalledTimes(1));
    rerender(<TabStrip {...props} incomingX={145} />);
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>(".tabstrip-slot")?.style.left).toBe("100px"),
    );
    expect(onIncomingIndex).toHaveBeenCalledTimes(1);
  });

  /**
   * 자리표시자는 **무엇이** 오는지도 말해야 한다. 3px 캐럿 시절엔 자리만 알고
   * 무엇이 오는지 몰라서, 창이 셋이면 겨눈 창이 맞는지 확인할 길이 없었다.
   */
  it("끌려오는 탭의 이름을 자리표시자에 그리고, 뒤 탭들이 비켜선다", async () => {
    const { props, rerender } = renderStrip({});
    const shells = stubGeometry();
    rerender(
      <TabStrip
        {...props}
        incomingX={140}
        incoming={{ name: "docs-site", icon: null, color: null, isStart: false }}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".tabstrip-slot")?.textContent).toContain("docs-site"),
    );
    // 자리는 1 — 그 뒤(1,2)만 밀리고 앞(0)은 그대로다.
    expect(shells[0].style.transform).toBe("");
    expect(shells[1].style.transform).toContain("translateX(");
    expect(shells[2].style.transform).toContain("translateX(");
  });

  it("겉모습이 아직 안 왔으면 빈 자리로라도 그린다", async () => {
    const { props, rerender } = renderStrip({});
    stubGeometry();
    rerender(<TabStrip {...props} incomingX={140} />);
    await waitFor(() => expect(document.querySelector(".tabstrip-slot")).not.toBeNull());
  });
});

/**
 * 떼어내기의 **거동**. 크롬과 같은 규약이라 확인할 것도 크롬과 같다: 줄을
 * 벗어나는 순간 탭이 이 줄에서 **사라지고**, 무르면 돌아오고, 캡처가 살아남아
 * 제스처가 끊기지 않는다.
 */
describe("탭 스트립 — 창으로 떼어내기", () => {
  const far = { clientX: 220, clientY: 44 + DETACH_THRESHOLD_PX + 30 };

  /**
   * 크롬은 탭이 줄을 벗어나는 순간 그 자리를 메운다 — 떼어낸 결과가 이미 창이기
   * 때문이다. 여기서는 백엔드가 탭 목록을 다시 내려 주는 것으로 성립하므로,
   * 이 테스트가 보는 것은 "그 사이에 옆으로 끌어 둔 자국이 남지 않는가" 다.
   */
  it("줄을 벗어나면 탭은 이 줄에서 손을 뗀다", async () => {
    const onTearOff = vi.fn().mockResolvedValue(true);
    renderStrip({ onTearOff });
    const shells = stubGeometry();
    fireEvent.pointerDown(shells[1], { button: 0, clientX: 150, clientY: 20 });
    await movePointer(shells[1], { clientX: 220, clientY: 20 });
    // 아직 줄 안 — 탭 자신이 손을 따라간다.
    expect(shells[1].style.transform).toContain("translateX(");
    expect(onTearOff).not.toHaveBeenCalled();

    await movePointer(shells[1], far);
    await waitFor(() => expect(onTearOff).toHaveBeenCalled());
    // 이동량은 지워진다 — 손에 들린 것은 이제 이 줄의 탭이 아니라 창이다.
    expect(shells[1].style.transform).toBe("");
    expect(shells[1].className).not.toContain("dragging");
  });

  /**
   * 떼어낸 탭은 이 창에서 언마운트된다. 포인터 캡처를 그 탭에 걸어 두었다면
   * 그 순간 캡처가 함께 사라져 남은 move/up 이 오지 않는다 — 창이 손을 놓친 채
   * 커서만 따라다니게 된다. 그래서 캡처는 스트립에 건다.
   */
  it("포인터 캡처는 스트립이 쥔다 — 탭이 사라져도 제스처가 산다", () => {
    renderStrip({ onTearOff: vi.fn().mockResolvedValue(true) });
    const shells = stubGeometry();
    const strip = shells[0].closest(".tabstrip") as HTMLElement;
    const captured: number[] = [];
    strip.setPointerCapture = (id: number) => captured.push(id);
    shells[1].setPointerCapture = () => {
      throw new Error("탭이 캡처를 쥐면 안 된다");
    };
    fireEvent.pointerDown(shells[1], { button: 0, clientX: 150, clientY: 20, pointerId: 7 });
    expect(captured).toEqual([7]);
  });

  it("Escape 로 무르면 떼어낸 창을 물린다", async () => {
    const onTearOff = vi.fn().mockResolvedValue(true);
    const onCancelTearOff = vi.fn().mockResolvedValue(undefined);
    const onDropTearOff = vi.fn().mockResolvedValue(undefined);
    const { props } = renderStrip({ onTearOff, onCancelTearOff, onDropTearOff });
    const shells = stubGeometry();
    fireEvent.pointerDown(shells[1], { button: 0, clientX: 150, clientY: 20 });
    await movePointer(shells[1], far);
    await waitFor(() => expect(onTearOff).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onCancelTearOff).toHaveBeenCalled());
    // 무른 뒤의 pointerup 은 아무 일도 하지 않는다 — 탭이 다시 열리면 안 된다.
    fireEvent.pointerUp(shells[1], far);
    expect(onDropTearOff).not.toHaveBeenCalled();
    expect(props.onDetach).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it("문턱을 넘기 전에 무르면 창은 만들어지지 않는다", async () => {
    const onTearOff = vi.fn().mockResolvedValue(true);
    const onCancelTearOff = vi.fn().mockResolvedValue(undefined);
    const onDragCleanup = vi.fn();
    renderStrip({ onTearOff, onCancelTearOff, onDragCleanup });
    const shells = stubGeometry();
    fireEvent.pointerDown(shells[1], { button: 0, clientX: 150, clientY: 20 });
    await movePointer(shells[1], { clientX: 220, clientY: 20 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onTearOff).not.toHaveBeenCalled();
    expect(onCancelTearOff).not.toHaveBeenCalled();
    expect(onDragCleanup).toHaveBeenCalled();
  });

  it("새로 앉은 탭에만 등장 모션이 붙는다 — 첫 렌더는 조용하다", async () => {
    const { props, rerender } = renderStrip({});
    expect(document.querySelectorAll(".tabstrip-tab.arriving")).toHaveLength(0);
    rerender(<TabStrip {...props} tabs={[...props.tabs, tab(4, "docs-site")]} />);
    await waitFor(() => {
      const fresh = document.querySelectorAll<HTMLElement>(".tabstrip-tab.arriving");
      expect(fresh).toHaveLength(1);
      expect(fresh[0].textContent).toContain("docs-site");
    });
  });
});

describe("탭 스트립 — 탭 메뉴 (드래그의 등가물)", () => {
  const choices = [
    { label: "win-2", name: "saju", tabCount: 2 },
    { label: "win-3", name: "landing", tabCount: 1 },
  ];

  it("우클릭으로 열리고 다른 창 목록을 그린다 — 열 때 목록을 새로 읽는다", () => {
    const onMenuOpen = vi.fn();
    renderStrip({ windowChoices: choices, onMenuOpen });
    fireEvent.contextMenu(screen.getAllByRole("tab")[1]);
    expect(onMenuOpen).toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "탭 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "「saju」 창으로 옮기기" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "「landing」 창으로 옮기기" })).toBeInTheDocument();
  });

  /**
   * 이게 이 메뉴의 존재 이유다 — 드래그는 포인터가 있어야만 성립한다.
   * `ContextMenu` 키와 Shift+F10 은 WAI-ARIA 가 권하는 등가 제스처다.
   */
  it("Shift+F10 · 메뉴 키로도 열린다", () => {
    renderStrip({ windowChoices: choices });
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("창을 고르면 그 창으로 옮긴다", () => {
    const onMoveToWindow = vi.fn();
    renderStrip({ windowChoices: choices, onMoveToWindow });
    fireEvent.contextMenu(screen.getAllByRole("tab")[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: "「landing」 창으로 옮기기" }));
    expect(onMoveToWindow).toHaveBeenCalledWith(102, "win-3");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  /** 메뉴에는 겨눈 지점이 없다 — 좌표를 지어내지 않고 null 을 준다. */
  it("떼어내기는 좌표 없이 부른다", () => {
    const { props } = renderStrip({ windowChoices: choices });
    fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "새 창으로 떼어내기" }));
    expect(props.onDetach).toHaveBeenCalledWith(101);
  });

  it("마지막 탭에는 떼어내기를 안 그린다 — 백엔드도 거절한다", () => {
    renderStrip({ tabs: [tab(1, "ai-pm")], activeId: 101, windowChoices: choices });
    fireEvent.contextMenu(screen.getByRole("tab"));
    expect(screen.queryByRole("menuitem", { name: "새 창으로 떼어내기" })).toBeNull();
    // 옮기기와 닫기는 남는다.
    expect(screen.getByRole("menuitem", { name: "탭 닫기" })).toBeInTheDocument();
  });

  it("보낼 창이 없으면 비우지 않고 이유를 적는다", () => {
    renderStrip({ windowChoices: [] });
    fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
    expect(screen.getByText("옮길 다른 창이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /창으로 옮기기/ })).toBeNull();
  });

  it("위아래 화살표가 항목을 돌고, 열리면 첫 항목이 포커스를 받는다", () => {
    renderStrip({ windowChoices: choices });
    fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    // 끝에서 감싼다.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("Escape 로 닫으면 포커스가 원래 탭으로 돌아온다", () => {
    renderStrip({ windowChoices: choices });
    const target = screen.getAllByRole("tab")[1];
    fireEvent.contextMenu(target);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(document.activeElement).toBe(target);
  });

  it("axe 위반이 없다 (메뉴가 열린 채로)", async () => {
    const { container } = render(
      <>
        <TabStrip
          tabs={[tab(1, "ai-pm"), tab(2, "saju")]}
          activeId={101}
          isMac={false}
          busyProjects={new Set()}
          closedProjects={[]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onReorder={vi.fn()}
          onDetach={vi.fn()}
          onNewTab={vi.fn()}
          onOpenProject={vi.fn()}
          windowChoices={choices}
        />
        <div role="tabpanel" id="tabpanel-t101" aria-labelledby="tab-t101" />
        <div role="tabpanel" id="tabpanel-t102" aria-labelledby="tab-t102" hidden />
      </>,
    );
    fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
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
