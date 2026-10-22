# Gifts security: Block 0.2

## Operational containment

No verified funding rule or gift/payment relationship exists in the current
Gifts flow. This package does not implement payments. To prevent creating or
using unpaid redeemable gifts, sending, accepting (all three accepted modes) and
redeeming fail closed with HTTP 409, code `GIFTS_PAYMENTS_UNAVAILABLE`.
There is deliberately no environment switch to bypass this protection.

This includes legacy accepted gifts: they remain readable by their receiver and
inspectable by their venue admin, but cannot be redeemed. Staff validation returns
`isRedeemable: false`. Do not advertise real purchases or deploy this containment
without communicating the suspension and reviewing any existing obligations.

The old acceptance/chat/QR and redemption code is retained behind this guard,
not certified for financial use. Block 3 must establish verified funding and
transactional state transitions before removing the guard. No payment, order,
wallet, refund, or migration code is activated here.

## Endpoint authorization

All paths below are relative to `/api/social/gifts` and require JWT.

| Method | Path | Actor and result |
| --- | --- | --- |
| POST | /send | Sender from JWT; eligibility checked; financially held (409). |
| GET | /pending | Authenticated receiver only; returns only their own pending/unexpired accepted rows. |
| POST | /:id/respond | Persisted receiver only; pending required; decline allowed; all acceptances held (409). |
| GET | /redeem/:token | Admin with an assigned venue matching persisted gift. Private staff allowlist. |
| POST | /redeem/:token | Same admin/venue check; unusable tokens rejected; valid redemption financially held (409). |
| POST | /:id/reaction | Broken unused story alias fails closed (410), after authentication. |
| GET | /:id/reactions | Broken unused story alias fails closed (410), after authentication. |

There is no sent-gifts list endpoint. This package does not create one.
Unassigned admins have no global bypass. Existing employee roles do not carry a
verified gift-redemption capability; they remain denied until explicitly modeled.
Services require an actor, independently of route middleware. Actor arguments are
trusted server context, never request-body objects.

## Compatibility and privacy

Inspected consumers: `useGifts.js`, `GiftSendModal.jsx`, `Account.jsx`, and the
frontend API client in the sibling SantaPalma-frontend repository. The client
already sends JWT. Existing matching `receiver_id` query/body fields remain
accepted; they can be omitted and never establish identity. A conflicting
identity gets 403. Send/respond bodies reject unexpected fields. Message length
is limited to 1000 characters. User/venue/product IDs are positive safe integers;
gift IDs allow integers and UUIDs because the original PK is absent from repository
migrations. No production schema was queried or altered.

Receiver inbox still includes the receiver's own redeem token. Tokens are not
included in sender `gift:responded` events. Staff responses omit participant IDs,
actor details and unknown database fields. Unexpected database errors return a
generic 500 instead of database messages. Full presence rows and reply text are
no longer logged by the active Gifts validation/respond paths.

Frontend changes are not included. Successful send/accept/redeem is intentionally
unavailable; clients must display the controlled error, not promise delivery.
The two legacy story aliases imported a nonexistent module; no inspected
frontend consumer used them. Normal Stories endpoints are unchanged.

## Tests and limits

Run `npm run test:gifts` and `npm run test:usuarios`. Tests use actual Express
routes, JWT verification, Gifts service, safety service and notification service.
Supabase is replaced before module import by an in-memory query adapter; outgoing
fetch is forbidden. Presence lookup and chat are mocked, and Socket.IO emissions
are captured (not actual network delivery). No real Supabase data is accessed.

Concurrency tests force two pending reads before conditional updates. The
`UPDATE ... WHERE id AND receiver_id AND status = pending RETURNING id` claim
admits only one responder in that model. Real PostgreSQL contention, triggers,
RLS, constraints and deployments need isolated integration testing; these tests
do not prove distributed transactions or delivery guarantees.

A committed decline and its notification are not atomic. Notification failure
returns 500 with the gift already declined; retry is rejected, not duplicated,
and the notification may be missing. Pending-list or socket failure after a
committed response can similarly prevent realtime delivery. Recovery/outbox and
financial acceptance/redemption atomicity belong to Block 3.

Preexisting JWT secret fallback, role/venue claim revocation, shared notification
endpoint ownership, server logging policy and storage/RLS hardening are outside
this patch. No global socket/auth changes were made. Gifts socket recipients
still use authenticated `user:<id>` rooms; socket delivery was not tested against
real clients. Security review is required before committing or lifting containment.
