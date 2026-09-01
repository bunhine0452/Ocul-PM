// ============================================================
// 랜딩이 쓰는 마크다운 부분집합 렌더러 — 의존성 0.
//
// 원래 `build.mjs` 안에 있었다. Phase 8 에서 `/changelog` 가 같은 렌더러를
// 필요로 하면서 밖으로 뺐다 — 두 소비처가 **같은 코드**를 봐야 위키에서 되는
// 표기가 변경 이력에서 조용히 깨지지 않는다.
//
// 지원 (여기 있는 것만 쓴다 — 소스는 우리가 쓰므로):
//   # ## ###  제목 / 문단 / **굵게** *기울임* `코드` [링크](url)
//   ``` 코드펜스 / - 목록 / 1. 목록 / > 인용 / --- 구분선
//   | 표 | (첫 행이 헤더, 둘째 행은 |---| 구분)
//   :::note ~ ::: / :::tip / :::warn  콜아웃 블록
// ============================================================

export const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function inline(s) {
  // 코드 스팬을 먼저 떼어내 보호한다 — 안의 *, [ 가 서식으로 오해되면 안 된다.
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return ` ${codes.length - 1} `;
  });
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const ext = /^https?:\/\//.test(u) && !u.startsWith("https://oculpm.com");
      return `<a href="${u}"${ext ? ' target="_blank" rel="noreferrer"' : ""}>${t}</a>`;
    });
  return s.replace(/ (\d+) /g, (_, i) => codes[+i]);
}

/** 콜아웃 배지 문구. 로케일마다 다르므로 `render` 가 인자로 받는다. */
export const CALLOUT_LABELS = {
  ko: { note: "참고", tip: "팁", warn: "주의" },
  en: { note: "Note", tip: "Tip", warn: "Warning" },
};

/** 블록 래퍼의 클래스 — 위키(wk-*)와 문서 페이지(pg-*)가 서로 다르다. */
const WIKI_CLASSES = { table: "wk-table", code: "wk-code", callout: "wk-callout" };

export function render(md, calloutLabels = CALLOUT_LABELS.ko, classes = WIKI_CLASSES) {
  const cls = { ...WIKI_CLASSES, ...classes };
  const lines = md.split("\n");
  const out = [];
  const toc = [];
  let i = 0;
  const slug = (t) =>
    t.toLowerCase().replace(/`/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    if (line.startsWith("```")) {                        // 코드펜스
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="${cls.code}"><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    const callout = line.match(/^:::(note|tip|warn)\s*(.*)$/); // 콜아웃
    if (callout) {
      const buf = callout[2] ? [callout[2]] : [];
      i++;
      while (i < lines.length && lines[i].trim() !== ":::") buf.push(lines[i++]);
      i++;
      const label = calloutLabels[callout[1]];
      out.push(
        `<div class="${cls.callout} ${callout[1]}"><span class="wk-callout-tag">${label}</span><div>` +
        buf.filter((l) => l.trim()).map((l) => `<p>${inline(l)}</p>`).join("") +
        `</div></div>`,
      );
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);           // 제목
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = slug(text);
      if (level === 2) toc.push({ id, text });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) { out.push("<hr />"); i++; continue; }

    if (line.startsWith("|")) {                          // 표
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(
        `<div class="${cls.table}"><table><thead><tr>` +
        head.map((c) => `<th>${inline(c)}</th>`).join("") +
        `</tr></thead><tbody>` +
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
        `</tbody></table></div>`,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {                            // 인용
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${buf.map((l) => `<p>${inline(l)}</p>`).join("")}</blockquote>`);
      continue;
    }

    const list = line.match(/^(\s*)([-*]|\d+\.)\s+/);    // 목록 (1단 중첩까지)
    if (list) {
      const ordered = /\d+\./.test(list[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!m) break;
        if (m[1].length >= 2 && items.length) items[items.length - 1].kids.push(m[3]);
        else items.push({ text: m[3], kids: [] });
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(
        `<${tag}>` +
        items.map((it) =>
          `<li>${inline(it.text)}${it.kids.length ? `<ul>${it.kids.map((k) => `<li>${inline(k)}</li>`).join("")}</ul>` : ""}</li>`,
        ).join("") +
        `</${tag}>`,
      );
      continue;
    }

    // 문단 — 빈 줄까지 이어 붙인다.
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|:::|\||>|---|(\s*)([-*]|\d+\.)\s)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return { html: out.join("\n"), toc };
}

// ── front-matter ───────────────────────────────────────────
export function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error("front-matter 없음");
  const meta = {};
  for (const l of m[1].split("\n")) {
    const kv = l.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const k of ["title", "desc", "order", "updated"]) {
    if (!meta[k]) throw new Error(`front-matter 에 ${k} 없음`);
  }
  return { meta, body: raw.slice(m[0].length) };
}

// ── 소스 검증 ──────────────────────────────────────────────
// 닫지 않은 코드펜스·콜아웃은 렌더러가 "파일 끝까지 삼키는" 것으로 조용히
// 처리한다 — 페이지 절반이 코드블록 안으로 사라져도 빌드는 성공한다.
// (2026-08-21: en/today.md 에서 실제로 발생. 눈으로 잡았다.)
// 조용한 손실 대신 빌드를 세운다.
export function validate(name, body) {
  const lines = body.split("\n");
  let fence = false;
  let callout = null; // 열린 콜아웃의 줄 번호 (1-based)
  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      fence = !fence;
      return;
    }
    if (fence) return; // 코드블록 안의 ::: 는 콜아웃이 아니다
    const open = line.match(/^:::(note|tip|warn)\b/);
    if (open) {
      if (callout !== null) {
        throw new Error(`${name}: ${callout}번째 줄 콜아웃이 안 닫힌 채 ${i + 1}번째 줄에서 새 콜아웃이 열림`);
      }
      callout = i + 1;
    } else if (line.trim() === ":::") {
      if (callout === null) {
        throw new Error(`${name}: ${i + 1}번째 줄에 짝 없는 \`:::\` 닫기`);
      }
      callout = null;
    }
  });
  if (fence) throw new Error(`${name}: 코드펜스(\`\`\`)가 안 닫혔습니다`);
  if (callout !== null) throw new Error(`${name}: ${callout}번째 줄에서 연 콜아웃이 안 닫혔습니다`);
}
