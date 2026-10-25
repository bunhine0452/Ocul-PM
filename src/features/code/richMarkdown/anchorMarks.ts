// 안정 id 흐리게 — 제목·할 일 끝의 `{#opt-c}` 는 파서가 읽는 표지라 지우면 안 되지만,
// 본문 글씨로 크게 보이면 읽기를 방해한다. 글은 그대로 두고 장식만 입힌다.
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";

const ANCHOR = /\{#[\w-]+\}\s*$/;

function decorate(doc: PmNode): DecorationSet {
  const marks: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const m = ANCHOR.exec(node.textContent);
    if (m) {
      const start = pos + 1 + m.index;
      marks.push(Decoration.inline(start, start + m[0].length, { class: "rich-anchor" }));
    }
    return false;
  });
  return DecorationSet.create(doc, marks);
}

export const AnchorMarks = Extension.create({
  name: "anchorMarks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
