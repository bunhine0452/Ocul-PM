// AD-3 존 3 — 제안 인박스 + 추가하기 (docs/agent-discipline/00-master-plan.md D2).
//
// 승격 루프(CI4/CI5)는 이미 완성돼 있었는데 **회고 화면에만** 있었다. 회고는
// 매일 가는 곳이 아니라, 만들어 둔 루프가 사실상 잠겨 있었다(F3). 여기로
// 끌어오면서 컴포넌트는 그대로 재사용한다 — 신규 백엔드 0.
//
// 하단 "추가하기" 는 샵 탭과 추천 갤러리 모달을 함께 흡수한 자리다. 28종
// 카탈로그를 훑는 건 작업이 아니라 쇼핑이라(F5), **ocul-pm 큐레이션 + 스택
// 감지 매칭**만 먼저 보이고 전체 카탈로그는 한 번 더 눌러야 나온다.
import { useMemo, useState } from "react";

import { Inbox, Plus, Puzzle, FileCode, Store } from "@/components/Icons";
import { skillsApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { toast } from "@/lib/toast";
import { tError } from "@/i18n/errors";
import { t, useT } from "@/i18n";
import { RuleCandidatesPanel } from "@/features/retro/RuleCandidates";
import { SkillCandidatesPanel } from "@/features/retro/SkillCandidates";
import { CATALOG_SKILLS } from "./skillsCatalog";
import { GALLERY_SKILLS } from "./skillsGallery";
import { ContextProposals } from "./ContextProposals";
import type { CleanupProposal, ContextItem, ScopeProposal } from "./contextModel";

/** 스택 매칭 카탈로그에서 먼저 보여 주는 개수 — 쇼핑이 아니라 제안이 되게. */
const CATALOG_LIMIT = 3;

/** 큐레이션·카탈로그를 한 줄 규격으로 접은 추천 항목. */
interface Recommendation {
  id: string;
  name: string;
  meta: string;
  desc: string;
  content: string;
}

interface ContextInboxProps {
  projectId: number;
  /** 후보 조회 창 (`YYYYMMDD`, 양끝 포함). */
  since: string;
  until: string;
  /** 이미 프로젝트에 있는 스킬 폴더명 — 중복 설치를 "설치됨" 으로 막는다. */
  installedDirs: ReadonlySet<string>;
  /** 감지된 스택 태그 — 카탈로그 추천의 매칭 키 (화면이 한 번만 조회한다). */
  stackTags: string[];
  /** AD-5/AD-6 자기정리 제안 3종. */
  scope: ScopeProposal[];
  cleanup: CleanupProposal[];
  trigger: ContextItem[];
  days: number;
  /** 설치·저장으로 목록이 바뀌었다. */
  onChanged: () => void;
  onCreateSkill: () => void;
  onCreateRule: () => void;
  onOpenShop: () => void;
  onOpenHooks: () => void;
  onOpenPlugin: () => void;
}

export function ContextInbox({
  projectId,
  since,
  until,
  installedDirs,
  stackTags,
  scope,
  cleanup,
  trigger,
  days,
  onChanged,
  onCreateSkill,
  onCreateRule,
  onOpenShop,
  onOpenHooks,
  onOpenPlugin,
}: ContextInboxProps) {
  useT();
  const [busy, setBusy] = useState(false);

  const recommended = useMemo<Recommendation[]>(() => {
    const curated = GALLERY_SKILLS.map((g) => ({
      id: g.id,
      name: t(g.labelKey),
      meta: t("ctx.add.curated"),
      desc: t(g.summaryKey),
      content: g.content,
    }));
    const tags = new Set(stackTags);
    const matched = CATALOG_SKILLS.filter((c) => c.tags.some((tag) => tags.has(tag)))
      .slice(0, CATALOG_LIMIT)
      .map((c) => ({
        id: c.id,
        name: t(c.labelKey),
        meta: `${c.source} · ${c.tags.join("·")}`,
        desc: t(c.summaryKey),
        content: c.content,
      }));
    return [...curated, ...matched];
  }, [stackTags]);

  const install = async (rec: Recommendation) => {
    if (busy) return;
    setBusy(true);
    try {
      await skillsApi.save(projectId, "project", rec.id, rec.content, true);
      toast.info(t("sk.galleryInstalled", { id: rec.id }));
      onChanged();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ctx-inbox" id="ctx-inbox" aria-label={t("ctx.inbox.aria")}>
      <div className="ctx-zone-head">
        <Inbox size={14} />
        <h3>{t("ctx.inbox.title")}</h3>
        <span className="ctx-zone-sub">{t("ctx.inbox.sub")}</span>
      </div>

      {/* AD-5/AD-6 자기정리 제안 — 결정적 판정이라 위에 둔다 (LLM 0·과금 0). */}
      <ContextProposals
        projectId={projectId}
        scope={scope}
        cleanup={cleanup}
        trigger={trigger}
        days={days}
        onChanged={onChanged}
      />

      {/* 승격 후보 — 결정적 후보(LLM 없음) → 버튼을 눌러야 초안(과금) →
          승인해야 파일. 이 순서는 회고 화면과 같은 것이다. */}
      <RuleCandidatesPanel projectId={projectId} since={since} until={until} />
      <SkillCandidatesPanel projectId={projectId} since={since} until={until} />

      <div className="ctx-add">
        <div className="ctx-add-head">
          <Plus size={13} /> {t("ctx.add.title")}
        </div>
        <ul className="ctx-add-list">
          {recommended.map((rec) => (
            <li key={rec.id}>
              <div className="ctx-add-meta">
                <span className="ctx-add-name">{rec.name}</span>
                <span className="ctx-add-tags">{rec.meta}</span>
                <span className="ctx-add-desc">{rec.desc}</span>
              </div>
              {installedDirs.has(rec.id) ? (
                <span className="sk-chip" title={t("sk.alreadyHere")}>
                  {t("sk.isInstalled")}
                </span>
              ) : (
                <button type="button" className="btn sm" disabled={busy} onClick={() => void install(rec)}>
                  {t("sk.install")}
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="ctx-add-actions">
          <button type="button" className="btn ghost sm" onClick={onCreateSkill}>
            <Puzzle size={13} /> {t("sk.new")}
          </button>
          <button type="button" className="btn ghost sm" onClick={onCreateRule}>
            <FileCode size={13} /> {t("rules.new")}
          </button>
          <button type="button" className="btn ghost sm" onClick={onOpenShop}>
            <Store size={13} /> {t("ctx.add.shop", { n: CATALOG_SKILLS.length })}
          </button>
          <button type="button" className="btn ghost sm" onClick={onOpenHooks}>
            {t("sk.tab.hooks")}
          </button>
          <button type="button" className="btn ghost sm" onClick={onOpenPlugin}>
            {t("sk.tab.plugin")}
          </button>
        </div>
      </div>
    </section>
  );
}
