import { useRef } from "react";
import { PanelBottom, PanelLeftDock, PanelRight, SquareArrowOutUpRight, X } from "@/components/Icons";
import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { useT, type I18nKey } from "@/i18n";
import {
  clampDockSize,
  nextDockPos,
  useProjectRuntime,
  useUiPrefs,
  type TerminalDockPos,
} from "@/contexts/WorkspaceContext";
import { TerminalSurface } from "./TerminalSurface";
import { TerminalAway } from "./TerminalAway";

// 터미널 도크 (2026-08-15) — 어느 화면에서나 ⌘J 로 여는 터미널 패널.
//
// 왜 도크인가: 터미널은 **다른 화면을 보면서** 쓰는 물건이다. 예전에는 ⌘10 로
// 터미널 화면에 들어가야만 셸이 보였고, 일지·플래너를 보려면 나와야 했다 —
// 그래서 사람들이 앱 밖 iTerm 으로 돌아갔다.
//
// 붙이는 자리는 사용자가 고른다 (하단/왼쪽). 세션은 터미널 화면과 **같은
// 것**이라 자리를 옮기거나 창으로 떼어내도 하던 셸이 그대로 이어진다.
//
// 분리 창이 떠 있는 동안에는 여기에 자리표시자만 남는다 — 하나의 PTY 에
// xterm 두 개가 붙으면 서로의 fit() 을 되돌려 화면이 떨리기 때문이다.

/**
 * 다음 자리별 아이콘·문구. 세 자리를 삼항 두 겹으로 쓰면 읽기 어렵고, 네
 * 번째 자리가 생겼을 때 세 군데를 따로 고쳐야 한다.
 */
const NEXT_ICON: Record<TerminalDockPos, React.ReactNode> = {
  bottom: <PanelBottom size={14} />,
  left: <PanelLeftDock size={14} />,
  right: <PanelRight size={14} />,
};
const MOVE_LABEL = {
  bottom: "term.dock.toBottom",
  left: "term.dock.toLeft",
  right: "term.dock.toRight",
} as const satisfies Record<TerminalDockPos, I18nKey>;
const MOVE_HINT = {
  bottom: "term.dock.toBottomHint",
  left: "term.dock.toLeftHint",
  right: "term.dock.toRightHint",
} as const satisfies Record<TerminalDockPos, I18nKey>;

interface TerminalDockProps {
  projectId: number;
  projectRoot: string | null;
}

export function TerminalDock({ projectId, projectRoot }: TerminalDockProps) {
  const { t } = useT();
  // 조각만 구독한다 (v2.42.0 `{#workspace-full-consumers}`) — 합친 겉면
  // `useWorkspace()` 를 쓰던 때는 **터미널 탭을 하나 고를 때마다** 도크가
  // 통째로 다시 그려졌다. 도크가 읽는 것은 취향(자리·크기·열림)과 런타임
  // (분리 창 여부)뿐이고, 세션 목록은 안쪽 `TerminalSurface` 의 몫이다.
  const { prefs, setPrefs } = useUiPrefs();
  const { terminalDetached: detached } = useProjectRuntime();
  const pos = prefs.terminalDockPos;
  const rootRef = useRef<HTMLElement | null>(null);

  // 세로 두 자리(왼쪽·오른쪽)는 폭을 함께 쓴다 — 좌↔우로 옮길 때 폭이
  // 유지되는 편이 자연스럽고, 자리마다 따로 기억할 값이 아니다.
  const size = pos === "bottom" ? prefs.terminalDockHeight : prefs.terminalDockWidth;

  const close = () => setPrefs(() => ({ terminalDockOpen: false }));
  const cyclePos = () => setPrefs((prev) => ({ terminalDockPos: nextDockPos(prev.terminalDockPos) }));

  const detach = () => {
    void commands.openTerminalWindow(projectId).then((r) => {
      if (r.status === "error") toast.destructive(t("term.dock.detachFailed", { error: r.error }));
    });
  };
  /**
   * 드래그 리사이즈. 크기는 도크가 놓인 부모(콘텐츠 시트) 기준으로 재고, 남는
   * 자리가 없어지지 않게 잘라 둔다 — 끝까지 끌면 화면이 사라지는 도크는
   * 되돌릴 방법이 없어 보인다.
   */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const calc = (ev: PointerEvent) =>
      pos === "bottom"
        ? clampDockSize(rect.bottom - ev.clientY, rect.height)
        : pos === "left"
          ? clampDockSize(ev.clientX - rect.left, rect.width)
          : clampDockSize(rect.right - ev.clientX, rect.width);
    const move = (ev: PointerEvent) => {
      const next = calc(ev);
      setPrefs(() => (pos === "bottom" ? { terminalDockHeight: next } : { terminalDockWidth: next }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 버튼은 **다음** 자리를 가리킨다 (아이콘·문구 모두) — 지금 자리를 그리면
  // "누르면 어디로 가는지"를 매번 추론해야 한다.
  const next = nextDockPos(pos);
  const headerActions = (
    <>
      <span className="term-tool-sep" aria-hidden="true" />
      <button
        type="button"
        className="term-tool"
        onClick={cyclePos}
        title={t(MOVE_HINT[next])}
        aria-label={t(MOVE_LABEL[next])}
      >
        {NEXT_ICON[next]}
      </button>
      <button
        type="button"
        className="term-tool"
        onClick={detach}
        title={t("term.dock.detachHint")}
        aria-label={t("term.dock.detach")}
      >
        <SquareArrowOutUpRight size={14} />
      </button>
      <button
        type="button"
        className="term-tool"
        onClick={close}
        title={t("term.dock.closeHint")}
        aria-label={t("term.dock.close")}
      >
        <X size={14} />
      </button>
    </>
  );

  return (
    <aside
      className={"term-dock pos-" + pos}
      ref={rootRef}
      style={pos === "bottom" ? { height: size } : { width: size }}
      aria-label={t("term.dock.region")}
    >
      <div
        className={"term-dock-grip " + pos}
        onPointerDown={startResize}
        role="separator"
        aria-orientation={pos === "bottom" ? "horizontal" : "vertical"}
        aria-label={t("term.dock.resize")}
      />
      {detached ? (
        <TerminalAway projectId={projectId} />
      ) : (
        <TerminalSurface
          projectRoot={projectRoot}
          compact
          keyboardScope="focused"
          headerActions={headerActions}
        />
      )}
    </aside>
  );
}
