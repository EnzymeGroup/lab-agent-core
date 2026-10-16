# v0.1.0 validation

Date: 2026-10-16 (Asia/Shanghai). Environment: Linux, Node 22.22.0, npm 10.9.4.
Validated versions: Pi SDK and sibling Pi packages 1.2.0; Pi Web 0.12.2.

## Automated acceptance

Run `npm ci && npm run verify`. No provider key is needed for tests. They use a
deterministic localhost HTTP/SSE model fixture while executing the real Pi SDK,
native tools, filesystem, subprocesses and upstream UI.

| Check | Result |
| --- | --- |
| TypeScript type checking and build | Passed |
| Runtime/config/delivery/model-selection/boundary tests | 31 passed |
| Packed-package consumers | TS, Python and documented sequence example passed (4 test-runner entries including parent suite) |
| Published Pi Web integration | 1 passed |
| Core task HTTP integration | 1 passed |
| Actual Chromium desktop/mobile interaction | Passed; no page or console errors |

Runtime coverage includes project instructions, native skills/extensions,
customTools, native JSONL resume, model errors, cancellation, concurrent-run
rejection, asynchronous extension shutdown, startup/runtime extension errors,
missing output directories, checker schema and exit codes, stale-report removal,
timeouts, and stopping a checker on SIGTERM.

Model configuration checks use two independently running local providers. They
verify exact routing (including slash-containing model IDs), environment credential
references, secret-free inspection, project/global default precedence, preserved
settings, transient overrides, session restoration, and rejection of missing
credentials, incomplete pairs and unknown models without fallback inference.
The native UI new-session path is also checked against project model defaults.

Three external consumers install an actual npm tarball outside this repository,
without workspace links. One runs a TypeScript extension through the public API;
one runs Python through native Bash and validates output with an independent
Python checker. The third copies the shipped sequence-summary example unchanged,
discovers its Skill, reads it with Pi's native tool, runs its Python CLI workflow,
and checks actual source IDs/count/lengths. Tampered lengths and missing output
both fail rechecking without making model calls. CLI creation, JSON output,
partial-delivery exit status, and invalid invocation are also exercised.

UI tests cover real chat, tool SSE events, extension discovery, persisted sessions
after restart, files, uploads/downloads, generation abort and process shutdown.
The same stdio MCP fixture is called through SDK, CLI and Pi Web using native
factories and the project's `.pi/mcp.json`. Tests verify explicit trust before
config evaluation, revocation, failed RunRecord JSON, canonical run boundaries,
symlink rejection, MCP shutdown, native exclusions/replacements and inspect
without model requests. A mismatched SDK/process MCP directory fails explicitly.
Run records are replaced atomically; concurrent readers are checked against
repeated writes so polling cannot observe partially written JSON checkpoints.

Task HTTP coverage submits the real `agent.run()` path, reads run/check records,
downloads actual output, rechecks without inference, records model errors,
rejects unknown model defaults without fallback, releases the busy slot after
setup failure, and saves aborted work on shutdown. Cross-origin/Host requests,
concurrent submissions and escaped artifact paths are rejected.

Browser checks submit chat through the actual composer, expand tool results,
reopen mobile history and verify no horizontal overflow. Test processes are stopped.
The new task page is also exercised through Chromium: submit the shipped FASTA
example, download the computed JSON, deliberately change a length, recheck to a
failed delivery, and restart the listener to rediscover that persisted result.
Light/dark views and keyboard focus were checked. Viewports 375, 768, 1024 and
1440 pixels had no horizontal overflow; page/console errors were zero.

Local review evidence is in `.test-artifacts/`: `verify.log`, `onboarding-consumers.log`, `browser-qa.json`,
`ui-desktop.png`, `ui-mobile.png`. Generated evidence is not included in the npm
package. CI uploads the installable tarball.
This revision adds `runtime-verify.log`, `tasks-browser.json`,
`tasks-desktop.png`, `tasks-mobile.png` and `tasks-dark.png`.

## Scope and limits

- Implemented and locally verified; not published to an npm registry.
- No live model provider was configured. Remote-model inference quality and
  credentials are not validated by deterministic tests.
- Browser QA covered Chromium on Linux, not other browsers or operating systems.
- No independent newcomer usability study was performed; the installed example
  verifies execution, not ease of learning. [ONBOARDING.md](ONBOARDING.md) provides
  a proposed two-participant exercise with explicitly unmeasured time targets.
- Core's default loader adds native MCP/codemode/tool-search factories and honors
  native settings. Arbitrary caller-provided loaders and UI-specific behavior
  are not promised to be identical. See CONVENTIONS.md.
- Native chat/RPC does not create Core delivery records. The task page does,
  through the same `agent.run()` path as CLI/SDK. It is a trusted local interface,
  not an authenticated multi-user task service.
- A direct Pi-versus-Core project comparison has not been conducted; no measured
  reduction in development time or code volume is claimed.

## Release procedure

1. Run `npm ci` and `npm run verify`.
2. Run `npm pack`; install the tarball as shown in QUICKSTART.md.
3. Review package contents with `npm pack --dry-run`.
4. Before publishing, confirm `lab-agent-core` is available in the intended
   registry and that the publisher has permission to publish it. This repository
   neither registers nor reserves that package name.

Core contains no custom model/tool loop, workflow engine, transcript store or
file-hashing system. Native-session access remains available.
