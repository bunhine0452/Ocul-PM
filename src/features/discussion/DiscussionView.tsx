/**
 * 문제 해결 문서의 **읽기 모드** 서브트리 — 섹션 렌더 · 첨부 레일 · 토의 로그 +
 * 한 줄 메모 입력. 화면(`DiscussionScreenV2`)은 데이터·액션을 소유하고, 여기는
 * 그리기만 한다.
 */
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { Markdown } from "@/components/Markdown";
import { Check, MessageSquare, Paperclip, X } from "@/components/Icons";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { commands, type DiscussionAttachmentDto, type DiscussionDetail } from "@/lib/bindings";
import { useT } from "@/i18n";

import { shortDate } from "./discussionFormat";


export function DiscussionView({
  projectId,
  detail,
  locked,
  onDetach,
  onAddNote,
}: {
  projectId: number;
  detail: DiscussionDetail;
  locked: boolean;
  onDetach: (relPath: string) => void;
  onAddNote: (body: string) => Promise<boolean>;
}) {
  const { t } = useT();
  return (
    <>
      {detail.warnings.length > 0 ? (
        <div className="disc-section">
          <EmptyState align="start" style={{ padding: "8px 0" }}>
            {/* U+FE0E — ⚠ 는 기본이 컬러 이모지라 텍스트 표현으로 고정해야
                주변 텍스트와 같은 색·무게로 그려진다. */}
            {t("disc.parseWarn", { list: detail.warnings.join(" · ") })}
          </EmptyState>
        </div>
      ) : null}

      <section className="disc-section">
        <div className="disc-section-title">{t("disc.sec.problem")}</div>
        {detail.problem.trim() ? (
          <Markdown>{detail.problem}</Markdown>
        ) : (
          <EmptyState align="start" style={{ padding: "8px 0" }}>
            {t("disc.sec.problemEmpty")}
          </EmptyState>
        )}
      </section>

      {detail.options.length > 0 ? (
        <section className="disc-section">
          <div className="disc-section-title">{t("disc.sec.options")}</div>
          {detail.options.map((o) => (
            <div className="disc-option-card" key={o.option_id}>
              <div className="disc-option-title">{o.title}</div>
              {o.body.trim() ? <Markdown>{o.body}</Markdown> : null}
            </div>
          ))}
        </section>
      ) : null}

      {detail.background.trim() || detail.attachments.length > 0 ? (
        <section className="disc-section">
          <div className="disc-section-title">{t("disc.sec.background")}</div>
          {detail.background.trim() ? <Markdown>{detail.background}</Markdown> : null}
          {detail.attachments.length > 0 ? (
            <div className="disc-attach-rail">
              {detail.attachments.map((a) => (
                <AttachmentChip
                  key={a.rel_path}
                  projectId={projectId}
                  discussionId={detail.discussion.discussion_id}
                  att={a}
                  locked={locked}
                  onDetach={onDetach}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {detail.log.length > 0 || !locked ? (
        <section className="disc-section">
          <div className="disc-section-title">{t("disc.sec.notes")}</div>
          {detail.log.map((l, i) => (
            <div className="disc-log-row" key={`${l.ts}-${i}`}>
              <span className="disc-log-author">
                <span className="disc-log-dot" style={{ background: agentColor(l.author) }} />
                {agentLabel(l.author)}
              </span>
              <span className="disc-log-body">
                {l.body}
                {l.ts ? <span className="disc-log-ts"> · {shortDate(l.ts)}</span> : null}
              </span>
            </div>
          ))}
          {!locked ? <NoteComposer onSubmit={onAddNote} /> : null}
        </section>
      ) : null}

      {detail.conclusion.trim() ? (
        <section className="disc-section">
          <div className="disc-section-title">{t("disc.sec.conclusion")}</div>
          <Markdown>{detail.conclusion}</Markdown>
        </section>
      ) : null}

      {detail.next_steps.length > 0 ? (
        <section className="disc-section">
          <div className="disc-section-title">{t("disc.sec.next")}</div>
          <div className="disc-next">
            {detail.next_steps.map((s) => (
              <div key={s.step_id} className={`disc-next-item${s.done ? " done" : ""}`}>
                <span className={`disc-next-box${s.done ? " done" : ""}`}>
                  {s.done ? <Check size={11} /> : null}
                </span>
                {s.title}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/** 편집 모드로 들어가지 않고 토의 로그에 한 줄 남기는 입력칸. */
function NoteComposer({ onSubmit }: { onSubmit: (body: string) => Promise<boolean> }) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = useMemo(() => value.trim(), [value]);

  const send = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    const ok = await onSubmit(trimmed);
    setBusy(false);
    if (ok) setValue("");
  };

  return (
    <div className="disc-note">
      <MessageSquare size={14} />
      <input
        aria-label={t("disc.noteAria")}
        value={value}
        placeholder={t("disc.notePlaceholder")}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void send();
        }}
      />
      <button type="button" className="disc-btn" disabled={busy || !trimmed} onClick={() => void send()}>
        {t("disc.noteAdd")}
      </button>
    </div>
  );
}

// ── attachment chip (lazy-loads image bytes) ───────────────────────────────────

function AttachmentChip({
  projectId,
  discussionId,
  att,
  locked,
  onDetach,
}: {
  projectId: number;
  discussionId: string;
  att: DiscussionAttachmentDto;
  locked: boolean;
  onDetach: (relPath: string) => void;
}) {
  const { t } = useT();
  const [uri, setUri] = useState<string | null>(null);
  const name = att.rel_path.replace(/^attachments\//, "");

  useEffect(() => {
    if (att.kind !== "image") return;
    let alive = true;
    void commands.discussionAsset(projectId, discussionId, att.rel_path).then((res) => {
      if (alive && res.status === "ok") {
        setUri(`data:${res.data.mime};base64,${res.data.base64}`);
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, discussionId, att.rel_path, att.kind]);

  return (
    <div className="disc-attach">
      {att.kind === "image" && uri ? <img src={uri} alt={name} /> : null}
      <div className="disc-attach-name">
        <Paperclip size={12} />
        <span title={name}>{name}</span>
        {!locked ? (
          <button
            type="button"
            className="disc-attach-x"
            aria-label={t("disc.deleteAttachment", { name })}
            onClick={() => onDetach(att.rel_path)}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
