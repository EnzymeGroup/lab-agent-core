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
| Runtime/config/delivery/model-selection tests | 24 passed |
| Packed-package consumers | Both TS and Python projects passed (3 test-runner entries including parent suite) |
| Published Pi Web integration | 1 passed |
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

Two external consumers install an actual npm tarball outside this repository,
without workspace links. One runs a TypeScript extension through the public API;
the other runs Python through native Bash and validates output with an independent
Python checker. CLI creation, JSON output, rechecking without a model call,
partial-delivery exit status, and invalid invocation are exercised.

UI tests cover real chat, tool SSE events, extension discovery, persisted sessions
after restart, files, uploads/downloads, generation abort and process shutdown.
Browser checks submit chat through the actual composer, expand tool results,
reopen mobile history and verify no horizontal overflow. Test processes are stopped.

Local review evidence is in `.test-artifacts/`: `verify.log`, `browser-qa.json`,
`ui-desktop.png`, `ui-mobile.png`. Generated evidence is not included in the npm
package. CI uploads the installable tarball.

## Scope and limits

- Implemented and locally verified; not published to an npm registry.
- No live model provider was configured. Remote-model inference quality and
  credentials are not validated by deterministic tests.
- Browser QA covered Chromium on Linux, not other browsers or operating systems.
- No independent newcomer usability study was performed; runnable TS/Python
  consumer examples verify the documented integration paths.
- SDK uses native SDK defaults; UI-specific built-ins and in-memory SDK overrides
  are not promised to be identical. See CONVENTIONS.md.
- Native UI/RPC chats do not automatically create Core delivery records;
  `agent.run()` is the standard checked-delivery path.

## Release procedure

1. Run `npm ci` and `npm run verify`.
2. Run `npm pack`; install the tarball as shown in QUICKSTART.md.
3. Review package contents with `npm pack --dry-run`.
4. Before publishing, confirm `lab-agent-core` is available in the intended
   registry and that the publisher has permission to publish it. This repository
   neither registers nor reserves that package name.

Core contains no custom model/tool loop, workflow engine, transcript store or
file-hashing system. Native-session access remains available.
