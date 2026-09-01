// AD-3 — 에이전트 컨텍스트 화면 (docs/agent-discipline/00-master-plan.md D2).
//
// 12번째 화면은 오랫동안 5탭 허브(`스킬 | 샵 | 규칙 | 훅 | 플러그인`)였고,
// 각 탭이 2-pane CRUD 였다. 실측(2026-08-29)이 말한 건 기능 부족이 아니라
// **설계가 파일 관리자**라는 것이었다 — 사용자는 파일을 관리하고 싶은 게 아니라
// 에이전트 행동을 고치고 싶고, 관리 화면은 동기가 없을 때 가는 곳이라 영원히
// 안 간다.
//
// 그래서 한 화면 3존으로 접었다:
//   존 1 컨텍스트 예산 바 — 세션마다 얼마가 들어가는가 (안 보이면 아무도 안 줄인다)
//   존 2 걸려 있는 것    — 스킬·규칙·CLAUDE.md 한 목록 + 발동 배지, 휴면 자동 강등
//   존 3 제안 인박스     — 승격 후보(회고에 갇혀 있던 CI4/CI5) + 추가하기(샵·훅·플러그인 흡수)
//
// 편집은 목록에서 드릴다운하는 **단일 편집기**(ContextEditor)로 위임했다 —
// 종류마다 같은 모양의 편집기를 두 벌 유지하던 비용이 사라진다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Toolbar } from "@/components/Toolbar";
import { AppDialog } from "@/components/ui/AppDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import { FileCode, Puzzle, RefreshCw } from "@/components/Icons";
import type {
  RuleEntry,
  RuleScope,
  RuleScopeFinding,
  RulesOverview,
  SkillScope,
  SkillsOverview,
} from "@/lib/bindings";
import { rulesApi, skillsApi, stackApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { toast } from "@/lib/toast";
import { oculpmApi } from "@/api/oculpm";
import { tError } from "@/i18n/errors";
import { t, useT } from "@/i18n";
import { localWorkdayKey, shiftWorkday } from "@/lib/workday";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import {
  consumeAgentContextIntent,
  onAgentContextRequest,
  type RuleSeed,
  type SkillSeed,
} from "@/lib/agentContextNav";
import { ClaudeHooksBlock } from "@/features/settings/OculpmSettings";
import { isValidSkillName, parseKeywords, skillTemplate } from "./skillsModel";
import { claudeMdTemplate, isValidRuleName, ruleTemplate } from "./rulesModel";
import { useFiringLedger } from "./useFiringLedger";
import {
  buildContextItems,
  cleanupProposals,
  computeBudget,
  indexFindings,
  irrelevantBytesPerSession,
  kb,
  scopeProposals,
  triggerProposals,
  type ContextItem,
} from "./contextModel";
import { ContextBudgetBar } from "./ContextBudgetBar";
import { ContextLiveList } from "./ContextLiveList";
import { ContextInbox } from "./ContextInbox";
import { ContextEditor } from "./ContextEditor";
import { SkillShopTab } from "./SkillShopTab";
import { PluginDocsTab } from "./PluginDocsTab";
import "./skills.css";

/** 존 3 승격 후보의 조회 창 — 발동 배지와 같은 30일. */
const CANDIDATE_WINDOW_DAYS = 30;

interface SkillsScreenV2Props {
  projectId: number;
  /**
   * 이 탭이 화면에 보이는가. 비활성 탭도 마운트된 채라(크롬식 탭) 창 전역
   * 인텐트 슬롯은 활성 탭만 들어야 한다 — 아니면 A 탭 터미널의 「일지로
   * 남기기」가 숨은 B 탭에서 작성기를 열고, 저장하면 **B 프로젝트**에 A 의
   * 내용이 적힌다.
   */
  active?: boolean;
}

type Extra = "shop" | "hooks" | "plugin" | null;

export function SkillsScreenV2({ projectId, active = true }: SkillsScreenV2Props) {
  useT();
  const firing = useFiringLedger(projectId);

  const [skills, setSkills] = useState<SkillsOverview | null>(null);
  const [rules, setRules] = useState<RulesOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ContextItem | null>(null);
  const [extra, setExtra] = useState<Extra>(null);
  const [busy, setBusy] = useState(false);

  // AD-5/AD-6 — 자기정리 루프의 재료. 둘 다 **보조 신호**라, 실패해도 화면은
  // 그대로 동작한다 (원장과 같은 규율): 제안이 안 뜰 뿐이다.
  const [findings, setFindings] = useState<RuleScopeFinding[]>([]);
  const [auditing, setAuditing] = useState(false);
  const [stackTags, setStackTags] = useState<string[]>([]);

  const [skillDialog, setSkillDialog] = useState<SkillSeed | null>(null);
  const [ruleDialog, setRuleDialog] = useState<RuleSeed | null>(null);
  const inboxRef = useRef<HTMLDivElement>(null);

  const loadSkills = useCallback(
    async () => setSkills(await skillsApi.list(projectId)),
    [projectId],
  );

  const loadRules = useCallback(async () => setRules(await rulesApi.list(projectId)), [projectId]);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      await Promise.all([loadSkills(), loadRules()]);
      setStatus("ready");
    } catch (err) {
      setLoadError(tError(toAppError(err)));
      setStatus("error");
    }
  }, [loadSkills, loadRules]);

  useEffect(() => {
    setStatus("loading");
    setDetail(null);
    void loadAll();
  }, [loadAll]);

  const runAudit = useCallback(async () => {
    setAuditing(true);
    try {
      const next = await rulesApi.scopeAudit(projectId);
      // 배열이 아닌 응답(커맨드 부재·형태 변화)은 "감사 결과 없음" 으로 접는다 —
      // 보조 신호가 화면 전체를 죽이면 안 된다.
      setFindings(Array.isArray(next) ? next : []);
    } catch {
      setFindings([]);
    } finally {
      setAuditing(false);
    }
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setFindings([]);
    setStackTags([]);
    void stackApi
      .detect(projectId)
      .catch(() => [] as string[])
      .then((tags) => {
        if (alive) setStackTags(Array.isArray(tags) ? tags : []);
      });
    void runAudit();
    return () => {
      alive = false;
    };
  }, [projectId, runAudit]);

  // 규칙 파일이 디스크에서 바뀌면(에이전트가 `.claude/rules/*.md` 를 고침) 다시 읽는다.
  useOculpmDataEvents("rules", projectId, true, () => void loadRules().catch(() => {}));

  // ── AD-4 — 사건 화면에서 온 요청 회수 ────────────────────────────────────
  const applyIntent = useCallback((intent: ReturnType<typeof consumeAgentContextIntent>) => {
    if (!intent) return;
    if (intent.kind === "createRule") {
      setDetail(null);
      setRuleDialog(intent.seed ?? {});
      return;
    }
    if (intent.kind === "createSkill") {
      setDetail(null);
      setSkillDialog(intent.seed ?? {});
      return;
    }
    setDetail(null);
    // 인박스는 화면 아래에 있다 — 옮겨 왔는데 화면이 그대로면 아무 일도 안
    // 일어난 것처럼 보인다. 레이아웃이 붙은 다음 프레임에 스크롤한다.
    requestAnimationFrame(() => inboxRef.current?.scrollIntoView({ block: "start" }));
  }, []);

  useEffect(() => {
    if (!active) return;
    applyIntent(consumeAgentContextIntent());
  }, [active, applyIntent]);
  useEffect(() => {
    if (!active) return;
    return onAgentContextRequest(applyIntent);
  }, [active, applyIntent]);

  // ── 파생 ────────────────────────────────────────────────────────────────

  const items = useMemo(
    () => buildContextItems(skills, rules, firing.index),
    [skills, rules, firing.index],
  );
  const scope = useMemo(
    () => scopeProposals(items, stackTags, firing.overview?.sessions ?? 0, firing.measured),
    [items, stackTags, firing.overview, firing.measured],
  );
  const cleanup = useMemo(
    () => cleanupProposals(items, indexFindings(findings), firing.measured),
    [items, findings, firing.measured],
  );
  const trigger = useMemo(() => triggerProposals(items, firing.measured), [items, firing.measured]);
  const budget = useMemo(
    () =>
      computeBudget(
        items,
        firing.overview?.bytes_per_session ?? 0,
        firing.measured,
        irrelevantBytesPerSession(scope),
      ),
    [items, firing.overview, firing.measured, scope],
  );
  const missingMemory = useMemo(
    () => (rules?.claude_md ?? []).filter((e) => !e.exists),
    [rules],
  );
  const installedDirs = useMemo(
    () => new Set((skills?.project ?? []).map((e) => e.dir_name)),
    [skills],
  );
  const until = useMemo(() => localWorkdayKey(), []);
  const since = useMemo(() => shiftWorkday(until, -(CANDIDATE_WINDOW_DAYS - 1)), [until]);

  // 목록이 다시 로드되면 열려 있던 상세를 새 데이터로 맞춘다 (배지·칩 동기화).
  useEffect(() => {
    setDetail((prev) => (prev ? (items.find((i) => i.id === prev.id) ?? null) : null));
  }, [items]);

  // ── 생성 ────────────────────────────────────────────────────────────────

  const createMemory = useCallback(
    async (entry: RuleEntry) => {
      if (busy) return;
      setBusy(true);
      try {
        await rulesApi.save(
          projectId,
          entry.scope,
          entry.rel_path,
          claudeMdTemplate(entry.rel_path, entry.scope === "global"),
          true,
        );
        toast.info(t("rules.created", { path: entry.rel_path }));
        await loadRules().catch(() => {});
      } catch (err) {
        toast.destructive(tError(toAppError(err)));
      } finally {
        setBusy(false);
      }
    },
    [busy, projectId, loadRules],
  );

  /** Cursor 병행 배포 옵인 토글 — config 저장 후 미러 전체를 화해시킨다. */
  const toggleTranslate = useCallback(async () => {
    if (!rules || busy) return;
    const turnOn = !rules.cursor_translate;
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
      const results = await rulesApi.syncTranslations(projectId);
      const counts = (action: string) => results.filter((r) => r.action === action).length;
      const parts: string[] = [];
      if (counts("written")) parts.push(t("rules.mirror.written", { n: counts("written") }));
      if (counts("removed")) parts.push(t("rules.mirror.removed", { n: counts("removed") }));
      if (counts("conflict")) parts.push(t("rules.mirror.conflict", { n: counts("conflict") }));
      const summary = parts.length ? parts.join(" · ") : t("rules.mirror.none");
      toast.info(turnOn ? t("rules.mirrorOn", { summary }) : t("rules.mirrorOff", { summary }));
      await loadRules().catch(() => {});
    } catch (err) {
      toast.destructive(
        t("rules.translateSaveFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, rules, projectId, loadRules]);

  const sub =
    status === "ready"
      ? `${t("ctx.toolbarSub", { n: items.length })}${
          budget.totalBytes > 0 ? ` · ${t("ctx.budget.kb", { kb: kb(budget.totalBytes) })}` : ""
        }${firing.scanning ? ` · ${t("firing.measuring")}` : firing.partial ? ` · ${t("firing.partial")}` : ""}`
      : undefined;

  return (
    <>
      <Toolbar title={t("nav.skills")} sub={sub}>
        <button
          type="button"
          className="sk-textbtn"
          disabled={firing.scanning}
          onClick={() => void firing.rebuild()}
          title={t("firing.rebuildTitle")}
        >
          {t("firing.rebuild")}
        </button>
        <button
          type="button"
          className="sk-iconbtn"
          onClick={() => void loadAll()}
          title={t("ctx.refresh")}
          aria-label={t("ctx.refresh")}
        >
          <RefreshCw size={15} />
        </button>
        <button type="button" className="btn ghost sm" onClick={() => setRuleDialog({})}>
          <FileCode size={14} /> {t("rules.new")}
        </button>
        <button type="button" className="btn primary sm" onClick={() => setSkillDialog({})}>
          <Puzzle size={14} /> {t("sk.new")}
        </button>
      </Toolbar>

      {status === "loading" ? (
        <div className="scroll">
          <div className="page">
            <SkeletonList rows={6} height={40} />
          </div>
        </div>
      ) : status === "error" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">
              {t("ctx.loadFailed")}
              <br />
              {loadError}
            </div>
          </div>
        </div>
      ) : detail ? (
        <ContextEditor
          projectId={projectId}
          item={detail}
          firing={firing}
          onBack={() => setDetail(null)}
          onChanged={() => void loadAll()}
          onDeleted={() => {
            setDetail(null);
            void loadAll();
          }}
        />
      ) : (
        <div className="scroll">
          <div className="page ctx-page">
            <ContextBudgetBar
              budget={budget}
              scanning={firing.scanning}
              partial={firing.partial}
              auditing={auditing}
              onJumpToIrrelevant={() =>
                document.getElementById("ctx-scope")?.scrollIntoView({ block: "center" })
              }
            />
            <ContextLiveList
              items={items}
              measured={firing.measured}
              days={firing.days}
              missingMemory={missingMemory}
              onCreateMemory={(e) => void createMemory(e)}
              onOpen={setDetail}
              cursorTranslate={rules?.cursor_translate ?? false}
              onToggleTranslate={() => void toggleTranslate()}
              translateBusy={busy}
            />
            <div ref={inboxRef}>
              <ContextInbox
                projectId={projectId}
                since={since}
                until={until}
                installedDirs={installedDirs}
                stackTags={stackTags}
                scope={scope}
                cleanup={cleanup}
                trigger={trigger}
                days={firing.days}
                onChanged={() => {
                  void loadAll();
                  void runAudit();
                }}
                onCreateSkill={() => setSkillDialog({})}
                onCreateRule={() => setRuleDialog({})}
                onOpenShop={() => setExtra("shop")}
                onOpenHooks={() => setExtra("hooks")}
                onOpenPlugin={() => setExtra("plugin")}
              />
            </div>
          </div>
        </div>
      )}

      <CreateSkillDialog
        projectId={projectId}
        seed={skillDialog}
        onClose={() => setSkillDialog(null)}
        onCreated={() => void loadAll()}
      />
      <CreateRuleDialog
        projectId={projectId}
        seed={ruleDialog}
        onClose={() => setRuleDialog(null)}
        onCreated={() => void loadAll()}
      />

      {/* 샵·훅·플러그인 — 탭이 아니라 "추가하기" 에서 여는 보조 표면. */}
      <AppDialog open={extra === "shop"} onClose={() => setExtra(null)} label={t("shop.toolbarSub")} width={860}>
        <div className="sk-modal-head">{t("ctx.add.shopTitle")}</div>
        <SkillShopTab projectId={projectId} embedded onInstalled={() => void loadAll()} />
      </AppDialog>
      <AppDialog open={extra === "hooks"} onClose={() => setExtra(null)} label={t("sk.hooksSub")} width={720}>
        <div className="sk-modal-head">{t("sk.tab.hooks")}</div>
        <div className="sk-hooks sk-shop-embed">
          <ClaudeHooksBlock projectId={projectId} />
          <p className="sk-hooks-hint">{t("sk.hooksNote")}</p>
        </div>
      </AppDialog>
      <AppDialog open={extra === "plugin"} onClose={() => setExtra(null)} label={t("plugin.toolbarSub")} width={860}>
        <div className="sk-modal-head">{t("plugin.toolbarTitle")}</div>
        <PluginDocsTab embedded />
      </AppDialog>
    </>
  );
}

// ─── 생성 모달 ───────────────────────────────────────────────────────────────

/** 씨앗 본문이 있으면 템플릿 뒤에 증거로 덧붙인다 (사건 화면에서 온 요청). */
function withSeedBody(template: string, body?: string): string {
  return body ? `${template.replace(/\s*$/, "")}\n\n${body.trim()}\n` : template;
}

function CreateSkillDialog({
  projectId,
  seed,
  onClose,
  onCreated,
}: {
  projectId: number;
  seed: SkillSeed | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  useT();
  const [scope, setScope] = useState<SkillScope>("project");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  /** 쉼표로 치는 키워드 — 능력 검색이 색인하는 유일한 말 (Phase 5). */
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!seed) return;
    setScope("project");
    setName(seed.name ?? "");
    setDesc(seed.description ?? "");
    setKeywords("");
  }, [seed]);

  const valid = isValidSkillName(name.trim());
  const submit = async () => {
    const slug = name.trim();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await skillsApi.save(
        projectId,
        scope,
        slug,
        withSeedBody(skillTemplate(slug, desc, parseKeywords(keywords)), seed?.body),
        true,
      );
      toast.info(t("sk.created", { name: slug }));
      onClose();
      onCreated();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog
      open={seed != null}
      onClose={onClose}
      label={t("sk.createLabel")}
      width={520}
      initialFocusRef={nameRef}
    >
      <div className="sk-modal-head">
        <Puzzle size={15} /> {t("sk.new")}
      </div>
      <div className="sk-form">
        <ScopeField
          id="ctx-skill-scope"
          label={t("sk.scopeLabel")}
          aria={t("sk.scopeAria")}
          scope={scope}
          onChange={(next) => setScope(next as SkillScope)}
        />
        <div className="sk-field">
          <label htmlFor="ctx-skill-name">{t("sk.nameLabel")}</label>
          <input
            id="ctx-skill-name"
            ref={nameRef}
            className="sk-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("sk.namePlaceholder")}
            autoComplete="off"
            spellCheck={false}
          />
          <div className={"sk-field-hint" + (name.trim() && !valid ? " bad" : "")}>
            {name.trim() && !valid
              ? t("sk.nameInvalid")
              : scope === "project"
                ? t("sk.createsProject")
                : t("sk.createsGlobal")}
          </div>
        </div>
        <div className="sk-field">
          <label htmlFor="ctx-skill-desc">{t("sk.descLabel")}</label>
          <input
            id="ctx-skill-desc"
            className="sk-input"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={t("sk.descPlaceholder")}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) void submit();
            }}
          />
        </div>
        {/* 키워드 (Phase 5 `#skill-keywords`) — 능력 검색은 이름·설명·키워드만
            색인하고 지시문 본문은 색인하지 않는다. 그래서 여기 적는 말이 곧 이
            스킬의 도달 경로다. */}
        <div className="sk-field">
          <label htmlFor="ctx-skill-keywords">{t("sk.keywordsLabel")}</label>
          <input
            id="ctx-skill-keywords"
            className="sk-input"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder={t("sk.keywordsPlaceholder")}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) void submit();
            }}
          />
          <div className="sk-field-hint">{t("sk.keywordsHint")}</div>
        </div>
      </div>
      <div className="sk-modal-foot">
        <button type="button" className="btn ghost sm" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn primary sm" disabled={!valid || busy} onClick={() => void submit()}>
          {t("sk.create")}
        </button>
      </div>
    </AppDialog>
  );
}

