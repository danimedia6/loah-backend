# Loah Block 0.3: JWT, current permissions, logging and debug

## Baseline and scope

Branch: `danielfelipe`. Starting commit: `4275844` (clean tree).
No production database reads/writes, migrations, credential rotation, commits or
pushes were performed. Financial Gifts containment from 0.2 is unchanged.

Confirmed issues: three runtime JWT secret fallbacks plus one legacy script;
HTTP/socket role and venue claims were not reloaded; debug endpoints read raw
orders and wrote business state without authentication; Morgan logged redeem
credentials; console calls printed bodies, webhook/payment data, reports,
presence sessions, database exceptions and other private objects.

## Required environment and Render preflight

- `JWT_SECRET`: required at import/startup, at least 32 UTF-8 bytes, no surrounding
  whitespace and not a known short placeholder. Length validation does not prove
  entropy: use an independently generated random key kept in private environment
  configuration. Never use the README placeholder as a key.
- `SUPABASE_URL`, `SUPABASE_KEY`: existing server database configuration, unchanged.
- `NODE_ENV=production`: required operational production setting. Do not use
  development behind a public reverse proxy.
- `CLIENT_URL` / `CLIENT_URLS`: existing permitted origins, unchanged.
- `PORT`: existing host-managed listening port, unchanged.
- `ENABLE_DEBUG_ROUTES`: absent/false in production. Only the exact string `true`
  plus `NODE_ENV=development` enables mounting the retired debug router.
- `DOTENV_CONFIG_PATH`: optional local/test override. Without it the existing
  root `.env` is loaded once, quietly, without overriding injected environment.

In Render's service Environment settings, verify names/presence and production
mode without copying, printing or sharing values. Save/redeploy and check startup
success and normal login/own-venue authorization. A missing/invalid JWT key now
terminates startup before database clients, listeners or presence timers start.
No environment values were inspected in Render during this package.

Preserve an already secure existing signing key. Changing it logs out existing
tokens, which is required if the old key was weak but must be planned explicitly.
No key was generated or changed here. The signer still uses its existing default
HS256 behavior, claims and 8-hour lifetime; no issuer/audience changes were added.

## Current authorization

HTTP authentication verifies the signature and reads exactly the current user's
`usuarios.id_usuario, rol, venue_id, is_suspended`. It builds a canonical context
with `id`, `id_usuario`, `user_id`, current role/venue and token deadline, discarding
private credentials, email and stale privilege claims. Missing accounts return
401; suspended or indeterminate suspension state returns 403; storage failures
return generic 503. These sensitive operations never fall back to JWT roles on
storage failure. Login also rejects suspended accounts before issuing a JWT.

Every authenticated HTTP request reloads this context once. Existing role and
venue ownership helpers consume it without a second user query. This covers
admin users, moderation, venue/settings/QR, products/tables, staff operations and
Gifts token access. No new cross-venue or global admin permission was granted.
Internal service actor/context arguments remain trusted server context; they
must never be populated from body/query fields.

Socket handshake uses the same verifier and lookup, then joins `user:<current id>`.
`social:join-venue` and `presence:heartbeat` recheck current permissions and token
deadline at each event before any administrative presence bypass. The presence
service cannot renew a `source=venue_admin` session as an ordinary QR session
after demotion/reassignment. It reuses current HTTP/socket context when provided,
or queries the current account for internal administrative presence calls.
Existing QR presence logic and expiration remain; no financial behavior changed.

Optional HTTP auth still permits no header, but a supplied invalid/expired token
returns 401 instead of silently becoming anonymous. Suspended users get 403.
Frontend must clear/re-authenticate invalid credentials and handle transient 503
without claiming the business action succeeded. A new lookup adds database
latency to authenticated traffic; there is no privilege cache to become stale.

This is permission revocation on the next sensitive operation, not full JWT
session revocation. No token registry, password-change invalidation, refresh
tokens, distributed socket eviction or session recovery was implemented. Existing
nonprivileged socket subscriptions/chat packets are not globally revalidated on
every packet or disconnected immediately on a database role/suspension change.
Previously created admin presence rows are not globally invalidated at the instant
of demotion; they cannot renew without authority and still obey their deadlines.
Block 1 must define and implement those lifecycle guarantees.

## Debug endpoints and consumers

Production/test/missing/unknown environments never mount `/api/debug`. Explicitly
opted-in development additionally requires a direct loopback connection, JWT and
current admin. Both legacy order GET/POST handlers return 410 without querying
or changing orders, including their compatibility controller exports.

No frontend consumer was found. Manual consumers `test_debug_post.js` and
`test_role_patch.js` are retired fail-closed scripts; they perform no HTTP/DB
operation and print only the isolated-suite command. The latter no longer creates
fabricated-role JWTs or uses a secret fallback. Other direct-database maintenance
scripts are not HTTP routes, were not executed, and remain operator-only tools
requiring private server credentials; broader operator-tool governance is pending.

