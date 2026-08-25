// 마크다운 렌더 — 완료 블록(memo)과 스트리밍 중 블록.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { memo, useMemo } from "react";
import { Markdown } from "@/components/Markdown";
import { splitMarkdownBlocks } from "../markdownBlocks";

/** 완성된 블록 하나 — 문자열이 그대로면 다시 파싱하지 않는다. */
export const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return <Markdown>{text}</Markdown>;
});

/** 스트리밍 중 본문 — 블록 단위로 그린다 (markdownBlocks.ts 참고). */
export function StreamingMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);
  return (
    <>
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} text={block} />
      ))}
    </>
  );
}
