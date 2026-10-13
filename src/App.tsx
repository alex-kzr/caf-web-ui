import { useState, type FormEvent } from 'react'
import { parseRun, validateTask, type CreateTask, type RunStatus } from './contracts'
import exampleRun from './example-run.json'

const initial: CreateTask = {
  target_repository: '', workspace_id: null, base_revision: '', prompt: '',
  acceptance_criteria: [], provider: 'codex', max_corrections: 0,
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function Artifact({ artifact }: { artifact: Record<string, unknown> | null }) {
  if (!artifact) return <p className="muted">No artifact has been recorded.</p>
  const reason = text(artifact.reason)
  const gates = Array.isArray(artifact.gates) ? artifact.gates : null
  const review = artifact.review && typeof artifact.review === 'object' && !Array.isArray(artifact.review)
    ? artifact.review as Record<string, unknown> : null
  return <>
    {reason === 'orphan_unverified' && <div className="notice danger" role="alert">
      Quarantined: the worker lease expired. An orphan process was not verified safe; this Run will not replay automatically.
    </div>}
    {reason && reason !== 'orphan_unverified' && <p><strong>Reason:</strong> {reason}</p>}
    <div className="result-grid">
      <section>
        <h3>Quality gates</h3>
        {gates ? <ul>{gates.map((gate, index) => {
          const item = gate && typeof gate === 'object' ? gate as Record<string, unknown> : {}
          return <li key={index}>{text(item.suite) ?? `Gate ${index + 1}`}: {item.passed === true ? 'passed' : item.passed === false ? 'failed' : 'unknown'}</li>
        })}</ul> : <p className="muted">No gate results in this artifact.</p>}
      </section>
      <section>
        <h3>Review</h3>
        {review ? <>
          <p>{review.approved === true ? 'Approved' : review.approved === false ? 'Not approved' : 'Verdict unavailable'}</p>
          {Array.isArray(review.findings) && <ul>{review.findings.map((finding, index) =>
            <li key={index}>{typeof finding === 'string' ? finding : 'Non-text finding omitted'}</li>)}</ul>}
        </> : <p className="muted">No structured review in this artifact.</p>}
      </section>
    </div>
    {text(artifact.commit) && <p><strong>Local commit:</strong> <code>{text(artifact.commit)}</code></p>}
  </>
}

function RunInspector({ run, label }: { run: RunStatus | null, label: string }) {
  if (!run) return <p className="muted">Load the labeled test example or import a sanitized RunStatus JSON file.</p>
  return <div className="run-inspector">
    <div className="run-top"><span className="eyebrow">{label}</span><span className={`status ${run.status}`}>{run.status}</span></div>
    <h3>Run {run.id}</h3>
    {run.status === 'queued' && <p className="notice">Queued only. No worker execution is implied.</p>}
    {run.status === 'running' && <p className="notice">Recorded as running at the last update; this offline view is not live.</p>}
    <dl className="facts">
      <div><dt>Task</dt><dd>{run.task_id}</dd></div>
      <div><dt>Correlation</dt><dd>{run.correlation_id}</dd></div>
      <div><dt>Provider</dt><dd>{run.provider}</dd></div>
      <div><dt>Attempt</dt><dd>{run.attempt}</dd></div>
      <div><dt>Created</dt><dd>{run.created_at}</dd></div>
      <div><dt>Started</dt><dd>{run.started_at ?? 'Not recorded'}</dd></div>
      <div><dt>Finished</dt><dd>{run.finished_at ?? 'Not recorded'}</dd></div>
      <div><dt>Updated</dt><dd>{run.updated_at}</dd></div>
    </dl>
    <Artifact artifact={run.artifact} />
  </div>
}

export function App() {
  const [form, setForm] = useState(initial)
  const [criteria, setCriteria] = useState('')
  const [request, setRequest] = useState<CreateTask | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [run, setRun] = useState<RunStatus | null>(null)
  const [runLabel, setRunLabel] = useState('')
  const [importError, setImportError] = useState('')

  function updateForm(next: CreateTask) {
    setForm(next)
    setRequest(null)
    setErrors([])
  }

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const candidate = { ...form, target_repository: form.target_repository.trim(),
      workspace_id: form.workspace_id?.trim() || null,
      base_revision: form.base_revision.trim(),
      acceptance_criteria: criteria.split('\n').map(item => item.trim()).filter(Boolean) }
    const nextErrors = validateTask(candidate)
    setErrors(nextErrors)
    setRequest(nextErrors.length ? null : candidate)
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    setImportError('')
    setRun(null)
    setRunLabel('')
    if (file.size > 262_144) { setImportError('Run JSON exceeds the 256 KiB UI import limit.'); return }
    try {
      const parsed = parseRun(await file.text())
      setRun(parsed)
      setRunLabel('Imported local JSON - not live')
    } catch {
      setImportError('Could not read a CAF RunStatus JSON object. Check its required fields and types.')
    }
  }

  return <main>
    <header className="masthead">
      <div><span className="eyebrow">CrewAI Factory / P0</span><h1>Task & run workbench</h1></div>
      <p>Offline contract preview. No task is submitted, no API is contacted, and no worker or model is started.</p>
    </header>
    <div className="notice">The current core API can store a queued Run, but an always-on production worker and browser authentication are not available. This page only prepares a request and inspects local JSON.</div>
    <div className="columns">
      <section className="panel" aria-labelledby="task-title">
        <div className="section-head"><span className="eyebrow">01 / Request</span><h2 id="task-title">Prepare a coding task</h2></div>
        <form onSubmit={prepare} noValidate>
          <label>Target repository <input value={form.target_repository} onChange={event => updateForm({ ...form, target_repository: event.target.value })} placeholder="caf-sample-app" /></label>
          <label>Workspace ID <input value={form.workspace_id ?? ''} onChange={event => updateForm({ ...form, workspace_id: event.target.value })} placeholder="Optional registered ID" /></label>
          <label>Base revision <input value={form.base_revision} onChange={event => updateForm({ ...form, base_revision: event.target.value })} placeholder="40 or 64 lowercase hex characters" /></label>
          <label>Prompt <textarea rows={5} value={form.prompt} onChange={event => updateForm({ ...form, prompt: event.target.value })} placeholder="Describe the coding task" /></label>
          <label>Acceptance criteria <span className="hint">One per line</span><textarea rows={4} value={criteria} onChange={event => { setCriteria(event.target.value); setRequest(null); setErrors([]) }} placeholder="State observable success conditions" /></label>
          <div className="field-row"><label>Provider <select value={form.provider} onChange={event => updateForm({ ...form, provider: event.target.value as CreateTask['provider'] })}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
            <label>Max corrections <input type="number" min="0" max="3" value={form.max_corrections} onChange={event => updateForm({ ...form, max_corrections: Number(event.target.value) })} /></label></div>
          <button type="submit">Prepare request JSON</button>
        </form>
        {errors.length > 0 && <div className="notice danger" role="alert"><strong>Fix these fields:</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        {request && <div className="output"><h3>Validated request body</h3><p className="muted">For the authenticated <code>POST /v1/tasks</code> contract. This preview is not submitted.</p><pre data-testid="request-json">{JSON.stringify(request, null, 2)}</pre></div>}
      </section>
      <section className="panel" aria-labelledby="run-title">
        <div className="section-head"><span className="eyebrow">02 / Evidence</span><h2 id="run-title">Inspect a Run</h2></div>
        <div className="actions"><button type="button" className="secondary" onClick={() => {
          setRun(parseRun(JSON.stringify(exampleRun)))
          setRunLabel('Illustrative test fixture - fabricated IDs')
          setImportError('')
        }}>Load test example</button>
          <label className="file-label">Import RunStatus JSON<input type="file" accept="application/json,.json" onChange={event => void importFile(event.target.files?.[0])} /></label></div>
        {importError && <p className="notice danger" role="alert">{importError}</p>}
        <RunInspector run={run} label={runLabel} />
      </section>
    </div>
    <footer>CAF P0 preview - No live stream, service control, task list or automatic execution.</footer>
  </main>
}
