// 코드 검색 순수 헬퍼 (검색 업그레이드 2026-08-16). DOM 파싱(markMatchesInHtml)은
// DOMParser 를 쓰므로 webview + jsdom(테스트) 양쪽에서 동작한다.

/** 트리밍 결과 — 오프셋은 content 안 0-based 라인 인덱스. 실제 파일 라인은
 *  호출자가 chunk 의 start_line 을 더해 계산한다. */
export interface TrimResult {
  text: string;
  fromLine: number;
  toLine: number;
  /** 첫 매치 라인 (0-based). 매치 없으면 null. */
  matchLine: number | null;
  totalLines: number;
  truncated: boolean;
}

/**
 * 정확 검색 히트의 스니펫을 첫 매치 라인 중심 ±context 라인 창으로 자른다.
 * 통짜 청크(수십 줄)가 그대로 나열돼 매치가 어디 있는지 보이지 않던 것의 해법.
 * 짧은 청크는 그대로 통과. 매치가 없으면(포맷 차이 등) 앞부분을 보여준다.
 */
export function trimAroundMatch(content: string, query: string, context = 5): TrimResult {
  const lines = content.split("\n");
  const q = query.trim().toLowerCase();
  const matchLine = q ? lines.findIndex((l) => l.toLowerCase().includes(q)) : -1;
  const windowSize = context * 2 + 1;
  if (lines.length <= windowSize) {
    return {
      text: content,
      fromLine: 0,
      toLine: lines.length - 1,
      matchLine: matchLine >= 0 ? matchLine : null,
      totalLines: lines.length,
      truncated: false,
    };
  }
  const center = matchLine >= 0 ? matchLine : 0;
  // 창이 끝에 걸리면 위로 밀어 항상 windowSize 줄을 확보한다.
  const from = Math.max(0, Math.min(center - context, lines.length - windowSize));
  const to = Math.min(lines.length - 1, from + windowSize - 1);
  return {
    text: lines.slice(from, to + 1).join("\n"),
    fromLine: from,
    toLine: to,
    matchLine: matchLine >= 0 ? matchLine : null,
    totalLines: lines.length,
    truncated: from > 0 || to < lines.length - 1,
  };
}

/**
 * highlight.js 가 만든 HTML 안의 텍스트 노드에서 query 를 찾아
 * `<mark class="s-hit">` 로 감싼다. 태그 문자열 치환이 아니라 DOM 텍스트 노드
 * 순회라 속성/토큰 마크업을 깨뜨리지 않는다. 대소문자 무시.
 *
 * 한계: 매치가 하이라이트 토큰 경계에 걸쳐 쪼개진 경우(예: 문자열 안 키워드
 * 색칠)는 표시하지 못한다 — 코드 검색 쿼리는 대부분 식별자 단위라 실용상 충분.
 */
export function markMatchesInHtml(html: string, query: string): string {
  const q = query.trim();
  if (!q) return html;
  const doc = new DOMParser().parseFromString(`<div id="__sroot">${html}</div>`, "text/html");
  const root = doc.getElementById("__sroot");
  if (!root) return html;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  const ql = q.toLowerCase();
  for (const node of texts) {
    const value = node.nodeValue ?? "";
    const lower = value.toLowerCase();
    let i = lower.indexOf(ql);
    if (i === -1) continue;
    const frag = doc.createDocumentFragment();
    let pos = 0;
    while (i !== -1) {
      if (i > pos) frag.appendChild(doc.createTextNode(value.slice(pos, i)));
      const mark = doc.createElement("mark");
      mark.className = "s-hit";
      mark.textContent = value.slice(i, i + q.length);
      frag.appendChild(mark);
      pos = i + q.length;
      i = lower.indexOf(ql, pos);
    }
    if (pos < value.length) frag.appendChild(doc.createTextNode(value.slice(pos)));
    node.parentNode?.replaceChild(frag, node);
  }
  return root.innerHTML;
}

/** 평문을 매치/비매치 세그먼트로 쪼갠다 — 심볼 이름 등 JSX 렌더용 (HTML 불필요). */
export function splitMatch(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let pos = 0;
  let i = lower.indexOf(q);
  while (i !== -1) {
    if (i > pos) out.push({ text: text.slice(pos, i), hit: false });
    out.push({ text: text.slice(i, i + q.length), hit: true });
    pos = i + q.length;
    i = lower.indexOf(q, pos);
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}
