/**
 * 세션 상태 띠 — 칸 위에 겹치는 한 줄, **예외일 때만** (영수증 규칙 1).
 *
 *  - 내 손을 기다린다: 까닭 한 줄(「approve Write: …」). 답은 터미널에서 한다.
 *  - 일지 없이 손을 놓았다: 「일지 없음」 + 「기록 남기게 하기」 — 오늘의 「다음」 이 여는 claude 세션 하나가
 *    가장 흔한 배치인데, 세션이 하나면 「일지 없음」 이 어디에도 안 떴다. 코드를 안 바꾼 문답이면 ×로 접는다
 *    — 접지 못하던 때는 턴 사이 내내 앰버 띠가 Claude 화면 윗줄을 덮고 있었다. 다음 차례가 끝나면 다시 선다.
 *  - 끝났다: 「끝남 · 코드 n」(0 이 아니면 빨강) + 「다시 열기」 + 「닫기」 — 닫기뿐인 막다른 길이었다.
 *
 * 줄로 끼우지 않고 `.tm-pane` 안에 겹친다(`PaneTree`) — 띠가 서고 질 때마다 터미널 높이가 31px 바뀌어
 * 허락 한 번에 Claude 화면이 두 번 다시 그려졌다. 격자 크기는 그대로다.
 */
import type { TermInfo } from "@/api/terminal";
import { X } from "@/components/Icons";
import { useT } from "@/i18n";
import { createStore } from "@/lib/createStore";
import { sessionLabel, type SessionView } from "./status";

export interface StatusBandProps {
  info: TermInfo;
  view: SessionView;
  /** 「다시 열기」 가 claude 대화를 잇는가 — 툴팁이 실제로 일어날 일을 말한다. */
  resumes: boolean;
  onAskRecord: (id: number) => void;
  onReopen: (id: number) => void;
  onClose: (id: number) => void;
}

/**
 * 「일지 없음」 띠를 접은 세션. Claude 가 다시 일을 시작하면(working) 편다 — 그 차례가 끝나 여전히 일지가 없으면
 * 다시 선다. 창(웹뷰) 하나에 하나 — 화면을 오가도 접은 채로 남는다.
 */
const folded = createStore<ReadonlySet<number>>(new Set());

/** 세션 목록이 바뀔 때마다 — 다시 일하는(또는 닫힌) 세션의 접음을 거둔다. 화면이 모든 세션을 넘긴다. */
export function unfoldWorking(list: readonly TermInfo[]): void {
  const cur = folded.get();
  if (cur.size === 0) return;
  const next = new Set([...cur].filter((id) => list.some((s) => s.id === id && s.status?.state !== "working")));
  if (next.size !== cur.size) folded.set(next);
}

/** 테스트 전용 — 창 하나의 수명을 흉내 낸다. */
export function __resetStatusBandForTests() {
  folded.set(new Set());
}

/** 띠가 설 일이 있는가 — 기다림 · 일지 없음 · 끝남. (접은 「일지 없음」 은 띠가 따로 가린다.) */
export function hasBand(info: TermInfo, view: SessionView): boolean {
  return !info.alive || view.mark === "wait" || view.norec;
}

export function StatusBand({ info, view, resumes, onAskRecord, onReopen, onClose }: StatusBandProps) {
  const { t } = useT();
  const foldedIds = folded.useValue();
  if (!hasBand(info, view)) return null;
  const ended = !info.alive;
  const waiting = view.mark === "wait";
  // 살아 있는 세션의 「일지 없음」 만 접힌다 — 기다림 · 끝남은 사람이 할 일이 남아 있다.
  const norecLive = view.norec && !ended && !waiting;
  if (norecLive && foldedIds.has(info.id)) return null;
  const msg = waiting ? info.status?.msg : null;
  const fold = () => folded.update((s) => new Set(s).add(info.id));
  return (
    <div className={"tm-band" + (waiting || norecLive ? " is-warn" : "") + (ended ? " is-ended" : "")} role="status">
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
      {norecLive ? (
        <>
          <button type="button" className="btn sm" onClick={() => onAskRecord(info.id)}>
            {t("terminal.askRecord")}
          </button>
          <button
            type="button"
            className="iconbtn sm"
            aria-label={t("terminal.bandFold")}
            title={t("terminal.bandFoldTitle")}
            onClick={fold}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </>
      ) : null}
      {ended ? (
        <>
          <button
            type="button"
            className="btn sm"
            title={t(resumes ? "terminal.reopenResumeTitle" : "terminal.reopenTitle")}
            onClick={() => onReopen(info.id)}
          >
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
