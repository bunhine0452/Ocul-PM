import { useRef } from "react";
import { PanelBottom, PanelLeftDock, SquareArrowOutUpRight, X } from "@/components/Icons";
import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { clampDockSize, useWorkspace, type TerminalDockPos } from "@/contexts/WorkspaceContext";
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

interface TerminalDockProps {
  projectId: number;
  projectRoot: string | null;
}

export function TerminalDock({ projectId, projectRoot }: TerminalDockProps) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const pos = state.terminalDockPos;
  const detached = state.terminalDetached;
  const rootRef = useRef<HTMLElement | null>(null);

  const size = pos === "bottom" ? state.terminalDockHeight : state.terminalDockWidth;

  const close = () => setState((prev) => ({ ...prev, terminalDockOpen: false }));
  const setPos = (next: TerminalDockPos) =>
    setState((prev) => ({ ...prev, terminalDockPos: next }));

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
        : clampDockSize(ev.clientX - rect.left, rect.width);
    const move = (ev: PointerEvent) => {
      const next = calc(ev);
      setState((prev) =>
        pos === "bottom"
          ? { ...prev, terminalDockHeight: next }
          : { ...prev, terminalDockWidth: next },
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const headerActions = (
    <>
      <span className="term-tool-sep" aria-hidden="true" />
      <button
        type="button"
        className="term-tool"
        onClick={() => setPos(pos === "bottom" ? "left" : "bottom")}
        title={pos === "bottom" ? t("term.dock.toLeftHint") : t("term.dock.toBottomHint")}
        aria-label={pos === "bottom" ? t("term.dock.toLeft") : t("term.dock.toBottom")}
      >
        {pos === "bottom" ? <PanelLeftDock size={14} /> : <PanelBottom size={14} />}
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
