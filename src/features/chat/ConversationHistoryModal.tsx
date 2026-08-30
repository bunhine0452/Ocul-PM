import { useConfirm } from "@/hooks/useConfirm";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { commands, type Conversation } from "@/lib/bindings";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { Plus, Trash2, MessageSquare } from "@/components/Icons";
import { toast } from "@/lib/toast";
// 모듈 getLang() 은 순수 헬퍼 relTime 용, useT() 는 컴포넌트 용.
import { getLang, useT } from "@/i18n";
import { relativeTime, toEpochMs } from "@/lib/format";

// PR-R1 (A3) — AI 패널 "대화 기록". 직전 라운드에서 disabled("1.1") 였던 버튼을
// 기존 backend(conversation_list / conversation_create / conversation_delete)로
// 실연동. 과거 대화를 열람·전환·삭제하고 새 대화를 시작한다. 스트리밍과 무관한
// 순수 데이터 UI 라 단위 테스트 가능(§0.11 의 AI 런타임 한계 밖).

interface Props {
  projectId: number;
  activeId: number | null;
  /** 대화 전환 (부모가 thread 로드 + 모달 닫기). */
  onSelect: (id: number) => void;
  /** 새 대화 시작 (부모가 create + 전환). */
  onNew: () => void;
  /** 활성 대화가 삭제되면 부모가 thread 재해석. */
  onActiveDeleted: () => void;
  onClose: () => void;
}

function relTime(conv: Conversation): string {
  const ts = conv.last_message_at ?? conv.updated_at ?? conv.created_at;
  const ms = toEpochMs(ts);
  if (ms == null) return "";
  const now = Date.now();
  // 하루가 넘으면 날짜로 — 월/일 표기 순서는 로케일마다 달라서 사전에 넣지
  // 않고 Intl 에 맡긴다 (03-i18n.md §3).
  if (now - ms >= 86_400_000) {
    return new Intl.DateTimeFormat(getLang(), { month: "long", day: "numeric" }).format(new Date(ms));
  }
  return relativeTime(ms, now);
}

export function ConversationHistoryModal({
  projectId,
  activeId,
  onSelect,
  onNew,
  onActiveDeleted,
  onClose,
}: Props) {
  const { t } = useT();
  const { confirm, confirmDialog } = useConfirm();
  const titleId = useId();
  const [convs, setConvs] = useState<Conversation[] | null>(null);

  const load = useCallback(async () => {
    const res = await commands.conversationList(projectId);
    if (res.status === "ok") {
      const sorted = [...res.data].sort(
        (a, b) =>
          (b.last_message_at ?? b.updated_at ?? b.created_at) -
          (a.last_message_at ?? a.updated_at ?? a.created_at),
      );
      setConvs(sorted);
    } else {
      setConvs([]);
      toast.destructive(t("chat.listFailed", { error: res.error }));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // v2 U13 — Esc/포커스 트랩/트리거 복원은 공용 모달 훅으로.
  const panelRef = useRef<HTMLDivElement>(null);
  useModalBehavior({ open: true, onClose, panelRef });

  const remove = async (id: number) => {
    // 대화 삭제는 되돌릴 수 없는데 확인 없이 지워졌다 (2026-08-30 감사).
    if (!(await confirm({ title: t("chat.deleteConfirm"), danger: true }))) return;
    const res = await commands.conversationDelete(id);
    if (res.status === "ok") {
      toast.info(t("chat.deleted"));
      await load();
      if (id === activeId) onActiveDeleted();
    } else {
      toast.destructive(t("chat.deleteFailed", { error: res.error }));
    }
  };

  return (
    <>
    {confirmDialog}
    <div className="set-modal-backdrop" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="set-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="set-modal-actions" style={{ marginTop: 0, marginBottom: 4 }}>
          <div className="set-modal-title" id={titleId} style={{ marginRight: "auto", marginBottom: 0 }}>
            {t("chat.historyTitle")}
          </div>
          <button type="button" className="btn sm primary" onClick={onNew}>
            <Plus size={14} /> {t("chat.newConversation")}
          </button>
        </div>

        {convs == null ? (
          <div className="empty-hint" style={{ padding: "24px 8px" }}>{t("chat.loading")}</div>
        ) : convs.length === 0 ? (
          <div className="empty-hint" style={{ padding: "24px 8px" }}>
            {t("chat.empty")}
          </div>
        ) : (
          <div className="conv-list">
            {convs.map((c) => (
              <div key={c.id} className={"conv-row" + (c.id === activeId ? " active" : "")}>
                <button type="button" className="conv-main" onClick={() => onSelect(c.id)}>
                  <span className="conv-title">
                    <MessageSquare size={12} color="var(--text-3)" />{" "}
                    {c.title || t("chat.untitled")}
                  </span>
                  <span className="conv-meta">{relTime(c)}</span>
                </button>
                <button
                  type="button"
                  className="iconbtn conv-del"
                  onClick={() => void remove(c.id)}
                  aria-label={t("chat.deleteAria", { title: c.title || t("chat.conversationWord") })}
                  title={t("chat.delete")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
