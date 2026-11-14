/**
 * 규칙 22 의 판정 — 액센트 후광(--accent-ring · --ring-soft)은 포커스 테에만 (11-15).
 *
 * `check-design-discipline.mjs` 에서 떼어 낸 이유는 하나다: 게이트 스크립트는 import 하는 순간 저장소 전체를
 * 돌고 끝나 버려 판정을 시험으로 물 길이 없었다. 그래서 시험이 「게이트에 함수 이름이 있는가」 만 봤고, 몸통을
 * 비워도 초록이었다. 이제 게이트와 시험(`src/__tests__/primitives_v2.test.ts`)이 이 순수 함수 하나를 나눠 쓴다
 * (`file-size-policy.mjs` 와 같은 관용구). 규칙의 사유는 게이트 머리 주석의 22.
 *
 * 의존성 0, Node 18+.
 */

const RING = /var\(\s*--(?:accent-ring|ring-soft)\b/;
const FOCUS = /:focus(?:-visible|-within)?\b/;

/**
 * 한 파일의 위반 — `[{ line, what }]`.
 *
 * @param {string} src 주석을 지운 소스 (줄 수는 원본과 같다 — 게이트의 stripComments)
 * @param {string[]} rawLines 원본 줄. `design-ignore --` 탈출구는 주석 안에 적으니 여기서 찾는다
 * @param {boolean} isCss
 * @returns {{ line: number, what: string }[]}
 */
export function accentRingHits(src, rawLines, isCss) {
  const hits = [];
  const lineAt = (index) => src.slice(0, index).split("\n").length;
  // 선언 줄과 그 앞 3줄 — 게이트의 다른 여러 줄 규칙과 같은 규약.
  const ignoredNear = (line) => {
    for (let i = Math.max(1, line - 3); i <= line; i++) {
      if (/design-ignore\s*--/.test(rawLines[i - 1] ?? "")) return true;
    }
    return false;
  };

  if (!isCss) {
    // TSX 인라인은 포커스를 알 길이 없어 그 자체로 위반이다. 값은 따옴표 안의 쉼표(겹 그림자 `a, b`)를 건너
    // 속성 끝까지 본다 — 쉼표에서 멈추면 둘째 겹의 후광을 놓친다.
    for (const m of src.matchAll(/boxShadow\s*:\s*((?:"[^"\n]*"|'[^'\n]*'|`[^`]*`|[^,}\n"'`])*)/g)) {
      if (!RING.test(m[1])) continue;
      const line = lineAt(m.index);
      if (!ignoredNear(line)) hits.push({ line, what: "인라인 boxShadow 가 액센트 후광을 쓴다" });
    }
    return hits;
  }

  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = m;
    const bodyAt = m.index + selector.length + 1;
    // 블록 안의 box-shadow 선언 **모두** — 첫 선언만 보면 뒤에서 덮어쓴 후광을 놓친다.
    const rings = [...body.matchAll(/(?:^|[;{\s])box-shadow\s*:\s*([^;}]+)/g)].filter((d) => RING.test(d[1]));
    if (rings.length === 0) continue;
    // 쉼표로 나뉜 조각 **모두**에 포커스가 있어야 한다 — 하나라도 빠지면 그 조각에서는 늘 켜진 후광이다.
    // `:not(:focus)` 안의 포커스는 포커스가 아니다(포커스가 **없을 때** 켜진다).
    const parts = selector.trim().split("\n").filter((l) => !l.trim().startsWith("@")).join(" ").split(",");
    if (parts.every((p) => FOCUS.test(p.replace(/:not\([^()]*\)/g, "")))) continue;
    const last = selector.trim().split("\n").pop().trim();
    for (const d of rings) {
      const line = lineAt(bodyAt + d.index + d[0].indexOf("box-shadow"));
      if (ignoredNear(line)) continue;
      hits.push({ line, what: `${last} { box-shadow: ${d[1].trim().slice(0, 60)} }` });
    }
  }
  return hits;
}
