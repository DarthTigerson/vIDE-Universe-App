# Universe app v1: spec

Build v1 of "Universe": a vIDE Store app that gives any AI agent in vIDE (Claude Code via the vide-apps MCP server, Bridge/llama sessions in-process) sealed, disposable Docker sandboxes ("universes") to write and run code in, with no network access and no access to the host.

## Hard constraints (from vIDE)

- Agent tool calls time out at 60s (AGENT_TOOL_TIMEOUT_MS). Every tool must return well under that.
- Tool names: `^[a-z][a-z0-9_]{0,63}$`, max 32 tools, prefix all with `universe_`.
- Validate args yourself (schema not enforced). Return compact readable text, not raw JSON. Throw actionable errors ("Docker is not running: start Docker Desktop, Colima or OrbStack").
- Pass ctx.windowId to vide.process exec/spawn where applicable.
- Bridge runs app tools with NO user approval step, so containment must be total by construction: agents must not be able to weaken it through any argument.
- App id: `universe`, name "Universe", category intended: agent-tools. Needs renderer.js + main.js.

## Containment (every container, not configurable by agents)

`docker run` with: `--network none`, non-root user (uid 1000), `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only` root fs, `--tmpfs /tmp` (size-limited), a named volume mounted at `/workspace` (working dir), `--memory`, `--cpus`, `--pids-limit`, labels `vide.universe=1` and `vide.universe.name=<name>` and a created-at label. Never mount the Docker socket, never bind-mount host paths. Container stays alive with a sleep-forever entrypoint; work happens via `docker exec`. Names: validate to a safe slug; container/volume names derived as `vide-universe-<name>`.

Resource caps come from app settings (user only) with defaults 2 CPUs, 2GB RAM, 256 pids, and a disk-size note (volume size enforcement is best-effort; document it).

## Agent tools

- `universe_create(name, from_project?: boolean)`: create a universe. If from_project, copy the current vIDE project folder in (via `docker cp` or tar stream into the volume, never a bind mount), excluding node_modules, .git, .env* and common build/cache dirs; cap total size and say what was skipped. If the project path isn't available in ctx, explain that.
- `universe_list`: name, status, age, approx size.
- `universe_write_file(name, path, content)`, `universe_read_file(name, path)` (truncate large output, say so), `universe_list_files(name, path?)`. Paths confined to /workspace; reject traversal.
- `universe_exec(name, command)`: run `sh -lc` in /workspace as the non-root user. Wait up to ~45s; if done, return exit code + truncated stdout/stderr. If still running, leave it running in the background and return a job_id.
- `universe_job(name, job_id)`: status, exit code if finished, new output since last poll. Jobs must survive (nohup writing to a log + exit-code file inside the container, or host-side tracking; pick the robust one and explain why).
- `universe_destroy(name)`: remove container and volume.

`agentTools.instructions` explains: universes are sealed (no network, no host), create, write files, exec, poll jobs, destroy when done; installs from the internet will fail, use what's in the image.

## Panel (renderer, copy Docker app UI patterns)

Sidebar panel listing universes (status, age, size) with destroy per item and destroy-all (confirm modal). "Export to host" button per universe: user picks a destination folder and the /workspace content is copied out; user-only, never an agent tool. Optional "open terminal" into a universe if the vide API supports it cheaply; otherwise skip and note it. Settings page: image name, CPU/RAM/pids caps, auto-cleanup after N days (default 7, runs on activate and periodically), "Build image locally" action using the bundled Dockerfile. Show a clear "Docker not running / not installed" state.

## Image

Ship `image/Dockerfile`: Debian slim based, non-root user 1000, Python 3 + pip + venv, Node LTS + npm, Go, git, build-essential, pytest, numpy, pandas, ripgrep, jq, curl. Default image setting: `ghcr.io/darthtigerson/universe-base:latest`; if not present locally and pull fails, tell the user to use "Build image locally" (which tags it under the configured name). A GitHub workflow builds and pushes the image to GHCR on release tags (not run). The app release workflow is copied from the Docker app, adapted.

## Tickets

1. Scaffold repo from Docker app template (manifest with agentTools, build, package, shims, tests run).
2. Container mechanism module (pure arg building + docker CLI wrapper), unit tests asserting every containment flag is always present and can't be overridden.
3. File tools with path confinement + tests.
4. Exec + background jobs + tests.
5. create/list/destroy + project copy-in with exclusions + tests.
6. Panel + settings + export + auto-cleanup.
7. Base image Dockerfile + GHCR workflow + "build locally".
8. Store README (store/README.md), repo README, docs/spec.md.

## Verify

`npm test`, `npm run build` and `npm run package` pass. Real smoke test with Docker: build the image locally, create a universe, write a file, exec it, confirm `curl https://example.com` / `pip download` fails inside it (network sealed), confirm a long command returns a job_id and polling works, destroy it, confirm no leftover containers/volumes labelled vide.universe=1.
