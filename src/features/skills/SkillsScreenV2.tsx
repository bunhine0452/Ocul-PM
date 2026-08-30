// 스킬·규칙 허브 (PR-CI3, docs/claude-integration/00-master-plan.md D5) —
// 12번째 화면을 탭 허브로 확장했다: [스킬] 기존 `.claude/skills/` 관리 그대로,
// [규칙] CLAUDE.md 계열 + `.claude/rules` CRUD·paths 편집·Cursor 병행 배포
// (RulesTab.tsx), [훅] CI0 훅 브리지 토글 (설정의 ClaudeHooksBlock 재사용).
// 탭 상태는 비영속 useState — localStorage 규율(WorkspaceContext 단독 소유)과
// 무관하다.
//
// 스킬 탭: 프로젝트/전역 Claude Code 스킬(`.claude/skills/`)을 GUI 로
// 조회·생성·편집·토글·복사·삭제한다. SSOT 는 디스크의 SKILL.md (백엔드
// commands/skills.rs — 캐시 없음). 좌: 스코프별 목록 / 우: 미리보기·편집.
// 비활성화는 `.claude/skills/.disabled/` 이동 규약 — 파일을 지우지 않고 로드에서만 뺀다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Toolbar } from "@/components/Toolbar";
import { PluginDocsTab } from "./PluginDocsTab";
import { Markdown } from "@/components/Markdown";
import { AppDialog } from "@/components/ui/AppDialog";
import { RefreshCw, Plus, Pencil, Trash2, Copy, Puzzle, Sparkles } from "@/components/Icons";
import {
  commands,
  type SkillDetail,
  type SkillEntry,
  type SkillScope,
  type SkillsOverview,
} from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { ClaudeHooksBlock } from "@/features/settings/OculpmSettings";
import { isValidSkillName, skillTemplate, splitFrontmatter } from "./skillsModel";
import { GALLERY_SKILLS } from "./skillsGallery";
import { CATALOG_SKILLS } from "./skillsCatalog";
import { FiringBadge } from "./FiringBadge";
import { skillFiring } from "./firingModel";
import { useFiringLedger, type FiringLedger } from "./useFiringLedger";
import { RulesTab } from "./RulesTab";
import { SkillShopTab } from "./SkillShopTab";
import { t, useT } from "@/i18n";
import "./skills.css";
import { tError } from "@/i18n/errors";

interface SkillsScreenV2Props {
  projectId: number;
}

type SelKey = { scope: SkillScope; dirName: string } | null;

const scopeLabel = (scope: SkillScope) => (scope === "project" ? t("rules.scope.project") : t("rules.scope.global"));

// ─── 허브 셸 ─────────────────────────────────────────────────────────────────

const HUB_TABS = [
  { id: "skills", labelKey: "sk.tab.skills" },
  { id: "shop", labelKey: "sk.tab.shop" },
  { id: "rules", labelKey: "sk.tab.rules" },
  { id: "hooks", labelKey: "sk.tab.hooks" },
  { id: "plugin", labelKey: "sk.tab.plugin" },
] as const;
type HubTab = (typeof HUB_TABS)[number]["id"];

export function SkillsScreenV2({ projectId }: SkillsScreenV2Props) {
  const [tab, setTab] = useState<HubTab>("skills");
  const tabs = <HubTabsSeg tab={tab} onChange={setTab} />;
  if (tab === "shop") return <SkillShopTab projectId={projectId} tabs={tabs} />;
  if (tab === "rules") return <RulesTab projectId={projectId} tabs={tabs} />;
  if (tab === "hooks") return <HooksTab projectId={projectId} tabs={tabs} />;
  if (tab === "plugin") return <PluginDocsTab tabs={tabs} />;
  return <SkillsTabView projectId={projectId} tabs={tabs} onOpenShop={() => setTab("shop")} />;
}

function HubTabsSeg({ tab, onChange }: { tab: HubTab; onChange: (t: HubTab) => void }) {
  return (
    <div className="sk-tabs" role="tablist" aria-label={t("sk.tabsAria")}>
      {HUB_TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          className={tab === entry.id ? "on" : ""}
          onClick={() => onChange(entry.id)}
        >
          {t(entry.labelKey)}
        </button>
      ))}
    </div>
  );
}

