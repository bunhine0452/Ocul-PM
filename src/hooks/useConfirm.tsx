import { useCallback, useRef, useState, type ReactNode } from "react";
import { AppDialog } from "@/components/ui/AppDialog";
import { useT } from "@/i18n";

/**
 * 파괴 동작 확인 한 벌 — `window.confirm`(네이티브, 테마 밖) · AppDialog 손제작 ·
 * 인라인 2단계 버튼 · 무확인이 화면마다 섞여 있었다(2026-08-30 감사). 이 훅은
 * AppDialog(Esc · 트랩 · 포커스 복원) 위에서 Promise 하나로 답한다.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm();
 * if (!(await confirm({ title: t("x.deleteTitle"), message: t("x.deleteBody"), danger: true }))) return;
 * …
 * return (<>{…}{confirmDialog}</>);
 * ```
 */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** 확인 버튼 라벨 (기본: 확인 / danger 면 삭제). */
  confirmLabel?: string;
  /** 되돌릴 수 없는 동작 — 확인 버튼이 빨갛다. */
  danger?: boolean;
}

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const { t } = useT();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // 이전 질문이 아직 열려 있었다면 취소로 닫는다 — 두 질문을 겹치지 않는다.
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(next);
      }),
    [],
  );

  const confirmDialog = (
    <AppDialog
      open={options != null}
      onClose={() => settle(false)}
      label={options?.title ?? ""}
      width={440}
    >
      {options ? (
        <>
          <div className="sk-modal-head">{options.title}</div>
          {options.message ? <div className="sk-modal-warn">{options.message}</div> : null}
          <div className="sk-modal-foot">
            <button type="button" className="btn ghost sm" onClick={() => settle(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={"btn sm" + (options.danger ? " danger" : "")}
              onClick={() => settle(true)}
            >
              {options.confirmLabel ?? (options.danger ? t("common.delete") : t("common.confirm"))}
            </button>
          </div>
        </>
      ) : null}
    </AppDialog>
  );

  return { confirm, confirmDialog };
}
