import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { createUiServer } from './server.mjs'

const token = 'offline-test-api-token-' + 'x'.repeat(40)
const runId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

async function close(server) {
  await new Promise(resolve => server.close(resolve))
}

async function rawStatus(port, path, host) {
  return await new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path,
      headers: { Host: host } }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end()
  })
}

test('host-only UI reads only its one scoped Run and strips raw artifact', async () => {
  const calls = []
  const upstream = http.createServer((request, response) => {
    calls.push({ url: request.url, method: request.method, authorization: request.headers.authorization,
      cookie: request.headers.cookie })
    response.setHeader('Content-Type', 'application/json')
    if (request.url?.endsWith('/results')) response.end(JSON.stringify({
      run_id: runId, status: 'failed', artifact_present: true, quarantined: true,
      reason: 'orphan_unverified', gates: null, review: null, commit: null }))
    else if (request.url?.includes('/events')) response.end(JSON.stringify([{
      seq: 1, attempt: 1, event: 'quarantined', owner: null,
      terminal_status: 'failed', created_at: '2026-10-13T12:00:00Z' }]))
    else response.end(JSON.stringify({ id: runId, status: 'failed', artifact: {
      diff: 'private patch', review_text: 'raw model output' } }))
  })
  const apiPort = await listen(upstream)
  const portProbe = http.createServer()
  const uiPort = await listen(portProbe)
  await close(portProbe)
  const ui = createUiServer({ apiToken: token, runId, apiPort, uiPort })
  await new Promise(resolve => ui.listen(uiPort, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${uiPort}`
  const path = `/ui/api/v1/runs/${runId}`
  try {
    const config = await (await fetch(origin + '/ui/config')).json()
    assert.deepEqual(config, { run_id: runId, mode: 'host-read-only' })
    const headers = { Authorization: 'Bearer browser-controlled', Cookie: 'browser=value' }
    const run = await fetch(origin + path, { headers })
    assert.equal(run.status, 200)
    const runBody = await run.json()
    assert.equal(runBody.artifact, null)
    assert.equal(JSON.stringify(runBody).includes('private patch'), false)
    assert.equal((await fetch(origin + path + '/results', { headers })).status, 200)
    assert.equal((await fetch(origin + path + '/events?limit=100', { headers })).status, 200)
    assert.equal((await fetch(origin + path + '/events?limit=101', { headers })).status, 400)
    assert.equal((await fetch(origin + path.replace(runId, otherId), { headers })).status, 404)
    assert.equal((await fetch(origin + '/ui/api/v1/tasks', { method: 'POST', headers })).status, 405)
    assert.equal((await fetch(origin + path + '/cancel', { method: 'POST', headers })).status, 405)
    assert.equal((await fetch(origin + '/ui/api/v1/runs/not-a-uuid', { headers })).status, 404)
    assert.equal(await rawStatus(uiPort, path, 'evil.invalid'), 403)
    assert.equal(await rawStatus(uiPort, 'http://[', `127.0.0.1:${uiPort}`), 400)
    assert.ok(calls.every(call => call.authorization === `Bearer ${token}` && !call.cookie && call.method === 'GET'))
    assert.equal(calls.length, 3)
  } finally {
    await close(ui)
    await close(upstream)
  }
})

test('server refuses missing scope and API bearer before listening', () => {
  assert.throws(() => createUiServer({ apiToken: token, runId: '' }))
  assert.throws(() => createUiServer({ apiToken: '', runId }))
})

test('CLI entrypoint starts the host-only server with an existing bearer', async () => {
  const probe = http.createServer()
  const port = await listen(probe)
  await close(probe)
  const environment = Object.fromEntries(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]))
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: import.meta.dirname,
    env: { ...environment, CAF_API_TOKEN: token, CAF_UI_RUN_ID: runId,
      CAF_UI_PORT: String(port), CAF_API_PORT: '8123' },
    stdio: 'ignore',
  })
  try {
    let ready = false
    for (let attempt = 0; attempt < 40; attempt++) {
      if (child.exitCode !== null) break
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ui/config`)
        ready = response.ok
        if (ready) break
      } catch { /* startup pending */ }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(ready, true)
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await new Promise(resolve => child.once('exit', resolve))
    }
  }
})
