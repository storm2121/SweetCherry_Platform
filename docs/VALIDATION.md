# Validation evidence

Prepared jointly by Codex and Claude on 2026-10-07. We discussed the source of truth, synthetic-data assumptions, workbook contract, ownership and Git-history transition before implementation. Claude owned forecasting, model provenance, rules and seed changes; Codex owned application integration, configuration, dependency repairs, delivery and browser verification.

## Automated checks

| Check | Result |
| --- | --- |
| ESLint | Passed |
| App and utility tests | 56 passed, including real bundled classifier cold-load |
| Firestore, Storage and callable tests | 58 passed against disposable local emulators |
| Forecasting tests | 25 passed, including generator determinism, causal features/backtests, sample regeneration and off-season behavior |
| Python model scripts | Six scripts passed syntax compilation; training was not run |
| Production Vite build | Passed |
| Dependency audit | Zero reported advisories for app, Functions and rules-test lockfiles |
| Secret-pattern check | Passed; this checks selected patterns rather than proving every possible secret is absent |

The integration was tested locally with Node 24, npm 11, Java 21, Firebase CLI 14.26.0 and Python 3.11. The repository targets Node 22.12 or later, and Functions target Node 22. CI uses Node 22 and Java 21. GitHub CI has not run because no remote repository has been created or pushed.

## Browser verification

The local demo seeded seven fictional accounts, five diagnosis records, four questions, a conversation, six price reports and the 72-row synthetic forecast. All fourteen remaining Functions loaded.

- The public page displayed the synthetic-data notice and the fixed cutoff.
- The farmer market page displayed eight weekly rows per selected market/grade, ordered price bands, source, model version and archived-snapshot notice.
- An approved expert claimed a disposable question and sent a reply through the authenticated HTTP callable; the question became a conversation.
- An administrator uploaded the generated workbook; all three grades reported success.
- A pending expert reached the approval screen.
- Raw workbook Read me and forecast Grade AA sheets were imported and rendered for visual inspection.
- The final-folder demo started and stopped with `q` followed by Enter; all seven demo and rules-test ports were free afterward.
- Git preserves the exact classifier model and label bytes used by the artifact fingerprint.

The default seed has no image files; it displays unavailable-photo states. A private local photo folder can be supplied separately to the seed script.

## Reproduce

```sh
npm ci
npm run setup
npm run validate
npm run test:rules
npm run check:history
npm run demo
```

From the repository root, after installing the pinned forecasting requirements:

```sh
python -m pytest forecasting/tests -q
```

## Practical limits

The production build reports a large dashboard chunk. This does not prevent the build.

The Storage emulator emitted a shutdown-time runtime error after its tests had passed; the test command exited successfully.

The market workbooks and forecasting metrics are simulated. The classifier lacks a held-out field evaluation; model training was syntax-checked only. Paid AI/TTS services, production deployment, real device hardware and device token refresh were not exercised.

The final repository uses fresh local history. Previous files and history are kept outside it in a recovery backup. Local environment files and dependencies remain ignored. No production resources or existing GitHub repository were changed.
