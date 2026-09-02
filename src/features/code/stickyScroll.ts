// 스티키 스크롤 (B7) — CM6 확장.
//
// 설계 SSOT: docs/20260902_vscode-borrows/04-sticky-scroll.md
//
// 계산은 전부 `stickyModel` 에 있고 여기서는 **그 결과를 DOM 으로 옮기기만**
// 한다 — jsdom 에 레이아웃이 없어 이 파일은 테스트 밖에 남기 때문이다.
// 패널은 `.cm-content` 밖(`view.dom`)에 붙는다: CM 은 콘텐츠 DOM 만 관찰하므로
// 편집 모델을 건드리지 않고, 스크롤과 무관하게 제자리에 남는다.
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";

import {
  stickyFromIndent,
  stickyFromSymbols,
  type StickyLine,
  type StickySymbol,
} from "./stickyModel";

/**
 * 새 심볼 목록을 밀어 넣는다 (재구성이 아니라 트랜잭션 — 진단·거터와 같은 이유).
 * `symbols: null` 이면 들여쓰기 폴백으로 그린다.
 */
export const setStickySource = StateEffect.define<{
  symbols: readonly StickySymbol[] | null;
  tabSize: number;
}>();

/**
 * 이 폭 아래에서는 아예 그리지 않는다. 분할 + svg 미리보기면 편집면이 400px
 * 아래로 가는데, 거기서 잘린 스티키 줄은 맥락이 아니라 소음이다.
 */
const MIN_WIDTH = 320;

/** 심볼 하나. 시작 줄을 **문서 오프셋**으로 들고 있다 (아래 주석 참고). */
interface Anchor {
  pos: number;
  depth: number;
  kind: string;
}

interface Source {
  anchors: readonly Anchor[] | null;
  tabSize: number;
}

const NO_SOURCE: Source = { anchors: null, tabSize: 2 };

const sourceField = StateField.define<Source>({
  create: () => NO_SOURCE,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setStickySource)) continue;
      const { symbols, tabSize } = effect.value;
      if (!symbols) return { anchors: null, tabSize };
      // `tr.state` 는 여기서 읽으면 안 된다 (필드를 계산하는 중이다) — newDoc.
      const doc = tr.newDoc;
      const anchors: Anchor[] = [];
      for (const s of symbols) {
        if (s.line < 0 || s.line >= doc.lines) continue;
        anchors.push({ pos: doc.line(s.line + 1).from, depth: s.depth, kind: s.kind });
      }
      return { anchors, tabSize };
    }
    if (!tr.docChanged || !value.anchors) return value;
    // 편집이 나도 심볼을 다시 묻지 않는다 — 시작 줄을 따라 옮기면 그만이고,
    // 그러지 않으면 위에 한 줄 넣는 순간 스티키가 통째로 남의 줄을 말한다.
    return {
      tabSize: value.tabSize,
      anchors: value.anchors.map((a) => ({ ...a, pos: tr.changes.mapPos(a.pos) })),
    };
  },
});

class StickyPanel implements PluginValue {
  private readonly dom = document.createElement("div");
  private readonly inner = document.createElement("div");
  /** 지금 그려 둔 내용의 지문 — 같으면 DOM 을 건드리지 않는다. */
  private painted = "";
  /** 들여쓰기 폴백용 줄 배열. 문서가 바뀔 때만 다시 만든다. */
  private lineCache: { doc: unknown; lines: string[] } | null = null;
  private readonly onScroll = () => {
    this.syncX();
    this.render();
  };

