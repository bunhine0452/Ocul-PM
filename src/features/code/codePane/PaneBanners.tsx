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
  reloadFromDisk: () => void;
  overwriteDisk: () => void;
  saving: boolean;
}

export function ConflictBanner({ reloadFromDisk, overwriteDisk, saving }: ConflictBannerProps) {
  return (
    <div className="code-conflict" role="alert">
      <AlertTriangle size={15} className="code-conflict-ico" />
      <div className="code-conflict-text">
        <strong>{t("code.conflict.title")}</strong>
        <span>{t("code.conflict.desc")}</span>
      </div>
      <button type="button" className="btn ghost sm" onClick={reloadFromDisk}>
        {t("code.conflict.reload")}
      </button>
      <button
        type="button"
        className="btn sm code-conflict-overwrite"
        onClick={overwriteDisk}
        disabled={saving}
      >
        {t("code.conflict.overwrite")}
      </button>
    </div>
  );
}
