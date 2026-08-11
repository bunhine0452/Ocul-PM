// 규칙 탭 (PR-CI3, docs/claude-integration/03-rules-hub-ui-spec.md §5) —
// CLAUDE.md 계열 고정 슬롯 + `.claude/rules/**/*.md`(프로젝트/전역)를 스킬과
// 같은 2-pane 으로 조회·생성·편집·삭제한다. SSOT 는 디스크 (rules_* 커맨드,
// 캐시 없음). 편집은 원문 textarea 가 정본이고 paths 칩 편집기는 draft 의
// frontmatter 행만 치환한다 (rulesModel). Cursor 병행 배포는 config
// `agents.rules_translate` 옵인 — 토글 직후 rules_sync_translations 로 수렴.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Toolbar } from "@/components/Toolbar";
import { Markdown } from "@/components/Markdown";
import { AppDialog } from "@/components/ui/AppDialog";
import { RefreshCw, Plus, Pencil, Trash2, FileCode, X } from "@/components/Icons";
import {
  commands,
  type MirrorWriteResult,
  type RuleDetail,
  type RuleEntry,
  type RuleScope,
  type RulesOverview,
} from "@/lib/bindings";
import { oculpmApi } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { splitFrontmatter } from "./skillsModel";
import {
  claudeMdTemplate,
  isValidRuleName,
  parseRulePaths,
  ruleTemplate,
  setRulePaths,
} from "./rulesModel";
import { t, useT } from "@/i18n";

interface RulesTabProps {
  projectId: number;
  /** 허브 세그먼트 탭 — Toolbar 액션 영역 맨 앞에 놓는다. */
  tabs: ReactNode;
}

type SelKey = { scope: RuleScope; relPath: string } | null;

const scopeLabel = (scope: RuleScope) => (scope === "project" ? t("rules.scope.project") : t("rules.scope.global"));

/** 목록/헤더 표시 경로 — 전역은 `~/` 접두로 스코프를 드러낸다. */
const displayPath = (e: RuleEntry) =>
  e.scope === "global" ? `~/${e.rel_path}` : e.rel_path;

/** 토글/동기화 결과 요약 토스트 문구. */
function mirrorSummary(results: MirrorWriteResult[]): string {
  useT();
  const count = (action: string) => results.filter((r) => r.action === action).length;
  const parts: string[] = [];
  if (count("written")) parts.push(t("rules.mirror.written", { n: count("written") }));
  if (count("removed")) parts.push(t("rules.mirror.removed", { n: count("removed") }));
  if (count("conflict")) parts.push(t("rules.mirror.conflict", { n: count("conflict") }));
  return parts.length ? parts.join(" · ") : t("rules.mirror.none");
}

