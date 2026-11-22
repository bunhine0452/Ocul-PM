---
schema_version: 1
type: bug
slug: "win-update-exit-race"
status: done
difficulty: medium
created_at: "2026-11-22T10:25:00+09:00"
session_id: "manual-20261122-102500"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/windows/installer-hooks.nsh"
    op: update
related: []
tags:
  - "업데이트"
  - "windows"
  - "설치"
---
[x] 업데이트: 꺼지는 중인 앱을 기다렸다 바꾼다

## 발생 원인
사용자 제보(11-22): Windows 에서 4.11.2 → 4.12.0 앱 안 업데이트가 「Ocul-PM을(를) 종료하지 못했습니다. 먼저 닫은 후 다시 시도하세요.」(템플릿의 `failedToKillApp`)로 멈췄다.

로그로 본 순서는 이렇다.
- 앱 로그: 01:11:58.743Z `update: 설치 파일 직전 — 세션 마감 · 터미널 정리` 다음에 감시 종료 줄이 나오고 끝난다.
- `%TEMP%\ocul-pm-setup.log`: 4.12.0 은 `preinstall` · `os:` 줄까지만 있고 `postinstall` 이 없다. 파일의 마지막 쓰기는 10:12:00 이다. 4.9.1 부터 4.11.2 까지 일곱 번은 모두 `postinstall: done` 이었다.
- 같은 PC 는 10:11:24 에 막 로그인한 상태였다(explorer 생성 시각). 새 4.11.2 프로세스는 10:12:13 에 정상 기동했다. 단일 인스턴스 플러그인이 넘기지 않았으니, 그때는 옛 프로세스가 이미 없었다.

업데이터 플러그인(2.14.1)은 `ShellExecuteW` 로 설치 파일을 띄운 **뒤에** `std::process::exit(0)` 을 부른다. 그래서 설치 파일과 옛 앱의 종료가 경쟁한다. CLI 2.12.4 템플릿의 `CheckIfAppIsRunning` 은 PREINSTALL 훅 바로 뒤에 Restart Manager 로 `$INSTDIR\ocul-pm.exe` 를 쓰는 프로세스를 찾고 `RmShutdown(RmForceShutdown)` 한다. ExitProcess 안에 들어간 프로세스는 강제 종료가 거부되므로 RmShutdown 이 실패하고, 곧 꺼질 앱 때문에 설치가 취소된다. 로그인 직후처럼 PC 가 바쁘면 종료가 길어져 이 틈에 걸린다.

## 해결 방법
`installer-hooks.nsh` 에 `OCULPM_WAIT_APP_EXIT` 를 더했다. PREINSTALL 의 맨 끝, 템플릿의 종료 단계 바로 앞에서 돈다.
- `/UPDATE`(앱 안 업데이트)일 때만 동작한다. 손으로 돌리는 설치(/S · GUI)에서는 앱이 스스로 꺼지는 중이 아니므로, 템플릿의 묻기·끄기가 맞다.
- `$INSTDIR\ocul-pm.exe` 를 쓰기로 열 수 있을 때까지 250ms 간격으로 최대 20초 기다린다. 돌거나 꺼지는 중인 실행 파일은 이미지가 매핑돼 있어 쓰기로 열리지 않는다. 플러그인 함수에 기대지 않고, 템플릿이 실제로 필요로 하는 조건(파일을 바꿀 수 있다)을 직접 본다.
- 기다린 시간을 설치 로그에 `app: not in use (waited N ms)` 또는 `app: still in use after N ms …` 로 남긴다. 20초가 지나도 쓰이고 있으면 예전처럼 템플릿 단계로 넘긴다.

이 고침은 **다음 판의 설치 파일**부터 쓰인다. 업데이트 때 도는 것은 새 판의 설치 파일이라, 이미 배포된 4.12.0 설치 파일로 가는 업데이트에는 적용되지 않는다.

## 검증
- 이 PC 에는 makensis 가 없어 컴파일하지 못했다(설치본 빌드는 CI 몫). 다음 CI 의 Windows 설치 스모크(`install-smoke-windows.ps1` 의 `/P /UPDATE` 관문)에서 컴파일과 동작이 확인된다.
- 파일 인코딩: 첫 3바이트 `EF BB BF`(BOM 유지), LF 279줄. Restart Manager 로 지금 설치본을 쓰는 프로세스를 세면 앱 자신 하나(`pid=11104 app='Ocul-PM' type=1`)뿐이다. 제3의 프로세스가 파일을 잡고 있는 경우는 아니었다.

## 메모
지금 4.11.2 사용자가 다시 시도하면 대개 통과한다(경쟁이라서다). 그래도 막히면 앱을 완전히 끄고 릴리스의 setup.exe 를 직접 돌리면 된다. 종료가 왜 1초 넘게 걸리는지(ExitProcess 안의 DLL 분리 · WebView2)는 재지 못했다.
