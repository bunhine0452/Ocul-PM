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
import { RulesTab } from "./RulesTab";
import "./skills.css";

interface SkillsScreenV2Props {
  projectId: number;
}

type SelKey = { scope: SkillScope; dirName: string } | null;

const scopeLabel = (scope: SkillScope) => (scope === "project" ? "프로젝트" : "전역");

// ─── 허브 셸 ─────────────────────────────────────────────────────────────────

const HUB_TABS = [
  { id: "skills", label: "스킬" },
  { id: "rules", label: "규칙" },
  { id: "hooks", label: "훅" },
  { id: "plugin", label: "플러그인" },
] as const;
type HubTab = (typeof HUB_TABS)[number]["id"];

export function SkillsScreenV2({ projectId }: SkillsScreenV2Props) {
  const [tab, setTab] = useState<HubTab>("skills");
  const tabs = <HubTabsSeg tab={tab} onChange={setTab} />;
  if (tab === "rules") return <RulesTab projectId={projectId} tabs={tabs} />;
  if (tab === "hooks") return <HooksTab projectId={projectId} tabs={tabs} />;
  if (tab === "plugin") return <PluginDocsTab tabs={tabs} />;
  return <SkillsTabView projectId={projectId} tabs={tabs} />;
}

function HubTabsSeg({ tab, onChange }: { tab: HubTab; onChange: (t: HubTab) => void }) {
  return (
    <div className="sk-tabs" role="tablist" aria-label="스킬·규칙 허브 탭">
      {HUB_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          className={tab === t.id ? "on" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** 훅 탭 — CI0 훅 브리지 블록(설정과 동일 컴포넌트)을 허브에서 바로 노출. */
function HooksTab({ projectId, tabs }: { projectId: number; tabs: ReactNode }) {
  return (
    <>
      <Toolbar title="스킬·규칙" sub="Claude Code 훅 연동">
        {tabs}
      </Toolbar>
      <div className="scroll">
        <div className="sk-hooks">
          <ClaudeHooksBlock projectId={projectId} />
          <p className="sk-hooks-hint">
            훅이 켜지면 Claude Code 세션의 시작·종료가 휴리스틱이 아닌 실측 신호로 기록됩니다.
            세션 종료 시의 <strong>일지 자동 초안</strong>(과금)과 <strong>MCP 도구 등록</strong>은
            설정 → ocul-pm → 에이전트 연동에서 관리합니다.
          </p>
        </div>
      </div>
    </>
  );
}

// ─── 스킬 탭 (기존 화면) ─────────────────────────────────────────────────────

function SkillsTabView({ projectId, tabs }: { projectId: number; tabs: ReactNode }) {
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
        res.data.enabled ? `스킬 활성화: ${res.data.name}` : `스킬 비활성화: ${res.data.name}`,
      );
      await loadList();
      setDetailNonce((n) => n + 1);
    } else {
      toast.destructive(res.error);
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
      toast.info("SKILL.md 저장됨");
      setEditing(false);
      setDetail({ ...detail, entry: res.data, content: draft });
      void loadList(); // 이름/설명이 바뀌었을 수 있으니 목록 동기화
    } else {
      toast.destructive(res.error);
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
        to === "global" ? `전역 스킬로 복사됨: ${e.name}` : `이 프로젝트로 복사됨: ${e.name}`,
      );
      await loadList();
    } else {
      toast.destructive(res.error);
    }
  };

  const submitDelete = async () => {
    if (!detail || busy) return;
    const e = detail.entry;
    setBusy(true);
    const res = await commands.skillsDelete(projectId, e.scope, e.dir_name);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(`스킬 삭제됨: ${e.name}`);
      setDeleteOpen(false);
      setSelected(null); // 보정 이펙트가 첫 항목을 재선택
      await loadList();
    } else {
      toast.destructive(res.error);
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
      toast.info(`추천 스킬 설치됨: ${g.id}`);
      await loadList();
      setSelected({ scope: "project", dirName: g.id });
    } else {
      toast.destructive(res.error);
    }
  };

  // C3 (#catalog-ui) — 제3자 카탈로그: 갤러리를 열 때 스택을 결정적으로
  // 감지(LLM·네트워크 0)해 태그가 겹치는 스킬을 추천한다. 콘텐츠는 커밋 핀
  // 벤더 사본(skillsCatalog) — 설치도 skills_save 재사용.
  const [stackTags, setStackTags] = useState<string[] | null>(null);
  const [catalogAllOpen, setCatalogAllOpen] = useState(false);
  // 프로젝트가 바뀌면 감지 캐시를 비운다 — 이전 프로젝트 스택으로 추천하는 오염 방지.
  useEffect(() => {
    setStackTags(null);
  }, [projectId]);
  useEffect(() => {
    if (!galleryOpen || stackTags != null) return;
    // alive 가드: 프로젝트 제자리 전환 시 이전 프로젝트의 느린 감지 응답이
    // 늦게 도착해 새 프로젝트 추천을 오염시키는 것을 막는다.
    let alive = true;
    void commands.detectStack(projectId).then((res) => {
      if (!alive) return;
      setStackTags(res.status === "ok" ? res.data : []);
    });
    return () => {
      alive = false;
    };
  }, [galleryOpen, stackTags, projectId]);
  const matchedCatalog = useMemo(() => {
    if (!stackTags?.length) return [];
    const tagSet = new Set(stackTags);
    return CATALOG_SKILLS.filter((c) => c.tags.some((t) => tagSet.has(t)));
  }, [stackTags]);
  const restCatalog = useMemo(() => {
    const matched = new Set(matchedCatalog.map((c) => c.id));
    return CATALOG_SKILLS.filter((c) => !matched.has(c.id));
  }, [matchedCatalog]);

  const installCatalogSkill = async (id: string) => {
    const c = CATALOG_SKILLS.find((x) => x.id === id);
    if (!c || busy) return;
    setBusy(true);
    const res = await commands.skillsSave(projectId, "project", c.id, c.content, true);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(`카탈로그 스킬 설치됨: ${c.id} (${c.source}, MIT)`);
      await loadList();
      setSelected({ scope: "project", dirName: c.id });
    } else {
      toast.destructive(res.error);
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
      toast.info(`스킬 생성됨: ${name}`);
      setCreateOpen(false);
      await loadList();
      setSelected({ scope: createScope, dirName: name });
    } else {
      toast.destructive(res.error);
    }
  };

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  const sub =
    status === "ready" && overview
      ? `프로젝트 ${overview.project.length} · 전역 ${overview.global.length}`
      : undefined;

  return (
    <>
      <Toolbar title="스킬·규칙" sub={sub}>
        {tabs}
        <button
          type="button"
          className="sk-iconbtn"
          onClick={() => void loadList()}
          title="스킬 목록 새로고침"
          aria-label="스킬 목록 새로고침"
        >
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setGalleryOpen(true)}
          title="검증 습관을 만드는 추천 스킬(self-audit 등)을 원클릭 설치"
        >
          <Sparkles size={14} /> 추천 스킬
        </button>
        <button type="button" className="btn primary sm" onClick={openCreate}>
          <Plus size={14} /> 새 스킬
        </button>
      </Toolbar>

      {status === "loading" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">스킬을 불러오는 중…</div>
          </div>
        </div>
      ) : status === "error" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">
              스킬 목록을 불러오지 못했습니다.
              <br />
              {listError}
            </div>
          </div>
        </div>
      ) : all.length === 0 ? (
        <SkillsEmptyState onCreate={openCreate} onGallery={() => setGalleryOpen(true)} />
      ) : (
        <div className="sk-body">
          <aside className="sk-list" aria-label="스킬 목록">
            <ScopeSection
              title="프로젝트"
              entries={overview?.project ?? []}
              selected={selected}
              onSelect={(e) => setSelected({ scope: e.scope, dirName: e.dir_name })}
            />
            <ScopeSection
              title="전역"
              entries={overview?.global ?? []}
              selected={selected}
              onSelect={(e) => setSelected({ scope: e.scope, dirName: e.dir_name })}
            />
          </aside>

          <section className="sk-main" aria-label="스킬 상세">
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
                    스킬을 읽지 못했습니다.
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
                      {!detail.entry.enabled ? <span className="sk-chip off">비활성</span> : null}
                    </div>
                    <div className="sk-head-path" title={detail.skill_md_path}>
                      {detail.entry.display_path}/SKILL.md
                      {detail.entry.extra_files > 0
                        ? ` · 보조 파일 ${detail.entry.extra_files}개`
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
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => void toggleEnabled()}
                          title={
                            detail.entry.enabled
                              ? ".claude/skills/.disabled/ 로 옮겨 로드에서 뺍니다 (파일 유지)"
                              : "다시 .claude/skills/ 로 옮겨 로드에 포함합니다"
                          }
                        >
                          {detail.entry.enabled ? "비활성화" : "활성화"}
                        </button>
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => void copyToOtherScope()}
                          title={
                            detail.entry.scope === "project"
                              ? "~/.claude/skills 로 복사해 모든 프로젝트에서 쓰기"
                              : "이 프로젝트의 .claude/skills 로 복사"
                          }
                        >
                          <Copy size={13} />{" "}
                          {detail.entry.scope === "project" ? "전역으로 복사" : "프로젝트로 복사"}
                        </button>
                        <button type="button" className="btn ghost sm" onClick={startEdit}>
                          <Pencil size={13} /> 편집
                        </button>
                        <button
                          type="button"
                          className="btn danger sm"
                          disabled={busy}
                          onClick={() => setDeleteOpen(true)}
                        >
                          <Trash2 size={13} /> 삭제
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
                      aria-label="SKILL.md 편집"
                      spellCheck={false}
                    />
                    <div className="sk-editor-hint">
                      frontmatter 의 <code>description</code> 이 에이전트가 스킬을 자동 발동하는
                      기준입니다 · ⌘S 저장
                    </div>
                  </div>
                ) : (
                  <div className="sk-scroll">
                    <article className="sk-article">
                      <SkillPreview content={detail.content} />
                      {detail.files.length > 0 ? (
                        <div className="sk-files">
                          <div className="sk-files-title">보조 파일 {detail.files.length}개</div>
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
                  <div className="empty-hint">왼쪽에서 스킬을 선택하세요.</div>
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
        label="추천 스킬 갤러리"
        width={620}
      >
        <div className="sk-modal-head">
          <Sparkles size={15} /> 추천 스킬
        </div>
        <div className="sk-gallery">
          <p className="sk-gallery-intro">
            검증·감사 습관을 만드는 스킬 묶음입니다. 설치하면 이 프로젝트의{" "}
            <code>.claude/skills/</code> 에 들어가고, 에이전트가 상황에 맞춰 자동으로 씁니다.
          </p>
          <ul className="sk-gallery-list">
            {GALLERY_SKILLS.map((g) => {
              const installed = installedGalleryIds.has(g.id);
              return (
                <li key={g.id} className="sk-gallery-item">
                  <div className="sk-gallery-meta">
                    <div className="sk-gallery-name">{g.label}</div>
                    <div className="sk-gallery-desc">{g.summary}</div>
                  </div>
                  {installed ? (
                    <span className="sk-chip" title="이미 이 프로젝트에 있습니다">
                      설치됨
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn primary sm"
                      disabled={busy}
                      onClick={() => void installGallerySkill(g.id)}
                    >
                      설치
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* C3 — 스택 감지 기반 제3자 카탈로그 추천 (MIT · 커밋 핀 벤더 사본) */}
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[13px] font-semibold">이 프로젝트 스택 추천</span>
              {stackTags?.map((t) => (
                <span key={t} className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                  {t}
                </span>
              ))}
            </div>
            {stackTags == null ? (
              <p className="text-[12px] text-muted-foreground">스택 감지 중…</p>
            ) : matchedCatalog.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                {stackTags.length === 0
                  ? "스택을 감지하지 못했습니다 — 아래 전체 카탈로그에서 직접 고를 수 있어요."
                  : "감지된 스택과 일치하는 카탈로그 스킬이 없습니다."}
              </p>
            ) : (
              <ul className="sk-gallery-list">
                {matchedCatalog.map((c) => {
                  const installed = installedGalleryIds.has(c.id);
                  return (
                    <li key={c.id} className="sk-gallery-item">
                      <div className="sk-gallery-meta">
                        <div className="sk-gallery-name">
                          {c.label}{" "}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {c.source} · 본문 ≈{c.tokenEstimate.toLocaleString()} tok
                          </span>
                        </div>
                        <div className="sk-gallery-desc">{c.summary}</div>
                      </div>
                      {installed ? (
                        <span className="sk-chip" title="같은 이름의 스킬이 이 프로젝트에 이미 있습니다 (내용은 다를 수 있어요)">설치됨</span>
                      ) : (
                        <button
                          type="button"
                          className="btn primary sm"
                          disabled={busy}
                          onClick={() => void installCatalogSkill(c.id)}
                        >
                          설치
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              className="btn ghost sm mt-2"
              aria-expanded={catalogAllOpen}
              onClick={() => setCatalogAllOpen((o) => !o)}
            >
              {catalogAllOpen ? "전체 카탈로그 접기" : `전체 카탈로그 보기 (${CATALOG_SKILLS.length})`}
            </button>
            {catalogAllOpen && (
              <ul className="sk-gallery-list mt-1">
                {restCatalog.map((c) => {
                  const installed = installedGalleryIds.has(c.id);
                  return (
                    <li key={c.id} className="sk-gallery-item">
                      <div className="sk-gallery-meta">
                        <div className="sk-gallery-name">
                          {c.label}{" "}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {c.source} · {c.tags.join("·")} · 본문 ≈{c.tokenEstimate.toLocaleString()} tok
                          </span>
                        </div>
                        <div className="sk-gallery-desc">{c.summary}</div>
                      </div>
                      {installed ? (
                        <span className="sk-chip" title="같은 이름의 스킬이 이 프로젝트에 이미 있습니다 (내용은 다를 수 있어요)">설치됨</span>
                      ) : (
                        <button
                          type="button"
                          className="btn primary sm"
                          disabled={busy}
                          onClick={() => void installCatalogSkill(c.id)}
                        >
                          설치
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              제3자 스킬(MIT, 출처·버전 고정 사본 — ECC·ponytail)입니다. 설치된 스킬의{" "}
              <strong>설명 한 줄은 매 세션 컨텍스트에 상시 탑승</strong>하므로 프로젝트당 2~3개를
              권장해요. 표기된 "본문 ≈N tok" 은 스킬이 <strong>발동될 때만</strong> 로드되는 본문
              크기입니다.
            </p>
          </div>
        </div>
        <div className="sk-modal-foot">
          <button type="button" className="btn ghost sm" onClick={() => setGalleryOpen(false)}>
            닫기
          </button>
        </div>
      </AppDialog>

      {/* 새 스킬 모달 — AppDialog 셸 (포커스 트랩·복원·Esc 내장, v2 U13). */}
      <AppDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        label="새 스킬 만들기"
        width={520}
        initialFocusRef={createNameRef}
      >
        <div className="sk-modal-head">
          <Puzzle size={15} /> 새 스킬
        </div>
        <div className="sk-form">
          <div className="sk-field">
            <label htmlFor="sk-create-scope">범위</label>
            <div className="sk-scope-seg" id="sk-create-scope" role="radiogroup" aria-label="스킬 범위">
              <button
                type="button"
                role="radio"
                aria-checked={createScope === "project"}
                className={createScope === "project" ? "on" : ""}
                onClick={() => setCreateScope("project")}
              >
                이 프로젝트
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={createScope === "global"}
                className={createScope === "global" ? "on" : ""}
                onClick={() => setCreateScope("global")}
              >
                전역 (모든 프로젝트)
              </button>
            </div>
          </div>
          <div className="sk-field">
            <label htmlFor="sk-create-name">이름 (폴더명)</label>
            <input
              id="sk-create-name"
              ref={createNameRef}
              className="sk-input"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="예: review-checklist"
              autoComplete="off"
              spellCheck={false}
            />
            <div className={"sk-field-hint" + (createName.trim() && !createValid ? " bad" : "")}>
              {createName.trim() && !createValid
                ? "영문 소문자·숫자·하이픈(kebab-case)만 쓸 수 있습니다"
                : createScope === "project"
                  ? ".claude/skills/<이름>/SKILL.md 로 생성됩니다"
                  : "~/.claude/skills/<이름>/SKILL.md 로 생성됩니다"}
            </div>
          </div>
          <div className="sk-field">
            <label htmlFor="sk-create-desc">설명 (스킬이 자동 발동되는 기준)</label>
            <input
              id="sk-create-desc"
              className="sk-input"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder="예: PR 을 만들기 전 리뷰 체크리스트를 적용할 때"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && createValid) void submitCreate();
              }}
            />
          </div>
        </div>
        <div className="sk-modal-foot">
          <button type="button" className="btn ghost sm" onClick={() => setCreateOpen(false)}>
            취소
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={!createValid || busy}
            onClick={() => void submitCreate()}
          >
            만들기
          </button>
        </div>
      </AppDialog>

      {/* 삭제 확인 모달. */}
      <AppDialog
        open={deleteOpen && detail != null}
        onClose={() => setDeleteOpen(false)}
        label="스킬 삭제 확인"
        width={440}
      >
        <div className="sk-modal-head">
          <Trash2 size={15} /> 스킬 삭제
        </div>
        <div className="sk-modal-warn">
          <code>{detail?.entry.display_path}</code> 폴더 전체가 삭제됩니다
          {detail && detail.entry.extra_files > 0
            ? ` (보조 파일 ${detail.entry.extra_files}개 포함)`
            : ""}
          . 이 동작은 되돌릴 수 없습니다.
        </div>
        <div className="sk-modal-foot">
          <button type="button" className="btn ghost sm" onClick={() => setDeleteOpen(false)}>
            취소
          </button>
          <button
            type="button"
            className="btn danger sm"
            disabled={busy}
            onClick={() => void submitDelete()}
          >
            삭제
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
  onSelect,
}: {
  title: string;
  entries: SkillEntry[];
  selected: SelKey;
  onSelect: (e: SkillEntry) => void;
}) {
  return (
    <div className="sk-sec">
      <div className="sk-sec-head">
        {title} <span className="sk-sec-count">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="sk-none">없음</div>
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
                {!e.enabled ? <span className="sk-chip off">비활성</span> : null}
                {e.extra_files > 0 ? <span className="sk-chip">+{e.extra_files}</span> : null}
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
          <div className="sk-empty-title">아직 스킬이 없습니다</div>
          <p className="sk-empty-desc">
            스킬은 에이전트에게 가르치는 재사용 작업 절차입니다. 프로젝트의{" "}
            <code>.claude/skills/&lt;이름&gt;/SKILL.md</code> 또는 전역{" "}
            <code>~/.claude/skills/</code> 에 두면 Claude Code 가 상황에 맞춰 자동으로
            불러 씁니다. 여기서 만들고, 프로젝트별로 켜고 끄고, 전역과 주고받을 수 있습니다.
          </p>
          <div className="sk-empty-actions">
            <button type="button" className="btn ghost sm" onClick={onGallery}>
              <Sparkles size={14} /> 추천 스킬 보기
            </button>
            <button type="button" className="btn primary sm" onClick={onCreate}>
              <Plus size={14} /> 새 스킬 만들기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
