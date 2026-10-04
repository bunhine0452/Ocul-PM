"""헤드리스 claude(stream-json) 에 비공개 `remote_control` 제어 요청을 보내 본다.

- initialize → remote_control{enabled:true} → 응답·이후 메시지를 전부 기록
- 원격(폰·브라우저)에서 들어온 user 메시지가 우리 stdout 에 보이는지 HOLD 초 동안 관찰
- 끝나면 remote_control{enabled:false} 로 끄고 stdin 을 닫는다
"""
import asyncio, json, os, subprocess, sys, tempfile, time, uuid

# 작업 폴더·로그는 임시 폴더에 — 저장소를 더럽히지 않는다. SPIKE_WORK 로 지정 가능.
WORK = os.environ.get("SPIKE_WORK") or tempfile.mkdtemp(prefix="claude-rc-spike-")
ROOT = WORK
subprocess.run(["git", "init", "-q"], cwd=WORK, check=False)
HOLD = int(sys.argv[1]) if len(sys.argv) > 1 else 20
LOG = open(os.path.join(ROOT, "events.log"), "a")
T0 = time.time()


def log(tag, obj):
    line = f"[{time.time()-T0:7.2f}] {tag} {json.dumps(obj, ensure_ascii=False)[:4000]}"
    LOG.write(line + "\n"); LOG.flush()
    print(line, flush=True)


async def main():
    env = {k: v for k, v in os.environ.items()
           if not (k == "CLAUDECODE" or k.startswith("CLAUDE_CODE_"))}
    proc = await asyncio.create_subprocess_exec(
        "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        cwd=WORK, env=env,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=open(os.path.join(ROOT, "stderr.log"), "a"), limit=16 * 1024 * 1024,
    )
    pending = {}

    async def reader():
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                log("EOF", {}); return
            try:
                msg = json.loads(raw)
            except Exception:
                log("RAW", raw.decode(errors="ignore")[:500]); continue
            if msg.get("type") == "control_response":
                rid = msg.get("response", {}).get("request_id")
                if rid in pending: pending.pop(rid).set_result(msg)
            log(msg.get("type", "?") + ("/" + msg["subtype"] if "subtype" in msg else ""), msg)

    task = asyncio.create_task(reader())

    async def control(request, timeout=60):
        rid = f"req_{uuid.uuid4().hex[:8]}"
        fut = asyncio.get_running_loop().create_future(); pending[rid] = fut
        proc.stdin.write((json.dumps({"type": "control_request", "request_id": rid, "request": request}) + "\n").encode())
        await proc.stdin.drain()
        return await asyncio.wait_for(fut, timeout)

    r = await control({"subtype": "initialize", "hooks": None})
    log("INIT_RESPONSE_KEYS", list(r.get("response", {}).get("response", {}).keys()))
    try:
        r = await control({"subtype": "remote_control", "enabled": True, "name": "ocul-pm spike 2"}, timeout=90)
        log("RC_ENABLE_RESPONSE", r)
    except asyncio.TimeoutError:
        log("RC_ENABLE_TIMEOUT", {})

    log("HOLD", {"seconds": HOLD})
    await asyncio.sleep(HOLD)

    try:
        r = await control({"subtype": "remote_control", "enabled": False}, timeout=30)
        log("RC_DISABLE_RESPONSE", r)
    except asyncio.TimeoutError:
        log("RC_DISABLE_TIMEOUT", {})
    proc.stdin.close()
    try:
        await asyncio.wait_for(proc.wait(), 20)
    except asyncio.TimeoutError:
        proc.kill()
    log("EXIT", {"code": proc.returncode})

asyncio.run(main())