## Logs and observability

Morgan retains method, safe route template, HTTP status and duration. It strips
all query strings, substitutes `[REDACTED]` for redeem tokens even on failed auth,
and logs unmatched paths as `/[UNMATCHED]` rather than echoing arbitrary secrets.
Example using a fictitious QR value (the value never appears in the output):

```text
GET /api/social/gifts/redeem/[REDACTED] 401 1.234 ms
PATCH /api/social/venues/:id/settings 403 2.345 ms
GET /[UNMATCHED] 404 0.456 ms
```

Runtime console calls retain static operation labels only. Bodies, token claims,
raw exception objects/stacks, interpolated personal values, reports, private
messages and payment/webhook objects were removed from arguments. Business logic
surrounding those calls was not changed. The tradeoff is less exception detail;
route/status/duration plus operation labels remain for diagnosis. No external
logging service or console monkey-patch was added. Financial files changed only
in logging calls, not payments, verification, states or Gifts containment.

This protects this application's logger, not browser consoles, proxy access logs,
third-party observability or database logs; their credential handling still needs
deployment review before enabling redemption.

## Validation and limits

- `npm run test:auth-security`: 61 isolated cases, including real HTTP requests,
  a local Engine.IO/Socket.IO handshake into the actual authenticated user room,
  server initialization with mocked storage, and a subprocess proving missing
  secret fails at startup before Supabase initialization. Role-change/error event
  cases use the actual socket handlers with simulated sockets.
- `npm run test:usuarios`: all 54 scenarios preserved, plus 10 post-audit cases.
- `npm run test:gifts`: all 80 scenarios preserved, including financial holds.
- Existing-account regression fixtures explicitly mark active accounts
  `is_suspended=false` and set current roles/venues. New-account insert mocks do
  not supply a suspension default: both creation services must persist false.
  The real default/nullability was not verified; accounts
  with null/unknown suspension state fail closed and require a staging preflight.
  Authenticated rejections permit only the new narrow authorization
  read, not target/business reads or writes; anonymous/invalid-token cases still
  assert no database access. Existing password and authorization assertions remain.
- Logging policy is checked using an AST over runtime sources. `@babel/parser`,
  already present through Jest, is declared explicitly as a dev dependency; no
  runtime dependency was added.
- The real Supabase module is mocked before production imports. Tests skip local
  environment files and forbid outgoing fetch. No real DB, RLS, triggers, live
  schema or deployed Render behavior was exercised. All local listeners close.
- Before post-audit corrections, an AST comparison against HEAD verified 29
  additional runtime files differed only in logging arguments, including
  financial controllers/services. Of those, errorHandler now also has the scoped
  global error-handling correction; the other logging-only files are unchanged.

Review before commit. Production still needs a private configuration/RLS/schema
preflight and manual login/reconnect/admin-degradation tests in an isolated stage.
Block 1 owns complete session revocation, recovery and role-change propagation;
Block 3 still owns Gifts funding, transactions and reliable notification recovery.

## Changed-file inventory

Functional configuration/authorization/debug changes:

- `backend/src/config/security.config.js` (new)
- `backend/src/config/supabaseClient.js`
- `backend/src/services/auth-context.service.js` (new)
- `backend/src/middlewares/auth.middleware.js`
- `backend/src/controllers/auth.controller.js`
- `backend/src/repositories/usuario.repository.js`
- `backend/src/services/auth.service.js`
- `backend/src/services/usuario.service.js`
- `backend/src/sockets/social.socket.js`
- `backend/src/modules/social/social.controller.js`
- `backend/src/modules/social/social.service.js`
- `backend/src/middlewares/request-logging.js` (new)
- `backend/src/middlewares/errorHandler.js`
- `backend/src/server.js`
- `backend/src/routes/debug.routes.js`
- `backend/src/controllers/debug.controller.js`
- `backend/scripts/test_debug_post.js`
- `backend/scripts/test_role_patch.js`

Additional runtime files changed only to remove sensitive logging arguments:

- Controllers: `admin`, `auditoria`, `categorias`, `mesas`, `pagos`, `pedidos`,
  `productos`, `qr`, `usuarios`, `wompi` (`backend/src/controllers/*.controller.js`).
- Social: `chat.controller.js`, `gifts.service.js`, `interests.controller.js`,
  `notifications.routes.js`, `presence-expiry.sweep.js`, `presence.controller.js`,
  `profile-background.routes.js`, `safety.controller.js`, `safety.service.js`,
  `social-profile.controller.js`, `stories.controller.js`, `venues.controller.js`
  (all under `backend/src/modules/social/`).
- Services: `mesa.service.js`, `pago.service.js`, `pedido.service.js`,
  `producto.service.js`, `qr.service.js` (under `backend/src/services/`).
