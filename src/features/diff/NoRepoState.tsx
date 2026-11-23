/**
 * 변경 화면의 「볼 수 없음」 — 저장소가 아니거나 git 이 없다 (love-round #diff-non-git, 11-23).
 *
 * 예전에는 둘 다 「이 브랜치엔 아직 변경이 없어요」 였다 — 볼 수 없는 것을 「없음」 으로 말해 약속 「예외만 보여
 * 준다」 를 정면으로 어겼다. 할 일은 하나씩: 저장소가 아니면 `git init` 줄 복사(앱이 돌리지 않는다), git 이 없으면
 * 설치 안내를 OS 브라우저로.
 */
import { EmptyState } from "@/components/EmptyState";
import { fileOpenApi } from "@/api/fileOpen";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";

export const GIT_DOWNLOADS = "https://git-scm.com/downloads";

export function NoRepoState({ missing }: { missing: boolean }) {
  const { t } = useT();
  const act = missing
    ? () => void fileOpenApi.url(GIT_DOWNLOADS).catch((e) => toast.destructive(String(e?.message ?? e)))
    : () =>
        void navigator.clipboard.writeText("git init").then(
          () => toast.info(t("common.copied")),
          () => toast.warning(t("op.copyFailed")),
        );
  return (
    <EmptyState
      density="rich"
      actions={
        <button type="button" className="btn" onClick={act}>
          {missing ? t("diff.noGit.action") : t("diff.noRepo.action")}
        </button>
      }
    >
      {missing ? t("diff.noGit") : t("diff.noRepo")}
    </EmptyState>
  );
}
