// `/usage` 의 "무엇이 기여했나" 대목을 **읽을 수 있는 모양으로** 뜯는다.
//
// 원래는 원문을 `<pre>` 로 통째로 걸었다. 292px 짜리 카드에 11px 고정폭
// 글자라, 한 문장이 네 줄로 접히고 그중 두 줄이 잘려 보였다 — 정보가 있는데
// 읽히지 않는 상태.
//
// 그래도 **파서가 이겨서는 안 된다**: 항목은 CLI 판올림마다 늘고 문구도 바뀐다.
// 그래서 규칙은 하나뿐이다 — **모르는 줄은 원문 그대로 흘려보낸다**(들여쓰기
// 정렬까지). 뜯어 읽는 것은 지금 확실히 아는 세 모양뿐이고, 나머지는 예전과
// 똑같이 보인다. 조용히 빈칸이 되는 일은 없다.
//
// 실측 원문 (claude 2026-08-20):
//
//     Approximate, based on local sessions on this machine — does not include …
//
//     Last 7d · 4704 requests · 44 sessions
//       92% of your usage was at >150k context
//       48% of your usage came from subagent-heavy sessions
//       Top skills: /frontend-design:frontend-design 2%, /claude-api 1%
//       Top MCP servers: plugin:oculpm:oculpm 4%, oculpm 1%

export type UsageDetailBlock =
  /** 맨 앞의 단서 문장 ("이 수치는 이 컴퓨터의 세션만 본 근사값이다"). */
  | { kind: "note"; text: string }
  /** 기간·요청 수 같은 집계 한 줄 ("Last 7d · 4704 requests · 44 sessions"). */
  | { kind: "stat"; text: string }
  /** "92% of your usage was at >150k context" — 비율 하나와 그 설명. */
  | { kind: "share"; pct: number; text: string }
  /** "Top skills: a 2%, b 1%" — 이름표와 그 아래 항목들. */
  | { kind: "top"; label: string; items: { name: string; pct: number | null }[] }
  /** 못 알아본 줄 — **원문 그대로**(정렬용 공백 포함). */
  | { kind: "text"; text: string };

const SHARE = /^(\d{1,3})%\s+(.+)$/;
const TOP = /^(Top\s+[^:]+):\s*(.+)$/i;
const ITEM = /^(.*?)\s+(\d{1,3})%$/;

/** 줄마다 되풀이되는 군더더기 — 넷 중 셋이 같은 말로 시작해 폭만 먹는다. */
const SHARE_NOISE = /^of your usage\s+/i;

function topOf(line: string): UsageDetailBlock | null {
  const found = TOP.exec(line);
  if (!found) return null;
  const items = found[2].split(",").map((chunk) => {
    const item = ITEM.exec(chunk.trim());
    return item
      ? { name: item[1].trim(), pct: Number(item[2]) }
      : { name: chunk.trim(), pct: null };
  });
  // 하나도 못 읽었으면 우리가 아는 모양이 아니다 — 원문으로 돌려보낸다.
  return items.some((item) => item.pct !== null) ? { kind: "top", label: found[1], items } : null;
}

/** 집계 한 줄인가 — 가운뎃점으로 항목을 잇는 것이 이 줄의 표식이다. */
function isStat(line: string): boolean {
  return line.includes("·") && /\d/.test(line);
}

export function parseUsageDetail(source: string): UsageDetailBlock[] {
  const out: UsageDetailBlock[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const share = SHARE.exec(line);
    if (share) {
      out.push({
        kind: "share",
        pct: Number(share[1]),
        text: share[2].replace(SHARE_NOISE, ""),
      });
      continue;
    }

    const top = topOf(line);
    if (top) {
      out.push(top);
      continue;
    }

    if (isStat(line)) {
      out.push({ kind: "stat", text: line });
      continue;
    }

    // 맨 앞의 못 알아본 줄만 단서 문장으로 본다 — 그 자리에 오는 것이 그것뿐이다.
    // 뒤에 오는 것들은 표일 수 있으므로 정렬 공백을 살려 원문으로 둔다.
    out.push(out.length === 0 ? { kind: "note", text: line } : { kind: "text", text: raw.trimEnd() });
  }
  return out;
}
