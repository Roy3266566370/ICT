# AI Dispatch Repair Implementation Plan

**Goal:** Fix pasted integral/derivative problems and make real local AI dispatch reliable for already supported calculus and 408 tasks.

**Architecture:** Keep deterministic kernels and source validation. For complete, explicit single calculus tasks, bind source conditions in code and ask AI for a small task-specific tool call. For already recognized 408 tasks, let AI select execution of the unchanged original text through the existing subprocess kernel. Preserve the general visual understanding path for unknown or unconfirmed inputs.

**Constraints:** Preserve existing workspace edits; no dependency changes, arbitrary generated code, invented conditions, service restart, or automatic commit. Missing or ambiguous conditions remain blocked. Never report rule fallback as AI success.

## Steps

- [x] Add failing regressions for natural-language derivative extraction, pasted single-task solving, compact AI dispatch, changed source conditions, missing inputs, and original-image confirmation.
- [x] Fix expression termination before point conditions; add strictly delimited single-task source binding and deterministic planning.
- [x] Add compact model schemas and runtime validation; reuse existing computation subprocesses for unchanged 408 source text.
- [x] Run focused regressions, the full backend/frontend suites, and real Ollama tests with recorded routing and answers.
- [x] Verify browser creation, interactive replay, answer checking, save/reload, and revised calculus results in an isolated temporary service.

## Review focus

- Single-task optimization must not discard extra subquestions or constraints.
- A changed AI expression, point, interval, or unsupported tool must be rejected.
- Unknown 408 inputs and image confirmation must not become checkable through the compact path.
- A successful AI call must be distinguishable from local fallback.
- Both public text creation and explicit AI retry must retain interactive models and persistence.

## Verification

- Full backend: 2076 passed, 9 skipped (8 unconfigured MySQL tests and 1 missing PPTX fixture); focused final repair/API/local/staged tests: 78 passed, including 24 repair cases.
- Full frontend: 477 passed, all core/conversion scripts passed; TypeScript check passed.
- Real Ollama: derivative 12 and variant 108; integral 1/3 and variant 4; DFS A/B/D/C, Huffman WPL 38, FCFS waiting 5/3, LRU faults 6, subnet 30 hosts, link delay 1.8 ms, Cache tag/index/offset 19/7/6, CPU time 0.15 s. Successful cases explicitly reported AI routing and kernel verification.
- Browser: real-model creation/revision, answer checking, notes and replay-step save/reload, AI-result persistence and cache reuse. Independent test services on 5191/8029 were stopped afterward; existing services were left alone.
- Independent review found multi-integral and extra-goal shortcuts; each was reproduced in a failing regression and blocked before final review passed. Arbitrary unknown or compound questions still require review/general modelling.
