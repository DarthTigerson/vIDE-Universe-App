# Universe for vIDE

Give your AI agents a safe place to run code. Universe creates sealed, disposable Docker sandboxes ("universes") that Claude Code and Bridge sessions can write files in and run commands in, without any way to reach the internet or your machine.

## What an agent can do

- `universe_create`: make a sandbox, optionally copying in your open project (minus `node_modules`, `.git`, `.env*`, keys and build output)
- `universe_write_file`, `universe_read_file`, `universe_list_files`: work with files under `/workspace`
- `universe_exec`: run a shell command; long commands keep running in the background and return a job id
- `universe_job`: poll a background job for its status and new output
- `universe_list`, `universe_destroy`: see and delete universes

## How it is sealed

Every universe is started with no network, a non-root user, all Linux capabilities dropped, no privilege escalation, a read-only root filesystem, and limits on memory, CPUs and processes. The Docker socket and your folders are never mounted. Agents cannot change any of this: the only thing they choose is the universe's name.

## In vIDE

- A sidebar panel lists your universes (status, age, size) with destroy, destroy all, and **Export to host**, which copies a universe's `/workspace` into a folder you pick. Exporting is something only you can do.
- Settings › Universe sets the image, CPU, memory and process limits, and auto-cleanup (default: destroy universes older than 7 days).

## Needs

Docker Desktop, Colima or OrbStack. The base image (`ghcr.io/darthtigerson/universe-base`) is pulled the first time; if that is not possible, Settings › Universe has **Build image locally**.

New agent sessions pick up the tools after you install the app.
