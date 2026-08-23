// git 거터 — HEAD 대비 무엇을 고쳤는지 줄 옆에 색막대로 (#git-gutter).
//
// LSP 가 아니다. 백엔드가 HEAD 블롭과 **지금 버퍼**를 비교해 덩어리를 주고
// (`git_line_changes`), 여기서는 그것을 CM6 거터 마커로 옮기기만 한다.
//
// 왜 진단(lintGutter)처럼 확장을 따로 두나: 거터는 편집 중에도 갱신되므로
// 재구성이 아니라 **트랜잭션**으로 바뀌어야 한다 (재구성하면 실행 취소 이력과
// 접힘 상태가 날아간다 — 진단 반영이 같은 이유로 그렇게 돼 있다).
import { StateEffect, StateField } from "@codemirror/state";
import { gutter, GutterMarker } from "@codemirror/view";
import type { GitLineChange } from "@/lib/bindings";

/** 새 거터 데이터를 밀어 넣는다. */
export const setGitChanges = StateEffect.define<readonly GitLineChange[]>();

type Kind = GitLineChange["kind"];

class ChangeMarker extends GutterMarker {
  constructor(private readonly kind: Kind) {
    super();
  }
  override eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
  override toDOM() {
    const el = document.createElement("div");
    el.className = `cm-git-gutter-mark ${this.kind}`;
    return el;
  }
}

const MARKERS: Record<Kind, ChangeMarker> = {
  added: new ChangeMarker("added"),
  modified: new ChangeMarker("modified"),
  deleted: new ChangeMarker("deleted"),
};

/**
 * 줄 번호(1-based) → 마커. 겹치면 **더 강한 것이 이긴다**: 수정 > 추가 > 삭제.
 * 한 줄이 두 덩어리에 걸리는 일은 드물지만, 그때 무엇을 그릴지 정해 두지 않으면
 * 마지막에 온 것이 이겨 결과가 들쭉날쭉해진다.
 */
export function markersByLine(changes: readonly GitLineChange[]): Map<number, Kind> {
  const rank: Record<Kind, number> = { deleted: 0, added: 1, modified: 2 };
  const out = new Map<number, Kind>();
  for (const change of changes) {
    for (let line = change.start_line; line <= change.end_line; line++) {
      const prev = out.get(line);
      if (prev === undefined || rank[change.kind] > rank[prev]) out.set(line, change.kind);
    }
  }
  return out;
}

const changesField = StateField.define<Map<number, Kind>>({
  create: () => new Map(),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGitChanges)) return markersByLine(effect.value);
    }
    return value;
  },
});

/**
 * 거터 확장. 데이터가 없으면 아무 것도 안 그린다 — 저장소 밖 파일에서 빈 띠가
 * 자리를 먹지 않도록 마커가 있을 때만 폭이 생긴다(CSS).
 */
export function gitGutter() {
  return [
    changesField,
    gutter({
      class: "cm-git-gutter",
      lineMarker: (view, line) => {
        const map = view.state.field(changesField);
        if (map.size === 0) return null;
        const number = view.state.doc.lineAt(line.from).number;
        const kind = map.get(number);
        return kind ? MARKERS[kind] : null;
      },
      // 줄이 새로 생기거나 사라져도 마커를 다시 계산하게 한다.
      lineMarkerChange: (update) =>
        update.docChanged || update.startState.field(changesField) !== update.state.field(changesField),
    }),
  ];
}
