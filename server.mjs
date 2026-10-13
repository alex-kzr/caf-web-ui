// Host-only, read-only CAF UI server. No worker credential is accepted or forwarded.

import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const runPath = new RegExp(`^/ui/api/v1/runs/(${uuid})(?:/(events|results))?$`, 'i')
const assetPath = /^\/assets\/[A-Za-z0-9._-]+$/

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

export function createUiServer({ apiToken, runId, apiPort = 8123, uiPort = 5174,
  staticRoot = join(dirname(fileURLToPath(import.meta.url)), 'dist') }) {
  if (typeof apiToken !== 'string' || apiToken.length < 32) throw new Error('existing CAF_API_TOKEN is required')
  if (typeof runId !== 'string' || !new RegExp(`^${uuid}$`, 'i').test(runId)) throw new Error('exact CAF_UI_RUN_ID is required')
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535 ||
      !Number.isInteger(uiPort) || uiPort < 1 || uiPort > 65535) throw new Error('invalid loopback port')
  const origin = `http://127.0.0.1:${uiPort}`
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    if (request.headers.host !== `127.0.0.1:${uiPort}`) return json(response, 403, { detail: 'Invalid host' })
    let url
    try { url = new URL(request.url ?? '/', origin) } catch {
      return json(response, 400, { detail: 'Invalid request target' })
    }
    if (request.method === 'GET' && url.pathname === '/ui/config') {
      return json(response, 200, { run_id: runId, mode: 'host-read-only' })
    }
    if (url.pathname.startsWith('/ui/api/')) {
      if (request.method !== 'GET') return json(response, 405, { detail: 'UI writes are disabled' })
      const match = runPath.exec(url.pathname)
      if (!match || match[1].toLowerCase() !== runId.toLowerCase()) return json(response, 404, { detail: 'Run outside UI scope' })
      if (match[2] === 'events') {
        for (const key of url.searchParams.keys()) {
          if (!['after_seq', 'limit'].includes(key) || url.searchParams.getAll(key).length !== 1) {
            return json(response, 400, { detail: 'Invalid event query' })
          }
        }
        const after = url.searchParams.get('after_seq')
        const limit = url.searchParams.get('limit')
        if ((after !== null && !/^(0|[1-9][0-9]*)$/.test(after)) ||
            (limit !== null && (!/^[1-9][0-9]*$/.test(limit) || Number(limit) > 100))) {
          return json(response, 400, { detail: 'Invalid event query' })
        }
      } else if (url.search) return json(response, 400, { detail: 'Unexpected query' })
      const target = `http://127.0.0.1:${apiPort}/v1/runs/${match[1]}${match[2] ? `/${match[2]}` : ''}${url.search}`
      try {
        const upstream = await fetch(target, {
          method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
        })
        if (upstream.status >= 300 && upstream.status < 400) return json(response, 502, { detail: 'API redirect refused' })
        if (!upstream.headers.get('content-type')?.startsWith('application/json')) {
          return json(response, 502, { detail: 'Invalid API response' })
        }
        const data = await upstream.json()
        if (!match[2] && upstream.ok && data && typeof data === 'object') data.artifact = null
        return json(response, upstream.status, data)
      } catch {
        return json(response, 503, { detail: 'CAF API unavailable' })
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { detail: 'Method not allowed' })
    if (url.search || (url.pathname !== '/' && url.pathname !== '/index.html' && !assetPath.test(url.pathname))) {
      return json(response, 404, { detail: 'Not found' })
    }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    try {
      const content = await readFile(join(staticRoot, path))
      const mime = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' :
        path.endsWith('.css') ? 'text/css' : 'application/octet-stream'
      response.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` })
      response.end(request.method === 'HEAD' ? undefined : content)
    } catch {
      json(response, 404, { detail: 'Not found' })
    }
  })
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.CAF_WORKER_TOKEN) throw new Error('worker credentials must not be present in UI server')
  const port = Number(process.env.CAF_UI_PORT ?? '5174')
  const apiPort = Number(process.env.CAF_API_PORT ?? '8123')
  createUiServer({ apiToken: process.env.CAF_API_TOKEN,
    runId: process.env.CAF_UI_RUN_ID, apiPort, uiPort })
    .listen(port, '127.0.0.1', () => process.stdout.write(`CAF read-only UI on http://127.0.0.1:${port}\n`))
}
