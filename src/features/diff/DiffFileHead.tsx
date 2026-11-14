/**
 * 변경 화면의 파일 머리줄 (11-15) — 경로 · 종류 · +N/−M · 「다시 바뀜」 · 봤음 · 맡기기 · 보기 방식 ·
 * 공백 무시 · 편집기. `DiffScreenV2` 에서 들어냈다(화면 파일이 배치만 갖게).
 *
 *  - 두 묶음이다: 이것이 무엇인가(경로 · 종류 · 숫자)와 동작. 한 줄에 다 서지 못하면 동작 묶음이 다음 줄로
 *    꺾인다 — 한 줄로 밀어 넣던 때 노트북 반 화면(720 · 864)에서 머리줄이 넘치고 파일 이름 폭이 0 이었다.
 *  - 경로는 폴더 · 파일 두 조각 — 폴더가 먼저 줄어 파일 이름이 끝까지 남는다(끝에서 자르면 이름이 잘렸다).
 *  - 0 인 쪽 숫자는 회색(「−0」 이 빨갛게 섰다), 잘린 diff 면 「이상」.
 *  - 「11:42 에 다시 바뀜」 은 시각만 mono(영수증 규칙 2), 움직이지 않는다(규칙 6).
 *  - 150ms 넘게 걸리는 조회만 「diff 계산 중」 — 본문은 이전 것을 그대로 둔다.
 *  - 두 토글(봤음 · 공백 무시)은 같은 모양이다 — 같은 뜻(aria-pressed + ✓)이 두 모양이었다(규칙 4).
 */
import { CheckMark, ExternalLinkIcon } from "@/components/Icons";
import { LoadingState } from "@/components/LoadingState";
import { RadioSeg } from "@/components/RadioSeg";
import type { DiffMode } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { splitPath } from "@/lib/filePath";
import type { RecentChange } from "@/lib/recentChangesStore";
import type { DiffStats } from "./useDiffFile";

const OP_KEY = { A: "diff.opAdded", M: "diff.opModified", D: "diff.opDeleted" } as const;

/** ms → 「11:42」. */
export function clockOf(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 5);
}

const MARK = "\u0000";

/** 「{time} 에 다시 바뀜」 — 시각만 mono 로. 낱말 차례는 언어마다 달라 사전 문장을 시각 자리에서 가른다. */
function ChangedAgain({ at }: { at: number }) {
  const { t } = useT();
  const [before, after = ""] = t("diff.changedAgain", { time: MARK }).split(MARK);
  return (
    <span className="chg-again">
      {before}
      <span className="mono">{clockOf(at)}</span>
      {after}
    </span>
  );
}

export function DiffFileHead({
  selected,
  current,
  stats,
  changedAt,
  slow,
  viewed,
  mode,
  ignoreWhitespace,
  wsBlocked,
  onToggleViewed,
  onAsk,
  onMode,
  onIgnoreWhitespace,
  onOpenEditor,
}: {
  selected: string | null;
  current: RecentChange | null;
  stats: DiffStats | null;
  changedAt: number | null;
  slow: boolean;
  viewed: boolean;
  mode: DiffMode;
  ignoreWhitespace: boolean;
  /** 공백 무시가 이 본문에 걸리지 않는 이유(스냅샷 · 새 파일) — 있으면 토글을 막고 이유를 말한다. */
  wsBlocked: string | null;
  onToggleViewed: () => void;
  onAsk: () => void;
  onMode: (mode: DiffMode) => void;
  onIgnoreWhitespace: (next: boolean) => void;
  onOpenEditor: () => void;
}) {
  const { t } = useT();
  const { dir, base } = selected ? splitPath(selected, "", Infinity) : { dir: "", base: "—" };
  return (
    <div className="chg-fh">
      <div className="chg-fh-id">
        <b className="chg-fname" title={selected ?? undefined}>
          {dir ? (
            <span className="chg-fdir">
              <bdi>{dir}</bdi>
            </span>
          ) : null}
          <span className="chg-fbase">{base}</span>
        </b>
        {current ? <span className="chip sm">{t(OP_KEY[current.op])}</span> : null}
        {stats ? (
          <span className="diff-stat" title={stats.atLeast ? t("diff.statsMoreTitle") : t("diff.statsTitle")}>
            <span className={stats.add ? "add" : "zero"}>+{stats.add}</span>
            <span className={stats.del ? "del" : "zero"}>−{stats.del}</span>
            {stats.atLeast ? <span className="more">{t("diff.statsMore")}</span> : null}
          </span>
        ) : null}
        {changedAt != null ? <ChangedAgain at={changedAt} /> : null}
        {slow ? (
          <LoadingState density="compact" align="start" className="chg-fh-wait">
            {t("diff.computing")}
          </LoadingState>
        ) : null}
      </div>
      <div className="chg-fh-act">
        {selected ? (
          <>
            <button
              type="button"
              className="btn sm"
              aria-pressed={viewed}
              title={t("diff.viewedTitle")}
              onClick={onToggleViewed}
            >
              {viewed ? <CheckMark size={13} aria-hidden="true" /> : null}
              {t("diff.viewed")}
            </button>
            <button type="button" className="btn sm" onClick={onAsk}>
              {t("diff.askFile")}
            </button>
          </>
        ) : null}
        <RadioSeg<DiffMode>
          label={t("diff.viewAria")}
          value={mode}
          options={[
            { id: "unified", label: t("diff.viewUnified") },
            { id: "split", label: t("diff.viewSplit") },
          ]}
          onChange={onMode}
        />
        <button
          type="button"
          className="btn sm"
          aria-pressed={ignoreWhitespace}
          {...blocked(wsBlocked, t("diff.ignoreWhitespaceTitle"))}
          onClick={() => onIgnoreWhitespace(!ignoreWhitespace)}
        >
          {ignoreWhitespace ? <CheckMark size={13} aria-hidden="true" /> : null}
          {t("diff.ignoreWhitespace")}
        </button>
        <button
          type="button"
          className="iconbtn sm"
          onClick={onOpenEditor}
          {...blocked(selected ? null : t("diff.blockedNoFile"), t("diff.openEditor"))}
          aria-label={t("diff.openEditor")}
        >
          <ExternalLinkIcon size={15} />
        </button>
      </div>
    </div>
  );
}
