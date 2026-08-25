// 세션 목록 패널 — 과거 대화 열기·이름 변경·삭제.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { memo, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "@/components/Icons";
import { type AcpSessionSummary } from "@/lib/bindings";
import { useT } from "@/i18n";
import { relativeTime } from "../relativeTime";

/**
 * 지난 대화 패널.
 *
 * **우리가 저장하지 않는다** — Claude Code 가 이미 자기 세션 스토어를 갖고
 * 있고 ACP `session/list` 가 그걸 열어 준다. 사본을 두면 터미널에서 연 세션과
 * 앱에서 연 세션이 갈라진다. 목록은 **이 프로젝트 경로의 것만** 들어온다
 * (백엔드가 cwd 로 한 번 더 거른다).
 *
 * 팝오버가 아니라 접히는 패널인 이유: 대화를 고르는 일은 "잠깐 열어 보고
 * 닫는" 동작이 아니라 **옆에 두고 오가는** 동작이다.
 */
export const SessionPanel = memo(function SessionPanel({
  open,
  sessions,
  currentId,
  query,
  onQuery,
  onPick,
  onNew,
  onRename,
  onDelete,
  names,
}: {
  open: boolean;
  sessions: AcpSessionSummary[];
  currentId: string | null;
  query: string;
  onQuery: (next: string) => void;
  onPick: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, next: string) => void;
  onDelete: (id: string) => void;
  names: Readonly<Record<string, string>>;
}) {
  const { t } = useT();
  /** 지금 이름을 고치고 있는 줄. 한 번에 하나만 — 여러 줄이 동시에 열리면
      어느 것을 저장하는지 알 수 없다. */
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  /**
   * 삭제 대기 중인 줄 — **두 번 눌러야 지워진다.**
   *
   * 삭제는 영구인데(어댑터의 `session/delete`) 22px 버튼이 이름 바꾸기 바로
   * 옆에 있었다. 오클릭 한 번 = 대화 소실. 모달은 과하다 — 같은 자리에서 잠깐
   * "삭제?"로 바뀌었다 2.5초면 돌아오는 것으로 충분하다.
   */
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), 2500);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  // 목록 전체가 **같은 기준 시각**을 써야 렌더 도중 분이 넘어가며 순서가
  // 흔들리지 않는다.
  const now = useMemo(() => Date.now(), [sessions]);
  const needle = query.trim().toLowerCase();
  const titleOf = (item: AcpSessionSummary) => names[item.id] ?? item.title ?? "";
  // 이름표를 붙인 대화는 **그 이름으로** 찾을 수 있어야 한다 — 붙여 놓고 원래
  // 제목으로만 검색되면 이름표가 반쪽이다.
  const shown = needle
    ? sessions.filter((item) => titleOf(item).toLowerCase().includes(needle))
    : sessions;

  return (
    <aside
      className={"acp-panel" + (open ? "" : " closed")}
      aria-label={t("acp.history")}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="acp-panel-inner">
      <div className="acp-panel-head">
        <span className="acp-panel-title">{t("acp.history")}</span>
      </div>

      {/* busy 로 잠그지 않는다 — 다른 대화가 도는 동안에도 새 대화를 열고
          **곧장 말을 걸 수 있어야** 한다. 기록도 작업 중 표시도 대화별로
          갈라져 있으므로 서로 기다릴 이유가 없다. */}
      <button type="button" className="acp-panel-new" onClick={onNew}>
        <Plus size={14} />
        {t("acp.newConversation")}
      </button>

      <div className="acp-panel-search">
        <Search size={12} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("acp.searchSessions")}
          aria-label={t("acp.searchSessions")}
        />
        {query ? (
          <button
            type="button"
            className="acp-search-clear"
            aria-label={t("acp.searchClear")}
            title={t("acp.searchClear")}
            onClick={() => onQuery("")}
          >
            <X size={11} />
          </button>
        ) : null}
      </div>

      <div className="acp-panel-list">
        {shown.length ? (
          shown.map((item) => {
            const label = titleOf(item);
            if (editing?.id === item.id) {
              // 고치는 중에는 줄 전체가 입력칸이 된다 — 좁은 패널에서 인라인
              // 입력칸을 따로 끼워 넣으면 제목이 두 글자만 남는다.
              const commit = () => {
                onRename(item.id, editing.value);
                setEditing(null);
              };
              return (
                <div key={item.id} className="acp-session editing">
                  <input
                    className="acp-session-input"
                    autoFocus
                    value={editing.value}
                    aria-label={t("acp.session.rename")}
                    onChange={(e) => setEditing({ id: item.id, value: e.target.value })}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditing(null);
                      }
                    }}
                  />
                </div>
              );
            }
            return (
              <div
                key={item.id}
                className={"acp-session" + (item.id === currentId ? " active" : "")}
              >
                <button
                  type="button"
                  className="acp-session-main"
                  onClick={() => onPick(item.id)}
                  title={label || undefined}
                >
                  <span className="acp-session-title">
                    {label || t("acp.untitledSession")}
                  </span>
                  <span className="acp-session-time">
                    {relativeTime(item.updated_at, now)}
                  </span>
                </button>
                <span className="acp-session-actions">
                  {confirming === item.id ? (
                    <button
                      type="button"
                      className="acp-session-confirm"
                      onClick={() => {
                        setConfirming(null);
                        onDelete(item.id);
                      }}
                    >
                      {t("acp.session.confirmDelete")}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="acp-session-act"
                        onClick={() => setEditing({ id: item.id, value: label })}
                        aria-label={t("acp.session.rename")}
                        title={t("acp.session.rename")}
                      >
                        <Pencil size={12} />
                      </button>
                      {/* X 는 "닫기"로 읽힌다 (탭의 X 가 실제로 그렇다) — 영구
                          삭제는 쓰레기통이어야 한다. */}
                      <button
                        type="button"
                        className="acp-session-act danger"
                        onClick={() => setConfirming(item.id)}
                        aria-label={t("acp.session.delete")}
                        title={t("acp.session.delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })
        ) : (
          <div className="acp-panel-empty">
            {sessions.length ? t("acp.history.noMatch") : t("acp.history.empty")}
          </div>
        )}
      </div>
      </div>
    </aside>
  );
});