- `backend/src/sockets/presenceEmitter.js`.

Tests/configuration/docs: `backend/tests/auth-config.security.test.js` (new),
`backend/tests/usuarios.security.test.js`, `backend/tests/gifts.security.test.js`,
`backend/tests/AUTH_SECURITY.md` (new), `.gitignore`, `package.json`,
`package-lock.json`, `README.md`.

## Post-audit correction: global Express errors

`errorHandler` is installed after all application routes, catching JSON parser
errors and forwarded/unhandled route errors. `entity.parse.failed` returns a
generic 400; valid 4xx/5xx status/statusCode values are retained, including
401/403/404/409/503 and parser size limits (413). No error.message, body, token,
stack or infrastructure detail is included in the response or console output.
If headers have already been sent, the response is destroyed without forwarding
the private error to Express's default logger. Existing direct controller and
middleware responses are unchanged; unmatched routes remain 404.

Regression requests run in both test and production environments, capture
stdout/stderr and application console output, and use fictitious markers only.
The actual server graph is imported in test mode with mocked storage to disable
startup listeners/sweep, then its Express environment and NODE_ENV are set to
production while issuing requests. No production infrastructure is exercised.

## Post-audit correction: Socket.IO recovery contract

Socket.IO namespace middleware denies access on every failed authentication:

- Storage lookup unavailable: `connect_error.message` is a generic temporary
  message and `connect_error.data.code = AUTH_TEMPORARILY_UNAVAILABLE`.
- Missing/invalid/expired token or missing account: `data.code = AUTH_REQUIRED`.
- Suspended or indeterminate suspension state: `data.code = AUTH_FORBIDDEN`.
- Other unexpected handshake errors fail closed as `AUTH_REQUIRED`; no raw error
  or stack is serialized. HTTP and existing presence-event storage errors keep
  their existing `AUTH_UNAVAILABLE` code; this new code is for connect_error.

No server reconnect loop or authentication bypass was added. Local real
Engine.IO/Socket.IO handshakes prove rejection without an authenticated socket
or user room, followed by a successful new connection after mock storage
recovery. Permanent token errors remain permanent during a storage outage.

Frontend work is still required and was NOT implemented here. A namespace
middleware rejection does not trigger normal transport reconnection. The client
should inspect `error.data.code` and explicitly call `socket.connect()` only for
`AUTH_TEMPORARILY_UNAVAILABLE`, with a single pending retry, exponential backoff,
jitter and a bounded budget (for example 1/2/4/8/16 seconds, five attempts).
Stop on unmount/logout, any permanent rejection, expiry of the credential, or
budget exhaustion. After exhaustion show a disconnected state and an explicit
retry action; do not silently claim realtime delivery. Stop old retry timers
before changing credentials or starting another attempt.

`AUTH_REQUIRED` must stop temporary retries and lead to fresh authentication;
`AUTH_FORBIDDEN` must stop retries and show account/access unavailability rather
than repeatedly signing in. After successful connection reset the retry budget,
rejoin the venue through the existing presence-authorized flow, rejoin allowed
conversation rooms and refetch notifications/conversations/presence as needed to
cover missed events. None of those steps may create presence without existing
authorization. End-to-end automatic recovery, bounded retries, UI handling and
room/data restoration remain pending frontend integration tests.

## Post-audit correction: explicit new-account suspension state

The repository contains no declaration of usuarios.is_suspended default or
nullability in its schemas/migrations. Existing runtime authorization,
moderation and login already read/write the field; the deployed schema and
historical values were NOT queried. Both `authService.signup` and the private
`usuarioService` creation method now insert `is_suspended: false` explicitly.
Public HTTP allowlists still reject client-provided true OR false; direct signup
also cannot override the server value. Dedicated administrative creation uses
the same server-controlled default. No existing account is updated by signup.
Login, HTTP and Socket.IO continue denying true/null/undefined; no indeterminate
state is silently enabled and no suspended account is reactivated.

### Proposed staging-only preflight and normalization (not executed)

1. In an isolated staging copy, verify the column type, default, nullability,
   triggers and constraints, and count false/true/null states without exporting
   private fields. Verify normal signup/login against that schema.
2. Review null accounts against moderation/audit records. Do not infer active
   status from null or from a historical JWT. Any account with unresolved
   suspension evidence remains denied pending manual review.
3. If normalization is authorized, prepare a reviewed, explicit ID allowlist of
   accounts independently confirmed active, record the decision, and update only
   those still-null rows transactionally. Do not touch true rows or perform a
   blanket null-to-false update. Keep indeterminate accounts denied.
4. Separately propose a false default and NOT NULL constraint only after every
   historical null has a reviewed disposition. Back up affected records and
   validate rollback, login, admin authorization and suspended-account denial.

No normalization SQL, migration or database operation was performed here.
