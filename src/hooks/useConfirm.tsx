import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
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
 *
 * 키보드: 열리면 **확인 버튼**이 포커스를 받는다 — Enter 한 번이 곧 답이고,
 * Esc 는 언제나 취소다 (2026-09-21: 탭·터미널 닫기 경고가 뜬 뒤 Enter 를
 * 쳐도 아무 일이 없었다 — 첫 포커서블이 「취소」였다). 패널 어디에 포커스가
 * 있든 Enter 는 확인으로 읽되, 버튼 위에서는 그 버튼의 뜻을 존중한다.
 */
export interface ConfirmItem {
  text: string;
  /** 명령어·경로처럼 글자 그대로 읽어야 하는 값 — 고정폭으로 찍는다. */
  mono?: boolean;
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** 무엇이 걸려 있는지 — 실행 중인 명령 · 세션처럼 낱개로 보여 줄 것들. */
  items?: ConfirmItem[];
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
  const confirmRef = useRef<HTMLButtonElement | null>(null);

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

  // Enter = 확인. 버튼 위에서는 그 버튼이 알아서 하므로(취소 위의 Enter 는
  // 취소) 손대지 않는다 — 본문을 클릭해 포커스가 패널 자체로 옮겨 갔을 때
  // 받는다 (패널은 tabIndex=-1 이라 안쪽 어디를 눌러도 포커스가 거기 앉는다).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    e.preventDefault();
    settle(true);
  };

  const Icon = options?.danger ? TriangleAlert : CircleAlert;
  const confirmDialog = (
    <AppDialog
      open={options != null}
      onClose={() => settle(false)}
      label={options?.title ?? ""}
      width={420}
      initialFocusRef={confirmRef}
      onKeyDown={onKeyDown}
    >
      {options ? (
        <div className={"cf" + (options.danger ? " danger" : "")}>
          <div className="cf-body">
            <span className="cf-mark" aria-hidden="true">
              <Icon size={18} />
            </span>
            <div className="cf-text">
              <div className="sk-modal-head cf-title">{options.title}</div>
              {options.message ? <div className="sk-modal-warn cf-msg">{options.message}</div> : null}
              {options.items && options.items.length > 0 ? (
                <ul className="cf-list">
                  {options.items.map((item) => (
                    <li key={item.text} className={"cf-item" + (item.mono ? " mono" : "")}>
                      {item.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
          <div className="sk-modal-foot cf-foot">
            <button type="button" className="btn ghost sm" onClick={() => settle(false)}>
              <span>{t("common.cancel")}</span>
              <kbd className="kbd cf-key" aria-hidden="true">esc</kbd>
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={"btn sm cf-confirm" + (options.danger ? " danger" : " primary")}
              onClick={() => settle(true)}
            >
              <span>{options.confirmLabel ?? (options.danger ? t("common.delete") : t("common.confirm"))}</span>
              <kbd className="kbd cf-key" aria-hidden="true">↩</kbd>
            </button>
          </div>
        </div>
      ) : null}
    </AppDialog>
  );

  return { confirm, confirmDialog };
}
