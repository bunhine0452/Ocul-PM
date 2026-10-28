import { Copy, FileCode, Puzzle } from "@/components/Icons";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";
import { blocked } from "@/lib/blocked";
import { FiringBadge } from "./FiringBadge";
import { RuleCandidatesPanel } from "./RuleCandidates";
import { PLUGIN_COMMANDS } from "./pluginDocs";
import type { ContextItem, DormantReason } from "./contextModel";

/**
 * 스킬·규칙 화면의 **간단 밀도** — 두 열 (UI 밀도 라운드 3, 시안 Skills).
 *
 *   왼쪽  규칙 후보(반복에서 올라온 것) → 규칙 목록
 *   오른쪽 플러그인 명령(언제 쓰나 한 줄 + 복사) → 프로젝트 스킬 목록
 *
 * 전문 밀도는 예전 3존(예산 바 · 걸려 있는 것 · 제안 인박스) 그대로다. 여기는 **같은
 * 항목**을 다른 자리에 놓을 뿐 — 새 자료도, 빠지는 자료도 없다. 쓰이지 않는 것은 숨기지
 * 않고 「잠자는 중」으로 말한다 (FiringBadge).
 */
export function SkillsSimpleView({
  projectId,
  since,
  until,
  items,
  measured,
  days,
  dormantReasons,
  onOpen,
}: {
  projectId: number;
  since: string;
  until: string;
  items: ContextItem[];
  measured: boolean;
  days: number;
  dormantReasons: Map<string, DormantReason>;
  onOpen: (item: ContextItem) => void;
}) {
  const { t } = useT();
  const rules = items.filter((i) => i.kind === "rule" || i.kind === "memory");
  const skills = items.filter((i) => i.kind === "skill");
  const copy = (cmd: string) => {
    void navigator.clipboard?.writeText(cmd).then(() => toast.info(t("plugin.copyToast")));
  };
  /** 「언제 쓰나」 한 줄 — 사전에서 (영어 모드에서도 영어). 설명 전체는 랜딩 플러그인 페이지에. */
  const when = (slug: string) => t(`sks.when.${slug}` as "sks.when.next");

  return (
    <div className="sks-grid">
      <section className="sks-col" aria-label={t("sks.rulesAria")}>
        <RuleCandidatesPanel projectId={projectId} since={since} until={until} />
        <div className="sks-head">
          <h2>
            <FileCode size={15} aria-hidden="true" /> {t("sks.rules", { n: rules.length })}
          </h2>
          <span className="mono">.claude/rules</span>
        </div>
        <ul className="sks-list">
          {rules.map((r) => (
            <li key={r.id}>
              <button type="button" className="sks-row" onClick={() => onOpen(r)} {...blocked(r.readonly ? t("sks.readonly") : null)}>
                <span className="mono sks-name">{r.name}</span>
                <span className="sks-sub">{r.sub || r.path}</span>
                <span className="sks-meta">
                  {r.alwaysOn ? t("sks.always") : r.pathCount > 0 ? t("sks.paths", { n: r.pathCount }) : ""}
                </span>
              </button>
            </li>
          ))}
          {rules.length === 0 ? <li className="sks-empty">{t("sks.noRules")}</li> : null}
        </ul>
        <p className="sks-note">{t("sks.rulesNote")}</p>
      </section>

      <section className="sks-col" aria-label={t("sks.pluginAria")}>
        <div className="sks-head">
          <h2>{t("sks.commands", { n: PLUGIN_COMMANDS.length })}</h2>
          <span>{t("sks.commandsSub")}</span>
        </div>
        <div className="sks-cmds">
          {PLUGIN_COMMANDS.map((c) => (
            <div key={c.slug} className="sks-cmd">
              <div className="sks-cmd-top">
                <code>{c.cmd}</code>
                <button type="button" className="sks-copy" aria-label={t("plugin.copy")} title={t("plugin.copy")} onClick={() => copy(c.cmd)}>
                  <Copy size={11} />
                </button>
              </div>
              <span>{when(c.slug)}</span>
            </div>
          ))}
        </div>
        <div className="sks-head">
          <h2>
            <Puzzle size={15} aria-hidden="true" /> {t("sks.skills", { n: skills.length })}
          </h2>
          <span className="mono">.claude/skills</span>
        </div>
        <ul className="sks-list">
          {skills.map((s) => (
            <li key={s.id}>
              <button type="button" className="sks-row" onClick={() => onOpen(s)}>
                <span className="mono sks-name">{s.name}</span>
                <span className="sks-sub">{s.sub}</span>
                <span className="sks-meta">
                  <FiringBadge stat={s.firing} measured={measured && s.measurable} days={days} reason={dormantReasons.get(s.id)} />
                </span>
              </button>
            </li>
          ))}
          {skills.length === 0 ? <li className="sks-empty">{t("sks.noSkills")}</li> : null}
        </ul>
        <p className="sks-note">{t("sks.skillsNote")}</p>
      </section>
    </div>
  );
}
