// 로컬 히스토리 팝오버 — 브레드크럼 시계 칩 아래 (06-local-history.md §UI).
//
// 새 화면을 만들지 않는다. 일지 팝오버(`.code-jrnl-pop`)와 같은 자리·같은
// 뼈대를 쓰고, 행을 누르면 **이미 있는 인라인 비교**로 들어간다. 되돌리기는
// 비교 배너에 있다 — 목록에서 바로 되돌리면 무엇으로 바뀌는지 못 보고 누른다.
import { useMemo } from "react";

import type { CodeHistoryVersion } from "@/api/codeHistory";
import { formatBytes, relativeTime } from "@/lib/format";
import { useT } from "@/i18n";

/** 판 하나의 시각 라벨 — 오늘 것은 시:분:초, 그 밖은 날짜까지. */
export function versionTimeLabel(ts: string, now: number): string {
  const ms = Number(ts);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return sameDay ? time : `${d.toLocaleDateString()} ${time}`;
}

export function CodeHistory({
  versions,
  onPick,
  onForget,
}: {
  versions: CodeHistoryVersion[];
  onPick: (version: CodeHistoryVersion) => void;
  onForget: () => void;
}) {
  const { t } = useT();
  // 목록 전체가 같은 기준으로 계산돼야 렌더 도중 분이 넘어가며 흔들리지 않는다.
  const now = useMemo(() => Date.now(), [versions]);

  return (
    <div className="code-jrnl-pop code-hist-pop" role="menu" aria-label={t("code.hist.title")}>
      <div className="code-jrnl-pop-head">{t("code.hist.title")}</div>
      {versions.length === 0 ? (
        <div className="code-hist-empty">{t("code.hist.empty")}</div>
      ) : null}
      {versions.map((v) => (
        <div key={v.ts} className="code-jrnl-row">
          <button
            type="button"
            className="code-jrnl-open"
            role="menuitem"
            onClick={() => onPick(v)}
            title={t("code.hist.open")}
          >
            <span className={"code-hist-src s-" + v.source} aria-hidden />
            <span className="code-jrnl-title">{versionTimeLabel(v.ts, now)}</span>
            <span className="code-jrnl-meta">
              {v.source === "user" ? t("code.hist.user") : t("code.hist.agent")} ·{" "}
              {formatBytes(v.bytes)} · {relativeTime(Number(v.ts), now)}
            </span>
          </button>
        </div>
      ))}
      {/* 민감한 파일이 한 번 들어왔을 때 빠져나갈 문. 설정 화면까지 가지 않는다. */}
      <button type="button" role="menuitem" className="code-hist-forget" onClick={onForget}>
        {t("code.hist.forget")}
      </button>
    </div>
  );
}
