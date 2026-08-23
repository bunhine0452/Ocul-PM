// 한 줄짜리 텍스트(플래너 항목 제목·메모, 단계 이름)를 위한 **인라인 전용**
// 마크다운 파서.
//
// 왜 `react-markdown` 을 쓰지 않나: 그쪽은 블록 렌더러라 `<p>` 를 만들고
// (≈141KB 청크를 lazy 로 끌어온다), 제목이 칩·버튼과 한 줄에 흘러야 하는
// 자리에는 맞지 않는다. 여기서 필요한 건 `**굵게**` / `` `코드` `` 정도의
// 강조뿐이라 작은 스캐너로 충분하다.
//
// 의도적으로 **`_` 강조는 지원하지 않는다**: 플래너 항목에는
// `plan_apply_edit`, `in_progress` 같은 snake_case 식별자가 널려 있어
// `_apply_` 가 기울임으로 잡히는 오탐이 강조 이득보다 훨씬 크다.
// 링크도 `http(s):` / `mailto:` 만 링크로 승격한다 (`javascript:` 차단).

/** 인라인 노드 — 트리는 얕고, 텍스트 잎만 실제 문자열을 들고 있다. */
export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "em"; children: InlineNode[] }
  | { kind: "del"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] };

// 각 가지의 안쪽은 "공백으로 시작·끝나지 않는다" 를 강제한다 (CommonMark 의
// flanking 규칙 근사). 그래야 `2 * 3 * 4` 나 `a ** b` 가 강조로 새지 않는다.
// 룩비하인드는 쓰지 않는다 — 구형 WKWebView 에서 파싱 자체가 깨진다.
const INLINE_SOURCE =
  "(`+)([\\s\\S]+?)\\1" + // 1,2 코드 (같은 개수의 백틱으로 닫음)
  "|\\*\\*([^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*\\*" + // 3 굵게
  "|~~([^\\s~](?:[\\s\\S]*?[^\\s~])?)~~" + // 4 취소선
  "|\\*([^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*" + // 5 기울임
  "|\\[([^\\][]*)\\]\\(((?:https?:|mailto:)[^\\s)]+)\\)"; // 6,7 링크

/** 강조 안의 강조까지만 판다 — 병적인 입력에서 재귀가 폭주하지 않도록. */
const MAX_DEPTH = 3;

/** 코드 스팬 양끝의 공백 한 칸씩은 구분자다 (CommonMark). */
function trimCodeFence(value: string): string {
  if (value.length > 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") {
    return value.slice(1, -1);
  }
  return value;
}

/** 인라인 마크다운을 노드 목록으로 판다. 문법이 없으면 텍스트 노드 하나. */
export function parseInlineMarkdown(src: string, depth = 0): InlineNode[] {
  if (!src) return [];
  if (depth > MAX_DEPTH) return [{ kind: "text", value: src }];

  // 정규식은 매번 새로 만든다 — `lastIndex` 는 재귀 호출과 공유되면 안 된다.
  const re = new RegExp(INLINE_SOURCE, "g");
  const out: InlineNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: "text", value: src.slice(last, m.index) });

    if (m[2] !== undefined) {
      // 코드 안쪽은 문자 그대로다 — 더 파지 않는다.
      out.push({ kind: "code", value: trimCodeFence(m[2]) });
    } else if (m[3] !== undefined) {
      out.push({ kind: "strong", children: parseInlineMarkdown(m[3], depth + 1) });
    } else if (m[4] !== undefined) {
      out.push({ kind: "del", children: parseInlineMarkdown(m[4], depth + 1) });
    } else if (m[5] !== undefined) {
      out.push({ kind: "em", children: parseInlineMarkdown(m[5], depth + 1) });
    } else if (m[7] !== undefined) {
      out.push({ kind: "link", href: m[7], children: parseInlineMarkdown(m[6] ?? "", depth + 1) });
    }

    last = re.lastIndex;
  }

  if (last < src.length) out.push({ kind: "text", value: src.slice(last) });
  return out;
}

/** 문법 기호를 걷어낸 순수 텍스트 — `title=` 툴팁·검색·정렬용. */
export function stripInlineMarkdown(src: string): string {
  const walk = (nodes: InlineNode[]): string =>
    nodes
      .map((n) => (n.kind === "text" || n.kind === "code" ? n.value : walk(n.children)))
      .join("");
  return walk(parseInlineMarkdown(src));
}
