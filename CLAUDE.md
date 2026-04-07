## Versioning

- Version file: `package.json`
- Version follows semantic versioning with test suffixes (e.g. `1.2.0-3`)
- When starting a new change: bump patch/minor/major based on scope, add `-1` suffix. Test suffixes are for testing the new version - e.g. if current is `1.2.0`, a new change goes to `1.2.1-1`, never `1.2.0-1`
- Each subsequent commit increments the test suffix (`-1` -> `-2`)
- When releasing: remove the suffix, commit, push, create git tag + GitHub release
- Never commit a test suffix to main
- Hook blocks commits without version bump
