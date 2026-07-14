# Security Policy

## Supported versions

Only the latest GitHub Release is supported with security updates.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include credentials, account data, screenshots containing personal information, or live tokens in a report.

Use GitHub's **Private vulnerability reporting** feature for this repository. Include the affected version, reproduction conditions, impact, and the smallest safe proof you can provide. If private reporting is temporarily unavailable, open a public issue containing no sensitive or exploit details and ask the maintainers to establish a private contact channel.

You should receive an acknowledgement within seven days. No response-time or bounty commitment is implied.

## Credential safety

Codex Deck stores managed credentials outside the source tree under the current Windows profile and protects credential bodies with Windows DPAPI. Never attach `%APPDATA%\Codex Deck\accounts.json`, any Codex `auth.json`, or a raw diagnostic archive to an issue.

