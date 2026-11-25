# vIDE Universe app

Sealed, disposable Docker sandboxes for AI agents, packaged as a vSuite Store app on vIDE's app API v1 (category: agent-tools). Claude Code (through the `vide-apps` MCP server) and Bridge sessions get `universe_*` tools to create a sandbox, write files, run commands, poll background jobs and destroy it again. The full spec is in [docs/spec.md](docs/spec.md).

## Containment

Every container is created by `buildRunArgs()` in `src/main/universe.ts` with:

`--network none`, `--user 1000:1000`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, a size-limited `--tmpfs /tmp`, `--memory` (swap equal), `--cpus`, `--pids-limit`, `--init`, labels `vide.universe=1`, `vide.universe.name` and `vide.universe.created`, and a single named volume at `/workspace`. No host paths, no Docker socket.

Bridge runs app tools without asking the user, so containment is by construction rather than by review: agents supply only a name (validated to a `[a-z0-9-]` slug, container and volume are `vide-universe-<name>`). Image, CPU, memory, pids and cleanup come from the user's own settings and are clamped in `sanitizeConfig()`. There is no agent tool that exports files to the host, reads settings, or passes docker options.

Disk: a universe's `/workspace` is a plain Docker volume. Docker has no portable per-volume size limit, so size is not enforced (the panel shows `du`, universes are capped at 8, `/tmp` is capped at 256 MB, project copy-in at 100 MB).

## Design notes

- `vide.process.exec` has no stdin, so file content goes in as base64 arguments (64 KB per write; `append` for more) and the project is copied with `docker cp` from a filtered staging folder.
- Jobs run detached inside the container (`/tmp/jobs/<id>.log|pid|exit|off`) so they survive the vIDE window closing and can be polled any number of times. `universe_exec` waits 38 s, well inside the 60 s agent tool timeout, then returns a `job_id`.
- Renderer settings are pushed to `main.js` (`configure`) because main has no settings API; the same call tells main which project is open in the window, for `from_project`.
- "Open terminal" is not offered: the vIDE app API has no way to open a terminal into a container.

Layout:

- `src/main/` becomes `main.js` (CommonJS; talks to `docker` through `vide.process`, never imports `electron`).
- `src/renderer/` becomes `renderer.js` (ES module; React from `globalThis.__videShared`) plus a scoped `style.css`.
- `image/Dockerfile` is the base image; it is also shipped in the zip for "Build image locally".
- `src/vide.d.ts` is a copy of vIDE's app API types.

## Dev loop

```bash
npm install
npm test             # pure arg building, path confinement, jobs, project copy-in, handlers
npm run build        # writes dist/
npm run package      # writes release/universe-<version>.zip
npx tsc --noEmit
```

In a dev vIDE run **Load app from folder…** and pick `dist/`, then start a new agent session to see the tools.

## Releasing

Push a tag like `v0.1.0`. `release.yml` builds `universe-<version>.zip` and publishes a GitHub release; `image.yml` builds the multi-arch base image and pushes it to `ghcr.io/darthtigerson/universe-base` (tags `<version>` and `latest`). Listing on the vSuite Store (`apps.json`, category `agent-tools`) comes after the first real release.
