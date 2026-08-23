import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { Toolbar } from "@/components/Toolbar";
import { OculSpinner } from "@/components/OculSpinner";
import { AppDialog } from "@/components/ui/AppDialog";
import { Plus, Pencil, Check, ArrowRight, TargetIcon, Clipboard, ClipboardCheck } from "@/components/Icons";
import { toast } from "@/lib/toast";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { commands, type DiscussionSummary, type DiscussionDetail } from "@/lib/bindings";
import { useT, type I18nKey } from "@/i18n";
import "./discussion.css";
import { tError } from "@/i18n/errors";
import type { EditorMode } from "./DiscussionEditor";
import { DiscussionView } from "./DiscussionView";
import { shortDate, statusMeta } from "./discussionFormat";
import { appendLogRowOp, localIsoWithOffset } from "./mdEdit";
import { buildDiscussionPrompt, promptKindFor } from "./discussionPrompt";
import { logColumns, sectionHeadings, TEMPLATE_IDS, templateBody, type TemplateId } from "./discussionTemplates";

interface Props {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
}

/** 토의 로그에 사용자가 직접 남기는 메모의 작성자 (규격 §3). */
const SELF_AUTHOR = "user";

/**
 * 편집기는 CodeMirror 를 끌고 온다 — 읽기만 하러 들어온 사람이 그 값을 치르지
 * 않게 [편집] 을 누르는 순간 내려받는다 (`Markdown` 과 같은 처리, v2 U6).
 */
const DiscussionEditor = lazy(() =>
  import("./DiscussionEditor").then((m) => ({ default: m.DiscussionEditor })),
);

const TEMPLATE_NAME: Record<TemplateId, I18nKey> = {
  blank: "disc.tpl.blank",
  decision: "disc.tpl.decision",
  kickoff: "disc.tpl.kickoff",
  migration: "disc.tpl.migration",
};
const TEMPLATE_DESC: Record<TemplateId, I18nKey> = {
  blank: "disc.tpl.blank.desc",
  decision: "disc.tpl.decision.desc",
  kickoff: "disc.tpl.kickoff.desc",
  migration: "disc.tpl.migration.desc",
};