  constructor(
    private readonly view: EditorView,
    private readonly max: number,
  ) {
    this.dom.className = "cm-sticky";
    this.dom.appendChild(this.inner);
    view.dom.appendChild(this.dom);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.render();
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.transactions.some((tr) => tr.effects.some((e) => e.is(setStickySource)))
    ) {
      this.render();
    }
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.dom.remove();
  }

  /** 가로 스크롤 동기화 — VS Code 의 `scrollWithEditor` 와 같은 값. */
  private syncX() {
    this.inner.style.transform = `translateX(${-this.view.scrollDOM.scrollLeft}px)`;
  }

  /** 화면 맨 위에 걸린 줄 (0-based). 아직 그려지지 않았으면 null. */
  private topLine(): number | null {
    const rect = this.view.scrollDOM.getBoundingClientRect();
    if (rect.height <= 0) return null;
    // precise=false 라 null 이 오지 않는다 — 가려진 자리도 추정해 준다.
    const pos = this.view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 }, false);
    return this.view.state.doc.lineAt(pos).number - 1;
  }

  private lines(): string[] {
    const doc = this.view.state.doc;
    if (this.lineCache?.doc === doc) return this.lineCache.lines;
    const lines = doc.toString().split("\n");
    this.lineCache = { doc, lines };
    return lines;
  }

  private render() {
    const view = this.view;
    // 폭 판단은 CSS 가 아니라 여기서 한다 — 미디어 쿼리는 창 폭을 보지, 분할된
    // 편집면의 폭을 보지 못한다.
    if (view.dom.clientWidth < MIN_WIDTH) {
      this.paint([]);
      return;
    }
    const source = view.state.field(sourceField, false) ?? NO_SOURCE;
    const top = this.topLine();
    if (top == null) {
      this.paint([]);
      return;
    }
    const doc = view.state.doc;
    let rows: StickyLine[];
    if (source.anchors && source.anchors.length > 0) {
      rows = stickyFromSymbols(
        source.anchors.map((a) => ({
          line: doc.lineAt(Math.min(a.pos, doc.length)).number - 1,
          depth: a.depth,
          kind: a.kind,
        })),
        top,
        this.max,
      );
    } else {
      rows = stickyFromIndent(this.lines(), top, this.max, source.tabSize);
    }
    this.paint(rows);
  }

  private paint(rows: StickyLine[]) {
    const doc = this.view.state.doc;
    const texts = rows.map((row) => doc.line(Math.min(row.line + 1, doc.lines)).text);
    // 줄 번호만으로는 모자란다 — 같은 줄의 글자가 편집으로 바뀔 수 있다.
    const key = rows.map((row, i) => `${row.line} ${row.kind} ${texts[i]}`).join("\n");
    if (key === this.painted) return;
    this.painted = key;

    this.dom.style.display = rows.length > 0 ? "" : "none";
    if (rows.length === 0) {
      this.inner.replaceChildren();
      return;
    }
    // 거터 폭만큼 밀어 코드와 세로줄을 맞춘다 (줄 번호가 늘면 폭도 는다).
    const gutters = this.view.dom.querySelector<HTMLElement>(".cm-gutters");
    this.dom.style.left = `${gutters?.offsetWidth ?? 0}px`;
    this.inner.replaceChildren(...rows.map((row, i) => this.rowEl(row, texts[i])));
    this.syncX();
  }

  private rowEl(row: StickyLine, text: string): HTMLElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "cm-sticky-row";
    // 탭 순서에는 넣지 않는다 — 편집기 안에서 Tab 은 들여쓰기이고, 이 줄들은
    // ⇧⌘O(파일 안 이동)가 이미 키보드로 하는 일의 겹침이다.
    el.tabIndex = -1;
    if (row.kind) {
      const dot = document.createElement("span");
      // 아웃라인·이동 위젯과 **같은 점** 을 쓴다 (같은 뜻이면 같은 물체).
      dot.className = `code-outline-kind k-${row.kind}`;
      el.appendChild(dot);
    }
    const label = document.createElement("span");
    label.className = "cm-sticky-text";
    label.textContent = text;
    el.appendChild(label);
    el.addEventListener("mousedown", (event) => {
      // 기본 동작(포커스 이동·선택 시작)을 막고 우리가 직접 옮긴다.
      event.preventDefault();
      this.jump(row.line);
    });
    return el;
  }

  private jump(line: number) {
    const view = this.view;
    const info = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: info.from },
      effects: EditorView.scrollIntoView(info.from, { y: "start" }),
    });
    view.focus();
  }
}

/**
 * 스티키 스크롤 확장. `maxLines` 가 0 이하면 호출하지 않는다 (CodeEditor 가
 * 마운트 시점에 판단한다 — 이 파일의 다른 확장들과 같은 규약).
 */
export function stickyScroll(maxLines: number): Extension {
  return [sourceField, ViewPlugin.define((view) => new StickyPanel(view, maxLines))];
}
