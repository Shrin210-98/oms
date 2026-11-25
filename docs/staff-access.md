# Staff access

The supplier needs to know who is using OMS and to withdraw access as soon as an employee's role changes. A PostgreSQL session lets the next protected request see a revocation immediately. PostgreSQL already serves the application, and the single Express process can use an in-memory rate limiter for this release. The limiter resets on restart and shares a budget across users behind the same client address. Review the proxy trust configuration and rate-limit storage before scaling the service or exposing it through a tunnel.

## Credentials and authorization

A 32-byte random session token travels in an HttpOnly, SameSite=Lax cookie. HTTPS uses a Secure cookie with the `__Host-` prefix. PostgreSQL stores its SHA-256 digest, last-use time and absolute expiry. The browser receives a separate CSRF value bound to its token and sends it in a custom header when changing authenticated state. Login and recovery accept JSON from the configured origin. The origin check also applies to authenticated writes. The backend reads permissions inside the same transaction as each administration command.

Passwords use Argon2id with a unique salt, 19 MiB of memory, two iterations and one lane. A reset code has 256 bits of randomness and only its digest is persisted. Passwords, codes and cookies stay out of request logs and URLs. Helmet supplies security headers to the API. The initial session settings are 30 minutes idle and eight hours absolute. Login rotates the cookie, and logout invalidates the corresponding database session. [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) · [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) · [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

Each account has one or more of Admin, Sales, Manager, Finance and Operations. Only Admin can manage accounts. Staff can view their own assigned roles. Later business modules will enforce their individual role requirements. Disabling an account preserves it and its access history. Administrative edits carry a version number, and a stale version returns HTTP 409.

## HTTP contract

The workspace pins the patched Effect 3.22.5 dependency for Prisma 7's configuration tooling. Revisit the override when Prisma updates its own pin. [Dependency advisory](https://github.com/advisories/GHSA-7589-6fvf-x4pw)

All paths below start with `/api/v1`. All POST and PATCH requests require `Origin` matching `APP_ORIGIN` and a JSON body. For authenticated writes, send the session cookie and `X-CSRF-Token` from the login or session response. The React Router loaders read accounts and the actions submit writes, revalidate the workspace and redirect expired sessions to sign-in.

| Method and path | Request and result |
|---|---|
| POST `/auth/login` | Email and password. Returns the staff projection and CSRF token and sets the session cookie. |
| GET `/auth/session` | Returns the current user and CSRF token. |
| POST `/auth/logout` | Empty object. Revokes the current session and clears the cookie. |
| POST `/auth/reset` | Code and new password. Consumes the credential and returns 204. The user then signs in. |
| GET `/admin/staff?page=1` | Administrator only. Returns 25 accounts at a time and a `hasMore` flag. |
| POST `/admin/staff` | Normalized email and a nonempty array of roles. Returns 201 with the user, setup code and expiry. |
| PATCH `/admin/staff/{id}` | Roles, active flag and current version. Returns the updated user and revokes the subject's sessions. |
| POST `/admin/staff/{id}/reset` | Empty object. Issues a private, one-use recovery code and its expiry. |
| POST `/admin/staff/{id}/revoke` | Empty object. Revokes all sessions for that staff member. |

Login and reset share a 30-request budget per client IP per 15 minutes. The API returns 429 when exhausted. Missing or invalid sessions return 401. Permission and CSRF failures return 403. Recoverable errors carry a stable code and request ID.

## Acceptance exercise

1. Bootstrap an administrator and create a synthetic Sales account. Finish its setup using a second browser profile so both staff members can be signed in at once.
2. In Sales, open **My access**. In the administrator profile, change Sales to Finance. Reload the Sales profile and sign in again. Explain why it now shows Finance.
3. Issue a recovery code, consume it, and try to use it twice. Explain how the user-row lock, conditional deletion and database transaction determine which request succeeds.
4. Sign out, then inspect the Network panel for the request ID and the HTTP status. In a SQL session, join the access event to the acting and affected users.

```sql
SELECT e.created_at, e.action, actor.email AS performed_by, subject.email AS affected_staff
FROM access_event AS e
LEFT JOIN staff_user AS actor ON actor.id = e.actor_id
JOIN staff_user AS subject ON subject.id = e.subject_id
ORDER BY e.created_at DESC, e.id DESC
LIMIT 20;
```

The first bootstrap event has a null actor because it originates in the local operator's terminal. The left join preserves that event.

**Hands-on challenge.** Write a query that finds enabled accounts with both Sales and Finance roles. Start by grouping role assignments by user. Explain how an inner join to sessions could accidentally omit an enabled account.

**Interview question.** What still enforces permissions when somebody opens the staff administration URL directly after their role was removed? Trace the request through the route, the session lookup, the user-row lock and the role check.
