/**
 * 영수증 한 장을 **자체완결 HTML** 로 (11-23 love-round #reviewer-mode-share-link) — 앱이 없는 동료(매니저 · QA)가
 * 브라우저로 연다. 새 형식이 아니다: `receipt.ts` 가 만든 마크다운을 그 모양 그대로 옮긴다(제목 · 칸 머리 · 줄 ·
 * 꼬리). 그래서 복사한 것과 저장한 것이 같은 말을 한다.
 *
 * 자체완결 — 인라인 CSS 하나, 스크립트 · 글꼴 · 이미지 · 링크 없음, CSP 가 모든 바깥 자원을 막는다. 기기를 떠나는 것은
 * 사람이 저장 대화상자에서 고른 파일 하나뿐이다(백엔드 `save_receipt_html` 이 쓰기 전에 다시 본다).
 * 글자는 전부 이스케이프한다 — 일지 제목에 든 `<` 가 태그가 되지 않게. 색은 예외에만(영수증 규칙 1): ✗ 빨강 · ⚠ 호박.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

/** 줄 안 표식 둘만 — `코드`(기계 글씨) · **굵게**. 이스케이프한 뒤에 바꾼다. */
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

/** 줄 머리 표시 → 칸. 통과는 조용하고 실패 · 통과 뒤 바뀜만 색이 든다. */
function markClass(item: string): string {
  if (item.startsWith("✗")) return "fail";
  if (item.includes("⚠")) return "warn";
  if (item.startsWith("✓")) return "ok";
  return "";
}

/** 영수증 마크다운(`receiptMarkdown` · `journalReceiptMarkdown` 이 내는 모양)을 본문 HTML 로. */
export function receiptBodyHtml(md: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push("</ul>");
    inList = false;
  };
  for (const line of md.split("\n")) {
    const sub = /^<sub>(.*)<\/sub>$/.exec(line);
    if (sub) {
      closeList();
      out.push(`<footer>${escapeHtml(sub[1])}</footer>`);
    } else if (line.startsWith("### ")) {
      closeList();
      out.push(`<h1>${inline(line.slice(4))}</h1>`);
    } else if (/^\*\*[^*]+\*\*$/.test(line)) {
      closeList();
      out.push(`<h2>${inline(line.slice(2, -2))}</h2>`);
    } else if (line.startsWith("- ")) {
      if (!inList) out.push("<ul>");
      inList = true;
      const item = line.slice(2);
      const cls = markClass(item);
      out.push(cls ? `<li class="${cls}">${inline(item)}</li>` : `<li>${inline(item)}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

/**
 * 문서 한 장의 색 — 앱의 토큰(`tokens.css`)은 이 파일에 없으므로 값을 그대로 적는다. CSS 변수 대신 규칙마다 값을 넣는
 * 까닭: 앱 디자인 검사가 정의 없는 `var()` 를 막고, 이 문서의 변수는 앱 안에서 정의되지 않는다.
 */
const LIGHT = { bg: "#fbfbfa", fg: "#1b1d1c", mute: "#5d6360", rule: "#e2e4e2", code: "#f0f1ef", fail: "#c8312b", warn: "#a86400" };
const DARK = { bg: "#121513", fg: "#e6e9e7", mute: "#9aa29e", rule: "#2a2f2c", code: "#1c201e", fail: "#f0716a", warn: "#e0a54a" };

function colorRules(c: typeof LIGHT): string {
  return [
    `body{background:${c.bg};color:${c.fg}}`,
    `h1+p,h2,footer{color:${c.mute}}`,
    `h2,li{border-bottom-color:${c.rule}}`,
    `li.fail{color:${c.fail}}li.warn{color:${c.warn}}`,
    `code{background:${c.code}}`,
  ].join("");
}

const CSS = [
  ":root{color-scheme:light dark}",
  "*{box-sizing:border-box}",
  "body{margin:0;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif}",
  "main{max-width:760px;margin:0 auto;padding:32px 16px 48px}",
  "h1{font-size:18px;font-weight:600;margin:0 0 4px}",
  "h1+p{margin:0 0 8px}",
  "h2{font-size:12px;font-weight:600;margin:24px 0 6px;padding-bottom:4px;border-bottom:1px solid}",
  "ul{list-style:none;margin:0;padding:0}",
  "li{padding:4px 0;border-bottom:1px solid;overflow-wrap:anywhere}",
  "code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;font-variant-ligatures:none;padding:1px 4px;border-radius:3px}",
  "footer{margin-top:24px;font-size:12px}",
  colorRules(LIGHT),
  `@media (prefers-color-scheme:dark){${colorRules(DARK)}}`,
].join("\n");

/** 한 장짜리 문서. `lang` 은 화면 언어 — 브라우저가 글꼴 · 줄바꿈을 고른다. */
export function receiptHtmlDocument(md: string, title: string, lang: string): string {
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(lang)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="generator" content="Ocul">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${CSS}</style>`,
    "</head>",
    "<body>",
    "<main>",
    receiptBodyHtml(md),
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** 저장 대화상자가 처음 보일 이름 — 영수증 제목줄(`### …`)의 뒤쪽에서. 백엔드가 한 번 더 걸러 낸다. */
export function receiptFileName(md: string, fallback: string): string {
  const head = md.split("\n", 1)[0]?.replace(/^###\s*/, "") ?? "";
  const tail = head.includes(" · ") ? head.slice(head.indexOf(" · ") + 3) : head;
  const slug = tail
    .replace(/[`"'“”「」]/g, "")
    .replace(/←/g, "")
    .replace(/[\\/:*?<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${fallback}${slug ? `-${slug}` : ""}.html`;
}
