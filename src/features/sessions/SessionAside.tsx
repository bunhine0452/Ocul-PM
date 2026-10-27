import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useDensity } from "@/hooks/useDensity";
import { useT } from "@/i18n";
import type { JournalEntrySummary, SessionUnrecorded } from "@/lib/bindings";

/**
 * 「이 터미널과 기록」 — 터미널·에이전트 화면 오른쪽 열 (UI 밀도 라운드 2).
 *
 * 에이전트가 일하는 자리 옆에 기록의 상태를 둔다: 오늘 일지가 몇 건인지, 에이전트가
 * 고치고 적지 않은 파일이 무엇인지. 둘 다 이미 있는 판정(`compare_workday` · 일지 목록)
 * 이고 이 열은 그것을 **일하는 자리 옆**으로 옮길 뿐이다. 간단 밀도에선 접힌 채
 * 시작하고 전문은 펼쳐진다 — 자료는 어느 쪽에서도 DOM 에 있다.
 *
 * 실패는 「모름」으로 남긴다 — 빈 목록과 같은 얼굴을 하지 않는다.
 */
export function SessionAside({ projectId, workday }: { projectId: number | null; workday: string | null }) {
  const { t } = useT();
  const { density } = useDensity();
  const [entries, setEntries] = useState<JournalEntrySummary[] | null>(null);
  const [rows, setRows] = useState<SessionUnrecorded[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (projectId == null || !workday) return;
    let cancelled = false;
    setFailed(false);
    void Promise.all([
      oculpmApi.listJournalEntries(projectId, workday),
      oculpmApi.compareWorkday(projectId, workday),
    ])
      .then(([list, cmp]) => {
        if (cancelled) return;
        setEntries(list);
        setRows(cmp.sessions);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, workday]);

  if (projectId == null || !workday) return null;
  const unrecorded = Array.from(new Set((rows ?? []).flatMap((r) => r.unrecorded)));
  const last = entries?.[0] ?? null;

  return (
    <details className="session-aside" open={density === "pro" || open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <b>{t("session.aside.title")}</b>
        <span className="hint">
          {entries ? t("session.aside.summary", { n: entries.length, u: unrecorded.length }) : failed ? t("session.aside.unknown") : "…"}
        </span>
      </summary>
      <div className="session-aside-body">
        <section className="card card-pad">
          <div className="sa-head">{t("session.aside.journals", { n: entries?.length ?? 0 })}</div>
          {last ? (
            <div className="sa-line">{last.title}</div>
          ) : entries ? (
            <div className="sa-line warn">{t("session.aside.noJournal")}</div>
          ) : failed ? (
            <div className="sa-line">{t("session.aside.unknown")}</div>
          ) : null}
        </section>
        <section className="card card-pad">
          <div className="sa-head">{t("session.aside.unrecorded", { n: unrecorded.length })}</div>
          {unrecorded.length > 0 ? (
            <ul className="sa-files">
              {unrecorded.slice(0, 6).map((f) => (
                <li key={f} className="mono">{f}</li>
              ))}
              {unrecorded.length > 6 ? <li>{t("session.aside.moreFiles", { n: unrecorded.length - 6 })}</li> : null}
            </ul>
          ) : rows ? (
            <div className="sa-line">{t("session.aside.allRecorded")}</div>
          ) : failed ? (
            <div className="sa-line">{t("session.aside.unknown")}</div>
          ) : null}
          <div className="sa-note">{t("session.aside.note")}</div>
        </section>
      </div>
    </details>
  );
}
