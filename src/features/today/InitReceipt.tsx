/**
 * 첫 활성화 영수증 — 앱이 이 저장소에 무엇을 썼는가 (love-round #init-receipt, 11-23).
 *
 * 처음 폴더를 열면 앱이 `.oculpm/` · `AGENTS.md` · `.gitignore` 블록(경우에 따라 `.claude/CLAUDE.md` 블록)을 쓴다.
 * 그 보고(`oculpmInitCard`)는 워크스페이스에 남았지만 읽는 곳이 없어, 개발자가 `git status` 에서 낯선 파일을 먼저
 * 봤다. 오늘의 「첫 기록까지」 카드 바닥에 한 줄로 말한다 — 첫 일지가 오면 그 카드와 함께 사라진다.
 * 파일 이름은 기계 글씨라 mono(영수증 규칙 2).
 */
import type { OculpmInitCardInfo } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";

/** 보고를 사람이 보는 이름 목록으로 — 폴더는 끝에 `/`, 겹치면 한 번만. */
export function initReceiptItems(info: OculpmInitCardInfo | null | undefined): string[] {
  if (!info) return [];
  const out: string[] = [];
  const add = (name: string) => {
    if (name && !out.includes(name)) out.push(name);
  };
  for (const d of info.createdDirs) add(d.endsWith("/") ? d : `${d}/`);
  for (const f of info.agentFiles) add(f);
  if (info.wroteGitignore) add(".gitignore");
  return out;
}

export function InitReceipt({ info }: { info: OculpmInitCardInfo | null | undefined }) {
  const { t } = useT();
  const items = initReceiptItems(info);
  if (items.length === 0) return null;
  return (
    <p className="tdy-meta tdy-init-receipt">
      {t("today.first.wrote")}{" "}
      {items.map((name, i) => (
        <span key={name}>
          {i > 0 ? " · " : null}
          <code>{name}</code>
        </span>
      ))}
      {" — "}
      {t("today.first.wroteHint")}
    </p>
  );
}
