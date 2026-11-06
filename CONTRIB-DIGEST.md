# kvnloo contribution digest (as of 2026-11-05T23:57 UTC)

Source: kvnloo/gh-contrib-archive `data/public.db`, incremental sync plus an issue/PR backfill from 2026-08-01. 16,164 public rows (private-repo rows are counts only and left out here). Generated from the db by a read-only query.

## Focus repos

| repo | PRs | issues | comments | reviews | latest |
|---|---:|---:|---:|---:|---|
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | 194 | 163 | 1190 | 381 | 2026-11-05 |
| [kvnloo/hermes-agent](https://github.com/kvnloo/hermes-agent) | 305 | 305 | 727 | 0 | 2026-11-05 |
| [alt-glitch/hermes-tern](https://github.com/alt-glitch/hermes-tern) | 7 | 8 | 3 | 0 | 2026-10-26 |
| [kvnloo/hermes-tern](https://github.com/kvnloo/hermes-tern) | 122 | 86 | 1156 | 0 | 2026-11-05 |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code) | 48 | 4 | 49 | 21 | 2026-11-04 |
| [kvnloo/t3code](https://github.com/kvnloo/t3code) | 54 | 25 | 134 | 0 | 2026-11-05 |

## Upstream hermes-agent PRs, open (10)

| # | created | state | title |
|---|---|---|---|
| [#133347](https://github.com/NousResearch/hermes-agent/pull/133347) | 2026-10-05 | open | fix(code-health): tighten semantic rule precision |
| [#132066](https://github.com/NousResearch/hermes-agent/pull/132066) | 2026-10-03 | open | fix(computer-use): support token-only actions without replaying retired targets |
| [#130205](https://github.com/NousResearch/hermes-agent/pull/130205) | 2026-10-01 | open | fix(tui): preserve expanded paste payload in busy/no-session queue |
| [#129928](https://github.com/NousResearch/hermes-agent/pull/129928) | 2026-10-01 | open | fix(ui-tui): pause dock clock while collapsed |
| [#129918](https://github.com/NousResearch/hermes-agent/pull/129918) | 2026-10-01 | open | fix(ui-tui): defer long-running tool charm polling |
| [#129556](https://github.com/NousResearch/hermes-agent/pull/129556) | 2026-09-30 | open | feat(tui): narrow sid/busy store subscriptions |
| [#129526](https://github.com/NousResearch/hermes-agent/pull/129526) | 2026-09-30 | open | perf(tui): narrow theme-only leaf subscriptions |
| [#129525](https://github.com/NousResearch/hermes-agent/pull/129525) | 2026-09-30 | open | perf(tui): stabilize queue display across parent UI renders |
| [#123057](https://github.com/NousResearch/hermes-agent/pull/123057) | 2026-09-25 | open | fix(agent): contain SystemExit from memory providers |
| [#113279](https://github.com/NousResearch/hermes-agent/pull/113279) | 2026-09-16 | open | fix(cli): honor sticky profile for one-shot gateway commands under supervisor markers |

## Upstream hermes-agent issues, open (104)

| # | created | state | title |
|---|---|---|---|
| [#148718](https://github.com/NousResearch/hermes-agent/issues/148718) | 2026-11-04 | open | [Feature]: Host-themed ephemeral UI cards with a selection-back channel (ephemeral-ui reference kit) |
| [#148398](https://github.com/NousResearch/hermes-agent/issues/148398) | 2026-11-03 | open | feat(backup): incremental/delta backups that dedupe against a previous archive |
| [#143717](https://github.com/NousResearch/hermes-agent/issues/143717) | 2026-10-23 | open | [Feature]: ACP session/list should include gateway conversations (TUI, CLI, messaging) so ACP client |
| [#135950](https://github.com/NousResearch/hermes-agent/issues/135950) | 2026-10-10 | open | [Feature]: coordinate Oct 9 PR review wave — Teams/Feishu overlap and session ownership |
| [#134833](https://github.com/NousResearch/hermes-agent/issues/134833) | 2026-10-08 | open | RFC: experimental Tern/TSP native surface for Hermes TUI |
| [#134826](https://github.com/NousResearch/hermes-agent/issues/134826) | 2026-10-07 | open | [Feature]: ACP external-runtime conformance contract for o8 and other orchestrators |
| [#132488](https://github.com/NousResearch/hermes-agent/issues/132488) | 2026-10-03 | open | RFC: make file tools honor the active sandbox filesystem authority |
| [#132468](https://github.com/NousResearch/hermes-agent/issues/132468) | 2026-10-03 | open | TUI: show truthful per-task progress bars in the subagent dock |
| [#132248](https://github.com/NousResearch/hermes-agent/issues/132248) | 2026-10-03 | open | [RFC] Trusted Agent Contacts: cross-owner A2A conversations as a standalone plugin |
| [#131689](https://github.com/NousResearch/hermes-agent/issues/131689) | 2026-10-02 | open | [Feature]: Bend proof verification as a standalone Hermes plugin — initial compatibility slice |
| [#131685](https://github.com/NousResearch/hermes-agent/issues/131685) | 2026-10-02 | open | feat(auth): portable model-provider logins tied to Nous Portal across Hermes environments |
| [#130140](https://github.com/NousResearch/hermes-agent/issues/130140) | 2026-10-01 | open | Close wave: agent, gateway and tools PRs superseded by 2026-09-15→30 landings (20 rows) |
| [#130139](https://github.com/NousResearch/hermes-agent/issues/130139) | 2026-10-01 | open | Salvage wave: 9 open issues, each with one A/B-verified carrier among the competing PRs |
| [#129963](https://github.com/NousResearch/hermes-agent/issues/129963) | 2026-10-01 | open | [Bug]: context compression still fails with Astra 6.1 at 272K context |
| [#129761](https://github.com/NousResearch/hermes-agent/issues/129761) | 2026-10-01 | open | Close wave: Desktop PRs superseded by 2026-09-15→30 landings (20 rows) |
| [#129760](https://github.com/NousResearch/hermes-agent/issues/129760) | 2026-10-01 | open | Wave: stale duplicates + landed-but-open resolved by 2026-09-18→30 landings (15 rows) |
| [#127375](https://github.com/NousResearch/hermes-agent/issues/127375) | 2026-09-29 | open | perf(tui): pause git branch subprocess polling when the status label is hidden |
| [#127374](https://github.com/NousResearch/hermes-agent/issues/127374) | 2026-09-29 | open | perf(tui): replace steady config mtime RPC polling with a gateway change signal |
| [#127373](https://github.com/NousResearch/hermes-agent/issues/127373) | 2026-09-29 | open | perf(tui): drive pet refresh from pet.changed with a slow backstop |
| [#127332](https://github.com/NousResearch/hermes-agent/issues/127332) | 2026-09-29 | open | TUI: give the composer a zero-row visual boundary |
| [#127228](https://github.com/NousResearch/hermes-agent/issues/127228) | 2026-09-29 | open | [Feature]: HUD quicklaunch — warm summon under 200ms, not a cold Desktop boot |
| [#118453](https://github.com/NousResearch/hermes-agent/issues/118453) | 2026-09-21 | open | /model provider selector lists models that cannot actually be used |
| [#117725](https://github.com/NousResearch/hermes-agent/issues/117725) | 2026-09-21 | open | [Bug]: Nous Portal LongCat 2.0 free exhausts output budget on reasoning even after lowering effort |
| [#117083](https://github.com/NousResearch/hermes-agent/issues/117083) | 2026-09-20 | open | [Wave] User-visible latency: attribute → overlap → eliminate critical-path work |
| [#117082](https://github.com/NousResearch/hermes-agent/issues/117082) | 2026-09-20 | open | [Feature]: Owner-attributed critical-path spans for Hermes turn latency |
| [#117012](https://github.com/NousResearch/hermes-agent/issues/117012) | 2026-09-20 | open | [Architecture]: Make doctor consume runtime-owned health and repair contracts |
| [#117005](https://github.com/NousResearch/hermes-agent/issues/117005) | 2026-09-20 | open | [Feature]: Verify backups by isolated restore before destructive profile recovery |
| [#116989](https://github.com/NousResearch/hermes-agent/issues/116989) | 2026-09-20 | open | [Feature]: Recovery fault-injection conformance harness for Hermes profiles |
| [#116865](https://github.com/NousResearch/hermes-agent/issues/116865) | 2026-09-20 | open | [Feature]: Clean-room profile isolation for unknown runtime corruption |
| [#116863](https://github.com/NousResearch/hermes-agent/issues/116863) | 2026-09-20 | open | [Wave] Runtime resilience: diagnose → isolate → repair → verified rebuild |
| [#116841](https://github.com/NousResearch/hermes-agent/issues/116841) | 2026-09-20 | open | [Feature]: Add runtime-path latency/functionality diagnosis to `hermes doctor` |
| [#116228](https://github.com/NousResearch/hermes-agent/issues/116228) | 2026-09-19 | open | Feature: synthesize task-aware free-model routers for providers without an aggregate |
| [#114377](https://github.com/NousResearch/hermes-agent/issues/114377) | 2026-09-17 | open | Follow-up TypeSafe Jev use cases after bundled skill routing (call 2+) |
| [#113837](https://github.com/NousResearch/hermes-agent/issues/113837) | 2026-09-17 | open | [Feature]: Implement Jev (TypeSafe) in Hermes |
| [#113644](https://github.com/NousResearch/hermes-agent/issues/113644) | 2026-09-17 | open | Agent should use the sudo-style masked prompt for API keys and vault secrets |
| [#113305](https://github.com/NousResearch/hermes-agent/issues/113305) | 2026-09-16 | open | [Feature]: Carry a structured decision ledger across compaction instead of re-summarizing consent |
| [#113241](https://github.com/NousResearch/hermes-agent/issues/113241) | 2026-09-16 | open | TUI: Ctrl+T agents roster should preserve parent context |
| [#113165](https://github.com/NousResearch/hermes-agent/issues/113165) | 2026-09-16 | open | [Bug]: session_search returns raw snippets while compaction redacts with force=True; use one redacti |
| [#113136](https://github.com/NousResearch/hermes-agent/issues/113136) | 2026-09-16 | open | [Bug]: browser_vault_fill leaves the password in page DOM between fill and submit; page script can r |
| [#113066](https://github.com/NousResearch/hermes-agent/issues/113066) | 2026-09-16 | open | feat(learn): expose structured completion metadata and a post-learn extension hook |
| [#113008](https://github.com/NousResearch/hermes-agent/issues/113008) | 2026-09-16 | open | [Feature]: Add a typed probabilistic decision-provider runtime for bounded agent decisions |
| [#112734](https://github.com/NousResearch/hermes-agent/issues/112734) | 2026-09-16 | open | RFC slice: revisioned computer-use state + critical-path telemetry |
| [#112639](https://github.com/NousResearch/hermes-agent/issues/112639) | 2026-09-16 | open | RFC: script-speed computer use via semantic state, runahead execution, and autoresearch |
| [#112143](https://github.com/NousResearch/hermes-agent/issues/112143) | 2026-09-15 | open | Dynamic model-availability inventory for free models (follow-up to #111058) |
| [#112102](https://github.com/NousResearch/hermes-agent/issues/112102) | 2026-09-15 | open | Follow-up to #107914: the consolidation verifier must be isolated from the writer (RSIAgent evidence |
| [#112021](https://github.com/NousResearch/hermes-agent/issues/112021) | 2026-09-15 | open | [Proposal] Scoped adapter-reliability contract: gateway/platforms/reliability.py + conformance suite |
| [#111990](https://github.com/NousResearch/hermes-agent/issues/111990) | 2026-09-15 | open | [UX]: TUI /voice parity checklist — visible turn status, honest meters (tracking, non-blocking) |
| [#111986](https://github.com/NousResearch/hermes-agent/issues/111986) | 2026-09-15 | open | TUI attention budget: semantic tool row allocation, glyph presets, truthful motion |
| [#111570](https://github.com/NousResearch/hermes-agent/issues/111570) | 2026-09-15 | open | [Feature]: Telegram HITL desk — worker stills + CoS brainstorming across profiles |
| [#111389](https://github.com/NousResearch/hermes-agent/issues/111389) | 2026-09-15 | open | [Wave] state.db / WAL reliability — landing-evidence style |
| [#111364](https://github.com/NousResearch/hermes-agent/issues/111364) | 2026-09-15 | open | [Wave] Telegram gateway reliability — logging, reconnect recovery, send_path_degraded replay |
| [#111349](https://github.com/NousResearch/hermes-agent/issues/111349) | 2026-09-15 | open | [Feature]: TUI should always show the reasoning effort, and model switches shouldn't silently carry  |
| [#111334](https://github.com/NousResearch/hermes-agent/issues/111334) | 2026-09-15 | open | skills/plugin scanner: remaining false-positive classes after Sep salvage (#96974 / #110218 / #11127 |
| [#111333](https://github.com/NousResearch/hermes-agent/issues/111333) | 2026-09-15 | open | Wave: Matrix adapter reliability contracts (fail-loud delivery + MAS token refresh) |
| [#111237](https://github.com/NousResearch/hermes-agent/issues/111237) | 2026-09-14 | open | [Feature] Self-tuning harness — opt-in local evolver loop, keep only statistically-credited tweaks |
| [#111200](https://github.com/NousResearch/hermes-agent/issues/111200) | 2026-09-14 | open | [Feature] Failure-pattern exchange — every hermes learns from every hermes's failures (human-gated) |
| [#111189](https://github.com/NousResearch/hermes-agent/issues/111189) | 2026-09-14 | open | [Feature] Evidence-carrying patches — ship the landing-evidence bar as repo-native CI |
| [#111122](https://github.com/NousResearch/hermes-agent/issues/111122) | 2026-09-14 | open | [Feature]: Evolver champion archive — every entry records (trigger, outcome, rollback-id) |
| [#111119](https://github.com/NousResearch/hermes-agent/issues/111119) | 2026-09-14 | open | [Feature]: Evolver Phase 0 — mandatory noise-floor study of the sealed battery before any credit ver |
| [#111118](https://github.com/NousResearch/hermes-agent/issues/111118) | 2026-09-14 | open | [Feature]: Evolver credit gate — evaluator must have no model client and no network access (dependen |
| [#111117](https://github.com/NousResearch/hermes-agent/issues/111117) | 2026-09-14 | open | [Bug]: Identity-kind vault fill must freeze vision/screenshots on the bound origin |
| [#111116](https://github.com/NousResearch/hermes-agent/issues/111116) | 2026-09-14 | open | [Feature]: Edit-tool shape audit — benchmark Hermes file-edit tools against str_replace semantics (e |
| [#111112](https://github.com/NousResearch/hermes-agent/issues/111112) | 2026-09-14 | open | [Feature]: block_loop_detected should write a self-healing evidence record, not just route to triage |
| [#110676](https://github.com/NousResearch/hermes-agent/issues/110676) | 2026-09-14 | open | [Feature]: Harness Evolver Phase 3 — credit-gated memory write-loop (skill promotion, curator consol |
| [#110675](https://github.com/NousResearch/hermes-agent/issues/110675) | 2026-09-14 | open | [Feature]: Harness Evolver Phase 2 — tool-schema/description evolution with transfer test |
| [#110674](https://github.com/NousResearch/hermes-agent/issues/110674) | 2026-09-14 | open | [Feature]: Harness Evolver — shadow-mode canary rollout for credited patches |
| [#110673](https://github.com/NousResearch/hermes-agent/issues/110673) | 2026-09-14 | open | [Feature]: Harness Evolver Phase 1 — prompt/retry-policy proposer with credit gates |
| [#110672](https://github.com/NousResearch/hermes-agent/issues/110672) | 2026-09-14 | open | [Feature]: Harness Evolver — signed evolvability manifest (Rego/OPA + Sigstore) |
| [#110671](https://github.com/NousResearch/hermes-agent/issues/110671) | 2026-09-14 | open | [Feature]: Harness Evolver Phase 0 — pathology archive + credit-gate calibration |
| [#110540](https://github.com/NousResearch/hermes-agent/issues/110540) | 2026-09-14 | open | [Feature]: BYO animations — add lersent001/orb as an orb animation + custom orb URL support |
| [#110509](https://github.com/NousResearch/hermes-agent/issues/110509) | 2026-09-14 | open | [Feature]: Let Hermes set its own goal (`/goal`) — agent-defined objectives |
| [#110124](https://github.com/NousResearch/hermes-agent/issues/110124) | 2026-09-13 | open | TUI: fast default model hop using existing model state |
| [#107705](https://github.com/NousResearch/hermes-agent/issues/107705) | 2026-09-10 | open | docs(secrets): statements/passport scans are not vault items — wrap file tokens, do not read_file th |
| [#107704](https://github.com/NousResearch/hermes-agent/issues/107704) | 2026-09-10 | open | feat(vault): identity kind (SSN/tax/passport number) — origin-bound fill, payment-class confirm, vis |
| [#107700](https://github.com/NousResearch/hermes-agent/issues/107700) | 2026-09-10 | open | feat(secrets): source-apply still hydrates the process — handles for tool credentials, wrap for HTTP |
| [#107698](https://github.com/NousResearch/hermes-agent/issues/107698) | 2026-09-10 | open | docs(secrets): startup apply hydrates os.environ — warn, and point site/identity secrets at the vaul |
| [#106258](https://github.com/NousResearch/hermes-agent/issues/106258) | 2026-09-09 | open | [Feature]: Resolve slash commands and their args from loose natural language against live options |
| [#105868](https://github.com/NousResearch/hermes-agent/issues/105868) | 2026-09-08 | open | [Bug]: Tracking full-backup reliability consolidation and auditable dry-run coverage |
| [#103133](https://github.com/NousResearch/hermes-agent/issues/103133) | 2026-09-04 | open | [Feature]: autodevelop mode — BYOK community agents drain a public issue/task queue unattended |
| [#102922](https://github.com/NousResearch/hermes-agent/issues/102922) | 2026-09-04 | open | Plugin proposal: local PAW PII redaction (standalone middleware + tools) |
| [#102375](https://github.com/NousResearch/hermes-agent/issues/102375) | 2026-09-03 | open | Add an optional skill for safe Hyprland UI testing |
| [#102265](https://github.com/NousResearch/hermes-agent/issues/102265) | 2026-09-03 | open | Support declarative MoA slot configuration (`moa configure --slots`) |
| [#102263](https://github.com/NousResearch/hermes-agent/issues/102263) | 2026-09-03 | open | Support non-interactive default model selection (`model --provider --model`) |
| [#99773](https://github.com/NousResearch/hermes-agent/issues/99773) | 2026-08-31 | open | TUI attention budget + first-paint cleanup (OMP reference) |
| [#99142](https://github.com/NousResearch/hermes-agent/issues/99142) | 2026-08-31 | open | Desktop: engineer-grade action/evidence timeline for every tool invocation |
| [#98911](https://github.com/NousResearch/hermes-agent/issues/98911) | 2026-08-30 | open | Telegram hint should prefer native clarify buttons over copy controls |
| [#98053](https://github.com/NousResearch/hermes-agent/issues/98053) | 2026-08-29 | open | [Feature]: Add Groq Orpheus as a first-class TTS provider |
| [#97674](https://github.com/NousResearch/hermes-agent/issues/97674) | 2026-08-29 | open | Desktop: make MoA advisor fan-out visibly parallel |
| [#97611](https://github.com/NousResearch/hermes-agent/issues/97611) | 2026-08-29 | open | [Feature]: Prefer non-visual information sources before launching a browser |
| [#97251](https://github.com/NousResearch/hermes-agent/issues/97251) | 2026-08-28 | open | [Feature]: Desktop model picker — inspectable MoA preset roles (hover/keyboard preview, no select) |
| [#96806](https://github.com/NousResearch/hermes-agent/issues/96806) | 2026-08-28 | open | docs: add an interactive xyflow architecture explorer with accessible static fallbacks |
| [#96547](https://github.com/NousResearch/hermes-agent/issues/96547) | 2026-08-27 | open | Desktop model controls: consider a focus-stable settings popover with a nested searchable picker |
| [#95154](https://github.com/NousResearch/hermes-agent/issues/95154) | 2026-08-26 | open | [Feature]: Recursive company → portfolio → product hierarchy in Kanban |
| [#94462](https://github.com/NousResearch/hermes-agent/issues/94462) | 2026-08-25 | open | Discord voice mode has extreme latency or poor STT accuracy |
| [#94363](https://github.com/NousResearch/hermes-agent/issues/94363) | 2026-08-25 | open | RFC: Hermes Mesh — turn opt-in household hardware into a local edge-compute fabric |
| [#93437](https://github.com/NousResearch/hermes-agent/issues/93437) | 2026-08-24 | open | feat(code-intel): add an optional SCIP query skill for existing indexes |
| [#93436](https://github.com/NousResearch/hermes-agent/issues/93436) | 2026-08-24 | open | test(code-intel): benchmark behavior-owner localization before adding another index |
| [#93319](https://github.com/NousResearch/hermes-agent/issues/93319) | 2026-08-23 | open | research: evaluate auditable agent experimentation, environments, and adaptive interfaces |
| [#89493](https://github.com/NousResearch/hermes-agent/issues/89493) | 2026-08-18 | open | [Feature]: Tracking: add a read-only hierarchical Roadmap projection to Kanban |
| [#88589](https://github.com/NousResearch/hermes-agent/issues/88589) | 2026-08-17 | open | HOTL: typed topology IR and honest badge decoder |
| [#88580](https://github.com/NousResearch/hermes-agent/issues/88580) | 2026-08-17 | open | [Feature]: Factory view for grounded multi-agent work observability |
| [#88571](https://github.com/NousResearch/hermes-agent/issues/88571) | 2026-08-17 | open | Design: compact, summary-first information architecture for Kanban |
| [#88549](https://github.com/NousResearch/hermes-agent/issues/88549) | 2026-08-17 | open | [Feature]: Settle, Snooze, and Wake lifecycle for human attention |
| [#87186](https://github.com/NousResearch/hermes-agent/issues/87186) | 2026-08-15 | open | fix(kanban): make the board usable on mobile viewports |

## Upstream hermes-agent PRs, closed/merged since 10-01 (2)

| # | created | state | title |
|---|---|---|---|
| [#132363](https://github.com/NousResearch/hermes-agent/pull/132363) | 2026-10-03 | closed | fix(terminal): do not replay ambiguous post-spawn command outcomes |
| [#130203](https://github.com/NousResearch/hermes-agent/pull/130203) | 2026-10-01 | closed | fix(desktop): isolate reused tool_call_id from prior lost-completion row |

## hermes-tern upstream PRs (7)

| # | created | state | title |
|---|---|---|---|
| [#86](https://github.com/alt-glitch/hermes-tern/pull/86) | 2026-10-22 | open | feat(frontend): open context breakdown from composer meter |
| [#73](https://github.com/alt-glitch/hermes-tern/pull/73) | 2026-10-21 | open | fix(media): bind image previews to session and pane lifetime (stacked on #72) |
| [#72](https://github.com/alt-glitch/hermes-tern/pull/72) | 2026-10-21 | open | fix(media): bound image downloads before buffering |
| [#71](https://github.com/alt-glitch/hermes-tern/pull/71) | 2026-10-20 | open | feat(frontend): dictate into the composer with Hermes' own speech-to-text |
| [#70](https://github.com/alt-glitch/hermes-tern/pull/70) | 2026-10-20 | open | fix(frontend): every control a click works on is a native button with a name |
| [#69](https://github.com/alt-glitch/hermes-tern/pull/69) | 2026-10-20 | open | feat(frontend): /tree shows a conversation's branches, and opens one |
| [#68](https://github.com/alt-glitch/hermes-tern/pull/68) | 2026-10-20 | open | feat(frontend): /rewind goes back to any earlier prompt, to rewind or branch there; /undo N counts |

## t3code upstream PRs, open (1)

| # | created | state | title |
|---|---|---|---|
| [#20738](https://github.com/pingdotgg/t3code/pull/20738) | 2026-10-17 | open | fix(web): retry failed final file saves after editor close |

## Upstream hermes-agent comments per week (last 8 weeks)

- 2026-W44: 22
- 2026-W43: 1
- 2026-W42: 4
- 2026-W41: 4
- 2026-W40: 52
- 2026-W39: 310
- 2026-W38: 280
- 2026-W37: 440
