export type CreateTask = {
  target_repository: string
  workspace_id: string | null
  base_revision: string
  prompt: string
  acceptance_criteria: string[]
  provider: 'codex' | 'claude'
  max_corrections: number
}

export type RunStatus = {
  id: string
  task_id: string
  correlation_id: string
  provider: 'codex' | 'claude'
  max_corrections: number
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  attempt: number
  cancel_requested: boolean
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
  artifact: Record<string, unknown> | null
}

const slug = /^[a-z0-9][a-z0-9-]{0,62}$/
const revision = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const statuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled']

export function validateTask(input: CreateTask): string[] {
  const errors: string[] = []
  if (!slug.test(input.target_repository)) errors.push('Repository must be a lowercase slug (1-63 characters).')
  if (input.workspace_id !== null && !slug.test(input.workspace_id)) errors.push('Workspace ID must be a lowercase slug.')
  if (!revision.test(input.base_revision)) errors.push('Base revision must be a 40 or 64 character lowercase hex SHA.')
  if (!input.prompt || Array.from(input.prompt).length > 20_000) errors.push('Prompt must contain 1-20,000 characters.')
  if (input.acceptance_criteria.length < 1 || input.acceptance_criteria.length > 20 ||
      input.acceptance_criteria.some(item => !item.trim() || Array.from(item).length > 2000)) {
    errors.push('Provide 1-20 nonempty acceptance criteria, each at most 2,000 characters.')
  }
  if (!['codex', 'claude'].includes(input.provider)) errors.push('Choose Codex or Claude.')
  if (!Number.isInteger(input.max_corrections) || input.max_corrections < 0 || input.max_corrections > 3) {
    errors.push('Maximum corrections must be 0-3.')
  }
  return errors
}

export function parseRun(text: string): RunStatus {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a RunStatus JSON object.')
  const run = value as Record<string, unknown>
  if (!['id', 'task_id', 'correlation_id'].every(key => typeof run[key] === 'string' && uuid.test(run[key] as string)) ||
      !statuses.includes(run.status as string) || !['codex', 'claude'].includes(run.provider as string) ||
      !Number.isInteger(run.attempt) || (run.attempt as number) < 0 ||
      !Number.isInteger(run.max_corrections) || typeof run.cancel_requested !== 'boolean' ||
      typeof run.created_at !== 'string' || typeof run.updated_at !== 'string' ||
      !['started_at', 'finished_at'].every(key => run[key] === null || typeof run[key] === 'string') ||
      (run.artifact !== null && (typeof run.artifact !== 'object' || Array.isArray(run.artifact))) ||
      (run.artifact !== null && (run.artifact as Record<string, unknown>).reason === 'orphan_unverified' && run.status !== 'failed')) {
    throw new Error('JSON does not match the current CAF RunStatus shape.')
  }
  return run as RunStatus
}
