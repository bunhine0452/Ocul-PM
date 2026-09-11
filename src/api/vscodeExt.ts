// VS Code 확장 연동 (플랜 `vscode-extension-round` {#app-settings}).
//
// `vscode_extension_status` 는 봉투 없이 값을 그대로 돌려주는 커맨드라 `call`
// 규약 밖이다 — `claudeSurface.pluginStatus` 와 같은 자리에서 감싸 두어 화면이
// `bindings` 를 직접 만지지 않게 한다. 실패는 `null`("확인 중/못 함") 로 접는다.
import { commands, type VscodeExtensionStatus } from "@/lib/bindings";

export type { VscodeExtensionStatus };

export const vscodeExtApi = {
  status: (): Promise<VscodeExtensionStatus | null> =>
    Promise.resolve()
      .then(() => commands.vscodeExtensionStatus())
      .catch(() => null),
};