/** 훅 탭 — CI0 훅 브리지 블록(설정과 동일 컴포넌트)을 허브에서 바로 노출. */
function HooksTab({ projectId, tabs }: { projectId: number; tabs: ReactNode }) {
  return (
    <>
      <Toolbar title={t("nav.skills")} sub={t("sk.hooksSub")}>
        {tabs}
      </Toolbar>
      <div className="scroll">
        <div className="sk-hooks">
          <ClaudeHooksBlock projectId={projectId} />
          <p className="sk-hooks-hint">
            {t("sk.hooksNote")}
          </p>
        </div>
      </div>
    </>
  );
}

// ─── 스킬 탭 (기존 화면) ─────────────────────────────────────────────────────

function SkillsTabView({
  projectId,
  tabs,
  onOpenShop,
}: {
  projectId: number;
  tabs: ReactNode;
  onOpenShop: () => void;
}) {
  const { t } = useT();
  // AD-2 — 발동 원장. 목록·상세가 "이게 실제로 걸리기는 하는가" 를 답한다.
  const firing = useFiringLedger(projectId);
  const [overview, setOverview] = useState<SkillsOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SelKey>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  /** 저장/토글/복사/삭제 등 변이 중 중복 클릭 방지. */
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createScope, setCreateScope] = useState<SkillScope>("project");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const createNameRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // PR-CI5 — 추천 스킬 갤러리 (설치는 skills_save 재사용, 프로젝트 스코프).
  const [galleryOpen, setGalleryOpen] = useState(false);

  const loadList = useCallback(async () => {
    setListError(null);
    const res = await commands.skillsList(projectId);
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

  const all = useMemo(
    () => (overview ? [...overview.project, ...overview.global] : []),
    [overview],
  );

  // 목록 로드/변이 후 선택 보정: 유효하면 유지, 아니면 첫 항목.
  useEffect(() => {
    if (status !== "ready") return;
    setSelected((prev) => {
      if (prev && all.some((e) => e.scope === prev.scope && e.dir_name === prev.dirName)) {
        return prev;
      }
      const first = all[0];
      return first ? { scope: first.scope, dirName: first.dir_name } : null;
    });
  }, [status, all]);

  // 선택 스킬 상세(원문) 로드. detailNonce 는 토글/이동 후 강제 재조회용.
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
    void commands.skillsRead(projectId, selected.scope, selected.dirName).then((res) => {
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
  }, [projectId, selected, detailNonce]);

  // ── 변이 ──────────────────────────────────────────────────────────────────

  const toggleEnabled = async () => {
    if (!detail || busy) return;
    const e = detail.entry;
    setBusy(true);
    const res = await commands.skillsSetEnabled(projectId, e.scope, e.dir_name, !e.enabled);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(
        res.data.enabled ? t("sk.enabled", { name: res.data.name }) : t("sk.disabled", { name: res.data.name }),
      );
      await loadList();
      setDetailNonce((n) => n + 1);
    } else {
      toast.destructive(tError(res.error));
    }
  };

  const startEdit = () => {
    if (!detail) return;
    setDraft(detail.content);
    setEditing(true);
  };

  const saveDraft = async () => {
    if (!detail || busy) return;
    const e = detail.entry;
    setBusy(true);
    const res = await commands.skillsSave(projectId, e.scope, e.dir_name, draft, false);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(t("sk.saved"));
      setEditing(false);
      setDetail({ ...detail, entry: res.data, content: draft });
      void loadList(); // 이름/설명이 바뀌었을 수 있으니 목록 동기화
    } else {
      toast.destructive(tError(res.error));
    }
  };

  const copyToOtherScope = async () => {
    if (!detail || busy) return;
    const e = detail.entry;
    const to: SkillScope = e.scope === "project" ? "global" : "project";
    setBusy(true);
    const res = await commands.skillsCopy(projectId, e.scope, to, e.dir_name);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(
        to === "global" ? t("sk.copiedGlobal", { name: e.name }) : t("sk.copiedProject", { name: e.name }),
      );
      await loadList();
    } else {
      toast.destructive(tError(res.error));
    }
  };

  const submitDelete = async () => {
    if (!detail || busy) return;
    const e = detail.entry;
    setBusy(true);
    const res = await commands.skillsDelete(projectId, e.scope, e.dir_name);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(t("sk.deleted", { name: e.name }));
      setDeleteOpen(false);
      setSelected(null); // 보정 이펙트가 첫 항목을 재선택
      await loadList();
    } else {
      toast.destructive(tError(res.error));
    }
  };

  const openCreate = () => {
    setCreateScope("project");
    setCreateName("");
    setCreateDesc("");
    setCreateOpen(true);
  };

  // 갤러리 중복 설치 가드 — 프로젝트 스코프에 같은 폴더명이 있으면 "설치됨".
  // (비활성(.disabled) 상태도 dir_name 으로 잡힌다 — 재설치 대신 활성화 유도.)
  const installedGalleryIds = useMemo(
    () => new Set((overview?.project ?? []).map((e) => e.dir_name)),
    [overview],
  );
  const installGallerySkill = async (id: string) => {
    const g = GALLERY_SKILLS.find((x) => x.id === id);
    if (!g || busy) return;
    setBusy(true);
    const res = await commands.skillsSave(projectId, "project", g.id, g.content, true);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(t("sk.galleryInstalled", { id: g.id }));
      await loadList();
      setSelected({ scope: "project", dirName: g.id });
    } else {
      toast.destructive(tError(res.error));
    }
  };

  const createValid = isValidSkillName(createName.trim());
  const submitCreate = async () => {
    const name = createName.trim();
    if (!createValid || busy) return;
    setBusy(true);
    const res = await commands.skillsSave(
      projectId,
      createScope,
      name,
      skillTemplate(name, createDesc),
      true,
    );
    setBusy(false);
    if (res.status === "ok") {
      toast.info(t("sk.created", { name }));
      setCreateOpen(false);
      await loadList();
      setSelected({ scope: createScope, dirName: name });
    } else {
      toast.destructive(tError(res.error));
    }
  };

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  const sub =
    status === "ready" && overview
      ? t("sk.toolbarSub", { p: overview.project.length, g: overview.global.length }) +
        (firing.scanning ? ` · ${t("firing.measuring")}` : "")
      : undefined;

  return (
    <>
      <Toolbar title={t("nav.skills")} sub={sub}>
        {tabs}
        <button
          type="button"
          className="sk-iconbtn"
          onClick={() => void loadList()}
          title={t("sk.refresh")}
          aria-label={t("sk.refresh")}
        >
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setGalleryOpen(true)}
          title={t("sk.galleryTitle")}
        >
          <Sparkles size={14} /> {t("sk.gallery")}
        </button>
        <button type="button" className="btn primary sm" onClick={openCreate}>
          <Plus size={14} /> {t("sk.new")}
        </button>
      </Toolbar>

      {status === "loading" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">{t("sk.loading")}</div>
          </div>
        </div>
      ) : status === "error" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">
              {t("sk.loadFailed")}
              <br />
              {listError}
            </div>
          </div>
        </div>
      ) : all.length === 0 ? (
        <SkillsEmptyState onCreate={openCreate} onGallery={() => setGalleryOpen(true)} />
      ) : (
        <div className="sk-body">
          <aside className="sk-list" aria-label={t("sk.listAria")}>
            <ScopeSection
              title={t("rules.scope.project")}
              entries={overview?.project ?? []}
              selected={selected}
              firing={firing}
              onSelect={(e) => setSelected({ scope: e.scope, dirName: e.dir_name })}
            />
            <ScopeSection
              title={t("rules.scope.global")}
              entries={overview?.global ?? []}
              selected={selected}
              firing={firing}
              onSelect={(e) => setSelected({ scope: e.scope, dirName: e.dir_name })}
            />
          </aside>

          <section className="sk-main" aria-label={t("sk.detailAria")}>
            {detailState === "loading" ? (
              <div className="scroll">
                <div className="page">
                  <div className="empty-hint">{t("common.loading")}</div>
                </div>
              </div>
            ) : detailState === "error" ? (
              <div className="scroll">
                <div className="page">
                  <div className="empty-hint">
                    {t("sk.readFailed")}
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
                      {detail.entry.name}
                      <span className="sk-chip">{scopeLabel(detail.entry.scope)}</span>
                      {!detail.entry.enabled ? <span className="sk-chip off">{t("sk.inactive")}</span> : null}
                      <FiringBadge
                        stat={skillFiring(firing.index, detail.entry)}
                        measured={firing.measured}
                        days={firing.days}
                      />
                    </div>
                    <div className="sk-head-path" title={detail.skill_md_path}>
                      {detail.entry.display_path}/SKILL.md
                      {detail.entry.extra_files > 0
                        ? t("sk.extraFiles", { n: detail.entry.extra_files })
                        : ""}
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
                          {t("common.cancel")}
                        </button>
                        <button
                          type="button"
                          className="btn primary sm"
                          disabled={busy}
                          onClick={() => void saveDraft()}
                        >
                          {t("common.save")}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => void toggleEnabled()}
                          title={
                            detail.entry.enabled
                              ? t("sk.disableTitle")
                              : t("sk.enableTitle")
                          }
                        >
                          {detail.entry.enabled ? t("sk.disable") : t("sk.enable")}
                        </button>
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => void copyToOtherScope()}
                          title={
                            detail.entry.scope === "project"
                              ? t("sk.copyGlobalTitle")
                              : t("sk.copyProjectTitle")
                          }
                        >
                          <Copy size={13} />{" "}
                          {detail.entry.scope === "project" ? t("sk.copyToGlobal") : t("sk.copyToProject")}
                        </button>
                        <button type="button" className="btn ghost sm" onClick={startEdit}>
                          <Pencil size={13} /> {t("sk.edit")}
                        </button>
                        <button
                          type="button"
                          className="btn danger sm"
                          disabled={busy}
                          onClick={() => setDeleteOpen(true)}
                        >
                          <Trash2 size={13} /> {t("common.delete")}
                        </button>
                      </>
                    )}
                  </div>
                </header>

                {editing ? (
                  <div className="sk-editor">
                    <textarea
                      className="sk-textarea"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                          e.preventDefault();
                          void saveDraft();
                        }
                      }}
                      aria-label={t("sk.editAria")}
                      spellCheck={false}
                    />
                    <div className="sk-editor-hint">
                      {t("sk.footer1")} <code>description</code> {t("sk.footer2")}
                    </div>
                  </div>
                ) : (
                  <div className="sk-scroll">
                    <article className="sk-article">
                      <SkillPreview content={detail.content} />
                      {detail.files.length > 0 ? (
                        <div className="sk-files">
                          <div className="sk-files-title">{t("sk.filesTitle", { n: detail.files.length })}</div>
                          <ul>
                            {detail.files.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  </div>
                )}
              </>
            ) : (
              <div className="scroll">
                <div className="page">
                  <div className="empty-hint">{t("sk.pickSkill")}</div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* PR-CI5 — 추천 스킬 갤러리 모달. 설치는 skills_save(create=true) 재사용 —
          동명 스킬이 있으면 "설치됨" 으로 비활성 (백엔드 동명 거부가 이중 가드). */}
      <AppDialog
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        label={t("sk.galleryLabel")}
        width={620}
      >
        <div className="sk-modal-head">
          <Sparkles size={15} /> {t("sk.gallery")}
        </div>
        <div className="sk-gallery">
          <p className="sk-gallery-intro">
            {t("sk.galleryDesc1")}{" "}
              <code>.claude/skills/</code> {t("sk.galleryDesc2")}
          </p>
          <ul className="sk-gallery-list">
            {GALLERY_SKILLS.map((g) => {
              const installed = installedGalleryIds.has(g.id);
              return (
                <li key={g.id} className="sk-gallery-item">
                  <div className="sk-gallery-meta">
                    <div className="sk-gallery-name">{t(g.labelKey)}</div>
                    <div className="sk-gallery-desc">{t(g.summaryKey)}</div>
                  </div>
                  {installed ? (
                    <span className="sk-chip" title={t("sk.alreadyHere")}>
                      {t("sk.isInstalled")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn primary sm"
                      disabled={busy}
                      onClick={() => void installGallerySkill(g.id)}
                    >
                      {t("sk.install")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* 제3자 카탈로그는 '샵' 탭으로 승격 — 여기는 포인터만 (이중 유지 방지). */}
          <div className="sk-gallery-sec">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setGalleryOpen(false);
                onOpenShop();
              }}
            >
              {t("sk.catalogHint", { n: CATALOG_SKILLS.length })}
            </button>
          </div>
        </div>
        <div className="sk-modal-foot">
          <button type="button" className="btn ghost sm" onClick={() => setGalleryOpen(false)}>
            {t("common.close")}
          </button>
        </div>
      </AppDialog>

      {/* 새 스킬 모달 — AppDialog 셸 (포커스 트랩·복원·Esc 내장, v2 U13). */}
      <AppDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        label={t("sk.createLabel")}
        width={520}
        initialFocusRef={createNameRef}
      >
        <div className="sk-modal-head">
          <Puzzle size={15} /> {t("sk.new")}
        </div>
        <div className="sk-form">
          <div className="sk-field">
            <label htmlFor="sk-create-scope">{t("sk.scopeLabel")}</label>
            <div className="sk-scope-seg" id="sk-create-scope" role="radiogroup" aria-label={t("sk.scopeAria")}>
              <button
                type="button"
                role="radio"
                aria-checked={createScope === "project"}
                className={createScope === "project" ? "on" : ""}
                onClick={() => setCreateScope("project")}
              >
                {t("sk.thisProject")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={createScope === "global"}
                className={createScope === "global" ? "on" : ""}
                onClick={() => setCreateScope("global")}
              >
                {t("sk.globalAll")}
              </button>
            </div>
          </div>
          <div className="sk-field">
            <label htmlFor="sk-create-name">{t("sk.nameLabel")}</label>
            <input
              id="sk-create-name"
              ref={createNameRef}
              className="sk-input"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder={t("sk.namePlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
            <div className={"sk-field-hint" + (createName.trim() && !createValid ? " bad" : "")}>
              {createName.trim() && !createValid
                ? t("sk.nameInvalid")
                : createScope === "project"
                  ? t("sk.createsProject")
                  : t("sk.createsGlobal")}
            </div>
          </div>
          <div className="sk-field">
            <label htmlFor="sk-create-desc">{t("sk.descLabel")}</label>
            <input
              id="sk-create-desc"
              className="sk-input"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder={t("sk.descPlaceholder")}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && createValid) void submitCreate();
              }}
            />
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
            {t("sk.create")}
          </button>
        </div>
      </AppDialog>

      {/* 삭제 확인 모달. */}
      <AppDialog
        open={deleteOpen && detail != null}
        onClose={() => setDeleteOpen(false)}
        label={t("sk.deleteConfirmLabel")}
        width={440}
      >
        <div className="sk-modal-head">
          <Trash2 size={15} /> {t("sk.deleteTitle")}
        </div>
        <div className="sk-modal-warn">
          <code>{detail?.entry.display_path}</code> {t("sk.deleteBody1")}
          {detail && detail.entry.extra_files > 0
            ? t("sk.deleteExtra", { n: detail.entry.extra_files })
            : ""}
          {t("sk.deleteBody2")}
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

function ScopeSection({
  title,
  entries,
  selected,
  firing,
  onSelect,
}: {
  title: string;
  entries: SkillEntry[];
  selected: SelKey;
  firing: FiringLedger;
  onSelect: (e: SkillEntry) => void;
}) {
  return (
    <div className="sk-sec">
      <div className="sk-sec-head">
        {title} <span className="sk-sec-count">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="sk-none">{t("sk.none")}</div>
      ) : (
        entries.map((e) => {
          const on = selected?.scope === e.scope && selected?.dirName === e.dir_name;
          return (
            <button
              key={`${e.scope}:${e.dir_name}:${e.enabled}`}
              type="button"
              className={"sk-row" + (on ? " on" : "")}
              aria-current={on ? "true" : undefined}
              onClick={() => onSelect(e)}
            >
              <div className="sk-row-top">
                <span className="sk-row-name">{e.name}</span>
                {!e.enabled ? <span className="sk-chip off">{t("sk.inactive")}</span> : null}
                {e.extra_files > 0 ? <span className="sk-chip">+{e.extra_files}</span> : null}
                <FiringBadge
                  stat={skillFiring(firing.index, e)}
                  measured={firing.measured}
                  days={firing.days}
                />
              </div>
              {e.description ? <div className="sk-row-desc">{e.description}</div> : null}
            </button>
          );
        })
      )}
    </div>
  );
}

/** frontmatter 는 접이식 원문으로, 본문만 마크다운 렌더. */
function SkillPreview({ content }: { content: string }) {
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

function SkillsEmptyState({
  onCreate,
  onGallery,
}: {
  onCreate: () => void;
  onGallery: () => void;
}) {
  return (
    <div className="scroll">
      <div className="page">
        <div className="sk-empty">
          <Puzzle size={32} strokeWidth={1.5} className="sk-empty-ico" />
          <div className="sk-empty-title">{t("sk.emptyTitle")}</div>
          <p className="sk-empty-desc">
            {t("sk.emptyBody1")}{" "}
              <code>.claude/skills/&lt;name&gt;/SKILL.md</code> {t("sk.emptyBody2")}{" "}
              <code>~/.claude/skills/</code> {t("sk.emptyBody3")}
          </p>
          <div className="sk-empty-actions">
            <button type="button" className="btn ghost sm" onClick={onGallery}>
              <Sparkles size={14} /> {t("sk.viewGallery")}
            </button>
            <button type="button" className="btn primary sm" onClick={onCreate}>
              <Plus size={14} /> {t("sk.createNew")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
