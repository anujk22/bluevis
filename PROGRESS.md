# Bluevis progress

Single source of truth for build status. **Any agent picking this up: read this file first, then `AGENTS.md`.** Update it in the same commit as the work it describes.

Last updated: 2026-09-25 01:30 ET by Claude Opus (Claude Code session)

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

## How memory reaches a model (retrieval)

Nothing loads the whole vault. Per turn Bluevis sends: `Profile/Core.md` (~1.3k chars, always), the active project's note, and the top ~6 passages from hybrid search, capped at ~7k chars (~2k tokens). Notes are split at headings into passages (`src/core/retrieval.ts`), scored with BM25 (titles + Obsidian `aliases` weighted) and fused (reciprocal rank) with local bge-small embeddings from the sidecar (`/embed`, fastembed on CPU, cached in userData/embeddings.json). Without the sidecar it falls back to keywords only. `Sources/` and `index: false` notes are never retrieved; `share: local-only` passages only go to local models. Each reply shows the passages it was given, and Memory has a search box that runs the same retrieval.

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
- [x] Live chat round trip with Codex Luna in the app (~5s), reply rendered and spoken via Kokoro
- [x] Delegation round trip: Codex Sol fixed a failing test in a scratch repo; observed fail → edit → pass, marked verified
- [ ] Voice input round trip in the app (TTS output verified; mic permission prompt needs the owner at the machine)
- [ ] Screen capture (Screen Recording permission needs the owner)
- [ ] Packaged `.dmg` smoke test

- [x] Decision → `Decisions/` note, "I'm done" → `Sessions/` note, "where did I leave off" → grounded resume
- [x] Voice sidecar recovers if it dies (restart + honest message)

### Phase 4: knowledge (done)
- [x] Personal knowledge export split into 53 notes (Profile, Education, Career, Projects, Tools, Interests, Work, Private, People), text preserved, citations kept, private sections `local-only`, raw export kept in `Sources/Raw` (not retrieved)
- [x] Hybrid retrieval (BM25 + embeddings + aliases), sources shown on replies, Memory search
- [x] Sidecar versioning: a stale sidecar from before an update is replaced, not adopted

### Phase 5: next up
- [x] Link vault project notes to repos by `path:` (Yonder → `Hackathons/Shopify`, observed from its git remote)
- [x] ChatGPT export importer (Memory → Teach and review): active-branch parsing, batched extraction with Codex `--output-schema`, review queue with keep/edit/discard, ledger in `vault/.bluevis/imports.json` so re-imports skip processed threads and never resurrect discarded items
- [x] "In your own words" dump → proposals through the same pipeline (voice input for it still to do)
- [x] Review queue for imported proposals
- [ ] Review flow for the seeded `needs-review` notes (confirm / correct in place)
- [ ] Menu bar presence and launch at login
- [ ] Active-app context (frontmost app + window title) with explicit permission
- [ ] Wake word (openWakeWord) as an opt-in
- [ ] Gmail / Calendar as scoped skills (read-only first)
- [ ] Custom voice identity experiment (Pocket TTS / Qwen3-TTS cloning with a rights-cleared reference)

## Known issues / notes for the next agent
- `codex exec` emits feature notices as `error` items; they are mapped to warnings, not failures.
- Codex brain turns cost ~50k (mostly cached) input tokens each because of Codex's own system prompt.
- Project names are folder names unless a vault project note sets `path:`.
- Run `npm run check` before committing. UI changes: take a screenshot of the real app (Playwright `_electron` works).
- **Testing against the real vault is forbidden.** Launch with `BLUEVIS_PROFILE_DIR=/some/tmp/dir` to get isolated settings and a fresh vault.
- An unexplained mic activation was seen once during automated testing and did not reproduce; watch for it.
