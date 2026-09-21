// 화면-로컬 단축키(⌘D·⌘F·⌘L·⌘↑↓·⌘±·⇧⌘↩·⇧⌘0·Esc) 와 ⌘W/⌘T 인텐트 사슬 등록 —
// `TerminalSurface.tsx` 에서 옮겨 왔다 (2026-09-15 분할). 핸들러는 ref 로 최신을
// 읽고 리스너는 1회 등록. 이펙트 순서(닫기 → 새 탭 → keydown) 불변.
// keydown 은 이 면이 **화면에 보일 때만** 듣는다 — 숨은 프로젝트 탭 게이트.
import { useEffect, useRef } from "react";
import type { PaneDir } from "@/lib/termPanes";
import { registerCloseHandler } from "@/lib/closeIntent";
import { registerNewTabHandler } from "@/lib/newTabIntent";

/** 본체가 매 렌더 새로 만들어 넘기는 핸들러 묶음 — 갱신값은 ref 가 본다. */
export interface TerminalKeyActions {
  addTab: () => void;
  closeFocusedPane: () => void;
  splitFocused: (dir: PaneDir) => void;
  openSearch: () => void;
  closeSearch: () => void;
  clearScreen: () => void;
  gotoBlock: (dir: "prev" | "next") => void;
  fontDelta: (d: number) => void;
  fontReset: () => void;
  toggleZoom: () => void;
  searchOpen: boolean;
  keyboardScope: "always" | "focused";
  ownsNewTab: boolean;
}

/** 돌려주는 `rootRef` 는 본체가 루트 `<div>` 에 단다 — 스코프 판정의 기준. */
export function useTerminalKeys(actions: TerminalKeyActions) {
  // 단축키 스코프 판정용 — 이 면의 루트.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  /**
   * ⌘W — **포커스가 터미널 안에 있으면 페인을 닫는다** (2026-08-29).
   *
   * 여기는 keydown 이 아니라 "안쪽부터 닫기" 사슬(`lib/closeIntent`)로 온다.
   * macOS 에서 ⌘W 는 앱 메뉴의 accelerator 라 OS 가 먼저 먹어치우고 웹뷰에는
   * keydown 이 오지 않는다 — 예전에 여기 있던 ⌘W 분기가 그래서 한 번도 안 돌았고,
   * 터미널에 타이핑하다 ⌘W 를 눌러도 **프로젝트 탭**이 닫혔다. Rust 는 대신
   * `CloseIntent` 를 쏘므로, 그 사슬에 들어가는 것이 유일하게 동작하는 길이다.
   *
   * scope 를 주는 이유: 도크는 다른 화면 **위에 얹혀** 있어서 등록 순서만으로는
   * "지금 사용자가 어디에 있는가" 를 알 수 없다. 포커스가 이 면 안에 있을 때만
   * 우선권을 갖고, 아니면 뒤 화면(코드 탭·세션 탭)이 평소대로 받는다.
   */
  useEffect(
    () =>
      registerCloseHandler(
        () => {
          const root = rootRef.current;
          if (!root || !root.contains(document.activeElement)) return false;
          actionsRef.current.closeFocusedPane();
          return true;
        },
        () => rootRef.current,
      ),
    [],
  );

  /**
   * ⌘T — **포커스가 터미널 안에 있으면 셸 탭을 연다** (2026-09-01).
   *
   * ⌘W 와 판박이다: `⌘T` 도 앱 메뉴 액셀러레이터라(menu.rs `ACC_NEW_TAB`)
   * macOS 가 웹뷰보다 먼저 먹어치우고, 위 keydown 리스너의 ⌘T 분기는 한 번도
   * 돈 적이 없었다 — 셸에 타이핑하다 ⌘T 를 누르면 **프로젝트 탭**이 새로
   * 열렸다. 치트시트는 "⌘T = 터미널 새 탭" 이라고 적혀 있었으니 약속만 남고
   * 동작이 없던 셈이다. Rust 가 `NewTabIntent` 를 쏘므로 그 사슬에 들어가는
   * 것이 유일하게 동작하는 길이다.
   */
  useEffect(
    () =>
      registerNewTabHandler(
        () => {
          const root = rootRef.current;
          if (!root) return false;
          // 분리 창은 이 면이 곧 창이라 포커스를 묻지 않는다 (`ownsNewTab`).
          if (!actionsRef.current.ownsNewTab && !root.contains(document.activeElement)) {
            return false;
          }
          actionsRef.current.addTab();
          return true;
        },
        () => rootRef.current,
      ),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      const root = rootRef.current;
      // 이 면이 **보일 때만** 듣는다 (2026-09-21). 크롬식 탭에선 숨은 프로젝트
      // 탭의 터미널 화면도 마운트된 채인데 `always` 스코프는 포커스를 묻지
      // 않아, A 탭에서 누른 ⌘D 가 열려 있는 **모든** 탭의 터미널을 함께
      // 쪼갰다. 숨은 탭은 `display:none` 이라 레이아웃 사각형이 없다 — 코드
      // 화면의 `isVisible` 과 같은 판정이다.
      if (!root || root.getClientRects().length === 0) return;
      // 도크는 다른 화면 **위에 얹혀** 있다 — 포커스가 터미널 안에 없는데도
      // ⌘F 를 가로채면 일지를 읽던 사용자가 스크롤백 검색을 만나게 된다.
      if (a.keyboardScope === "focused" && !root.contains(document.activeElement)) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        // ⌘T 는 여기 없다 — ⌘W 와 같이 앱 메뉴 액셀러레이터라 keydown 이 오지
        // 않는다. 아래 `registerNewTabHandler` 가 정본이다.
        if (k === "d") {
          e.preventDefault();
          e.stopPropagation();
          a.splitFocused(e.shiftKey ? "col" : "row");
        } else if (k === "f" && !e.shiftKey) {
          e.preventDefault();
          a.openSearch();
        } else if (k === "l" && !e.shiftKey) {
          // ⌘K 는 전역 커맨드 팔레트가 선점하므로(useGlobalShortcuts) ⌘L 을 쓴다.
          // 셸 자체의 Ctrl+L 은 그대로 PTY 로 흘러가 함께 동작한다.
          e.preventDefault();
          e.stopPropagation();
          a.clearScreen();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          // 셸 자체의 히스토리(↑/↓)와 겹치지 않는다 — 저쪽은 수식어가 없다.
          e.preventDefault();
          e.stopPropagation();
          a.gotoBlock(e.key === "ArrowUp" ? "prev" : "next");
        } else if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          a.fontDelta(1);
        } else if (e.key === "-") {
          e.preventDefault();
          a.fontDelta(-1);
        } else if (e.key === "Enter" && e.shiftKey) {
          // ⇧⌘↩ — 포커스된 페인만 크게 (tmux 의 zoom). 셸의 ↩ 은 수식어가 없다.
          e.preventDefault();
          e.stopPropagation();
          a.toggleZoom();
        } else if (e.shiftKey && (e.key === "0" || e.key === ")")) {
          // ⌘0 은 전역 화면 이동(navRegistry 10번째)이 함께 잡아가 눌렀을 때
          // 글자 크기 초기화 + 화면 전환이 동시에 일어났다 → ⇧⌘0 으로 옮긴다.
          e.preventDefault();
          e.stopPropagation();
          a.fontReset();
        }
      } else if (e.key === "Escape" && a.searchOpen) {
        a.closeSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return rootRef;
}
