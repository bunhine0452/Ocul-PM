import { Clipboard, ShieldCheck } from "@/components/Icons";
import { useT } from "@/i18n";
import { kbd } from "@/lib/kbd";
import { toast } from "@/lib/toast";
import { evidenceInbox } from "@/features/oculpm/evidenceInbox";
import { lastResultLine, type LastResult } from "./lastResultStore";

/**
 * 결과 끝 줄 — 마지막으로 끝난 명령의 `명령 · 결과 끝 줄 · exit N` 한 줄 (시안 Terminal).
 *
 * xterm 그리드는 줄 사이에 DOM 을 끼울 수 없으니(블록 접기 불가, commandBlocks.ts) 그 손잡이는
 * 캔버스 아래 한 줄에 선다. 「검증 칸으로」는 받은함(`evidenceInbox`)에 넣고 클립보드에도 복사한다
 * — 다음 수동 일지의 검증 칸에 미리 들어가고, 에이전트 일지에는 사람이 붙인다. ⇧⌘J 가 같은 일을 한다.
 */
export function TerminalResultBar({
  result,
  projectId,
  outputOf,
}: {
  result: LastResult;
  projectId: number | null;
  /** 지금 살아 있는 페인의 출력 전체 — 「출력 복사」. 없으면 버튼을 안 그린다. */
  outputOf?: (sid: string) => string | null;
}) {
  const { t } = useT();
  const line = lastResultLine(result);
  const failed = result.exitCode != null && result.exitCode !== 0;
  const toEvidence = () => {
    if (projectId != null) evidenceInbox.push(projectId, line);
    void navigator.clipboard?.writeText(line).then(() => toast.info(t("term.block.copiedVerification")));
  };
  const copyOutput = () => {
    const out = outputOf?.(result.sid);
    if (!out) {
      toast.info(t("term.block.nothingToCopy"));
      return;
    }
    void navigator.clipboard?.writeText(out).then(() => toast.info(t("term.block.copiedOutput")));
  };
  return (
    <div className="term-result" data-tone={failed ? "fail" : "ok"} role="status">
      <ShieldCheck size={13} aria-hidden="true" />
      <b>{failed ? t("term.result.failed") : t("term.result.title")}</b>
      <span className="term-result-line mono" title={line}>
        {line}
      </span>
      <span className="term-result-fill" />
      <button type="button" className="term-result-btn primary" onClick={toEvidence} title={t("term.result.toEvidenceHint")}>
        {t("term.result.toEvidence")} <kbd>{kbd("⇧⌘J")}</kbd>
      </button>
      {outputOf ? (
        <button type="button" className="term-result-btn" onClick={copyOutput}>
          <Clipboard size={11} /> {t("term.block.copyOutput")}
        </button>
      ) : null}
    </div>
  );
}
