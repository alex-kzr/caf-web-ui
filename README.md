# CAF web UI: P0 inspection workbench

This independent repository contains a React/TypeScript/Vite inspection
workbench. The task form validates the current
`CreateTask` shape and prepares JSON without sending it. The Run inspector
accepts a local, sanitized `RunStatus` JSON file and displays only fields
present in its artifact. It does not dump arbitrary artifact content. The
built-in example is fabricated test data, labeled
in the UI. `failed` with `orphan_unverified` is shown as quarantine, not a
retry. No token, task, Run or model call is created by the page. The optional
host server reads one existing Run when the user chooses to connect.
Local imports have a 256 KiB file limit; the API's separate 128 KiB limit
applies only to the artifact on completion.

## Run checks

From this repository, use `npm ci`, `npm test`, and `npm run build`. Use
`npm run dev` for a local preview at Vite's loopback address. These commands
do not start the CAF API or worker.

## Optional host-only read

Build first, then start the API separately and run `npm run serve` with an
**existing** `CAF_API_TOKEN` and an exact `CAF_UI_RUN_ID` UUID in the server
environment. Optional `CAF_API_PORT` and `CAF_UI_PORT` default to 8123 and
5174. The server binds to `127.0.0.1` and serves the built page. It creates
no credentials or Runs and refuses `CAF_WORKER_TOKEN` in its environment.

The server allows only status, typed results and a bounded lease journal for
the configured Run. It never forwards browser Authorization or cookies to
the API, and removes the opaque artifact from the status response. The
results projection allows known fields but does **not** redact secrets in
their text. View only Runs suitable for local display. Loopback access does
not authenticate a human user or support multi-user deployment. These are
separate reads and can race with a status transition; the page asks for a
retry if the status and results disagree. The journal contains lease claim,
completion and quarantine, not a full workflow history.

Never embed `CAF_API_TOKEN` in the browser bundle, URL or storage. The
umbrella [inspection contract](../../docs/architecture/run-inspection-contract.md)
and [SPEC](../../SPEC.md) govern the current boundary and target P4 scope.
One isolated same-origin HTTP read of an existing Run passed on 2026-10-14;
the umbrella [evidence](../../docs/experiments/2026-10-14-p0-live-run-and-crash.md)
records the scope and remaining browser identity gap.
