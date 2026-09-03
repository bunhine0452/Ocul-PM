// 컨텍스트 화면의 **보조 신호** 한 벌 (AD-5/AD-6 · context-budget-truth · evidence-based-rules).
//
// 넷은 성질이 같다: 화면의 본체(스킬·규칙 목록)와 무관하게 백그라운드로 캐고,
// **실패해도 화면은 그대로 선다** — 제안이나 배지가 안 뜰 뿐이다. 그래서
// `SkillsScreenV2` 본문에 흩어져 있을 이유가 없었고, 프로젝트가 바뀔 때 넷을
// 함께 비우는 규율도 한자리에 있는 편이 안전하다 (하나를 빠뜨리면 앞
// 프로젝트의 감사 결과가 다음 프로젝트 화면에 남는다).
//
// 파일 크기 래칫(`scripts/check-file-sizes.mjs`)이 이 추출의 계기였다 —
// 게이트가 "쪼갤 자리를 찾으라"고 했고, 여기가 그 자리였다.
import { useCallback, useEffect, useState } from "react";

import { rulesApi, skillsApi, stackApi } from "@/api/claudeSurface";
import type { NegationFinding, RuleEvidence, RuleScopeFinding, SkillDormancySignal } from "@/lib/bindings";

export interface ContextAudits {
  /** AD-6 범위 감사 — glob 이 실제로 무는 파일. */
  findings: RuleScopeFinding[];
  /** 감사가 센 프로젝트 파일 수 — glob 배지의 분모. */
  totalFiles: number;
  /** context-budget-truth C — 실려 놓고 부정되는 규칙. */
  negations: NegationFinding[];
  /** evidence-based-rules — 규칙이 막고 있는 반복 결함 (일지 채굴). */
  evidence: RuleEvidence | null;
  /** context-budget-truth D — 「0회」의 이유 신호. */
  dormancy: SkillDormancySignal[];
  /** 감지된 스택 태그 — 무관 규칙 판정의 재료. */
  stackTags: string[];
  /** 범위 감사가 도는 중 — 무관 조각이 아직 자랄 수 있다. */
  auditing: boolean;
  /** 범위 감사만 다시 (사용자가 새로고침을 누를 때). */
  rerunScopeAudit: () => void;
}

export function useContextAudits(projectId: number): ContextAudits {
  const [findings, setFindings] = useState<RuleScopeFinding[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [negations, setNegations] = useState<NegationFinding[]>([]);
  const [evidence, setEvidence] = useState<RuleEvidence | null>(null);
  const [dormancy, setDormancy] = useState<SkillDormancySignal[]>([]);
  const [stackTags, setStackTags] = useState<string[]>([]);
  const [auditing, setAuditing] = useState(false);

  const runScopeAudit = useCallback(async () => {
    setAuditing(true);
    try {
      const next = await rulesApi.scopeAudit(projectId);
      // 형태가 어긋난 응답(커맨드 부재·구버전)은 "감사 결과 없음" 으로 접는다 —
      // 보조 신호가 화면 전체를 죽이면 안 된다.
      setFindings(Array.isArray(next?.findings) ? next.findings : []);
      setTotalFiles(typeof next?.total_files === "number" ? next.total_files : 0);
    } catch {
      setFindings([]);
      setTotalFiles(0);
    } finally {
      setAuditing(false);
    }
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    // 프로젝트가 바뀌면 **넷을 함께** 비운다 — 하나라도 남으면 앞 프로젝트의
    // 사실이 다음 프로젝트 화면에 섞인다.
    setFindings([]);
    setTotalFiles(0);
    setNegations([]);
    setEvidence(null);
    setDormancy([]);
    setStackTags([]);

    const guard = <T,>(value: T) => (alive ? value : null);
    void rulesApi
      .negationAudit(projectId)
      .catch(() => [] as NegationFinding[])
      .then((next) => guard(setNegations(Array.isArray(next) ? next : [])));
    void rulesApi
      .evidence(projectId)
      // 근거는 곁들이는 정보다 — 못 캐도 화면은 그대로 선다.
      .catch(() => null)
      .then((next) => guard(setEvidence(next)));
    void skillsApi
      .dormancySignals(projectId)
      .catch(() => [] as SkillDormancySignal[])
      .then((next) => guard(setDormancy(Array.isArray(next) ? next : [])));
    void stackApi
      .detect(projectId)
      .catch(() => [] as string[])
      .then((tags) => guard(setStackTags(Array.isArray(tags) ? tags : [])));
    void runScopeAudit();

    return () => {
      alive = false;
    };
  }, [projectId, runScopeAudit]);

  return {
    findings,
    totalFiles,
    negations,
    evidence,
    dormancy,
    stackTags,
    auditing,
    rerunScopeAudit: () => void runScopeAudit(),
  };
}
