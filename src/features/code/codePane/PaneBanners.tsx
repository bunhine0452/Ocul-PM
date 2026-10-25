// 편집기 위의 상태 띠 둘 — 비교 모드 배너(무엇과 비교 중인지·나가는 길)와 충돌 배너
// (디스크가 앞서 갔다 — 다시 읽기 / 덮어쓰기). `CodePane.tsx` 에서 그대로 들어냈다.
import { t } from "@/i18n";
import { AlertTriangle, GitCompareArrows, X } from "@/components/Icons";

import type { DiffMode } from "./types";

interface DiffBannerProps {
  diffMode: DiffMode;
  openJournal: (journalPath: string) => void;
  restoreVersion: () => Promise<void>;
  exitDiff: () => void;
}

/** 비교 모드 배너 — 지금 무엇과 비교 중인지, 나가는 길. */
export function DiffBanner({ diffMode, openJournal, restoreVersion, exitDiff }: DiffBannerProps) {
  return (
    <div className="code-diffbar" role="status">
      <GitCompareArrows size={13} className="code-diffbar-ico" />
      <span className="code-diffbar-label">
        {diffMode.kind === "head"
          ? t("code.diff.banner.head")
          : diffMode.kind === "disk"
            ? t("code.diff.banner.disk")
            : diffMode.kind === "entry"
            ? t("code.diff.banner.entry", { title: diffMode.title })
            : t("code.diff.banner.history", { time: diffMode.label })}
      </span>
      {diffMode.kind === "entry" ? (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => openJournal(diffMode.journalPath)}
        >
          {t("code.jrnl.open")}
        </button>
      ) : null}
      {diffMode.kind === "history" ? (
        <button type="button" className="btn ghost sm" onClick={() => void restoreVersion()}>
          {t("code.hist.restore")}
        </button>
      ) : null}
      <button type="button" className="code-diffbar-exit" onClick={exitDiff} aria-label={t("code.diff.exit")} title={t("code.diff.exit")}>
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}

interface ConflictBannerProps {
  /** 디스크에 파일이 없다 — 바깥에서 지워졌다 (`code_write` 의 빈 `disk_hash`). */
  gone: boolean;
  /** 지금 디스크 판과 겹쳐 보는 중인가 — 그때는 「비교」 대신 비교 띠가 나가는 길을 준다. */
  comparing: boolean;
  compareWithDisk: () => void;
  reloadFromDisk: () => void;
  overwriteDisk: () => void;
  saving: boolean;
}

/**
 * 바깥 변경 띠 — 디스크가 앞서 갔거나(에이전트가 고쳤다) 아예 사라졌다.
 *
 * 2026-10-25 Orca 벤치마크: 고르기 전에 **무엇이 다른지 볼 수 있어야** 한다 —
 * 「바뀐 곳 비교」가 디스크 판을 원본으로 인라인 비교를 연다. 지워진 파일은 예전에
 * 토스트 한 번이 전부라 저장하면 오류만 났다; 이제 같은 자리에 다시 만들 수 있다.
 */
export function ConflictBanner({
  gone,
  comparing,
  compareWithDisk,
  reloadFromDisk,
  overwriteDisk,
  saving,
}: ConflictBannerProps) {
  return (
    <div className="code-conflict" role="alert">
      <AlertTriangle size={15} className="code-conflict-ico" />
      <div className="code-conflict-text">
        <strong>{t(gone ? "code.conflict.goneTitle" : "code.conflict.title")}</strong>
        <span>{t(gone ? "code.conflict.goneDesc" : "code.conflict.desc")}</span>
      </div>
      {gone ? null : (
        <>
          {comparing ? null : (
            <button type="button" className="btn sm" onClick={compareWithDisk}>
              <GitCompareArrows size={13} /> {t("code.conflict.compare")}
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={reloadFromDisk}>
            {t("code.conflict.reload")}
          </button>
        </>
      )}
      <button
        type="button"
        className="btn sm code-conflict-overwrite"
        onClick={overwriteDisk}
        disabled={saving}
      >
        {t(gone ? "code.conflict.recreate" : "code.conflict.overwrite")}
      </button>
    </div>
  );
}
