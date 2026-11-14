import { lazy, Suspense } from "react";
import type { Components } from "react-markdown";

// v2 U6 (docs/20260706_v2/03-performance-spec.md §2) — 렌더 구현
// (react-markdown + remark-gfm + rehype-highlight, ≈141KB) 은 MarkdownImpl 로
// 분리해 lazy 로드. 7개 소비 화면의 임포트 경로는 그대로다.
//
// Suspense fallback = 원문 텍스트 pre-wrap: 청크가 내려오는 짧은 순간에도
// 내용이 즉시 보이고, 로드 완료 시 리치 렌더로 승격된다 (스피너 없음).
// `import type` 은 컴파일 타임에 지워지므로 react-markdown 을 eager 그래프로
// 끌고 오지 않는다.

const MarkdownImpl = lazy(() => import("./MarkdownImpl"));

export function Markdown(props: {
  children: string;
  components?: Components;
  urlTransform?: (url: string) => string;
}) {
  return (
    <Suspense
      fallback={
        // 조판은 소비처의 한 벌(`.jd-prose`)이 쥔다 — 여기서 크기 · 줄간격을 따로 주면 청크가 오는 순간 글이 뛴다.
        <div className="md-fallback">{props.children}</div>
      }
    >
      <MarkdownImpl {...props} />
    </Suspense>
  );
}
