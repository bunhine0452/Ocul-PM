import { Clipboard, ShieldCheck } from "@/components/Icons";
import { useT } from "@/i18n";
import type { BranchStory } from "@/lib/bindings";
import { toast } from "@/lib/toast";

const JUDGED = new Set(["bug", "feature", "refactor"]);

/**
 * 브랜치 영수증 — 간단 밀도의 브랜치 화면은 이 한 장이다 (UI 밀도 라운드 2).
 *
 * 코드를 안 보는 사람에게 건네는 것: 검증된 일지 · 검증 안 된 일지 · 일지에 없는 파일.
 * 셋 다 이미 있는 판정(증거 등급 · 기록률)이고, 여기는 그것을 **한 장**으로 접을 뿐이다.
 * CI 결과는 로컬에 없으므로 적지 않는다 — 모르는 것은 모른다고 둔다.
 */
export function BranchReceipt({ story }: { story: BranchStory }) {
  const { t } = useT();
  const judged = story.entries.filter((e) => JUDGED.has(e.entry_type));
  const verified = judged.filter((e) => e.evidence === 2);
  const unverified = judged.filter((e) => e.evidence < 2);
  const missing = Math.max(0, story.files.length - story.recorded_files);

  const markdown = () => {
    const lines: string[] = [];
    lines.push(`# ${story.branch} — ${t("branch.receipt.title")}`);
    lines.push("");
    lines.push(`- ${t("branch.receipt.verified")}: ${verified.length}`);
    lines.push(`- ${t("branch.receipt.unverified")}: ${unverified.length}`);
    lines.push(`- ${t("branch.receipt.missing")}: ${missing} / ${story.files.length}`);
    lines.push("");
    lines.push(`## ${t("branch.receipt.did")}`);
    for (const e of story.entries) {
      lines.push(`- [${e.entry_type}] ${e.title}${e.evidence === 2 ? " ✓" : ""} — \`${e.relative_path}\``);
    }
    if (unverified.length > 0) {
      lines.push("");
      lines.push(`## ${t("branch.receipt.unverified")}`);
      for (const e of unverified) lines.push(`- ${e.title} — \`${e.relative_path}\``);
    }
    return lines.join("\n");
  };
  const copy = (text: string, msg: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast.info(msg));
  };

  return (
    <section className="card card-pad branch-receipt" aria-label={t("branch.receipt.title")}>
      <div className="br-head">
        <ShieldCheck size={15} color="var(--accent-text)" />
        <strong>{t("branch.receipt.title")}</strong>
        <span className="br-sub">{t("branch.receipt.sub", { entries: story.entries.length, files: story.files.length })}</span>
      </div>
      <div className="br-nums">
        <div data-tone="ok"><i>{t("branch.receipt.verified")}</i><b>{verified.length}</b></div>
        <div data-tone={unverified.length > 0 ? "warn" : "ok"}><i>{t("branch.receipt.unverified")}</i><b>{unverified.length}</b></div>
        <div data-tone={missing > 0 ? "warn" : "ok"}><i>{t("branch.receipt.missing")}</i><b>{missing}</b></div>
      </div>
      {unverified.length > 0 ? (
        <ul className="br-list">
          {unverified.slice(0, 5).map((e) => (
            <li key={e.relative_path}>
              <span className="br-type">{e.entry_type}</span>
              <span className="br-title">{e.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="br-actions">
        <button type="button" className="btn sm" onClick={() => copy(markdown(), t("branch.receipt.copied"))}>
          <Clipboard size={13} /> {t("branch.receipt.copy")}
        </button>
        <button type="button" className="btn sm" onClick={() => copy(`/oculpm:redteam ${story.branch}`, t("branch.receipt.redteamCopied"))}>
          {t("branch.receipt.redteam")}
        </button>
        <span className="br-note">{t("branch.receipt.note")}</span>
      </div>
    </section>
  );
}
