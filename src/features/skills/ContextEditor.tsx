// AD-3 — 통합 상세 편집기 (docs/agent-discipline/00-master-plan.md D2).
//
// 예전엔 스킬 탭과 규칙 탭이 **같은 모양의 2-pane 편집기를 두 벌** 유지했다
// (헤더+칩+액션 / textarea / frontmatter 접기+마크다운 미리보기). 3존 화면이
// 목록을 하나로 접었으니 편집기도 하나여야 한다 — 종류별로 다른 건 헤더의 칩과
// 액션 줄, 그리고 규칙에만 붙는 paths 칩 편집기뿐이다.
//
// 파일 쓰기는 전부 명시적 버튼 경로다 (자동 저장 없음). 저장/삭제/토글/복사는
// 기존 커맨드를 그대로 부른다 — 이 화면이 새로 만든 백엔드는 없다.
import { useCallback, useEffect, useMemo, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { AppDialog } from "@/components/ui/AppDialog";
import { ArrowLeft, Copy, Pencil, Trash2, X } from "@/components/Icons";
import type { RuleDetail, SkillDetail, SkillScope } from "@/lib/bindings";
import { rulesApi, skillsApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { toast } from "@/lib/toast";
import { tError } from "@/i18n/errors";
import { t, useT } from "@/i18n";
import { FiringBadge } from "./FiringBadge";
import type { FiringLedger } from "./useFiringLedger";
import { splitFrontmatter } from "./skillsModel";
import { parseRulePaths, setRulePaths } from "./rulesModel";
import { KIND_LABEL_KEY, type ContextItem } from "./contextModel";

interface ContextEditorProps {
  projectId: number;
  item: ContextItem;
  firing: FiringLedger;
  /** 목록으로 돌아간다. */
  onBack: () => void;
  /** 목록 갱신 요청 (저장·토글·복사 후). */
  onChanged: () => void;
  /** 삭제 성공 — 호출부가 목록으로 되돌린다. */
  onDeleted: () => void;
}

type Loaded =
  | { kind: "skill"; detail: SkillDetail }
  | { kind: "rule"; detail: RuleDetail };

const scopeLabel = (scope: "project" | "global") =>
  scope === "project" ? t("rules.scope.project") : t("rules.scope.global");

export function ContextEditor({
  projectId,
  item,
  firing,
  onBack,
  onChanged,
  onDeleted,
}: ContextEditorProps) {
  useT();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isSkill = item.kind === "skill";

  useEffect(() => {
    let alive = true;
    setState("loading");
    setError(null);
    setEditing(false);
    const load: Promise<Loaded> = isSkill
      ? skillsApi
          .read(projectId, item.scope as SkillScope, item.skill?.dir_name ?? "")
          .then((detail) => ({ kind: "skill", detail }))
      : rulesApi
          .read(projectId, item.scope, item.rule?.rel_path ?? "")
          .then((detail) => ({ kind: "rule", detail }));
    void load.then(
      (next) => {
        if (!alive) return;
        setLoaded(next);
        setState("ready");
      },
      (err: unknown) => {
        if (!alive) return;
        setLoaded(null);
        setError(tError(toAppError(err)));
        setState("error");
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId, isSkill, item.scope, item.skill?.dir_name, item.rule?.rel_path, nonce]);

  const content = loaded?.detail.content ?? "";

  const startEdit = useCallback(() => {
    setDraft(content);
    setEditing(true);
  }, [content]);

  const save = useCallback(async () => {
    if (!loaded || busy) return;
    setBusy(true);
    try {
      if (loaded.kind === "skill") {
        const e = loaded.detail.entry;
        const entry = await skillsApi.save(projectId, e.scope, e.dir_name, draft, false);
        toast.info(t("sk.saved"));
        setLoaded({ kind: "skill", detail: { ...loaded.detail, entry, content: draft } });
      } else {
        const e = loaded.detail.entry;
        const outcome = await rulesApi.save(projectId, e.scope, e.rel_path, draft, false);
        if (outcome.mirror?.action === "conflict") {
          toast.destructive(t("rules.savedMirrorConflict", { path: outcome.mirror.mirror_rel }));
        } else {
          toast.info(t("rules.saved", { path: item.path }));
        }
        setLoaded({
          kind: "rule",
          detail: { ...loaded.detail, entry: outcome.entry, content: draft },
        });
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, item.path, loaded, onChanged, projectId]);

  const toggleEnabled = useCallback(async () => {
    if (!loaded || loaded.kind !== "skill" || busy) return;
    const e = loaded.detail.entry;
    setBusy(true);
    try {
      const next = await skillsApi.setEnabled(projectId, e.scope, e.dir_name, !e.enabled);
      toast.info(next.enabled ? t("sk.enabled", { name: next.name }) : t("sk.disabled", { name: next.name }));
      setNonce((n) => n + 1);
      onChanged();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  }, [busy, loaded, onChanged, projectId]);

  const copyScope = useCallback(async () => {
    if (!loaded || loaded.kind !== "skill" || busy) return;
    const e = loaded.detail.entry;
    const to: SkillScope = e.scope === "project" ? "global" : "project";
    setBusy(true);
    try {
      await skillsApi.copy(projectId, e.scope, to, e.dir_name);
      toast.info(
        to === "global" ? t("sk.copiedGlobal", { name: e.name }) : t("sk.copiedProject", { name: e.name }),
      );
      onChanged();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  }, [busy, loaded, onChanged, projectId]);

  const remove = useCallback(async () => {
    if (!loaded || busy) return;
    setBusy(true);
    try {
      const e = loaded.detail.entry;
      if (loaded.kind === "skill") {
        await skillsApi.remove(projectId, e.scope as SkillScope, loaded.detail.entry.dir_name);
        toast.info(t("sk.deleted", { name: e.name }));
      } else {
        await rulesApi.remove(projectId, e.scope, loaded.detail.entry.rel_path);
        toast.info(t("rules.ruleDeleted", { name: e.name }));
      }
      setDeleteOpen(false);
      onDeleted();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  }, [busy, loaded, onDeleted, projectId]);

  // ── 렌더 ────────────────────────────────────────────────────────────────

  const deletable = isSkill || item.kind === "rule"; // CLAUDE.md 는 구조적으로 비삭제
  const skillEntry = loaded?.kind === "skill" ? loaded.detail.entry : null;
  const ruleEntry = loaded?.kind === "rule" ? loaded.detail.entry : null;

  return (
    <section className="sk-detail" aria-label={t("ctx.detailAria")}>
      <header className="sk-head">
        <button
          type="button"
          className="sk-iconbtn"
          onClick={onBack}
          title={t("ctx.back")}
          aria-label={t("ctx.back")}
        >
          <ArrowLeft size={15} />
        </button>
        <div className="sk-head-meta">
          <div className="sk-head-name">
            {item.name}
            <span className="sk-chip">{scopeLabel(item.scope)}</span>
            <span className="sk-chip">{t(KIND_LABEL_KEY[item.kind])}</span>
            {skillEntry && !skillEntry.enabled ? <span className="sk-chip off">{t("sk.inactive")}</span> : null}
            {item.alwaysOn ? (
              <span className="sk-chip" title={t("firing.alwaysTitle")}>
                {t("firing.always")}
              </span>
            ) : (
              <FiringBadge stat={item.firing} measured={firing.measured} days={firing.days} />
            )}
            {ruleEntry?.mirror === "mirrored" ? <span className="sk-chip">Cursor</span> : null}
            {ruleEntry?.mirror === "conflict" ? (
              <span className="sk-chip off">{t("rules.conflict")}</span>
            ) : null}
          </div>
          <div className="sk-head-path">{item.path}</div>
        </div>
        <div className="sk-actions">
          {editing ? (
            <>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => void save()}>
                {t("common.save")}
              </button>
            </>
          ) : (
            <>
              {skillEntry ? (
                <>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => void toggleEnabled()}
                    title={skillEntry.enabled ? t("sk.disableTitle") : t("sk.enableTitle")}
                  >
                    {skillEntry.enabled ? t("sk.disable") : t("sk.enable")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => void copyScope()}
                    title={
                      skillEntry.scope === "project" ? t("sk.copyGlobalTitle") : t("sk.copyProjectTitle")
                    }
                  >
                    <Copy size={13} />{" "}
                    {skillEntry.scope === "project" ? t("sk.copyToGlobal") : t("sk.copyToProject")}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="btn ghost sm"
                disabled={state !== "ready"}
                onClick={startEdit}
              >
                <Pencil size={13} /> {t("sk.edit")}
              </button>
              {deletable ? (
                <button
                  type="button"
                  className="btn danger sm"
                  disabled={busy || state !== "ready"}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={13} /> {t("common.delete")}
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {state === "loading" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">{t("common.loading")}</div>
          </div>
        </div>
      ) : state === "error" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">
              {isSkill ? t("sk.readFailed") : t("ctx.ruleReadFailed")}
              <br />
              {error}
            </div>
          </div>
        </div>
      ) : editing ? (
        <Editor
          draft={draft}
          setDraft={setDraft}
          showPaths={item.kind === "rule"}
          hint={
            isSkill ? (
              <>
                {t("sk.footer1")} <code>description</code> {t("sk.footer2")}
              </>
            ) : item.kind === "rule" ? (
              <>
                {t("rules.footer1")} <code>paths</code> {t("rules.footer2")}
              </>
            ) : (
              <>{t("rules.footerMemory")}</>
            )
          }
          ariaLabel={isSkill ? t("sk.editAria") : t("rules.editAria")}
          onSave={() => void save()}
        />
      ) : (
        <div className="sk-scroll">
          <article className="sk-article">
            <Preview content={content} />
            {loaded?.kind === "skill" && loaded.detail.files.length > 0 ? (
              <div className="sk-files">
                <div className="sk-files-title">
                  {t("sk.filesTitle", { n: loaded.detail.files.length })}
                </div>
                <ul>
                  {loaded.detail.files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        </div>
      )}

      <AppDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        label={isSkill ? t("sk.deleteConfirmLabel") : t("rules.deleteConfirmLabel")}
        width={440}
      >
        <div className="sk-modal-head">
          <Trash2 size={15} /> {isSkill ? t("sk.deleteTitle") : t("rules.deleteTitle")}
        </div>
        <div className="sk-modal-warn">
          <code>{item.path}</code>{" "}
          {isSkill ? t("sk.deleteBody1") : t("rules.deleteBody1")}
          {isSkill && skillEntry && skillEntry.extra_files > 0
            ? t("sk.deleteExtra", { n: skillEntry.extra_files })
            : ""}
          {!isSkill && ruleEntry?.mirror === "mirrored" ? t("rules.deleteMirrorNote") : ""}
          {isSkill ? t("sk.deleteBody2") : t("rules.deleteBody2")}
        </div>
        <div className="sk-modal-foot">
          <button type="button" className="btn ghost sm" onClick={() => setDeleteOpen(false)}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn danger sm" disabled={busy} onClick={() => void remove()}>
            {t("common.delete")}
          </button>
        </div>
      </AppDialog>
    </section>
  );
}

/** 원문 편집기 — 규칙이면 paths 칩 편집기를 얹는다 (draft 가 SSOT). */
function Editor({
  draft,
  setDraft,
  showPaths,
  hint,
  ariaLabel,
  onSave,
}: {
  draft: string;
  setDraft: (v: string) => void;
  showPaths: boolean;
  hint: React.ReactNode;
  ariaLabel: string;
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

  return (
    <div className="sk-editor">
      {showPaths ? (
        <div className="sk-paths" aria-label={t("rules.pathsEditorAria")}>
          <span className="sk-paths-label">paths</span>
          {paths.map((p, i) => (
            <span key={`${p}:${i}`} className="sk-path-chip">
              {p}
              <button
                type="button"
                aria-label={t("rules.removePath", { path: p })}
                onClick={() => setDraft(setRulePaths(draft, paths.filter((_, idx) => idx !== i)))}
              >
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
        aria-label={ariaLabel}
        spellCheck={false}
      />
      <div className="sk-editor-hint">{hint}</div>
    </div>
  );
}

/** frontmatter 는 접이식 원문으로, 본문만 마크다운 렌더. */
function Preview({ content }: { content: string }) {
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
