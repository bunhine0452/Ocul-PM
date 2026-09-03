/**
 * 트리 안에서 파일·폴더를 끌어 옮기는 몸짓 — **포인터 이벤트**로 만든다.
 *
 * 처음엔 HTML5 드래그(`draggable` + `dataTransfer`)였다. 그런데 실제
 * WKWebView 에서는 트리 행이 아예 들리지 않는다: 행이 `<button>` 이라 WebKit 이
 * 네이티브 드래그 세션을 열어 주지 않는다. 창 탭 줄(`TabStrip`)이 같은 이유로
 * 이미 포인터 드래그로 옮겨 갔으므로 트리도 같은 길을 쓴다.
 *
 * 포인터로 직접 몰면 `dataTransfer` 로는 못 하던 것이 따라온다:
 *  · 손에 들린 것이 **보인다** (유령이 커서를 따라간다).
 *  · 접힌 폴더 위에 잠깐 머물면 **열린다** (스프링 로드 — Finder 와 같다).
 *    이게 없으면 '폴더 안의 폴더 안' 으로는 옮길 방법이 없다.
 *  · 목록 가장자리에서 **자동으로 스크롤**한다 — 화면 밖 폴더로도 옮겨진다.
 *  · 놓을 수 없는 자리는 **강조하지 않는다** (자기 자신·자기 후손·제자리).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FileIcon } from "./FileIcon";
import { baseName, moveTarget } from "./fileOps";
import { importDestDir, type TreeHit } from "./importTarget";
import { hitAt } from "./treeDom";

/** 이 거리(px)를 넘어야 드래그다. 그 전에는 그냥 클릭이다. */
export const DRAG_THRESHOLD = 4;
/** 접힌 폴더 위에 이만큼(ms) 머물면 펼친다. */
export const SPRING_MS = 550;
/** 목록 위·아래 이 띠(px) 안에서는 자동 스크롤한다. */
const EDGE_PX = 26;
/** 한 틱에 스크롤하는 양(px)과 틱 간격(ms). */
const EDGE_STEP = 12;
const TICK_MS = 50;

/**
 * 이 행 위에 놓으면 들어갈 폴더. 놓을 수 없으면 `null`.
 *
 * 파일 위에 놓는 것은 "그 옆에 놓아 달라" 는 뜻이라 부모 폴더로 접는다
 * (`importDestDir` — Finder 드롭과 같은 규칙). 제자리·자기 안으로는 놓을 수
 * 없으므로 `moveTarget` 이 거절하면 그대로 없는 자리로 친다.
 */
export function dropDirFor(from: string, hit: TreeHit | null): string | null {
  if (!hit) return null;
  const dir = importDestDir(hit, null);
  return moveTarget(from, dir).ok ? dir : null;
}

interface Live {
  from: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  into: string | null;
  scroller: HTMLElement | null;
  /** 스프링 로드를 기다리는 폴더와 그 위에 머물기 시작한 시각. */
  springDir: string | null;
  springAt: number;
}

/** 화면이 그리는 데 필요한 만큼만 — 좌표는 상태로 올리지 않는다. */
interface DragView {
  from: string;
  name: string;
  isDir: boolean;
  /** 이 몸짓이 실제로 데려가는 경로들 (트리 다중 선택). `from` 을 포함한다. */
  paths: string[];
  moved: boolean;
  into: string | null;
}

export interface UseTreeDragArgs {
  /** 놓았다 — `toDir` 은 목적지 폴더 (`""` = 프로젝트 루트). */
  onMove: (from: string, toDir: string) => void;
  /**
   * 이 행을 잡으면 실제로 무엇이 딸려 오는가 (트리 다중 선택). 유령이 "n개" 를
   * 말하려면 몸짓이 시작될 때 이미 알아야 한다.
   */
  payloadOf: (path: string) => string[];
  /** 접힌 폴더 위에 머물렀다 — 펼칠 기회. */
  onSpringOpen: (dir: string) => void;
  /** 이 폴더가 이미 펼쳐져 있는가 (스프링 로드를 두 번 부르지 않게). */
  isExpanded: (dir: string) => boolean;
}

