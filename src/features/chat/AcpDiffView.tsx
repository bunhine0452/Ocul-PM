import { memo, useMemo } from "react";
import type { AcpToolDiff } from "@/lib/bindings";
import { useT } from "@/i18n";
import { diffLines, diffStats, focusWindow, type DiffLine } from "./lineDiff";

// 편집 diff 뷰 — 도구 카드와 승인 카드가 함께 쓴다.
//
// 예전에는 어댑터의 diff 가 "[diff]" 라는 **자리표 문자열**로 버려졌다. 편집을
// 승인하라는 카드가 무엇이 바뀌는지 보여 주지 못했고, 끝난 편집도 어디를
// 고쳤는지 카드에서 알 수 없었다. 이 뷰가 그 공백의 답이다: 줄 비교는
// lineDiff.ts (순수), 여기는 그리기만 한다.

/** 접힌 카드(미리보기)에 보여 줄 줄 수 — 결과 미리보기(4줄)보다 조금 넉넉하게. */
const COMPACT_LINES = 8;

/** 펼친 뷰의 상한. 이 위로는 스크롤보다 "잘렸다"가 정직하다. */
const FULL_LINES = 400;

export const AcpDiffView = memo(function AcpDiffView({
  diffs,
  compact,
}: {
  diffs: readonly AcpToolDiff[];
  /** true 면 첫 변경 지점 둘레 몇 줄만 (접힌 카드의 미리보기 자리). */
  compact?: boolean;
}) {
  return (
    <div className={"diffv" + (compact ? " compact" : "")}>
      {diffs.map((diff, i) => (
        <DiffFile key={`${diff.path}-${i}`} diff={diff} compact={compact} />
      ))}
    </div>
  );
});

function DiffFile({ diff, compact }: { diff: AcpToolDiff; compact?: boolean }) {
  const { t } = useT();
  const lines = useMemo(() => diffLines(diff.old_text, diff.new_text), [diff]);
  const stats = useMemo(() => diffStats(lines), [lines]);
  const window = useMemo(
    () => focusWindow(lines, compact ? COMPACT_LINES : FULL_LINES),
    [lines, compact],
  );

  const name = diff.path.split("/").pop() ?? diff.path;

  return (
    <section className="diffv-file">
      {/* 파일 이름 + 변경 규모. 여러 파일이 한 호출에 실려 와도 구분된다. */}
      <header className="diffv-head">
        <span className="diffv-name">{name}</span>
        <span className="diffv-path" title={diff.path}>
          {diff.path}
        </span>
        <span className="diffv-stat">
          {diff.old_text == null ? (
            <span className="diffv-new">{t("acp.diff.newFile")}</span>
          ) : null}
          {stats.added ? <span className="diffv-add">+{stats.added}</span> : null}
          {stats.removed ? <span className="diffv-del">−{stats.removed}</span> : null}
        </span>
      </header>
      <div className="diffv-body">
        {window.hiddenBefore > 0 ? (
          <div className="diffv-more">{t("acp.diff.moreLines", { n: window.hiddenBefore })}</div>
        ) : null}
        {window.lines.map((line, i) => (
          <DiffRow key={i} line={line} />
        ))}
        {window.hiddenAfter > 0 ? (
          <div className="diffv-more">{t("acp.diff.moreLines", { n: window.hiddenAfter })}</div>
        ) : null}
      </div>
    </section>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  return (
    <div className={"diffv-line " + line.kind}>
      {/* 부호는 복사에 안 딸려 가야 한다 — diff 를 긁어 코드로 붙여 넣는 자리라,
          `+`/`−` 가 섞이면 붙일 때마다 지워야 한다 (CSS user-select:none). */}
      <span className="diffv-sign" aria-hidden="true">
        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
      </span>
      <span className="diffv-text">{line.text || " "}</span>
    </div>
  );
}
