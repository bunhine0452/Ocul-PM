/**
 * 「Notion 으로 보내기」 (감사 라운드 2026-09-11 C1).
 *
 * PR-CI7 이 만든 내보내기 버튼은 회고 화면에 있었고, 2026-09-08 회고 삭제와
 * 함께 사라졌다 — 설정의 Notion 섹션(토큰·부모 페이지·OAuth 브로커)은 남아
 * **아무것도 못 하는 연동**이 됐다. 이 훅이 트리거를 되살린다: 일지 상세와
 * 브랜치 요약이 같은 훅을 쓴다.
 *
 * 계약은 그때와 같다 — 토큰이 없으면 버튼을 **그리지 않는다**(`ready`
 * 거짓), 성공하면 새 페이지를 브라우저로 연다. 상태는 모듈에서 한 번만
 * 묻는다(설정에서 연결하면 `invalidateNotionStatus`).
 */
import { useCallback, useEffect, useState } from "react";

import { notionApi } from "@/api/notion";
import { toAppError } from "@/api/invoke";
import { t } from "@/i18n";
import { toast } from "@/lib/toast";

let statusCache: Promise<boolean> | null = null;

function notionReady(): Promise<boolean> {
  statusCache ??= notionApi
    .status()
    .then((s) => s.has_token)
    .catch(() => false);
  return statusCache;
}

/** 설정에서 연결·해제한 뒤 — 다음 화면이 다시 묻게 한다. */
export function invalidateNotionStatus(): void {
  statusCache = null;
}

export function useNotionExport(projectId: number) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void notionReady().then((ok) => {
      if (alive) setReady(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const send = useCallback(
    async (title: string, markdown: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const url = await notionApi.export(projectId, title, markdown);
        toast.info(t("notion.exported"), {
          actions: [{ label: t("notion.open"), onClick: () => void notionApi.openUrl(url) }],
        });
      } catch (e) {
        const err = toAppError(e);
        toast.destructive(t("notion.exportFailed", { error: err.detail ?? err.code }));
      } finally {
        setBusy(false);
      }
    },
    [busy, projectId],
  );

  return { ready, busy, send };
}
