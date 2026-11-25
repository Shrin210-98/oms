# OMS changelog

## 0.2.0

- Staff can sign in, recover access with a private one-use code, and see their assigned roles. Administrators can provision accounts, change roles, disable access, and revoke sessions.
- Status, account, and administration pages use subtle dashed panel borders and dividers. System status displays the web build’s OMS version even when the API is unavailable.
- Version tags identify tested source releases. CI checks each release tag against the application version and publishes its changelog entry on GitHub.

## 0.1.0

- The initial workspace added the React status page, Express liveness and readiness checks, PostgreSQL migration, and CI. This was the untagged development baseline.
