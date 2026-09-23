#!/usr/bin/env python3
"""ACP 스파이크 3 — 파일 변경 감사(`agentFileChangeReport`) 실측.

    python3 acp_file_change_audit_spike.py [어댑터 버전]   # 기본 0.81.0

0.70.0 이 추가한 확장이다. 0.77.0 까지는 턴이 끝나기 직전 어댑터의 Stop 훅이
숨은 continuation 을 넣어 "이번 턴에 바꾼 워크스페이스 파일을 전부 신고하라"를
시켰다(모델이 적는 목록, `declaredComplete` 도 모델이 정함). 0.81.0 부터는
그 continuation 이 없고 SDK 체크포인트(`rewindFiles` dry-run)로 목록을 뽑는다 —
`declaredComplete` 는 항상 false 다. 결과는 여전히 `session_info_update` 의
`_meta` 로 온다.

이 스파이크가 확인하는 계약:
  1. initialize 에서 `_meta.jetbrains.air.capabilities` 에 능력을 광고해야 켜진다
  2. 프롬프트마다 `_meta.jetbrains.air.agentFileChangeReportRequest` 로 requestId 를 준다
  3. 결과가 `session_info_update._meta.jetbrains.air.agentFileChangeReport` 로 온다
  4. (0.81.0) 파일을 **안 건드린** 턴도 `reported` + 빈 목록으로 오는가, 아니면
     `unavailable` 로 오는가 — 대화만 한 턴마다 "신고를 받지 못했어요"가 뜰지를 가른다

안전장치: cwd 는 매번 새로 만드는 임시 디렉터리(끝나면 삭제), 첫 프롬프트는 그
안에 파일 하나 만들기, 둘째는 파일을 건드리지 않는 질문. 권한 요청은 **그 임시
디렉터리 안의 쓰기만** 허용한다.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

VERSION = sys.argv[1] if len(sys.argv) > 1 else "0.81.0"
CWD = tempfile.mkdtemp(prefix="acp-fca-spike-")

proc = subprocess.Popen(
    ["npx", "-y", f"@agentclientprotocol/claude-agent-acp@{VERSION}"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1, cwd=CWD,
)

lock = threading.Lock()
state = {"sid": None, "agent": None}
reports = []
kinds = []
turn_done = {}

# 턴마다 (requestId, 프롬프트). 둘째 턴은 파일을 건드리지 않는다.
TURNS = [
    ("spike-fca-edit", "이 폴더에 spike.txt 파일을 만들고 hello 라고만 써. 설명하지 마."),
    ("spike-fca-chat", "1 더하기 1 은? 숫자만 답해. 도구는 쓰지 마."),
]


def send(obj):
    with lock:
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()


def on_line(line):
    if not line:
        return
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        return

    # 에이전트 → 클라이언트 요청. 권한은 첫 번째 allow 계열을 고른다
    # (cwd 가 임시 디렉터리라 파괴 범위가 없다).
    if "method" in msg and "id" in msg:
        params = msg.get("params") or {}
        options = params.get("options") or []
        allow = next(
            (o for o in options if "allow" in str(o.get("kind", "")).lower()
             or "allow" in str(o.get("optionId", "")).lower()),
            None,
        )
        if allow:
            print(f"[REQ<-] {msg['method']} → allow({allow.get('optionId')})", flush=True)
            send({"jsonrpc": "2.0", "id": msg["id"],
                  "result": {"outcome": {"outcome": "selected", "optionId": allow["optionId"]}}})
        else:
            print(f"[REQ<-] {msg['method']} → cancelled", flush=True)
            send({"jsonrpc": "2.0", "id": msg["id"],
                  "result": {"outcome": {"outcome": "cancelled"}}})
        return

    if msg.get("method") == "session/update":
        u = msg["params"]["update"]
        kind = u.get("sessionUpdate")
        kinds.append(kind)
        air = (((u.get("_meta") or {}).get("jetbrains") or {}).get("air") or {})
        report = air.get("agentFileChangeReport")
        if report is not None:
            reports.append(report)
            print(f"[REPORT] {json.dumps(report, ensure_ascii=False)}", flush=True)
        return

    if "id" in msg:
        res = msg.get("result")
        if msg["id"] == 1 and res:
            state["agent"] = res.get("agentInfo")
        if msg["id"] == 2 and res:
            state["sid"] = res["sessionId"]
        if msg["id"] >= 10 and msg["id"] in turn_done:
            print(f"[RES] 턴 {msg['id']} 완료 {json.dumps(res or msg.get('error'))[:160]}", flush=True)
            turn_done[msg["id"]].set()


threading.Thread(target=lambda: [on_line(l.strip()) for l in proc.stdout], daemon=True).start()
threading.Thread(target=lambda: [None for _ in proc.stderr], daemon=True).start()

# 1) 능력 광고 — 이게 없으면 어댑터는 감사 자체를 켜지 않는다. 앱
#    (`src-tauri/src/acp/process.rs`)과 같은 목록을 싣는다.
send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": {"protocolVersion": 1,
                 "clientCapabilities": {
                     "_meta": {"jetbrains": {"air": {
                         "version": 1,
                         "capabilities": ["sessionFailure", "agentFileChangeReport"],
                     }}},
                 }}})
send({"jsonrpc": "2.0", "id": 2, "method": "session/new",
      "params": {"cwd": CWD, "mcpServers": []}})

for _ in range(120):
    if state["sid"]:
        break
    time.sleep(0.5)

if not state["sid"]:
    print("[!!] session/new 실패", flush=True)
else:
    for index, (request_id, text) in enumerate(TURNS):
        rpc_id = 10 + index
        turn_done[rpc_id] = threading.Event()
        before = len(reports)
        # 2) 프롬프트에 requestId 를 싣는다 (키는 정확히 version·requestId 둘뿐이어야 한다).
        send({"jsonrpc": "2.0", "id": rpc_id, "method": "session/prompt",
              "params": {"sessionId": state["sid"],
                         "prompt": [{"type": "text", "text": text}],
                         "_meta": {"jetbrains": {"air": {
                             "agentFileChangeReportRequest": {"version": 1, "requestId": request_id},
                         }}}}})
        turn_done[rpc_id].wait(timeout=180)
        # 보고는 프롬프트 응답 직전/직후에 올 수 있어 잠깐 더 기다린다.
        for _ in range(20):
            if len(reports) > before:
                break
            time.sleep(0.5)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()

created = sorted(os.listdir(CWD))
shutil.rmtree(CWD, ignore_errors=True)

seen = []
for k in kinds:
    if k not in seen:
        seen.append(k)

print("\n=== 결과 ===")
print(f"어댑터: {json.dumps(state['agent'], ensure_ascii=False)}")
print(f"실제로 만들어진 파일: {created}")
print(f"관측된 sessionUpdate 종류: {seen}")
print(f"파일 변경 보고 {len(reports)}건:")
for r in reports:
    print(f"  {json.dumps(r, ensure_ascii=False)}")
for request_id, _ in TURNS:
    got = [r for r in reports if r.get("requestId") == request_id]
    verdict = f"{got[0].get('status')} {got[0].get('reason') or got[0].get('paths')}" if got else "없음 ✗"
    print(f"계약 확인: {request_id} → {verdict}")
