import { useCallback, useEffect, useRef, useState } from "react";

import { Toolbar } from "@/components/Toolbar";
import { Markdown } from "@/components/Markdown";
import { OculSpinner } from "@/components/OculSpinner";
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  Paperclip,
  X,
  Save,
  ArrowRight,
  TargetIcon,
  RotateCcw,
} from "@/components/Icons";
import { toast } from "@/lib/toast";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import {
  commands,
  type DiscussionSummary,
  type DiscussionDetail,
  type DiscussionAttachmentDto,
} from "@/lib/bindings";
import "./discussion.css";

interface Props {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "탐색 중", cls: "open" },
  resolved: { label: "결론남", cls: "resolved" },
  archived: { label: "보관", cls: "archived" },
};

function statusMeta(s: string) {
  return STATUS_META[s] ?? { label: s, cls: "resolved" };
}

/** Short YYYY-MM-DD slice of an ISO/date string. */
function shortDate(s: string): string {
  return s ? s.slice(0, 10) : "";
}

export function DiscussionScreenV2({ projectId, onNavigate }: Props) {
  const { state, setState } = useWorkspace();
  const selectedId = state.discussionActiveId;

  const [list, setList] = useState<DiscussionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [promoting, setPromoting] = useState(false);
  // v2 U13 — 승격 모달: Esc/포커스 트랩/트리거 복원 공용 훅 (기존엔 스크림
  // 클릭만 닫혔고 Tab 이 모달 뒤로 샜음).
  const promoteRef = useRef<HTMLDivElement>(null);
  useModalBehavior({
    open: promoting,
    onClose: () => setPromoting(false),
    panelRef: promoteRef,
  });

  const select = useCallback(
    (id: string | null) => setState((prev) => ({ ...prev, discussionActiveId: id })),
    [setState],
  );

  const loadList = useCallback(async (): Promise<DiscussionSummary[]> => {
    setListError(null);
    const res = await commands.discussionList(projectId);
    if (res.status === "ok") {
      setList(res.data);
      return res.data;
    }
    setListError(res.error);
    setList([]);
    return [];
  }, [projectId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Ensure a valid selection once the list is known.
  useEffect(() => {
    if (!list) return;
    const ids = new Set(list.map((d) => d.discussion_id));
    if (selectedId && ids.has(selectedId)) return;
    const first = list[0]?.discussion_id ?? null;
    setState((prev) => (prev.discussionActiveId === first ? prev : { ...prev, discussionActiveId: first }));
  }, [list, selectedId, setState]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      const res = await commands.discussionGet(projectId, id);
      setDetailLoading(false);
      if (res.status === "ok") setDetail(res.data);
      else {
        setDetail(null);
        toast.destructive(`문서를 불러오지 못했어요: ${res.error}`);
      }
    },
    [projectId],
  );

  useEffect(() => {
    setEditing(false);
    setRenaming(false);
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // ── actions ────────────────────────────────────────────────────────────────

  const submitCreate = async () => {
    const t = newTitle.trim();
    if (!t) return;
    setBusy(true);
    const res = await commands.discussionCreate(projectId, t);
    setBusy(false);
    if (res.status === "ok") {
      setCreating(false);
      setNewTitle("");
      await loadList();
      select(res.data.discussion_id);
    } else toast.destructive(`만들기 실패: ${res.error}`);
  };

  const startEdit = async () => {
    if (!selectedId) return;
    const res = await commands.discussionReadRaw(projectId, selectedId);
    if (res.status === "ok") {
      setDraft(res.data);
      setEditing(true);
    } else toast.destructive(`편집기를 열지 못했어요: ${res.error}`);
  };

  const saveBody = async () => {
    if (!selectedId) return;
    setBusy(true);
    const res = await commands.discussionWrite(projectId, selectedId, draft);
    setBusy(false);
    if (res.status === "ok") {
      setEditing(false);
      setDetail(res.data);
      void loadList();
      toast.info("저장했어요");
    } else toast.destructive(`저장 실패: ${res.error}`);
  };

  const changeStatus = async (status: string) => {
    if (!selectedId) return;
    setBusy(true);
    const res = await commands.discussionSetStatus(projectId, selectedId, status);
    setBusy(false);
    if (res.status === "ok") {
      setDetail(res.data);
      void loadList();
    } else toast.destructive(res.error);
  };

  const submitRename = async () => {
    if (!selectedId) return;
    const t = renameTitle.trim();
    if (!t) return;
    setBusy(true);
    const res = await commands.discussionRename(projectId, selectedId, t);
    setBusy(false);
    if (res.status === "ok") {
      setRenaming(false);
      setDetail(res.data);
      void loadList();
    } else toast.destructive(res.error);
  };

  const remove = async () => {
    if (!selectedId) return;
    if (!window.confirm("이 문제 해결 문서를 삭제할까요? (첨부 포함)")) return;
    setBusy(true);
    const res = await commands.discussionDelete(projectId, selectedId);
    setBusy(false);
    if (res.status === "ok") {
      select(null);
      await loadList();
    } else toast.destructive(res.error);
  };

  const attach = async () => {
    if (!selectedId) return;
    const res = await commands.discussionAttachViaDialog(projectId, selectedId);
    if (res.status === "ok") {
      if (res.data) {
        await loadDetail(selectedId);
        toast.info("첨부했어요");
      }
    } else toast.destructive(res.error);
  };

  const detach = async (relPath: string) => {
    if (!selectedId) return;
    const res = await commands.discussionDetach(projectId, selectedId, relPath);
    if (res.status === "ok") await loadDetail(selectedId);
    else toast.destructive(res.error);
  };

  const confirmPromote = async () => {
    if (!selectedId) return;
    setBusy(true);
    const res = await commands.discussionPromoteToPlan(projectId, selectedId);
    setBusy(false);
    setPromoting(false);
    if (res.status === "ok") {
      setState((prev) => ({ ...prev, plannerPlanId: res.data }));
      toast.info("플래너로 승격했어요");
      onNavigate("planner");
    } else toast.destructive(res.error);
  };

  // ── derived ────────────────────────────────────────────────────────────────

  const active = list?.filter((d) => d.status !== "archived") ?? [];
  const archived = list?.filter((d) => d.status === "archived") ?? [];
  const openCount = active.filter((d) => d.status === "open").length;
  const locked = detail ? detail.discussion.status !== "open" : false;

  // ── render ─────────────────────────────────────────────────────────────────

  const renderItem = (d: DiscussionSummary) => {
    const meta = statusMeta(d.status);
    return (
      <button
        key={d.discussion_id}
        type="button"
        className={`disc-item${d.discussion_id === selectedId ? " on" : ""}`}
        onClick={() => select(d.discussion_id)}
      >
        <div className="disc-item-top">
          <span className="disc-item-title">{d.title}</span>
          <span className={`disc-status ${meta.cls}`}>{meta.label}</span>
        </div>
        {d.problem_preview ? <div className="disc-item-preview">{d.problem_preview}</div> : null}
        <div className="disc-item-meta">
          {d.option_count > 0 ? <span>{d.option_count}안</span> : null}
          {d.next_step_count > 0 ? <span>·다음 {d.next_step_count}</span> : null}
          {d.resolution_plan_id ? <span>· → 📋</span> : null}
          <span style={{ marginLeft: "auto" }}>{shortDate(d.updated_at)}</span>
        </div>
      </button>
    );
  };

  return (
    <>
      <Toolbar
        title="문제 해결"
        sub={list ? `${active.length}건 · 결정 대기 ${openCount}` : undefined}
      >
        <button
          type="button"
          className="disc-btn primary"
          onClick={() => {
            setCreating(true);
            setNewTitle("");
          }}
        >
          <Plus size={14} /> 새 문제
        </button>
      </Toolbar>

      {list === null ? (
        <div className="scroll">
          <div className="page">
            <div className="grid place-items-center py-20">
              <OculSpinner size={28} label="불러오는 중…" />
            </div>
          </div>
        </div>
      ) : (
        <div className="disc-body">
          <aside className="disc-list">
            {creating ? (
              <div className="disc-new-row">
                <input
                  aria-label="새 문제 제목"
                  autoFocus
                  value={newTitle}
                  placeholder="무엇을 정해야 하나요?"
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitCreate();
                    if (e.key === "Escape") setCreating(false);
                  }}
                />
                <button
                  type="button"
                  className="disc-btn primary"
                  disabled={busy || !newTitle.trim()}
                  onClick={() => void submitCreate()}
                >
                  생성
                </button>
              </div>
            ) : null}

            {listError ? (
              <div className="empty-hint">목록을 불러오지 못했어요: {listError}</div>
            ) : list.length === 0 ? (
              <div className="empty-hint">
                아직 문제 해결 문서가 없어요.
                <br />
                “새 문제”로 첫 토의를 시작하세요.
              </div>
            ) : (
              <>
                {active.map(renderItem)}
                {archived.length > 0 ? (
                  <>
                    <div className="disc-archive-head">보관 {archived.length}</div>
                    {archived.map(renderItem)}
                  </>
                ) : null}
              </>
            )}
          </aside>

          <div className="disc-main">
            {selectedId == null ? (
              <div className="empty-hint">왼쪽에서 문제를 선택하거나 새로 만드세요.</div>
            ) : detailLoading && !detail ? (
              <div className="grid place-items-center py-20">
                <OculSpinner size={24} label="문서 여는 중…" />
              </div>
            ) : !detail ? (
              <div className="empty-hint">문서를 불러오지 못했습니다.</div>
            ) : (
              <div className="disc-doc fade-in">
                {/* ── 헤더 ── */}
                <div className="disc-head">
                  {renaming ? (
                    <div className="disc-head-title">
                      <input
                        aria-label="제목 변경"
                        autoFocus
                        value={renameTitle}
                        onChange={(e) => setRenameTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void submitRename();
                          if (e.key === "Escape") setRenaming(false);
                        }}
                        onBlur={() => setRenaming(false)}
                      />
                    </div>
                  ) : (
                    <h1 className="disc-head-title">{detail.discussion.title}</h1>
                  )}
                  <span className={`disc-status ${statusMeta(detail.discussion.status).cls}`}>
                    {statusMeta(detail.discussion.status).label}
                  </span>
                </div>

                <div className="disc-owner">
                  <span
                    className="disc-log-dot"
                    style={{ background: agentColor(detail.discussion.owner) }}
                  />
                  {agentLabel(detail.discussion.owner)} · {shortDate(detail.discussion.updated_at)}
                </div>

                {/* ── 액션 ── */}
                {editing ? (
                  <div className="disc-actions">
                    <button
                      type="button"
                      className="disc-btn primary"
                      disabled={busy}
                      onClick={() => void saveBody()}
                    >
                      <Save size={14} /> 저장
                    </button>
                    <button type="button" className="disc-btn" onClick={() => setEditing(false)}>
                      취소
                    </button>
                  </div>
                ) : (
                  <div className="disc-actions">
                    {!locked ? (
                      <button type="button" className="disc-btn" onClick={() => void startEdit()}>
                        <Pencil size={14} /> 편집
                      </button>
                    ) : null}
                    {!locked ? (
                      <button type="button" className="disc-btn" onClick={() => void attach()}>
                        <Paperclip size={14} /> 첨부
                      </button>
                    ) : null}
                    {!locked ? (
                      <button
                        type="button"
                        className="disc-btn"
                        onClick={() => {
                          setRenameTitle(detail.discussion.title);
                          setRenaming(true);
                        }}
                      >
                        이름 변경
                      </button>
                    ) : null}
                    {detail.discussion.status === "open" ? (
                      <button
                        type="button"
                        className="disc-btn primary"
                        disabled={busy || detail.next_steps.length === 0}
                        title={
                          detail.next_steps.length === 0
                            ? "먼저 ‘다음 단계’를 작성하세요"
                            : "다음 단계를 플래너 계획으로 만듭니다"
                        }
                        onClick={() => setPromoting(true)}
                      >
                        <TargetIcon size={14} /> 플래너로 승격
                      </button>
                    ) : null}
                    {detail.discussion.status !== "open" ? (
                      <button
                        type="button"
                        className="disc-btn"
                        disabled={busy}
                        onClick={() => void changeStatus("open")}
                      >
                        <RotateCcw size={14} /> 다시 열기
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="disc-btn"
                        disabled={busy}
                        onClick={() => void changeStatus("resolved")}
                      >
                        <Check size={14} /> 닫기(결론)
                      </button>
                    )}
                    {detail.discussion.status !== "archived" ? (
                      <button
                        type="button"
                        className="disc-btn"
                        disabled={busy}
                        onClick={() => void changeStatus("archived")}
                      >
                        보관
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="disc-btn danger"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      <Trash2 size={14} /> 삭제
                    </button>
                    {detail.resolution_plan_id ? (
                      <button
                        type="button"
                        className="disc-reslink"
                        onClick={() => {
                          setState((prev) => ({ ...prev, plannerPlanId: detail.resolution_plan_id }));
                          onNavigate("planner");
                        }}
                      >
                        <TargetIcon size={13} /> {detail.resolution_plan_id} 계획 보기
                      </button>
                    ) : null}
                  </div>
                )}

                {/* ── 본문 ── */}
                {editing ? (
                  <div className="disc-editor">
                    <textarea
                      aria-label="문서 본문 마크다운"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="disc-editor-preview">
                      <Markdown>{draft || "_미리보기_"}</Markdown>
                    </div>
                  </div>
                ) : (
                  <DiscussionView
                    projectId={projectId}
                    detail={detail}
                    locked={locked}
                    onDetach={detach}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {promoting && detail ? (
        <div className="disc-modal-scrim" onClick={() => setPromoting(false)}>
          <div
            ref={promoteRef}
            className="disc-modal"
            role="dialog"
            aria-modal="true"
            aria-label="플래너로 승격"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>플래너로 승격</h2>
            <p className="disc-modal-sub">
              아래 “다음 단계” {detail.next_steps.length}개가 새 플래너 계획의 항목이 됩니다. 이
              문제는 <b>결론남</b> 상태로 닫히고 계획과 연결돼요.
            </p>
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
            <div className="disc-modal-foot">
              <button type="button" className="disc-btn" onClick={() => setPromoting(false)}>
                취소
              </button>
              <button
                type="button"
                className="disc-btn primary"
                disabled={busy}
                onClick={() => void confirmPromote()}
              >
                <ArrowRight size={14} /> 승격
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── view (read mode) ──────────────────────────────────────────────────────────

function DiscussionView({
  projectId,
  detail,
  locked,
  onDetach,
}: {
  projectId: number;
  detail: DiscussionDetail;
  locked: boolean;
  onDetach: (relPath: string) => void;
}) {
  return (
    <>
      {detail.warnings.length > 0 ? (
        <div className="disc-section">
          <div className="empty-hint" style={{ textAlign: "left", padding: "8px 0" }}>
            {/* U+FE0E — ⚠ 는 기본이 컬러 이모지라 텍스트 표현으로 고정해야
                주변 텍스트와 같은 색·무게로 그려진다. */}
            ⚠︎ 파싱 경고: {detail.warnings.join(" · ")}
          </div>
        </div>
      ) : null}

      <section className="disc-section">
        <div className="disc-section-title">문제 정의</div>
        {detail.problem.trim() ? (
          <Markdown>{detail.problem}</Markdown>
        ) : (
          <div className="empty-hint" style={{ textAlign: "left", padding: "8px 0" }}>
            문제 정의가 비어 있어요. “편집”에서 먼저 문제를 적어보세요.
          </div>
        )}
      </section>

      {detail.options.length > 0 ? (
        <section className="disc-section">
          <div className="disc-section-title">후보 해결 방안</div>
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
          <div className="disc-section-title">배경 / 조사 자료</div>
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

      {detail.log.length > 0 ? (
        <section className="disc-section">
          <div className="disc-section-title">토의 / 메모</div>
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
        </section>
      ) : null}

      {detail.conclusion.trim() ? (
        <section className="disc-section">
          <div className="disc-section-title">결론</div>
          <Markdown>{detail.conclusion}</Markdown>
        </section>
      ) : null}

      {detail.next_steps.length > 0 ? (
        <section className="disc-section">
          <div className="disc-section-title">다음 단계</div>
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
            aria-label={`첨부 ${name} 삭제`}
            onClick={() => onDetach(att.rel_path)}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
