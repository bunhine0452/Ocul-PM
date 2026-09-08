/**
 * 링크 호버 밑줄 — WebGL 렌더러에서도 그려지는 자체 장식 (2026-09-07).
 *
 * # 왜 직접 그리는가
 *
 * xterm 의 기본 링크 밑줄은 **DOM 렌더러 전용**이다. 코어의 링크 처리기는
 * 호버할 때 `onShowLinkUnderline` 을 쏘는데, 그 이벤트를 듣는 렌더러는
 * `DomRenderer` 하나뿐이다 — `@xterm/addon-webgl` 에는 구독하는 자리가 아예
 * 없다. 이 앱은 2026-07-30 에 렌더러를 WebGL 로 올렸고(글리프 폭·출력량),
 * 그때부터 링크에 마우스를 올려도 **손 모양 커서만 바뀌고 밑줄은 안 그려졌다.**
 * 링크인지 아닌지가 커서로만 구분되니, 경로가 여럿 있는 줄에서는 어디까지가
 * 한 링크인지 보이지 않는다.
 *
 * # 어떻게
 *
 * 장식(`registerDecoration`)은 렌더러와 무관한 **DOM 오버레이**라 WebGL 에서도
 * 그대로 산다. 마커에 매달리므로 스크롤도 xterm 이 알아서 따라간다 — 우리가
 * 좌표를 다시 계산할 일이 없다.
 *
 * 한 번에 하나만 산다. 마우스는 링크 하나 위에만 있을 수 있고, 남겨 두면
 * 스크롤백에 밑줄이 쌓인다.
 */
import type { IBufferRange, IDecoration, IMarker, Terminal } from "@xterm/xterm";

export interface LinkUnderline {
  /** 이 범위에 밑줄을 긋는다 (버퍼 좌표, 1-based, end 포함). */
  show(range: IBufferRange): void;
  /** 지운다. 없으면 아무 일도 하지 않는다. */
  hide(): void;
  dispose(): void;
}

/**
 * @param shouldDraw GPU 렌더러가 붙어 있는가. DOM 렌더러로 돌아간 순간에는
 *   xterm 이 **자기 밑줄을 다시 그리므로** 우리가 겹쳐 그으면 두 줄이 된다.
 *   컨텍스트 소실로 렌더러가 바뀔 수 있어 값이 아니라 술어로 받는다.
 */
export function createLinkUnderline(term: Terminal, shouldDraw: () => boolean): LinkUnderline {
  let marker: IMarker | undefined;
  let decoration: IDecoration | undefined;

  const hide = () => {
    decoration?.dispose();
    decoration = undefined;
    marker?.dispose();
    marker = undefined;
  };

  return {
    show(range) {
      hide();
      if (!shouldDraw()) return;
      // 줄을 넘는 링크(줄바꿈된 URL)는 긋지 않는다. 장식은 마커 한 줄에
      // 매달리므로 여러 줄은 장식 여러 개가 필요한데, 접힌 줄의 경계는
      // 여기서 알 수 없다 — 반만 긋느니 안 긋는다.
      if (range.start.y !== range.end.y) return;
      const buffer = term.buffer.active;
      // 마커는 **커서 줄 기준 오프셋**으로 등록한다. 링크 범위는 절대 버퍼 줄
      // (1-based)이라 커서 줄을 빼서 옮긴다.
      const offset = range.start.y - 1 - (buffer.baseY + buffer.cursorY);
      const anchor = term.registerMarker(offset);
      if (!anchor) return;
      marker = anchor;
      const x = Math.max(0, range.start.x - 1);
      const width = Math.max(1, range.end.x - x);
      const drawn = term.registerDecoration({ marker: anchor, x, width, layer: "top" });
      if (!drawn) {
        hide();
        return;
      }
      decoration = drawn;
      drawn.onRender((el) => {
        // onRender 는 스크롤·리사이즈마다 다시 불린다 — 멱등해야 한다.
        el.className = "term-link-underline";
        // **필수**: 오버레이가 마우스를 먹으면 xterm 이 "링크에서 벗어났다"로
        // 읽고 밑줄을 지운다. 지우면 다시 링크 위가 되어 또 그린다 — 깜빡임이
        // 멈추지 않는다.
        el.style.pointerEvents = "none";
      });
    },
    hide,
    dispose: hide,
  };
}
