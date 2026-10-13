import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { parseRun, validateTask } from './contracts'
import exampleRun from './example-run.json'

afterEach(cleanup)

describe('host-only one-Run read', () => {
  it('loads typed results and the lease journal from three read-only endpoints', async () => {
    const originalFetch = globalThis.fetch
    const runId = String(exampleRun.id)
    const urls: string[] = []
    globalThis.fetch = async (input) => {
      const url = String(input)
      urls.push(url)
      const body = url === '/ui/config' ? { run_id: runId, mode: 'host-read-only' }
        : url.endsWith('/results') ? { run_id: runId, status: exampleRun.status,
          artifact_present: true, quarantined: true, reason: 'orphan_unverified',
          gates: null, review: null, commit: null }
        : url.includes('/events?') ? [{ seq: 1, attempt: 1, event: 'quarantined',
          owner: null, terminal_status: 'failed', created_at: '2026-10-13T12:00:00Z' }]
        : { ...exampleRun, artifact: null }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: 'Connect to local UI server' }))
      await waitFor(() => expect(screen.getByText(runId)).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Read Run' }))
      await waitFor(() => expect(screen.getByText('Lease journal')).toBeTruthy())
      expect(screen.getByText(/Quarantined: the worker lease expired/)).toBeTruthy()
      expect(urls).toEqual(['/ui/config', `/ui/api/v1/runs/${runId}`,
        `/ui/api/v1/runs/${runId}/results`, `/ui/api/v1/runs/${runId}/events?limit=100`])
    } finally { globalThis.fetch = originalFetch }
  })
})

describe('offline CAF workbench', () => {
  it('does not make network calls while showing the illustrative quarantined Run', () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = () => { throw new Error('unexpected network request') }
    try {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: 'Load test example' }))
      expect(screen.getByText(/Illustrative test fixture/)).toBeTruthy()
      expect(screen.getByText(/Quarantined: the worker lease expired/)).toBeTruthy()
      expect(screen.getByText(/No gate results/)).toBeTruthy()
      expect(screen.getByText(/No structured review/)).toBeTruthy()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('validates task fields without submitting a Run', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare request JSON' }))
    expect(screen.getByRole('alert').textContent).toContain('Repository must be')
    expect(screen.queryByTestId('request-json')).toBeNull()
    expect(validateTask({ target_repository: 'caf-sample-app', workspace_id: null,
      base_revision: 'a'.repeat(40), prompt: 'Check a fixture', acceptance_criteria: ['Tests pass'],
      provider: 'codex', max_corrections: 0 })).toEqual([])
  })

  it('prepares a valid request body locally', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Target repository'), { target: { value: 'caf-sample-app' } })
    fireEvent.change(screen.getByLabelText('Base revision'), { target: { value: 'a'.repeat(40) } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Change the sample' } })
    fireEvent.change(screen.getByLabelText(/Acceptance criteria/), { target: { value: 'Tests pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare request JSON' }))
    const output = screen.getByTestId('request-json').textContent ?? ''
    expect(JSON.parse(output).target_repository).toBe('caf-sample-app')
    expect(JSON.parse(output).acceptance_criteria).toEqual(['Tests pass'])
    expect(screen.getByText(/This preview is not submitted/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Changed task' } })
    expect(screen.queryByTestId('request-json')).toBeNull()
  })

  it('rejects malformed or executable content in imported Run data', () => {
    expect(() => parseRun('{"status":"running"}')).toThrow()
    expect(() => parseRun('<script>alert(1)</script>')).toThrow()
    const inconsistent = { ...JSON.parse(JSON.stringify(exampleRun)), status: 'succeeded' }
    expect(() => parseRun(JSON.stringify(inconsistent))).toThrow()
  })

  it('renders imported gate and review data, then clears a failed import', async () => {
    render(<App />)
    const input = screen.getByLabelText('Import RunStatus JSON')
    const content = JSON.stringify({ ...exampleRun, status: 'succeeded',
      artifact: { gates: [{ suite: 'test_discount.py', passed: true }],
        review: { approved: true, findings: [] }, commit: 'a'.repeat(40) } })
    const valid = new File([content], 'run.json', { type: 'application/json' })
    Object.defineProperty(valid, 'text', { value: async () => content })
    fireEvent.change(input, { target: { files: [valid] } })
    await waitFor(() => expect(screen.getByText('test_discount.py: passed')).toBeTruthy())
    expect(screen.getByText('Approved')).toBeTruthy()
    const bad = new File(['{}'], 'bad.json', { type: 'application/json' })
    Object.defineProperty(bad, 'text', { value: async () => '{}' })
    fireEvent.change(input, { target: { files: [bad] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not read'))
    expect(screen.queryByText('test_discount.py: passed')).toBeNull()
  })

  it('does not crash on a malformed finding in an opaque artifact', async () => {
    render(<App />)
    const content = JSON.stringify({ ...exampleRun, status: 'failed',
      artifact: { review: { approved: false, findings: [{ toString: 'not a function' }] } } })
    const file = new File([content], 'run.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => content })
    fireEvent.change(screen.getByLabelText('Import RunStatus JSON'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText('Non-text finding omitted')).toBeTruthy())
  })
})
