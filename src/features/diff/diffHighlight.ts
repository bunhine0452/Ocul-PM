/**
 * diff 줄 강조 (11-15 #diff-perf) — 덩이마다 옛 쪽 · 새 쪽 텍스트를 **한 번씩** 강조하고 줄로 자른다.
 *
 * 예전엔 줄마다 따로 hljs 를 돌렸다: 2,000줄이면 2,000번이고, 여러 줄 주석(`/** … *\/`)의 가운데
 * 줄은 주석인 줄 모르고 숫자 · 키워드 색으로 칠해졌다. 한 쪽을 통째로 돌리면 문맥이 이어지고, 줄을
 * 넘는 span 은 줄 끝에서 닫고 다음 줄 앞에서 다시 연다.
 */
import type { Hljs } from "@/lib/hljs";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 강조한 HTML 을 줄로 — 열린 span 은 줄 끝에서 닫고 다음 줄 앞에서 다시 연다. */
export function splitHtmlLines(html: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  let cur = "";
  for (const [tok] of html.matchAll(/<[^>]*>|\n|[^<\n]+/g)) {
    if (tok === "\n") {
      out.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
    } else if (tok.startsWith("</")) {
      open.pop();
      cur += tok;
    } else if (tok.startsWith("<")) {
      open.push(tok);
      cur += tok;
    } else {
      cur += tok;
    }
  }
  out.push(cur + "</span>".repeat(open.length));
  return out;
}

/** 한 쪽의 줄들을 한 번에 강조해 줄마다 HTML. 언어를 모르거나 실패하면 `null` — 부르는 쪽이 평문으로. */
export function highlightLines(hljs: Hljs | null, lang: string | null, lines: readonly string[]): string[] | null {
  if (!hljs || !lang || lines.length === 0 || !hljs.getLanguage(lang)) return null;
  try {
    const html = hljs.highlight(lines.join("\n"), { language: lang, ignoreIllegals: true }).value;
    const split = splitHtmlLines(html);
    return split.length === lines.length ? split : null;
  } catch {
    return null;
  }
}
