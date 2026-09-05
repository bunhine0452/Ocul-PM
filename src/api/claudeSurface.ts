/**
 * `claudeSurface` — Claude Code 표면(스킬·규칙·승격 후보·스택 감지) 커맨드의
 * 단일 래퍼.
 *
 * AD-3 이 12번째 화면을 3존으로 다시 짜면서, 새 파일들이 `bindings.ts` 를
 * 직접 부르지 않도록 여기로 모았다 (완성도 라운드 Phase 4 의 `call` 규약 —
 * `lint:bindings` 가 게이트). 봉투(`{status}`)를 풀어 값을 돌려주고, 실패는
 * `ApiError` 하나로 접는다: 화면은 `catch (e)` 하나에 `tError(toAppError(e))`.
 */

import { commands } from "@/lib/bindings";
import { call, type Envelope } from "@/api/invoke";
import type {
  AgentSurfaceOverview,
  MirrorWriteResult,
  NegationFinding,
  RuleBackupOutcome,
  RuleScopeAudit,
  SkillTriggerDraft,
  RuleCandidate,
  RuleDetail,
  RuleEntry,
  RuleSaveOutcome,
  RuleScope,
  RulesOverview,
  SkillCandidate,
  SkillDetail,
  SkillDormancySignal,
  SkillEntry,
  SkillScope,
  SkillsOverview,
  RuleEvidence,
  JournalMissingSignal,
} from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const skillsApi = {
  list: (projectId: number) => unwrap<SkillsOverview>("skills_list", commands.skillsList(projectId)),

  read: (projectId: number, scope: SkillScope, dirName: string) =>
    unwrap<SkillDetail>("skills_read", commands.skillsRead(projectId, scope, dirName)),

  save: (projectId: number, scope: SkillScope, dirName: string, content: string, create: boolean) =>
    unwrap<SkillEntry>("skills_save", commands.skillsSave(projectId, scope, dirName, content, create)),

  setEnabled: (projectId: number, scope: SkillScope, dirName: string, enabled: boolean) =>
    unwrap<SkillEntry>("skills_set_enabled", commands.skillsSetEnabled(projectId, scope, dirName, enabled)),

  copy: (projectId: number, from: SkillScope, to: SkillScope, dirName: string) =>
    unwrap<SkillEntry>("skills_copy", commands.skillsCopy(projectId, from, to, dirName)),

  remove: (projectId: number, scope: SkillScope, dirName: string) =>
    unwrap<null>("skills_delete", commands.skillsDelete(projectId, scope, dirName)),

  /** AD-5 트리거 교정 — description 재작성 초안 (과금). 파일은 쓰지 않는다. */
  triggerRewrite: (
    projectId: number,
    scope: SkillScope,
    dirName: string,
    provider: string,
    model: string,
  ) =>
    unwrap<SkillTriggerDraft>(
      "skills_trigger_rewrite",
      commands.skillsTriggerRewrite(projectId, scope, dirName, provider, model),
    ),

  /**
   * context-budget-truth D — 「0회」의 이유 신호. 판정하지 않고 신호만 준다
   * (선행조건 파일 부재 · 억제 문장 · 파일 나이).
   */
  dormancySignals: (projectId: number) =>
    unwrap<SkillDormancySignal[]>(
      "skills_dormancy_signals",
      commands.skillsDormancySignals(projectId),
    ),
};

export const rulesApi = {
  list: (projectId: number) => unwrap<RulesOverview>("rules_list", commands.rulesList(projectId)),

  read: (projectId: number, scope: RuleScope, relPath: string) =>
    unwrap<RuleDetail>("rules_read", commands.rulesRead(projectId, scope, relPath)),

  save: (projectId: number, scope: RuleScope, relPath: string, content: string, create: boolean) =>
    unwrap<RuleSaveOutcome>("rules_save", commands.rulesSave(projectId, scope, relPath, content, create)),

  remove: (projectId: number, scope: RuleScope, relPath: string) =>
    unwrap<MirrorWriteResult | null>("rules_delete", commands.rulesDelete(projectId, scope, relPath)),

  syncTranslations: (projectId: number) =>
    unwrap<MirrorWriteResult[]>("rules_sync_translations", commands.rulesSyncTranslations(projectId)),

  /** AD-6 범위 감사 — 결정적, 아무것도 쓰지 않는다. */
  scopeAudit: (projectId: number) =>
    unwrap<RuleScopeAudit>("rules_scope_audit", commands.rulesScopeAudit(projectId)),

  /**
   * context-budget-truth A — 에이전트·커맨드 표면. 매 세션 시스템 프롬프트에
   * 실리는 name+description 을 센다 (플러그인 제공분은 제외 — 파일 단위로 손댈
   * 수 없다).
   */
  agentSurface: (projectId: number) =>
    unwrap<AgentSurfaceOverview>("agent_surface_list", commands.agentSurfaceList(projectId)),

  /**
   * context-budget-truth C — 실려 놓고 부정되는 규칙. 휴리스틱이라 근거
   * 발췌가 함께 오고, 아무것도 쓰지 않는다.
   */
  negationAudit: (projectId: number) =>
    unwrap<NegationFinding[]>("rules_negation_audit", commands.rulesNegationAudit(projectId)),

  /**
   * evidence-based-rules — 규칙이 **무엇을 막고 있나.**
   *
   * 일지에서 캔 반복 결함 클러스터 + 규칙이 그 언어를 쓰는지의 후보 연결.
   * 근거가 붙은 규칙만 `links` 에 온다 ("근거 0" 을 만들지 않는다).
   */
  evidence: (projectId: number) =>
    unwrap<RuleEvidence>("rules_evidence", commands.rulesEvidence(projectId)),

  /** AD-6 승인형 저장 — 원본을 `.bak` 으로 남기고 덮어쓴다 (기존 파일 전용). */
  saveWithBackup: (projectId: number, scope: RuleScope, relPath: string, content: string) =>
    unwrap<RuleBackupOutcome>(
      "rules_save_with_backup",
      commands.rulesSaveWithBackup(projectId, scope, relPath, content),
    ),
};

/** 승격 후보 — 결정적(LLM 없음). 초안 생성(과금)은 승격 패널이 직접 부른다. */
export const promoteApi = {
  ruleCandidates: (projectId: number, since: string, until: string) =>
    unwrap<RuleCandidate[]>("rule_candidates", commands.ruleCandidates(projectId, since, until)),

  skillCandidates: (projectId: number, since: string, until: string) =>
    unwrap<SkillCandidate[]>("skill_candidates", commands.skillCandidates(projectId, since, until)),
};

/**
 * SessionEnd 훅이 남긴 "일지 없이 끝난 세션" 신호 ({#card-unhide} ·
 * {#retro-standing-line}). 무엇을 해소로 볼지의 **판정은 백엔드 소유**라
 * (mtime 근사 → 세션 귀속으로 교체 예정) 화면은 행 수만 읽는다.
 */
export const hooksApi = {
  journalMissing: (projectId: number, days: number) =>
    unwrap<JournalMissingSignal[]>(
      "journal_missing_signals",
      commands.journalMissingSignals(projectId, days),
    ),
};

/** 스택 감지 — 추천 스킬을 고르는 유일한 신호. */
export const stackApi = {
  detect: (projectId: number) => unwrap<string[]>("detect_stack", commands.detectStack(projectId)),
};

export type { RuleEntry };
