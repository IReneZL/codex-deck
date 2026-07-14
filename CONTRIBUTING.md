# Contributing to Codex Deck

Thanks for helping improve Codex Deck.

## Before opening an issue

- Search existing issues first.
- Include the Codex Deck version, Windows version, and whether the issue occurs in the main window, compact bar, or account-login flow.
- Redact account names, email addresses, task titles, local paths, tokens, and usage identifiers from screenshots and logs.
- Do not attach `accounts.json` or `auth.json`.

## Development

```powershell
npm ci
npm test
npm run build
```

For native changes, also run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

Keep changes small and focused. Preserve the local-only privacy model, DPAPI credential protection, bilingual UI, and lightweight Windows-first behavior. New production dependencies should be justified in the pull request.

## Pull requests

Describe what changed, why it is needed, how it was tested, and any remaining risk. UI changes should include redacted before/after captures. Security vulnerabilities must follow [SECURITY.md](SECURITY.md) instead of a public pull request.

