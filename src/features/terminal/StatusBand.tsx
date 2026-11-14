/**
 * 세션 상태 띠 — 칸 위에 겹치는 한 줄, **예외일 때만** (영수증 규칙 1).
 *
 *  - 내 손을 기다린다: 까닭 한 줄(「approve Write: …」). 답은 터미널에서 한다.
 *  - 일지 없이 손을 놓았다: 「일지 없음」 + 「기록 남기게 하기」 — 오늘의 「다음」 이 여는 claude 세션 하나가
 *    가장 흔한 배치인데, 세션이 하나면 「일지 없음」 이 어디에도 안 떴다.
 *  - 끝났다: 「끝남 · 코드 n」(0 이 아니면 빨강) + 「다시 열기」 + 「닫기」 — 닫기뿐인 막다른 길이었다.
 *
 * 줄로 끼우지 않고 `.tm-pane` 안에 겹친다(`PaneTree`) — 띠가 서고 질 때마다 터미널 높이가 31px 바뀌어
 * 허락 한 번에 Claude 화면이 두 번 다시 그려졌다. 격자 크기는 그대로다.
 */
import type { TermInfo } from "@/api/terminal";
import { useT } from "@/i18n";
import { sessionLabel, type SessionView } from "./status";

export interface StatusBandProps {
  info: TermInfo;
  view: SessionView;
  onAskRecord: (id: number) => void;
  onReopen: (id: number) => void;
  onClose: (id: number) => void;
}

/** 띠가 설 일이 있는가 — 기다림 · 일지 없음 · 끝남. */
export function hasBand(info: TermInfo, view: SessionView): boolean {
  return !info.alive || view.mark === "wait" || view.norec;
}

export function StatusBand({ info, view, onAskRecord, onReopen, onClose }: StatusBandProps) {
  const { t } = useT();
  if (!hasBand(info, view)) return null;
  const ended = !info.alive;
  const waiting = view.mark === "wait";
  const msg = waiting ? info.status?.msg : null;
  return (
    <div
      className={"tm-band" + (waiting || (view.norec && !ended) ? " is-warn" : "") + (ended ? " is-ended" : "")}
      role="status"
    >
      {ended || waiting ? (
        <span className={"tm-band-word" + (view.tone ? " is-" + view.tone : "")}>{view.word}</span>
      ) : null}
      {msg ? <span className="tm-band-msg">{msg}</span> : null}
      {view.norec ? (
        <span className="tm-band-word is-warn" title={t("terminal.noRecordTitle")}>
          {t("terminal.noRecord")}
        </span>
      ) : null}
      <span className="tm-band-sp" />
      {view.norec && !ended ? (
        <button type="button" className="btn sm" onClick={() => onAskRecord(info.id)}>
          {t("terminal.askRecord")}
        </button>
      ) : null}
      {ended ? (
        <>
          <button type="button" className="btn sm" title={t("terminal.reopenTitle")} onClick={() => onReopen(info.id)}>
            {t("terminal.reopen")}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            aria-label={t("terminal.closeAria", { name: sessionLabel(t, info) })}
            onClick={() => onClose(info.id)}
          >
            {t("common.close")}
          </button>
        </>
      ) : null}
    </div>
  );
}