export function RulesTab({ projectId, tabs }: RulesTabProps) {
  useT();
  const [overview, setOverview] = useState<RulesOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SelKey>(null);
  const [detail, setDetail] = useState<RuleDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  /** 저장/삭제/토글 등 변이 중 중복 클릭 방지. */
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createScope, setCreateScope] = useState<RuleScope>("project");
  const [createName, setCreateName] = useState("");
  const [createPaths, setCreatePaths] = useState("");
  const createNameRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadList = useCallback(async () => {
    setListError(null);
    const res = await commands.rulesList(projectId);
    if (res.status === "ok") {
      setOverview(res.data);
      setStatus("ready");
    } else {
      setListError(res.error);
      setStatus("error");
    }
  }, [projectId]);

  useEffect(() => {
    setStatus("loading");
    setSelected(null);
    void loadList();
  }, [loadList]);

  /** 선택 가능한(=실존) 항목의 평탄 목록 — 선택 보정용. */
  const selectable = useMemo(() => {
    if (!overview) return [] as RuleEntry[];
    return [
      ...overview.claude_md.filter((e) => e.exists),
      ...overview.project_rules,
      ...overview.global_rules,
    ];
  }, [overview]);

  // 목록 로드/변이 후 선택 보정: 유효하면 유지, 아니면 첫 항목.
  useEffect(() => {
    if (status !== "ready") return;
    setSelected((prev) => {
      if (prev && selectable.some((e) => e.scope === prev.scope && e.rel_path === prev.relPath)) {
        return prev;
      }
      const first = selectable[0];
      return first ? { scope: first.scope, relPath: first.rel_path } : null;
    });
  }, [status, selectable]);

  // 선택 규칙 상세(원문) 로드.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailState("idle");
      return;
    }
    let alive = true;
    setDetailState("loading");
    setDetailError(null);
    setEditing(false);
    void commands.rulesRead(projectId, selected.scope, selected.relPath).then((res) => {
      if (!alive) return;
      if (res.status === "ok") {
        setDetail(res.data);
        setDetailState("idle");
      } else {
        setDetail(null);
        setDetailError(res.error);
        setDetailState("error");
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, selected]);

  // ── 변이 ──────────────────────────────────────────────────────────────────

  const startEdit = () => {
    if (!detail) return;
    setDraft(detail.content);
    setEditing(true);
  };

  const saveDraft = async () => {
    if (!detail || busy) return;
    const e = detail.entry;
    setBusy(true);
    const res = await commands.rulesSave(projectId, e.scope, e.rel_path, draft, false);
    setBusy(false);
    if (res.status === "ok") {
      if (res.data.mirror?.action === "conflict") {
        toast.destructive(
          t("rules.savedMirrorConflict", { path: res.data.mirror.mirror_rel }),
        );
      } else {
        toast.info(t("rules.saved", { path: displayPath(e) }));
      }
      setEditing(false);
      setDetail({ ...detail, entry: res.data.entry, content: draft });
      void loadList(); // paths/제목·미러 배지가 바뀌었을 수 있으니 목록 동기화
    } else {
      toast.destructive(res.error);
    }
  };

  /** CLAUDE.md 계열 미존재 슬롯 → 시드 본문으로 생성 후 선택. */
  const createClaudeMd = async (e: RuleEntry) => {
    if (busy) return;
    setBusy(true);
    const res = await commands.rulesSave(
      projectId,
      e.scope,
      e.rel_path,
      claudeMdTemplate(e.rel_path, e.scope === "global"),
      true,
    );
    setBusy(false);
    if (res.status === "ok") {
      toast.info(t("rules.created", { path: displayPath(e) }));
      await loadList();
      setSelected({ scope: e.scope, relPath: e.rel_path });
    } else {
      toast.destructive(res.error);
    }
  };

  const openCreate = () => {
    setCreateScope("project");
    setCreateName("");
    setCreatePaths("");
    setCreateOpen(true);
  };

  const createValid = isValidRuleName(createName.trim());
  const submitCreate = async () => {
    const name = createName.trim();
    if (!createValid || busy) return;
    const paths = createPaths
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    setBusy(true);
    const res = await commands.rulesSave(
      projectId,
      createScope,
      `.claude/rules/${name}.md`,
      ruleTemplate(name, paths),
      true,
    );
    setBusy(false);
    if (res.status === "ok") {
      toast.info(t("rules.ruleCreated", { name }));
      setCreateOpen(false);
      await loadList();
      setSelected({ scope: createScope, relPath: `.claude/rules/${name}.md` });
    } else {
      toast.destructive(res.error);
    }
  };

  const submitDelete = async () => {
    if (!detail || busy) return;
    const e = detail.entry;
    setBusy(true);
    const res = await commands.rulesDelete(projectId, e.scope, e.rel_path);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(t("rules.ruleDeleted", { name: e.name }));
      setDeleteOpen(false);
      setSelected(null); // 보정 이펙트가 첫 항목을 재선택
      await loadList();
    } else {
      toast.destructive(res.error);
    }
  };

  /** Cursor 병행 배포 옵인 토글 — config 저장 후 미러 전체 화해. */
  const toggleTranslate = async () => {
    if (!overview || busy) return;
    const turnOn = !overview.cursor_translate;
    setBusy(true);
    try {
      const cfg = await oculpmApi.getConfig(projectId);
      const targets = new Set(cfg.agents.rules_translate ?? []);
      if (turnOn) targets.add("cursor");
      else targets.delete("cursor");
      await oculpmApi.setConfig(projectId, {
        ...cfg,
        agents: { ...cfg.agents, rules_translate: [...targets] },
      });
      const res = await commands.rulesSyncTranslations(projectId);
      if (res.status === "ok") {
        toast.info(
          turnOn
            ? t("rules.mirrorOn", { summary: mirrorSummary(res.data) })
            : t("rules.mirrorOff", { summary: mirrorSummary(res.data) }),
        );
      } else {
        toast.destructive(t("rules.mirrorFailed", { error: res.error }));
      }
      await loadList();
    } catch (err) {
      toast.destructive(
        t("rules.translateSaveFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  const sub =
    status === "ready" && overview
      ? `${t("rules.toolbarSub", { p: overview.project_rules.length, g: overview.global_rules.length })}${
          overview.cursor_translate ? t("rules.cursorDeploying") : ""
        }`
      : undefined;

  return (
    <>
      <Toolbar title={t("nav.skills")} sub={sub}>
        {tabs}
        <button
          type="button"
          className="sk-iconbtn"
          onClick={() => void loadList()}
          title={t("rules.refresh")}
          aria-label={t("rules.refresh")}
        >
          <RefreshCw size={15} />
        </button>
        <button type="button" className="btn primary sm" onClick={openCreate}>
          <Plus size={14} /> {t("rules.new")}
        </button>
      </Toolbar>

      {status === "loading" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">{t("rules.loading")}</div>
          </div>
        </div>
      ) : status === "error" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">
              {t("rules.loadFailed")}
              <br />
              {listError}
            </div>
          </div>
        </div>
      ) : (
        <div className="sk-body">
          <aside className="sk-list" aria-label={t("rules.listAria")}>
            <ClaudeMdSection
              entries={overview?.claude_md ?? []}
              selected={selected}
              busy={busy}
              onSelect={(e) => setSelected({ scope: e.scope, relPath: e.rel_path })}
              onCreate={(e) => void createClaudeMd(e)}
            />
            <RulesSection
              title={t("rules.projectRules")}
              entries={overview?.project_rules ?? []}
              selected={selected}
              onSelect={(e) => setSelected({ scope: e.scope, relPath: e.rel_path })}
            />
            <div className="sk-translate">
              <label className="sk-translate-label">
                <input
                  type="checkbox"
                  checked={overview?.cursor_translate ?? false}
                  disabled={busy}
                  onChange={() => void toggleTranslate()}
                />
                {t("rules.mirrorToCursor")}
              </label>
              <p className="sk-translate-hint">
                {t("rules.mirrorHint1")} <code>.cursor/rules/*.mdc</code> {t("rules.mirrorHint2")}{" "}
                {t("rules.mirrorHint3")}<code>paths</code>→<code>globs</code>{t("rules.mirrorHint4")}
              </p>
            </div>
            <RulesSection
              title="전역 규칙"
              entries={overview?.global_rules ?? []}
              selected={selected}
              onSelect={(e) => setSelected({ scope: e.scope, relPath: e.rel_path })}
            />
          </aside>

          <section className="sk-main" aria-label="규칙 상세">
            {detailState === "loading" ? (
              <div className="scroll">
                <div className="page">
                  <div className="empty-hint">불러오는 중…</div>
                </div>
              </div>
            ) : detailState === "error" ? (
              <div className="scroll">
                <div className="page">
                  <div className="empty-hint">
                    규칙을 읽지 못했습니다.
                    <br />
                    {detailError}
                  </div>
                </div>
              </div>
            ) : detail ? (
              <>
                <header className="sk-head">
                  <div className="sk-head-meta">
                    <div className="sk-head-name">
                      {detail.entry.kind === "claude_md" ? displayPath(detail.entry) : detail.entry.name}
                      <span className="sk-chip">{scopeLabel(detail.entry.scope)}</span>
                      {detail.entry.kind === "claude_md" || detail.entry.paths.length === 0 ? (
                        <span className="sk-chip" title="세션 시작 시 항상 로드됩니다">
                          항상 로드
                        </span>
                      ) : (
                        <span
                          className="sk-chip"
                          title={`매칭 파일 작업 시에만 로드: ${detail.entry.paths.join(", ")}`}
                        >
                          paths {detail.entry.paths.length}
                        </span>
                      )}
                      {detail.entry.mirror === "mirrored" ? (
                        <span className="sk-chip" title="Cursor 미러가 배포되어 있습니다">
                          Cursor
                        </span>
                      ) : null}
                      {detail.entry.mirror === "conflict" ? (
                        <span
                          className="sk-chip off"
                          title="같은 경로에 다른 .mdc 가 있어 배포하지 않습니다 — 다른 규칙의 미러(중첩 경로는 같은 이름으로 평탄화됨)이거나 사용자/어댑터 파일입니다"
                        >
                          미러 충돌
                        </span>
                      ) : null}
                    </div>
                    <div className="sk-head-path" title={detail.abs_path}>
                      {displayPath(detail.entry)}
                    </div>
                  </div>
                  <div className="sk-actions">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => setEditing(false)}
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          className="btn primary sm"
                          disabled={busy}
                          onClick={() => void saveDraft()}
                        >
                          저장
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn ghost sm" onClick={startEdit}>
                          <Pencil size={13} /> 편집
                        </button>
                        {detail.entry.kind === "rule" ? (
                          <button
                            type="button"
                            className="btn danger sm"
                            disabled={busy}
                            onClick={() => setDeleteOpen(true)}
                          >
                            <Trash2 size={13} /> 삭제
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </header>

                {editing ? (
                  <RuleEditor
                    draft={draft}
                    setDraft={setDraft}
                    isRule={detail.entry.kind === "rule"}
                    onSave={() => void saveDraft()}
                  />
                ) : (
                  <div className="sk-scroll">
                    <article className="sk-article">
                      <RulePreview content={detail.content} />
                    </article>
                  </div>
                )}
              </>
            ) : (
              <div className="scroll">
                <div className="page">
                  <div className="empty-hint">왼쪽에서 규칙을 선택하거나 만들어 보세요.</div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* 새 규칙 모달. */}
      <AppDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        label={t("rules.createLabel")}
        width={520}
        initialFocusRef={createNameRef}
      >
        <div className="sk-modal-head">
          <FileCode size={15} /> {t("rules.new")}
        </div>
        <div className="sk-form">
          <div className="sk-field">
            <label htmlFor="rl-create-scope">{t("rules.scopeLabel")}</label>
            <div className="sk-scope-seg" id="rl-create-scope" role="radiogroup" aria-label={t("rules.scopeAria")}>
              <button
                type="button"
                role="radio"
                aria-checked={createScope === "project"}
                className={createScope === "project" ? "on" : ""}
                onClick={() => setCreateScope("project")}
              >
                {t("rules.thisProject")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={createScope === "global"}
                className={createScope === "global" ? "on" : ""}
                onClick={() => setCreateScope("global")}
              >
                {t("rules.globalAll")}
              </button>
            </div>
          </div>
          <div className="sk-field">
            <label htmlFor="rl-create-name">{t("rules.nameLabel")}</label>
            <input
              id="rl-create-name"
              ref={createNameRef}
              className="sk-input"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder={t("rules.namePlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
            <div className={"sk-field-hint" + (createName.trim() && !createValid ? " bad" : "")}>
              {createName.trim() && !createValid
                ? t("rules.nameInvalid")
                : createScope === "project"
                  ? t("rules.createsProject")
                  : t("rules.createsGlobal")}
            </div>
          </div>
          <div className="sk-field">
            <label htmlFor="rl-create-paths">{t("rules.pathsLabel")}</label>
            <input
              id="rl-create-paths"
              className="sk-input"
              value={createPaths}
              onChange={(e) => setCreatePaths(e.target.value)}
              placeholder={t("rules.pathsPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && createValid) void submitCreate();
              }}
            />
            <div className="sk-field-hint">
              {t("rules.pathsHint")}
            </div>
          </div>
        </div>
        <div className="sk-modal-foot">
          <button type="button" className="btn ghost sm" onClick={() => setCreateOpen(false)}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={!createValid || busy}
            onClick={() => void submitCreate()}
          >
            {t("rules.create")}
          </button>
        </div>
      </AppDialog>

      {/* 삭제 확인 모달. */}
      <AppDialog
        open={deleteOpen && detail != null}
        onClose={() => setDeleteOpen(false)}
        label={t("rules.deleteConfirmLabel")}
        width={440}
      >
        <div className="sk-modal-head">
          <Trash2 size={15} /> {t("rules.deleteTitle")}
        </div>
        <div className="sk-modal-warn">
          <code>{detail ? displayPath(detail.entry) : ""}</code> {t("rules.deleteBody1")}
          {detail?.entry.mirror === "mirrored" ? t("rules.deleteMirrorNote") : ""}{t("rules.deleteBody2")}
        </div>
        <div className="sk-modal-foot">
          <button type="button" className="btn ghost sm" onClick={() => setDeleteOpen(false)}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn danger sm"
            disabled={busy}
            onClick={() => void submitDelete()}
          >
            {t("common.delete")}
          </button>
        </div>
      </AppDialog>
    </>
  );
}

// ─── 하위 컴포넌트 ────────────────────────────────────────────────────────────

function ClaudeMdSection({
  entries,
  selected,
  busy,
  onSelect,
  onCreate,
}: {
  entries: RuleEntry[];
  selected: SelKey;
  busy: boolean;
  onSelect: (e: RuleEntry) => void;
  onCreate: (e: RuleEntry) => void;
}) {
  useT();
  return (
    <div className="sk-sec">
      <div className="sk-sec-head">
        {t("rules.claudeMemory")} <span className="sk-sec-count">{entries.filter((e) => e.exists).length}</span>
      </div>
      {entries.map((e) => {
        const on = selected?.scope === e.scope && selected?.relPath === e.rel_path;
        return e.exists ? (
          <button
            key={`${e.scope}:${e.rel_path}`}
            type="button"
            className={"sk-row" + (on ? " on" : "")}
            aria-current={on ? "true" : undefined}
            onClick={() => onSelect(e)}
          >
            <div className="sk-row-top">
              <span className="sk-row-name">{displayPath(e)}</span>
            </div>
            {e.title ? <div className="sk-row-desc">{e.title}</div> : null}
          </button>
        ) : (
          <button
            key={`${e.scope}:${e.rel_path}`}
            type="button"
            className="sk-row ghost"
            disabled={busy}
            onClick={() => onCreate(e)}
            title={t("rules.seedTitle")}
          >
            <div className="sk-row-top">
              <span className="sk-row-name">
                <Plus size={11} /> {t("rules.createNamed", { path: displayPath(e) })}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function RulesSection({
  title,
  entries,
  selected,
  onSelect,
}: {
  title: string;
  entries: RuleEntry[];
  selected: SelKey;
  onSelect: (e: RuleEntry) => void;
}) {
  useT();
  return (
    <div className="sk-sec">
      <div className="sk-sec-head">
        {title} <span className="sk-sec-count">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="sk-none">{t("rules.none")}</div>
      ) : (
        entries.map((e) => {
          const on = selected?.scope === e.scope && selected?.relPath === e.rel_path;
          return (
            <button
              key={`${e.scope}:${e.rel_path}`}
              type="button"
              className={"sk-row" + (on ? " on" : "")}
              aria-current={on ? "true" : undefined}
              onClick={() => onSelect(e)}
            >
              <div className="sk-row-top">
                <span className="sk-row-name">{e.name}</span>
                {e.paths.length > 0 ? (
                  <span className="sk-chip">paths {e.paths.length}</span>
                ) : (
                  <span className="sk-chip">{t("rules.always")}</span>
                )}
                {e.mirror === "mirrored" ? <span className="sk-chip">Cursor</span> : null}
                {e.mirror === "conflict" ? <span className="sk-chip off">{t("rules.conflict")}</span> : null}
              </div>
              {e.title ? <div className="sk-row-desc">{e.title}</div> : null}
            </button>
          );
        })
      )}
    </div>
  );
}

/** 편집기 — rule 이면 paths 칩 편집기를 원문 위에 얹는다 (draft 가 SSOT). */
function RuleEditor({
  draft,
  setDraft,
  isRule,
  onSave,
}: {
  draft: string;
  setDraft: (v: string) => void;
  isRule: boolean;
  onSave: () => void;
}) {
  useT();
  const [pathInput, setPathInput] = useState("");
  const paths = useMemo(() => parseRulePaths(draft), [draft]);

  const addPath = () => {
    const v = pathInput.trim();
    if (!v) return;
    setDraft(setRulePaths(draft, [...paths, v]));
    setPathInput("");
  };
  const removePath = (idx: number) => {
    setDraft(setRulePaths(draft, paths.filter((_, i) => i !== idx)));
  };

  return (
    <div className="sk-editor">
      {isRule ? (
        <div className="sk-paths" aria-label={t("rules.pathsEditorAria")}>
          <span className="sk-paths-label">paths</span>
          {paths.map((p, i) => (
            <span key={`${p}:${i}`} className="sk-path-chip">
              {p}
              <button type="button" aria-label={t("rules.removePath", { path: p })} onClick={() => removePath(i)}>
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPath();
              }
            }}
            onBlur={addPath}
            placeholder={paths.length === 0 ? t("rules.globPlaceholderEmpty") : t("rules.globPlaceholder")}
            aria-label={t("rules.globAria")}
            spellCheck={false}
          />
        </div>
      ) : null}
      <textarea
        className="sk-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            onSave();
          }
        }}
        aria-label={t("rules.editAria")}
        spellCheck={false}
      />
      <div className="sk-editor-hint">
        {isRule ? (
          <>
            {t("rules.footer1")} <code>paths</code> {t("rules.footer2")}
          </>
        ) : (
          <>{t("rules.footerMemory")}</>
        )}
      </div>
    </div>
  );
}

/** frontmatter 는 접이식 원문으로, 본문만 마크다운 렌더 (스킬과 동일 규격). */
function RulePreview({ content }: { content: string }) {
  useT();
  const { meta, body } = useMemo(() => splitFrontmatter(content), [content]);
  return (
    <>
      {meta ? (
        <details className="sk-fm">
          <summary>frontmatter</summary>
          <pre>{meta}</pre>
        </details>
      ) : null}
      <Markdown>{body}</Markdown>
    </>
  );
}
