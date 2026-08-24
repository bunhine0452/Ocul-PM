// 모바일 논의 — 목록 → 상세 + 로그 한 줄 추가 (#mb3-screens).
// append 는 데스크톱과 같은 순수 헬퍼(mdEdit.appendLogRowOp)를 재사용한다 —
// 규격(§3 기존 행 불변)이 한 곳에만 살게.
import { useCallback, useEffect, useState } from "react";

import { commands, type DiscussionDetail, type DiscussionSummary } from "@/lib/bindings";
import { ChevronLeft } from "@/components/Icons";
import { useT } from "@/i18n";
import { appendLogRowOp, localIsoWithOffset } from "@/features/discussion/mdEdit";
import { agentColor } from "@/features/today/agentColor";
import { logColumns, sectionHeadings } from "@/features/discussion/discussionTemplates";
import { statusMeta } from "@/features/discussion/discussionFormat";
import { ErrorNote, Loading } from "./shared";

export function DiscussionTab({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [list, setList] = useState<DiscussionSummary[] | null>(null);
  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setError(null);
    const res = await commands.discussionList(projectId);
    if (res.status === "ok") setList(res.data);
    else setError(res.error);
  }, [projectId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const open = async (id: string) => {
    setSelected(id);
    setDetail(null);
    const res = await commands.discussionGet(projectId, id);
    if (res.status === "ok") setDetail(res.data);
    else setError(res.error);
  };

  const addNote = async () => {
    if (!selected || !note.trim() || busy) return;
    setBusy(true);
    const raw = await commands.discussionReadRaw(projectId, selected);
    if (raw.status !== "ok") {
      setError(raw.error);
      setBusy(false);
      return;
    }
    const op = appendLogRowOp(raw.data, {
      author: "user (mobile)",
      ts: localIsoWithOffset(new Date()),
      body: note.trim(),
      heading: sectionHeadings().log,
      columns: logColumns(),
    });
    const next = raw.data.slice(0, op.from) + op.insert + raw.data.slice(op.to);
    const res = await commands.discussionWrite(projectId, selected, next);
    setBusy(false);
    if (res.status === "ok") {
      setDetail(res.data);
      setNote("");
    } else setError(res.error);
  };

  if (error) return <ErrorNote message={error} onRetry={() => void loadList()} />;

  if (selected) {
    if (!detail) return <Loading />;
    return (
      <div className="p-4 space-y-4">
        <button
          onClick={() => {
            setSelected(null);
            setDetail(null);
          }}
          className="mob-link text-sm inline-flex items-center gap-0.5"
        >
          <ChevronLeft size={15} /> {t("mobile.common.back")}
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold flex-1">{detail.discussion.title}</h2>
          <StatusChip status={detail.discussion.status} />
        </div>

        <Section title={t("mobile.discussion.problem")} body={detail.problem} />
        {detail.options.length > 0 ? (
          <section>
            <h3 className="mob-sec-title">{t("mobile.discussion.options")}</h3>
            <ul className="space-y-1.5">
              {detail.options.map((o) => (
                <li key={o.option_id} className="mob-card px-3.5 py-2.5">
                  <div className="text-[13px]">{o.title}</div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {detail.conclusion ? (
          <Section title={t("mobile.discussion.conclusion")} body={detail.conclusion} />
        ) : null}

        <section>
          <h3 className="mob-sec-title">{t("mobile.discussion.log")}</h3>
          <ul className="space-y-1.5">
            {detail.log.map((l, i) => (
              <li key={i} className="mob-log-row px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] mob-text-3">
                  <span className="mob-agent-dot" style={{ background: agentColor(l.author) }} aria-hidden />
                  {l.author} · {l.ts.slice(5, 16)}
                </div>
                <div className="text-[13px] whitespace-pre-wrap mt-0.5">{l.body}</div>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("mobile.discussion.notePlaceholder")}
              className="mob-input flex-1 px-3 py-2 text-sm"
            />
            <button
              onClick={() => void addNote()}
              disabled={!note.trim() || busy}
              className="mob-btn-primary px-4 text-sm"
            >
              {t("mobile.discussion.addNote")}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (list === null) return <Loading />;
  if (list.length === 0)
    return <p className="p-6 text-sm mob-text-3 text-center">{t("mobile.discussion.empty")}</p>;

  return (
    <ul className="p-4 space-y-2">
      {list.map((d) => (
        <li key={d.discussion_id}>
          <button
            onClick={() => void open(d.discussion_id)}
            className="mob-card w-full text-left px-3.5 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium truncate flex-1">{d.title}</span>
              <StatusChip status={d.status} />
            </div>
            <div className="text-[11px] mob-text-3 mt-1 truncate">{d.problem_preview}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <section>
      <h3 className="mob-sec-title">{title}</h3>
      <p className="text-[13px] whitespace-pre-wrap">{body}</p>
    </section>
  );
}

/** 상태 칩 — 데스크톱 statusMeta(라벨 키·클래스) 재사용. */
function StatusChip({ status }: { status: string }) {
  const { t } = useT();
  const meta = statusMeta(status);
  return (
    <span className={`mob-status ${meta.cls}`}>
      {meta.labelKey ? t(meta.labelKey) : meta.rawLabel}
    </span>
  );
}