export function DiscussionScreenV2({ projectId, onNavigate }: Props) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const selectedId = state.discussionActiveId;
  const editorMode = state.discussionEditorMode;

  const [list, setList] = useState<DiscussionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTemplate, setNewTemplate] = useState<TemplateId>("decision");
  const newTitleRef = useRef<HTMLInputElement>(null);
  /** 방금 만든 문서는 곧바로 편집기로 — 선택 전이가 `editing` 을 되돌리므로 ref 로 넘긴다. */
  const pendingEditRef = useRef<string | null>(null);

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
  const setEditorMode = useCallback(
    (m: EditorMode) => setState((prev) => ({ ...prev, discussionEditorMode: m })),
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

  // `silent` — 스피너 없이 조용히 다시 읽는다 (디스크 변경으로 도는 갱신용).
  const loadDetail = useCallback(
    async (id: string, silent = false) => {
      if (!silent) setDetailLoading(true);
      const res = await commands.discussionGet(projectId, id);
      if (!silent) setDetailLoading(false);
      if (res.status === "ok") setDetail(res.data);
      else if (!silent) {
        setDetail(null);
        toast.destructive(t("disc.loadDocFailed", { error: res.error }));
      }
    },
    [projectId],
  );

  const startEdit = useCallback(
    async (id: string) => {
      const res = await commands.discussionReadRaw(projectId, id);
      if (res.status === "ok") {
        setDraft(res.data);
        setEditing(true);
      } else toast.destructive(t("disc.editorFailed", { error: res.error }));
    },
    [projectId, t],
  );

  useEffect(() => {
    setEditing(false);
    setRenaming(false);
    setCopied(false);
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
    if (pendingEditRef.current === selectedId) {
      pendingEditRef.current = null;
      void startEdit(selectedId);
    }
  }, [selectedId, loadDetail, startEdit]);

  // 에이전트(또는 다른 창)가 `.oculpm/discussion/**` 을 건드리면 즉시 다시 읽는다.
  //
  // 편집 중에는 본문을 다시 읽지 않는다 — `draft` 는 열 때의 본문에서 갈라져
  // 나온 사용자의 작업본이고, 그 아래 `detail` 을 갈아끼우면 저장 시 무엇을
  // 덮어쓰는지가 사용자 눈에 보이던 것과 달라진다. 목록은 편집 중에도 안전하다.
  const refreshFromDisk = useCallback(() => {
    void loadList();
    if (!editing && selectedId) void loadDetail(selectedId, true);
  }, [loadList, loadDetail, editing, selectedId]);
  useOculpmDataEvents("discussion", projectId, true, refreshFromDisk);

  // ── actions ────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setNewTitle("");
    setNewTemplate("decision");
    setCreating(true);
  };

  const submitCreate = async () => {
    // `t` 는 번역 함수 이름이라 지역 변수로 쓰지 않는다.
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) return;
    setBusy(true);
    const res = await commands.discussionCreate(projectId, trimmedTitle);
    if (res.status !== "ok") {
      setBusy(false);
      toast.destructive(t("disc.createFailed", { error: res.error }));
      return;
    }
    const id = res.data.discussion_id;
    // 템플릿은 골격 위에 본문만 덮어쓴다 ("빈 문서" 면 그대로 둔다).
    const body = templateBody(newTemplate);
    if (body) {
      const w = await commands.discussionWrite(projectId, id, body);
      if (w.status !== "ok") toast.destructive(t("disc.saveFailed", { error: w.error }));
    }
    setBusy(false);
    setCreating(false);
    await loadList();
    pendingEditRef.current = id;
    select(id);
  };

  const saveBody = async (text: string) => {
    if (!selectedId) return;
    setBusy(true);
    const res = await commands.discussionWrite(projectId, selectedId, text);
    setBusy(false);
    if (res.status === "ok") {
      setEditing(false);
      setDetail(res.data);
      void loadList();
      toast.info(t("disc.saved"));
    } else toast.destructive(t("disc.saveFailed", { error: res.error }));
  };

  /** 이 문서를 읽고 논의를 시작하라는 지시문을 클립보드로. */
  const copyPrompt = async () => {
    if (!detail) return;
    const text = buildDiscussionPrompt(detail);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.info(t("disc.promptCopied"));
    } catch {
      toast.destructive(t("disc.promptCopyFailed"));
    }
  };

  const copyPath = async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.discussion.file_path);
      toast.info(t("disc.pathCopied"));
    } catch {
      toast.destructive(t("disc.promptCopyFailed"));
    }
  };

  /** 편집기를 열지 않고 토의 로그에 한 줄 append (규격 §3: 기존 행 불변). */
  const addNote = async (body: string) => {
    if (!selectedId) return false;
    const raw = await commands.discussionReadRaw(projectId, selectedId);
    if (raw.status !== "ok") {
      toast.destructive(t("disc.editorFailed", { error: raw.error }));
      return false;
    }
    const op = appendLogRowOp(raw.data, {
      author: SELF_AUTHOR,
      ts: localIsoWithOffset(new Date()),
      body,
      heading: sectionHeadings().log,
      columns: logColumns(),
    });
    const next = raw.data.slice(0, op.from) + op.insert + raw.data.slice(op.to);
    const res = await commands.discussionWrite(projectId, selectedId, next);
    if (res.status !== "ok") {
      toast.destructive(t("disc.saveFailed", { error: res.error }));
      return false;
    }
    setDetail(res.data);
    void loadList();
    return true;
  };

  const changeStatus = async (status: string) => {
    if (!selectedId) return;
    setBusy(true);
    const res = await commands.discussionSetStatus(projectId, selectedId, status);
    setBusy(false);
    if (res.status === "ok") {
      setDetail(res.data);
      void loadList();
    } else toast.destructive(tError(res.error));
  };

  const submitRename = async () => {
    if (!selectedId) return;
    // `t` 는 번역 함수 이름이라 지역 변수로 쓰지 않는다.
    const trimmedRename = renameTitle.trim();
    if (!trimmedRename) return;
    setBusy(true);
    const res = await commands.discussionRename(projectId, selectedId, trimmedRename);
    setBusy(false);
    if (res.status === "ok") {
      setRenaming(false);
      setDetail(res.data);
      void loadList();
    } else toast.destructive(tError(res.error));
  };

  const remove = async () => {
    if (!selectedId) return;
    if (!window.confirm(t("disc.deleteConfirm"))) return;
    setBusy(true);
    const res = await commands.discussionDelete(projectId, selectedId);
    setBusy(false);
    if (res.status === "ok") {
      select(null);
      await loadList();
    } else toast.destructive(tError(res.error));
  };

  const attach = async () => {
    if (!selectedId) return;
    const res = await commands.discussionAttachViaDialog(projectId, selectedId);
    if (res.status === "ok") {
      if (res.data) {
        await loadDetail(selectedId);
        toast.info(t("disc.attached"));
      }
    } else toast.destructive(tError(res.error));
  };

  const detach = async (relPath: string) => {
    if (!selectedId) return;
    const res = await commands.discussionDetach(projectId, selectedId, relPath);
    if (res.status === "ok") await loadDetail(selectedId);
    else toast.destructive(tError(res.error));
  };

  const confirmPromote = async () => {
    if (!selectedId) return;
    setBusy(true);
    const res = await commands.discussionPromoteToPlan(projectId, selectedId);
    setBusy(false);
    setPromoting(false);
    if (res.status === "ok") {
      setState((prev) => ({ ...prev, plannerPlanId: res.data }));
      toast.info(t("disc.promoted"));
      onNavigate("planner");
    } else toast.destructive(tError(res.error));
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
          <span className={`disc-status ${meta.cls}`}>{meta.labelKey ? t(meta.labelKey) : meta.rawLabel}</span>
        </div>
        {d.problem_preview ? <div className="disc-item-preview">{d.problem_preview}</div> : null}
        <div className="disc-item-meta">
          {d.option_count > 0 ? <span>{t("disc.options", { n: d.option_count })}</span> : null}
          {d.next_step_count > 0 ? <span>{t("disc.nextSteps", { n: d.next_step_count })}</span> : null}
          {d.resolution_plan_id ? <span>· → 📋</span> : null}
          <span style={{ marginLeft: "auto" }}>{shortDate(d.updated_at)}</span>
        </div>
      </button>
    );
  };

  return (
    <>
      <Toolbar
        title={t("nav.discussion")}
        sub={list ? t("disc.toolbarSub", { n: active.length, open: openCount }) : undefined}
      >
        <button type="button" className="disc-btn primary" onClick={openCreate}>
          <Plus size={14} /> {t("disc.new")}
        </button>
      </Toolbar>

      {list === null ? (
        <div className="scroll">
          <div className="page">
            <div className="grid place-items-center py-20">
              <OculSpinner size={28} label={t("common.loading")} />
            </div>
          </div>
        </div>
      ) : (
        <div className={`disc-body${editing ? " editing" : ""}`}>
          <aside className="disc-list">
            {listError ? (
              <div className="empty-hint">{t("disc.listFailed", { error: listError })}</div>
            ) : list.length === 0 ? (
              <div className="empty-hint">
                {t("disc.empty")}
                <br />
                {t("disc.emptyHint")}
              </div>
            ) : (
              <>
                {active.map(renderItem)}
                {archived.length > 0 ? (
                  <>
                    <div className="disc-archive-head">{t("disc.archiveHead", { n: archived.length })}</div>
                    {archived.map(renderItem)}
                  </>
                ) : null}
              </>
            )}
          </aside>

          <div className="disc-main">
            {selectedId == null ? (
              <div className="empty-hint">{t("disc.pickOne")}</div>
            ) : detailLoading && !detail ? (
              <div className="grid place-items-center py-20">
                <OculSpinner size={24} label={t("disc.openingDoc")} />
              </div>
            ) : !detail ? (
              <div className="empty-hint">{t("disc.docFailed")}</div>
            ) : editing ? (
              <div className="disc-edit-shell">
                <div className="disc-edit-head">
                  <span className="disc-edit-title">{detail.discussion.title}</span>
                  <span className="disc-edit-path">{detail.discussion.file_path}</span>
                </div>
                <Suspense
                  fallback={
                    <div className="grid place-items-center py-20">
                      <OculSpinner size={22} label={t("common.loading")} />
                    </div>
                  }
                >
                  <DiscussionEditor
                    key={selectedId}
                    initialText={draft}
                    mode={editorMode}
                    onModeChange={setEditorMode}
                    onSave={(text) => void saveBody(text)}
                    onCancel={() => setEditing(false)}
                    busy={busy}
                    author={SELF_AUTHOR}
                  />
                </Suspense>
              </div>
            ) : (
              <div className="disc-doc fade-in">
                {/* ── 헤더 ── */}
                <div className="disc-head">
                  {renaming ? (
                    <div className="disc-head-title">
                      <input
                        aria-label={t("disc.renameAria")}
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
                    {statusMeta(detail.discussion.status).labelKey
                      ? t(statusMeta(detail.discussion.status).labelKey!)
                      : statusMeta(detail.discussion.status).rawLabel}
                  </span>
                </div>

                <div className="disc-owner">
                  <span
                    className="disc-log-dot"
                    style={{ background: agentColor(detail.discussion.owner) }}
                  />
                  {agentLabel(detail.discussion.owner)} · {shortDate(detail.discussion.updated_at)}
                  <button
                    type="button"
                    className="disc-path"
                    title={t("disc.copyPath")}
                    onClick={() => void copyPath()}
                  >
                    {detail.discussion.file_path}
                  </button>
                </div>

                {/* ── 액션 ── */}
                <div className="disc-actions">
                  <button
                    type="button"
                    className="disc-btn primary"
                    title={t(`disc.promptHint.${promptKindFor(detail)}` as I18nKey)}
                    onClick={() => void copyPrompt()}
                  >
                    {copied ? <ClipboardCheck size={14} /> : <Clipboard size={14} />}{" "}
                    {t("disc.copyPrompt")}
                  </button>
                  {!locked ? (
                    <button
                      type="button"
                      className="disc-btn"
                      onClick={() => void startEdit(detail.discussion.discussion_id)}
                    >
                      <Pencil size={14} /> {t("disc.edit")}
                    </button>
                  ) : null}
                  {detail.discussion.status === "open" ? (
                    <button
                      type="button"
                      className="disc-btn"
                      disabled={busy || detail.next_steps.length === 0}
                      title={
                        detail.next_steps.length === 0
                          ? t("disc.promoteNeedSteps")
                          : t("disc.promoteTitle")
                      }
                      onClick={() => setPromoting(true)}
                    >
                      <TargetIcon size={14} /> {t("disc.promote")}
                    </button>
                  ) : null}
                  <MoreMenu
                    label={t("disc.more")}
                    items={[
                      ...(!locked
                        ? [{ key: "attach", label: t("disc.attach"), run: () => void attach() }]
                        : []),
                      ...(!locked
                        ? [
                            {
                              key: "rename",
                              label: t("disc.rename"),
                              run: () => {
                                setRenameTitle(detail.discussion.title);
                                setRenaming(true);
                              },
                            },
                          ]
                        : []),
                      detail.discussion.status !== "open"
                        ? { key: "reopen", label: t("disc.reopen"), run: () => void changeStatus("open") }
                        : { key: "close", label: t("disc.close"), run: () => void changeStatus("resolved") },
                      ...(detail.discussion.status !== "archived"
                        ? [
                            {
                              key: "archive",
                              label: t("disc.archive"),
                              run: () => void changeStatus("archived"),
                            },
                          ]
                        : []),
                      { key: "delete", label: t("common.delete"), danger: true, run: () => void remove() },
                    ]}
                  />
                  {detail.resolution_plan_id ? (
                    <button
                      type="button"
                      className="disc-reslink"
                      onClick={() => {
                        setState((prev) => ({ ...prev, plannerPlanId: detail.resolution_plan_id }));
                        onNavigate("planner");
                      }}
                    >
                      <TargetIcon size={13} /> {t("disc.viewPlan", { id: detail.resolution_plan_id })}
                    </button>
                  ) : null}
                </div>

                <DiscussionView
                  projectId={projectId}
                  detail={detail}
                  locked={locked}
                  onDetach={detach}
                  onAddNote={addNote}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 새 문제 (제목 + 시작 템플릿) ── */}
      <AppDialog
        open={creating}
        onClose={() => setCreating(false)}
        label={t("disc.new")}
        width={640}
        initialFocusRef={newTitleRef}
      >
        <div className="disc-new">
          <h2>{t("disc.new")}</h2>
          <p className="disc-modal-sub">{t("disc.newSub")}</p>
          <input
            ref={newTitleRef}
            aria-label={t("disc.newTitleAria")}
            value={newTitle}
            placeholder={t("disc.newTitlePlaceholder")}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
            }}
          />
          <div className="disc-tpl-grid" role="group" aria-label={t("disc.tplAria")}>
            {TEMPLATE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`disc-tpl${newTemplate === id ? " on" : ""}`}
                aria-pressed={newTemplate === id}
                onClick={() => setNewTemplate(id)}
              >
                <span className="disc-tpl-name">{t(TEMPLATE_NAME[id])}</span>
                <span className="disc-tpl-desc">{t(TEMPLATE_DESC[id])}</span>
              </button>
            ))}
          </div>
          <div className="disc-modal-foot">
            <button type="button" className="disc-btn" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="disc-btn primary"
              disabled={busy || !newTitle.trim()}
              onClick={() => void submitCreate()}
            >
              {t("disc.create")}
            </button>
          </div>
        </div>
      </AppDialog>

      {promoting && detail ? (
        <div className="disc-modal-scrim" onClick={() => setPromoting(false)}>
          <div
            ref={promoteRef}
            className="disc-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("disc.promoteAria")}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{t("disc.promote")}</h2>
            <p className="disc-modal-sub">
              {t("disc.promoteBody", { n: detail.next_steps.length })}
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
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="disc-btn primary"
                disabled={busy}
                onClick={() => void confirmPromote()}
              >
                <ArrowRight size={14} /> {t("disc.promoteAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── 넘침 메뉴 ─────────────────────────────────────────────────────────────────

interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

/**
 * 부차 동작(첨부·이름 변경·닫기·보관·삭제)을 접어 두는 작은 메뉴. 헤더에
 * 회색 버튼 일곱 개가 늘어서 있으면 정작 자주 쓰는 세 개가 안 보인다.
 */
function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!hostRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="disc-more" ref={hostRef}>
      <button
        type="button"
        className="disc-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">···</span>
      </button>
      {open ? (
        <div className="disc-menu right" role="menu" aria-label={label}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`disc-menu-item${it.danger ? " danger" : ""}`}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
