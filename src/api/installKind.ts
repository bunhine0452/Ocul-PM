// 설치 형식 (크로스플랫폼 L-UPD `#upd-target-missing`) — `install_kind` 커맨드의 창구.
//
// 봉투 없이 값을 그대로 돌려주는 커맨드라 `call` 규약 밖이다 (`vscodeExt.ts` 와 같은
// 자리). 실패는 `null`(모름)로 접는다 — 업데이터는 모르면 예전처럼 확인한다.
import { commands, type InstallKind } from "@/lib/bindings";

export type { InstallKind };

export const installKindApi = {
  get: (): Promise<InstallKind | null> =>
    Promise.resolve()
      .then(() => commands.installKind())
      .catch(() => null),
};
