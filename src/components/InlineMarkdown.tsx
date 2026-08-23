import { Fragment, useMemo, type ReactNode } from "react";
import { parseInlineMarkdown, type InlineNode } from "@/lib/inlineMarkdown";

// 한 줄 텍스트용 인라인 마크다운 렌더러. `<span>` 하나만 내보내므로 기존
// 제목 `<span>` 자리를 그대로 대체할 수 있다 (칩·버튼과 같은 줄에 흐른다).
// 블록 문서는 그대로 `@/components/Markdown` 을 쓴다.

function render(nodes: InlineNode[], linkable: boolean): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return <Fragment key={i}>{n.value}</Fragment>;
      case "code":
        return <code key={i} className="imd-code">{n.value}</code>;
      case "strong":
        return <strong key={i} className="imd-strong">{render(n.children, linkable)}</strong>;
      case "em":
        return <em key={i}>{render(n.children, linkable)}</em>;
      case "del":
        return <del key={i} className="imd-del">{render(n.children, linkable)}</del>;
      case "link":
        // 버튼 **안**(단계 헤더·계획 제목 버튼)에서는 앵커를 만들지 않는다 —
        // 중첩 인터랙티브는 접근성 위반이고 클릭도 서로 뺏는다.
        // 바깥 링크는 문서 레벨 가드(lib/externalLinks)가 기본 브라우저로 보낸다.
        return linkable ? (
          <a key={i} href={n.href} className="imd-link" title={n.href}>
            {render(n.children, linkable)}
          </a>
        ) : (
          <span key={i} title={n.href}>{render(n.children, linkable)}</span>
        );
    }
  });
}

export function InlineMarkdown({
  text,
  className,
  title,
  linkable = true,
}: {
  text: string;
  className?: string;
  /** 툴팁. 생략하면 안 붙는다 (원문을 그대로 보고 싶을 때 호출부에서 넘긴다). */
  title?: string;
  /** 버튼·링크 안에 놓을 때는 false — 마크다운 링크를 앵커로 만들지 않는다. */
  linkable?: boolean;
}) {
  const nodes = useMemo(() => parseInlineMarkdown(text), [text]);
  return (
    <span className={className} title={title}>
      {render(nodes, linkable)}
    </span>
  );
}
