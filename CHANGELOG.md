# Changelog

All notable user-facing changes to Codex Deck will be documented here.

## [0.1.26] - 2026-07-14

- Added the installed app version beside Codex Deck in the main title bar so builds can be identified directly from the UI.

## [0.1.25] - 2026-07-14

- Changed account Today totals to use only that account's ChatGPT profile daily buckets, matching established multi-account tools.
- Removed cross-account local rollout deltas from individual account totals because local session logs do not carry reliable ChatGPT account identity.
- Added the official usage snapshot time and an explicit lag label; a missing current-day bucket now remains pending instead of being estimated.

## [0.1.24] - 2026-07-14

- Fixed local Today usage incorrectly counting a newly discovered task's historical lifetime tokens as usage from the current day.
- Track local token increments independently per task so disappearing or reordered rollout files cannot create multi-billion-token spikes.
- Reset the local Today observation schema so corrupted 0.1.23 values are discarded automatically after upgrading.

## [0.1.23] - 2026-07-14

- Added managed multi-account login and DPAPI-encrypted local credential storage.
- Added seven-day quota, account-scoped usage totals, cache metrics, token trends, and API-equivalent cost estimates.
- Added compact always-on-top status bar, tray controls, theme/language preferences, and geometry restore.
- Removed unreliable completed-task counters while retaining running-task status.
- Improved responsive layout, drag/resize performance, and release packaging.
