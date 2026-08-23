// 시그니처 힌트 — 인자를 입력하는 동안 함수의 모양을 띄운다 (`signatureHelp`).
//
// 호버·자동완성과 달리 CM6 에 기성 확장이 없어 직접 만든다. 얼개는 셋이다:
//   1. `StateField` — 지금 떠 있는 툴팁을 상태로 들고 있다 (`showTooltip` 이 읽는다).
//   2. `updateListener` — 편집·커서 이동 때 서버에 물을지 판단하고, 비동기 응답을
//      `StateEffect` 로 되돌려 넣는다.
//   3. 트리거 문자 — `(` 와 `,` 를 쳤을 때, 그리고 이미 떠 있으면 계속 따라간다.
//
// 왜 이 파일에 따로 두나: CodeEditor 는 이미 400줄이고, 여기 로직(비동기 응답이
// 도착했을 때 커서가 이미 움직였는지 판단하는 것)은 편집기 배선과 성격이 다르다.
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import type { LspSignatureHelp } from "@/lib/bindings";

/** 요청 간 최소 간격. 타자마다 물으면 서버가 재분석을 계속 취소한다. */
const ASK_DEBOUNCE_MS = 120;

type Ask = (line: number, character: number) => Promise<LspSignatureHelp | null>;

/** 도착한 응답을 상태에 밀어 넣는다. `null` 이면 툴팁을 접는다. */
const setSignature = StateEffect.define<{ pos: number; help: LspSignatureHelp } | null>();

/**
 * 시그니처 힌트 확장.
 *
 * `askRef` 를 ref 로 받는 이유는 CodeEditor 의 다른 LSP 확장과 같다 — 확장은
 * 마운트 시 한 번 구성되므로 최신 콜백을 클로저가 아니라 ref 로 읽어야 한다.
 */
export function lspSignatureTooltip(askRef: { current: Ask | undefined }) {
  const field = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (!effect.is(setSignature)) continue;
        return effect.value ? buildTooltip(effect.value.pos, effect.value.help) : null;
      }
      // 문서가 바뀌면 위치를 따라 옮긴다 — 안 그러면 툴팁이 옛 자리에 붙어
      // 있다가 다음 응답에서야 제자리를 찾는다.
      if (value && tr.docChanged) {
        return { ...value, pos: tr.changes.mapPos(value.pos) };
      }
      return value;
    },
    provide: (f) => showTooltip.from(f),
  });

  let timer: number | null = null;
  let seq = 0;

  const listener = EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) return;
    const ask = askRef.current;
    if (!ask) return;

    const view = update.view;
    const sel = view.state.selection.main;
    const open = view.state.field(field) != null;

    // 선택 범위가 있으면 인자를 치는 중이 아니다.
    if (!sel.empty) {
      close(view);
      return;
    }
    // 열려 있지 않다면 **트리거를 실제로 쳤을 때만** 연다 — 커서를 옮길
    // 때마다 물으면 서버 왕복이 끝없이 난다.
    if (!open && !(update.docChanged && justTypedTrigger(update.state.sliceDoc(sel.head - 1, sel.head)))) {
      return;
    }

    if (timer != null) window.clearTimeout(timer);
    const token = ++seq;
    timer = window.setTimeout(() => {
      timer = null;
      const head = view.state.selection.main.head;
      const { line, character } = positionAt(view, head);
      void ask(line, character).then((help) => {
        // 응답이 오는 사이 커서가 움직였거나 더 새 요청이 나갔으면 버린다 —
        // 늦게 도착한 옛 응답이 지금 자리를 덮어쓰면 엉뚱한 시그니처가 뜬다.
        if (token !== seq || view.state.selection.main.head !== head) return;
        view.dispatch({
          effects: setSignature.of(help && help.signatures.length > 0 ? { pos: head, help } : null),
        });
      });
    }, ASK_DEBOUNCE_MS);
  });

  function close(view: EditorView) {
    if (view.state.field(field) == null) return;
    seq += 1; // 진행 중인 요청 무효화
    view.dispatch({ effects: setSignature.of(null) });
  }

  return [
    field,
    listener,
    // Escape 로 닫기 — 툴팁이 보고 싶은 줄을 가릴 때의 탈출구.
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.key !== "Escape" || view.state.field(field) == null) return false;
        close(view);
        return true;
      },
    }),
  ];
}

/** 방금 친 글자가 시그니처를 열 만한 것인가. */
function justTypedTrigger(ch: string): boolean {
  return ch === "(" || ch === ",";
}

/** CM 오프셋 → LSP `(line, character)`. 둘 다 0-based·UTF-16 이라 변환이 없다. */
function positionAt(view: EditorView, pos: number): { line: number; character: number } {
  const line = view.state.doc.lineAt(pos);
  return { line: line.number - 1, character: pos - line.from };
}

/**
 * 툴팁 DOM. 활성 인자만 굵게 — 어디를 치고 있는지가 이 기능의 전부다.
 *
 * 라벨 구간은 백엔드가 **UTF-16 오프셋**으로 준다. JS 문자열이 같은 단위라
 * `slice` 가 그대로 맞는다 (설계 SSOT §위치 인코딩과 같은 이유).
 */
function buildTooltip(pos: number, help: LspSignatureHelp): Tooltip {
  return {
    pos,
    above: true,
    // 화살표를 붙이면 좁은 창에서 툴팁이 커서를 가린다.
    arrow: false,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-lsp-signature";

      const index = Math.min(help.active_signature, help.signatures.length - 1);
      const sig = help.signatures[Math.max(0, index)];
      const label = document.createElement("div");
      label.className = "cm-lsp-signature-label";

      const span = sig.parameters[help.active_parameter];
      if (span && span.end <= sig.label.length && span.start < span.end) {
        label.append(
          sig.label.slice(0, span.start),
          strong(sig.label.slice(span.start, span.end)),
          sig.label.slice(span.end),
        );
      } else {
        label.textContent = sig.label;
      }
      dom.appendChild(label);

      if (sig.documentation) {
        const doc = document.createElement("div");
        doc.className = "cm-lsp-signature-doc";
        doc.textContent = sig.documentation;
        dom.appendChild(doc);
      }
      if (help.signatures.length > 1) {
        const count = document.createElement("div");
        count.className = "cm-lsp-signature-count";
        count.textContent = `${Math.max(0, index) + 1}/${help.signatures.length}`;
        dom.appendChild(count);
      }
      return { dom };
    },
  };
}

function strong(text: string): HTMLElement {
  const el = document.createElement("strong");
  el.textContent = text;
  return el;
}