function CreateRuleDialog({
  projectId,
  seed,
  onClose,
  onCreated,
}: {
  projectId: number;
  seed: RuleSeed | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  useT();
  const [scope, setScope] = useState<RuleScope>("project");
  const [name, setName] = useState("");
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!seed) return;
    setScope("project");
    setName(seed.name ?? "");
    setPaths((seed.paths ?? []).join(", "));
  }, [seed]);

  const valid = isValidRuleName(name.trim());
  const submit = async () => {
    const slug = name.trim();
    if (!valid || busy) return;
    const globs = paths
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    setBusy(true);
    try {
      await rulesApi.save(
        projectId,
        scope,
        `.claude/rules/${slug}.md`,
        withSeedBody(ruleTemplate(slug, globs), seed?.body),
        true,
      );
      toast.info(t("rules.ruleCreated", { name: slug }));
      onClose();
      onCreated();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog
      open={seed != null}
      onClose={onClose}
      label={t("rules.createLabel")}
      width={520}
      initialFocusRef={nameRef}
    >
      <div className="sk-modal-head">
        <FileCode size={15} /> {t("rules.new")}
      </div>
      <div className="sk-form">
        <ScopeField
          id="ctx-rule-scope"
          label={t("rules.scopeLabel")}
          aria={t("rules.scopeAria")}
          scope={scope}
          onChange={(next) => setScope(next as RuleScope)}
        />
        <div className="sk-field">
          <label htmlFor="ctx-rule-name">{t("rules.nameLabel")}</label>
          <input
            id="ctx-rule-name"
            ref={nameRef}
            className="sk-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("rules.namePlaceholder")}
            autoComplete="off"
            spellCheck={false}
          />
          <div className={"sk-field-hint" + (name.trim() && !valid ? " bad" : "")}>
            {name.trim() && !valid
              ? t("rules.nameInvalid")
              : scope === "project"
                ? t("rules.createsProject")
                : t("rules.createsGlobal")}
          </div>
        </div>
        <div className="sk-field">
          <label htmlFor="ctx-rule-paths">{t("rules.pathsLabel")}</label>
          <input
            id="ctx-rule-paths"
            className="sk-input"
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
            placeholder={t("rules.pathsPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) void submit();
            }}
          />
          <div className="sk-field-hint">{t("rules.pathsHint")}</div>
        </div>
      </div>
      <div className="sk-modal-foot">
        <button type="button" className="btn ghost sm" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn primary sm" disabled={!valid || busy} onClick={() => void submit()}>
          {t("rules.create")}
        </button>
      </div>
    </AppDialog>
  );
}

/** 프로젝트/전역 라디오 — 두 생성 모달이 같은 것을 쓴다. */
function ScopeField({
  id,
  label,
  aria,
  scope,
  onChange,
}: {
  id: string;
  label: string;
  aria: string;
  scope: string;
  onChange: (scope: "project" | "global") => void;
}) {
  return (
    <div className="sk-field">
      <label htmlFor={id}>{label}</label>
      <div className="sk-scope-seg" id={id} role="radiogroup" aria-label={aria}>
        <button
          type="button"
          role="radio"
          aria-checked={scope === "project"}
          className={scope === "project" ? "on" : ""}
          onClick={() => onChange("project")}
        >
          {t("rules.thisProject")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={scope === "global"}
          className={scope === "global" ? "on" : ""}
          onClick={() => onChange("global")}
        >
          {t("rules.globalAll")}
        </button>
      </div>
    </div>
  );
}
