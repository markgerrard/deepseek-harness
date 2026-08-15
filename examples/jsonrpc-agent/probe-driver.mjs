// Probe: drive dsh-jsonrpc-agent over raw newline-delimited JSON-RPC, exactly
// as a Go adapter would, and record the full session.event stream.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REPO = process.env.DSH_REPO ?? new URL('../..', import.meta.url).pathname
const BIN = `${REPO}/packages/examples/jsonrpc-demo/lib/bin.js`
const OUT = process.env.PROBE_OUT ?? '/tmp/dsh-frames.jsonl'
const TASK = process.argv[2] ?? 'Use the bash tool to run exactly: echo probe-ok. Then reply with the output and nothing else.'

const child = spawn(process.execPath, [BIN], {
  cwd: process.env.DSH_CWD,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
})

const frames = []
let nextId = 1
const pending = new Map()

function send(method, params) {
  const id = nextId++
  const frame = { jsonrpc: '2.0', id, method, params }
  frames.push({ dir: 'out', frame })
  child.stdin.write(JSON.stringify(frame) + '\n')
  return new Promise((res, rej) => pending.set(id, { res, rej }))
}

let buf = ''
child.stdout.on('data', (d) => {
  buf += d.toString()
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { frames.push({ dir: 'in', raw: line }); continue }
    frames.push({ dir: 'in', frame: msg })
    if (msg.id !== undefined && msg.method === undefined) {
      const p = pending.get(msg.id)
      if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result) }
    }
    if (msg.method === 'session.status') {
      const s = msg.params?.status ?? msg.params?.state
      if (s === 'idle' && sawRunning) finish('idle')
    }
    if (msg.method === 'session.status' && (msg.params?.status ?? msg.params?.state) === 'running') sawRunning = true
  }
})
let sawRunning = false
const stderrChunks = []
child.stderr.on('data', (d) => stderrChunks.push(d.toString()))

let done = false
function finish(reason) {
  if (done) return
  done = true
  writeFileSync(OUT, frames.map((f) => JSON.stringify(f)).join('\n') + '\n')

  const evTypes = new Map()
  let notifMethods = new Map()
  for (const f of frames) {
    if (f.dir !== 'in' || !f.frame?.method) continue
    notifMethods.set(f.frame.method, (notifMethods.get(f.frame.method) ?? 0) + 1)
    if (f.frame.method === 'session.event') {
      const t = f.frame.params?.event?.type ?? f.frame.params?.type ?? '(unknown)'
      evTypes.set(t, (evTypes.get(t) ?? 0) + 1)
    }
  }
  console.log('=== reason:', reason)
  console.log('=== frames:', frames.length, '-> ' + OUT)
  console.log('=== notification methods:')
  for (const [m, n] of [...notifMethods].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${m}`)
  console.log('=== session.event types:')
  for (const [t, n] of [...evTypes].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${t}`)
  if (stderrChunks.length) console.log('=== stderr (first 600):\n' + stderrChunks.join('').slice(0, 600))
  child.kill('SIGKILL')
  process.exit(0)
}

setTimeout(() => finish('timeout'), Number(process.env.PROBE_TIMEOUT_MS ?? 90000))

try {
  const init = await send('initialize', {
    cwd: process.env.DSH_CWD,
    provider: 'deepseek-official',
    model: process.env.DSH_MODEL,
    maxTokens: 2048,
  })
  console.log('=== initialize result:', JSON.stringify(init))
  const pr = await send('session/prompt', {
    sessionId: 'probe-session-1',
    contentBlocks: [{ type: 'text', text: TASK }],
  })
  console.log('=== session/prompt result:', JSON.stringify(pr))
} catch (e) {
  console.log('=== request error:', e.message)
  finish('request-error')
}
