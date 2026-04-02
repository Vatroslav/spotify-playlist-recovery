## Versioning

- Version file: `package.json`
- Every commit increments the test suffix (e.g. `v1.3.2-1` -> `v1.3.2-2`)
- Release removes suffix and bumps patch/minor/major based on changes
- Hook blocks commits without version bump
