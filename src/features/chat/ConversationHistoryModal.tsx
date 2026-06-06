import { useCallback, useEffect, useId, useState } from "react";
import { commands, type Conversation } from "@/lib/bindings";
import { Plus, Trash2, MessageSquare } from "@/components/Icons";
import { toast } from "@/lib/toast";

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
  if (!ts) return "";
  const d = new Date(ts > 1e11 ? ts : ts * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function ConversationHistoryModal({
  projectId,
  activeId,
  onSelect,
  onNew,
  onActiveDeleted,
  onClose,
}: Props) {
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
      toast.destructive(`대화 목록을 불러오지 못했어요: ${res.error}`);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const remove = async (id: number) => {
    const res = await commands.conversationDelete(id);
    if (res.status === "ok") {
      toast.info("대화를 삭제했어요.");
      await load();
      if (id === activeId) onActiveDeleted();
    } else {
      toast.destructive(`대화 삭제 실패: ${res.error}`);
    }
  };

  return (
    <div className="set-modal-backdrop" onMouseDown={onClose}>
      <div
        className="set-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="set-modal-actions" style={{ marginTop: 0, marginBottom: 4 }}>
          <div className="set-modal-title" id={titleId} style={{ marginRight: "auto", marginBottom: 0 }}>
            대화 기록
          </div>
          <button type="button" className="btn sm primary" onClick={onNew}>
            <Plus size={14} /> 새 대화
          </button>
        </div>

        {convs == null ? (
          <div className="empty-hint" style={{ padding: "24px 8px" }}>불러오는 중…</div>
        ) : convs.length === 0 ? (
          <div className="empty-hint" style={{ padding: "24px 8px" }}>
            아직 대화가 없어요. "새 대화" 로 시작하세요.
          </div>
        ) : (
          <div className="conv-list">
            {convs.map((c) => (
              <div key={c.id} className={"conv-row" + (c.id === activeId ? " active" : "")}>
                <button type="button" className="conv-main" onClick={() => onSelect(c.id)}>
                  <span className="conv-title">
                    <MessageSquare size={12} color="var(--text-3)" />{" "}
                    {c.title || "제목 없는 대화"}
                  </span>
                  <span className="conv-meta">{relTime(c)}</span>
                </button>
                <button
                  type="button"
                  className="iconbtn conv-del"
                  onClick={() => void remove(c.id)}
                  aria-label={`${c.title || "대화"} 삭제`}
                  title="삭제"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
