// 중단점 거터 — 줄 옆을 눌러 찍고 지운다 (docs/dap/00-master-plan.md #breakpoints).
//
// git 거터와 **다른 거터**다. git 거터는 읽기 전용 색막대라 좁고 클릭을 안 받지만,
// 이쪽은 사람이 겨눠서 눌러야 하므로 넓고 hover 를 보여 준다. 둘을 한 거터에
// 합치면 "고친 줄" 과 "중단점" 이 같은 자리를 다투다 둘 다 안 보인다.
//
// 줄 번호는 **1-based** 다 — DAP 와 CodeMirror 가 같은 규약이라 변환이 없다
// (LSP 층의 0-based 와 다르다는 것이 유일한 주의점).
import { StateEffect, StateField } from "@codemirror/state";
import { gutter, GutterMarker, EditorView } from "@codemirror/view";

/** 이 파일의 중단점 줄들(1-based)을 통째로 갈아끼운다. */
export const setBreakpoints = StateEffect.define<readonly number[]>();

/** 어댑터가 "이 줄엔 못 건다" 고 답한 줄들 — 다르게 그린다. */
export const setUnverified = StateEffect.define<readonly number[]>();

class BreakpointMarker extends GutterMarker {
  constructor(private readonly verified: boolean) {
    super();
  }
  override eq(other: BreakpointMarker) {
    return other.verified === this.verified;
  }
  override toDOM() {
    const el = document.createElement("div");
    el.className = "cm-bp-mark" + (this.verified ? "" : " unverified");
    return el;
  }
}

const VERIFIED = new BreakpointMarker(true);
const UNVERIFIED = new BreakpointMarker(false);

interface BreakpointData {
  lines: Set<number>;
  unverified: Set<number>;
}

const field = StateField.define<BreakpointData>({
  create: () => ({ lines: new Set(), unverified: new Set() }),
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setBreakpoints)) next = { ...next, lines: new Set(effect.value) };
      else if (effect.is(setUnverified)) next = { ...next, unverified: new Set(effect.value) };
    }
    return next;
  },
});

/**
 * 중단점 거터.
 *
 * `onToggle` 은 ref 로 받는다 — 확장은 마운트 시 한 번 구성되므로 최신 콜백을
 * 클로저가 아니라 ref 로 읽어야 한다 (다른 LSP 확장과 같은 이유).
 */
export function breakpointGutter(onToggleRef: { current: ((line: number) => void) | undefined }) {
  return [
    field,
    gutter({
      class: "cm-bp-gutter",
      lineMarker: (view, line) => {
        const data = view.state.field(field);
        const number = view.state.doc.lineAt(line.from).number;
        if (!data.lines.has(number)) return null;
        return data.unverified.has(number) ? UNVERIFIED : VERIFIED;
      },
      lineMarkerChange: (update) =>
        update.docChanged || update.startState.field(field) !== update.state.field(field),
      // 빈 줄에서도 눌러야 한다 — 거터 전체가 클릭 대상이다.
      domEventHandlers: {
        mousedown: (view, line, event) => {
          if ((event as MouseEvent).button !== 0) return false;
          const toggle = onToggleRef.current;
          if (!toggle) return false;
          toggle(view.state.doc.lineAt(line.from).number);
          return true;
        },
      },
    }),
    // 거터 위에 커서를 올리면 찍을 수 있다는 것을 보여 준다 (VS Code 와 같다).
    EditorView.baseTheme({
      ".cm-bp-gutter": { cursor: "pointer" },
    }),
  ];
}

/**
 * 확정 응답에서 "못 건" 줄만 골라낸다.
 *
 * 어댑터는 요청한 줄을 **옮길 수 있다** (12행 요청 → 13행 확정). 옮긴 경우는
 * 정상이므로 경고하지 않고, `verified: false` 인 것만 다르게 그린다.
 */
export function unverifiedLines(
  confirmed: readonly { line: number; verified: boolean }[],
): number[] {
  return confirmed.filter((b) => !b.verified).map((b) => b.line);
}