export interface UseTreeDragResult {
  /** 트리 행에 그대로 펴 넣는다 (`{...rowDrag(path, isDir)}`). */
  rowDrag: (path: string, isDir: boolean) => {
    onPointerDown: (e: React.PointerEvent) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
  /** 지금 강조할 폴더 (`""` = 루트). 놓을 수 없는 자리 위에서는 null. */
  dropDir: string | null;
  /** 지금 들려 있는 경로들 — 그 행들을 흐리게 그린다. */
  draggingPaths: ReadonlySet<string>;
  /** 커서를 따라다니는 유령. 화면이 그대로 렌더한다. */
  ghost: React.ReactNode;
}

export function useTreeDrag({
  onMove,
  payloadOf,
  onSpringOpen,
  isExpanded,
}: UseTreeDragArgs): UseTreeDragResult {
  const live = useRef<Live | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<DragView | null>(null);
  /** 드래그로 끝난 몸짓의 click 을 한 번 삼킨다 — 안 그러면 놓는 순간 그 행이
   *  열리거나(파일) 접힌다(폴더). */
  const swallow = useRef(false);

  // 콜백은 ref 로 최신을 본다 — 구독은 드래그당 한 번만 걸고 유지한다.
  const cb = useRef({ onMove, payloadOf, onSpringOpen, isExpanded });
  cb.current = { onMove, payloadOf, onSpringOpen, isExpanded };

  const paint = useCallback((x: number, y: number) => {
    const el = ghostRef.current;
    if (el) el.style.transform = `translate3d(${x + 14}px, ${y + 12}px, 0)`;
  }, []);

  // 유령은 상태가 바뀐 **뒤에** 생긴다 — 첫 프레임에 좌측 상단에서 튀어나오지
  // 않도록 그려진 직후 지금 좌표로 한 번 찍는다.
  useLayoutEffect(() => {
    const d = live.current;
    if (d?.moved) paint(d.x, d.y);
  });

  const finish = useCallback((commit: boolean) => {
    const d = live.current;
    live.current = null;
    setView(null);
    document.body.classList.remove("code-dragging");
    if (!d) return;
    swallow.current = d.moved;
    if (commit && d.moved && d.into !== null) cb.current.onMove(d.from, d.into);
  }, []);

  const active = view !== null;

  // 몸짓이 사는 동안에만 창을 듣는다. 포인터 캡처 대신 창을 쓰는 이유는
  // 스프링 로드가 트리를 다시 그려 잡았던 행이 갈릴 수 있기 때문이다.
  useEffect(() => {
    if (!active) return;

    /** 좌표 하나로 유령·목적지·스프링 대상을 한꺼번에 갱신한다. */
    const track = (x: number, y: number) => {
      const d = live.current;
      if (!d) return;
      d.x = x;
      d.y = y;
      paint(x, y);
      const hit = hitAt(x, y);
      const into = dropDirFor(d.from, hit);
      if (into !== d.into) {
        d.into = into;
        setView((v) => (v ? { ...v, into } : v));
      }
      // '어느 폴더 위인가' 는 놓을 수 있는지와 무관하게 센다 — 놓을 수 없는
      // 폴더라도 그 **안쪽**이 목적지일 수 있으니 열어 줘야 한다.
      const dir = hit?.isDir && hit.path ? hit.path : null;
      if (dir !== d.springDir) {
        d.springDir = dir;
        d.springAt = Date.now();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const d = live.current;
      if (!d) return;
      // 버튼이 이미 떨어졌다 — 창 **밖**에서 뗐거나(포인터 캡처를 안 쓰므로
      // 그 pointerup 은 창에 오지 않는다) 구독이 붙기 전에 지나갔다. 그대로
      // 두면 누르지도 않은 손을 유령이 따라다닌다: 첫 움직임에서 회수한다.
      if (e.buttons === 0) {
        finish(false);
        return;
      }
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
        d.moved = true;
        document.body.classList.add("code-dragging");
        setView((v) => (v ? { ...v, moved: true } : v));
      }
      // 텍스트 선택이 시작되면 WebKit 이 자기 드래그 세션을 열어 이 몸짓을
      // 가로챈다 (`body.code-dragging` 의 user-select 와 짝이다).
      e.preventDefault();
      track(e.clientX, e.clientY);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      finish(false);
    };

    // 한 틱이 가장자리 자동 스크롤과 스프링 로드를 함께 본다 — 둘 다 손이
    // **멈춰 있는 동안** 일어나야 하는 일이라 pointermove 로는 셀 수 없다.
    const tick = () => {
      const d = live.current;
      if (!d?.moved) return;
      if (
        d.springDir &&
        !cb.current.isExpanded(d.springDir) &&
        Date.now() - d.springAt >= SPRING_MS
      ) {
        cb.current.onSpringOpen(d.springDir);
        d.springAt = Date.now();
      }
      const box = d.scroller?.getBoundingClientRect();
      if (!box || !d.scroller) return;
      const up = d.y - box.top < EDGE_PX;
      const down = box.bottom - d.y < EDGE_PX;
      if (!up && !down) return;
      const before = d.scroller.scrollTop;
      d.scroller.scrollTop = before + (up ? -EDGE_STEP : EDGE_STEP);
      if (d.scroller.scrollTop !== before) track(d.x, d.y);
    };

    const timer = window.setInterval(tick, TICK_MS);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, finish, paint]);

  // 드래그 도중 언마운트되면 몸에 걸어 둔 커서 상태가 남는다.
  useEffect(() => () => document.body.classList.remove("code-dragging"), []);

  const rowDrag = useCallback(
    (path: string, isDir: boolean) => ({
      onPointerDown: (e: React.PointerEvent) => {
        // 왼쪽 버튼만. 터치는 건드리지 않는다 — 목록 스크롤을 삼키면 안 된다.
        if (e.button !== 0 || e.pointerType === "touch") return;
        // 다른 행 위에서 놓은 몸짓의 click 은 영영 오지 않는다 — 그 자리에
        // 남은 삼킴 표를 여기서 버린다.
        swallow.current = false;
        live.current = {
          from: path,
          x: e.clientX,
          y: e.clientY,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
          into: null,
          scroller: (e.currentTarget as HTMLElement).closest<HTMLElement>(".code-tree"),
          springDir: null,
          springAt: 0,
        };
        setView({
          from: path,
          name: baseName(path),
          isDir,
          paths: cb.current.payloadOf(path),
          moved: false,
          into: null,
        });
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (!swallow.current) return;
        swallow.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [],
  );

  const ghost =
    view?.moved
      ? createPortal(
          <div
            ref={ghostRef}
            className={"code-drag-ghost" + (view.into === null ? " no" : "")}
            aria-hidden
          >
            <FileIcon name={view.name} isDir={view.isDir} size={15} />
            <span>{view.name}</span>
            {/* 여럿을 들었으면 그 사실이 손에 보여야 한다 — 이름 하나만 뜨면
                나머지가 따라오는 줄 모른 채 놓게 된다. */}
            {view.paths.length > 1 ? (
              <em className="code-drag-count">+{view.paths.length - 1}</em>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return {
    rowDrag,
    dropDir: view?.into ?? null,
    draggingPaths: useMemo(
      () => new Set(view?.moved ? view.paths : []),
      [view?.moved, view?.paths],
    ),
    ghost,
  };
}
