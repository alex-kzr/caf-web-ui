# CAF web UI: offline P0 workbench

This independent repository contains a React/TypeScript/Vite **offline contract
preview**, not a connected CAF console. The task form validates the current
`CreateTask` shape and prepares JSON without sending it. The Run inspector
accepts a local, sanitized `RunStatus` JSON file and displays only fields
present in its artifact. It does not dump arbitrary artifact content. The
built-in example is fabricated test data, labeled
in the UI. `failed` with `orphan_unverified` is shown as quarantine, not a
retry. No token, task, Run or model call is created by the page.
Local imports have a 256 KiB file limit; the API's separate 128 KiB limit
applies only to the artifact on completion.

## Run checks

From this repository, use `npm ci`, `npm test`, and `npm run build`. Use
`npm run dev` for a local preview at Vite's loopback address. These commands
do not start the CAF API or worker.

## Current boundary

The control API supports authenticated `POST /v1/tasks`, `GET /v1/runs/{id}`
and cancellation, but has no browser session or same-origin UI proxy. The
current API does not expose a task list, live events, logs, service status or
separate typed review/gate resources. This UI therefore does not claim those
features or send a request. Never embed `CAF_API_TOKEN` in the browser bundle,
URL or storage. A connected UI needs an explicitly designed server-side auth
boundary and tested API contracts. The umbrella [SPEC](../../SPEC.md) governs
the target P4 scope and acceptance criteria.
