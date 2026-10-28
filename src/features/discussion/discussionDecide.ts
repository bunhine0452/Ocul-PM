import { appendLogRowOp, insertInSectionOp, localIsoWithOffset } from "./mdEdit";
import { logColumns, sectionHeadings } from "./discussionTemplates";

/**
 * 「X 로 결정」이 문서에 남기는 것 — 결론 절 한 줄 + 토의 로그 한 행 (UI 밀도 라운드 3).
 * 순수 함수다: 읽은 원문을 받아 다음 원문을 돌려준다. 쓰기와 잠금은 화면이 한다.
 */
export function buildDecisionBody(body: string, author: string, line: string, now = new Date()): string {
  const headings = sectionHeadings();
  const op = insertInSectionOp(body, "conclusion", line, { heading: headings.conclusion });
  const withConclusion = body.slice(0, op.from) + op.insert + body.slice(op.to);
  const log = appendLogRowOp(withConclusion, {
    author,
    ts: localIsoWithOffset(now),
    body: line,
    heading: headings.log,
    columns: logColumns(),
  });
  return withConclusion.slice(0, log.from) + log.insert + withConclusion.slice(log.to);
}
