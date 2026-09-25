# Bluevis progress

Single source of truth for build status. **Any agent picking this up: read this file first, then `AGENTS.md`.** Update it in the same commit as the work it describes.

Last updated: 2026-09-25 by Claude Opus (Claude Code session)

## Current state

v0.1 core loop is built and runs: orb, text chat through Codex/Claude/local, local voice, agent delegation with honest status, vault memory with undo. See "Next up" for what to do next.

## Decisions (with reasons)

| Decision | Why |
| --- | --- |
| Electron + React + raw WebGL2 shader, no UI/3D libraries | Floating always-on-top orb, global hotkeys and easy CLI process control; the orb is one fragment shader, so three.js would be dead weight. |
| Drive the `codex`, `claude` CLIs instead of APIs | Uses the owner's ChatGPT Pro / Claude subscriptions with no API keys, and their JSON event streams give real, observable agent status. |
| Conversation default: Codex `gpt-6-luna`, low effort (~4s round trip) | Fast enough for voice. Agents default to `gpt-6-sol` medium. Claude Haiku/Opus and local mlx-serve are switchable (Settings, or say "switch to Claude"). Requires Codex CLI >= 0.157. |
| Deterministic intent router before any model (`src/core/router.ts`) | "have Codex…", "open X", "status", "stop", "remember…" never need a model (PRD §15.8). Jev/Laya "Reflex" deliberately skipped for v1. |
| Brain is read-only; real work is delegated | The brain proposes `ACTION:` lines that render as an approval card. Agents run sandboxed (`codex -s workspace-write`, Claude `acceptEdits` + sandbox). |
| Task "verified" only if a passing test/build/typecheck is observed after the last edit | PRD's core honesty rule. Everything else is "done · unverified". Logic in `src/core/taskState.ts`. |
| Vault = plain Markdown folder + its own local git repo | Obsidian-compatible, user-owned, and every memory write is a commit, so "what changed" and undo are free. |
| Vault lives at `./vault` in dev and is **gitignored**; this repo is public | Personal knowledge never goes to GitHub. `vault-template/` is the generic, public starting structure. |
| `share: local-only` notes are never sent to cloud models | Work notes are local-only, and the internship folder is not scanned. |
| Local voice: Whisper large-v3-turbo + Kokoro (`bm_george`) on MLX via a `uv` Python sidecar | No paid TTS. STT ~0.2s warm. First run downloads ~2GB of models. |
| Screen only on demand (⌥⇧L or the eye button) | No continuous observation (PRD §9). |

## Checklist

### Phase 1: foundation (done)
- [x] Repo, Electron + Vite + React + TS, CI (typecheck, tests, build on macOS; tagged releases build an unsigned `.dmg`)
- [x] Provider layer: Codex / Claude / OpenAI-compatible local, normalized event stream (`src/core/parsers.ts`, tested against real captured streams)
- [x] Intent router, reply parser (spoken vs shown, `ACTION:`/`MEMORY:` directives), task state reducer, note/frontmatter utils, all unit tested
- [x] Vault service: template, git history, scoped retrieval, memory writes, sessions, agent-run outputs, revert
- [x] Seed vault from PRD §4 (all `needs-review`), local only
- [x] Voice sidecar (`voice/server.py`) and renderer mic/VAD + pipelined TTS

### Phase 2: experience (done, iterating)
- [x] Orb shader: IKB ink in glass, state looks, audio-driven edge, one satellite per running agent
- [x] Talk view: empty-state greeting, serif "voice" typography, proposals, memory lines with undo, inline live task cards
- [x] Agents view: observed steps, files changed, diff stat, verification explanation, stop
- [x] Memory view: areas, status legend, note cards, reader, "what changed" timeline with revert
- [x] Settings: models, provider health, voice, vault, project folders, shortcuts, privacy summary
- [x] Compact orb mode (⌥Space), talk hotkey (⌥⇧Space), look hotkey (⌥⇧L)

### Phase 3: verify end to end (in progress)
- [ ] Live chat round trip with Codex Luna in the app, reply rendered and spoken
- [ ] Delegation round trip: Codex agent edits a scratch repo, status + agent-run note written
- [ ] Voice round trip in the app (mic permission prompt needs the owner at the machine)
- [ ] Screen capture (Screen Recording permission needs the owner)
- [ ] Packaged `.dmg` smoke test

### Phase 4: next up
- [ ] Link vault project notes to repos by `path:` so "Yonder" resolves to its folder (discovered folder names are used today)
- [ ] ChatGPT export importer: parse `conversations.json`, propose notes for review (never auto-accept assistant suggestions as decisions)
- [ ] "Life dump" onboarding: a long voice/text brain dump turned into proposed Profile/Project notes
- [ ] Review queue in Memory view: confirm / edit / reject `needs-review` notes
- [ ] Menu bar presence and launch at login
- [ ] Active-app context (frontmost app + window title) with explicit permission
- [ ] Wake word (openWakeWord) as an opt-in
- [ ] Gmail / Calendar as scoped skills (read-only first)
- [ ] Custom voice identity experiment (Pocket TTS / Qwen3-TTS cloning with a rights-cleared reference)

## Known issues / notes for the next agent
- `codex exec` emits feature notices as `error` items; they are mapped to warnings, not failures.
- Codex brain turns cost ~50k (mostly cached) input tokens each because of Codex's own system prompt.
- Project names are folder names (e.g. `Shopify` is probably Yonder's repo, unconfirmed).
- Run `npm run check` before committing. UI changes: take a screenshot of the real app (Playwright `_electron` works).
