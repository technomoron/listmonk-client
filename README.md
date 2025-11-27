# Listmonk Client

Minimal TypeScript client for the Listmonk HTTP API with a small response
wrapper and helpers for common flows (create subscribers, list members, bulk
add, change email).

## Interfaces (LMC\*)

- `LMCConfig`
  - `apiURL` (string, required): base API URL.
  - `token` (string, required): Basic auth token/password.
  - `user` (string, required): Basic auth username.
  - `timeoutMS` (number, optional): request timeout in milliseconds (default
    `15000`).
  - `debug` (boolean, optional): enable request logging.
  - `listPageSize` (number, optional): default `per_page` for paging.
  - `listCacheSeconds` (number, optional): cache list metadata for this duration
    (seconds) to include list names in unsubscribe results and validate provided
    list ids.

- `LMCResponseData<T>`
  - `success` (boolean, required): indicates the request succeeded.
  - `code` (number, required): HTTP status code returned by the API.
  - `message` (string, required): human-readable status text.
  - `data` (T | null, required): typed payload or `null`.

- `LMCSubscriberAttribs`
  - Record<string, JsonValue> (JSON-safe attributes).

- `LMCSubscriptionStatus`
  - `"enabled" | "disabled" | "blocklisted" | "unconfirmed" | "bounced" | "unsubscribed"`
    (also returned in membership data).
- `LMCSubscribeOptions`
  - `preconfirm` (boolean, optional): preconfirm subscriptions (default `true`).
  - `status` (LMCSubscriptionStatus, optional): override subscriber status.

- `LMCListMemberStatus`
  - `"subscribed" | "unsubscribed" | "blocked"`.
- `LMCListVisibility`
  - `"private" | "public"` for list filtering.

- `LMCSubscription`
  - `id` (number, required): numeric list id.
  - `subscription_status` (LMCSubscriptionStatus, optional): status of the
    subscriber on this list.

- `LMCSubscriber`
  - `id` (number, required): subscriber id.
  - `uuid` (string, required): subscriber UUID.
  - `email` (string, required): subscriber email address.
  - `name` (string, required): subscriber display name.
  - `attribs` (LMCSubscriberAttribs, required): custom attributes.
  - `status` (string, required): global subscriber status (e.g., enabled,
    blocklisted).
  - `lists` (array, optional): `LMCSubscription` or `LMCListRecord` entries.
  - `created_at` (string, optional): created timestamp.
  - `updated_at` (string, optional): updated timestamp.

- `LMCListRecord`
  - `id` (number, required): numeric list id.
  - `uuid` (string, optional): list UUID.
  - `name` (string, optional): display name.
  - `type` (string, optional): list type (e.g., public/opt-in).
  - `tags` (string[], optional): list tags.
  - `created_at` (string, optional): list created timestamp.
  - `updated_at` (string, optional): list updated timestamp.
  - `subscription_status` (LMCSubscriptionStatus, optional): merged membership
    status when attached to a subscriber.

- `LMCSubscriberPage`
  - `results` (LMCSubscriber[], required): page of subscribers.
  - `total` (number, required): total matching subscribers for the query.
  - `per_page` (number, required): page size used.
  - `page` (number, required): current page number.
  - `query` (string, optional): applied filter (when present).

- `LMCBulkSubscription`
  - `email` (string, required): subscriber email.
  - `name` (string, optional): display name.
  - `uid` (string, optional): caller-defined unique id for deduplication.
  - `attribs` (LMCSubscriberAttribs, optional): attributes; `uid` is mirrored
    when present.
- `LMCUser`
  - `email` (string, required): subscriber email.
  - `name` (string, optional): display name.
  - `uid` (string, optional): caller-defined id; mirrored into `attribs.uid`.
  - `attribs` (LMCSubscriberAttribs, optional): attributes; merged on update.
- `LMCSyncUsersResult`
  - `blocked` (number): subscribers skipped due to blocklist.
  - `unsubscribed` (number): subscribers skipped due to unsubscribed status.
  - `added` (number): subscribers added/attached to the list.
  - `updated` (number): subscribers whose data changed.

- `LMCSubscriptionSnapshot`
  - `email` (string, required): processed email.
  - `lists` (LMCSubscription[], optional): memberships observed.

- `LMCBulkAddResult`
  - `created` (LMCSubscriber[], required): subscribers created.
  - `added` (LMCSubscriber[], required): existing subscribers attached.
  - `skippedBlocked` (string[], required): emails skipped due to blocklist.
  - `skippedUnsubscribed` (string[], required): emails skipped due to
    unsubscribed status.
  - `memberships` (LMCSubscriptionSnapshot[], optional): membership snapshots.
- `LMCBulkAddError`
  - `email` (string, required): email that failed to process.
  - `message` (string, required): failure message.
  - `code` (number, optional): HTTP status or error code when available.
- `LMCSubscribeResult`
  - `subscriber` (LMCSubscriber | null): subscriber returned by the API.
  - `added` (boolean): `true` when the call added the subscriber to the list.
  - `alreadySubscribed` (boolean): `true` when the subscriber was already on the
    list.
  - `created` (boolean): `true` when a new subscriber record was created.

## Installation

```bash
pnpm add @technomoron/listmonk-client
# or npm/yarn/pnpm equivalent
```

## Usage

```ts
import { ListMonkClient } from "@technomoron/listmonk-client";

const client = new ListMonkClient({
  apiURL: "https://your-listmonk.example.com/api",
  user: "admin",
  token: "your-token",
});

// Example call
client.listAllLists().then((res) => {
  if (res.success && res.data) {
    console.log(
      "Lists:",
      res.data.map((l) => l.name),
    );
  }
});
```

All methods return `LMCResponse<T>`:

```ts
/* eslint-disable @typescript-eslint/no-unused-vars */
type LMCResponse<T> = {
  success: boolean;
  code: number;
  message: string;
  data: T | null;
};
/* eslint-enable @typescript-eslint/no-unused-vars */
```

Use `response.isSuccess()` as a type guard, or inspect `success`/`data`.

## API

### `new ListMonkClient(config)`

- `config: LMCConfig` (see Interfaces)

### Low-level helpers

- `client.get(path)`, `client.post(path, body?)`, `client.put(path, body?)`,
  `client.delete(path, body?)`
- Return `LMCResponse<T>` wrappers around Listmonk API calls.

### `client.listAllLists(visibility?)`

Fetch every list with an optional visibility filter.

- `visibility`: `"public" | "private" | "all"` (default `all`).
- Returns `LMCResponse<LMCListRecord[]>`.

### `client.getSubscriberById(id)`

Fetch a subscriber by id. Returns `LMCResponse<LMCSubscriber>`.

### `client.getSubscriberByUuid(uuid)`

Fetch a subscriber by uuid. Returns `LMCResponse<LMCSubscriber>`.

### `client.getSubscriberByEmail(email)`

Fetch a subscriber by email. Returns `LMCResponse<LMCSubscriber>`.

### `client.getSubscriber(identifier)`

Fetch a subscriber by id, uuid, or email.

- `identifier`: `{ id?: number; uuid?: string; email?: string }` (one required)
- Returns `LMCResponse<LMCSubscriber>`.

### `client.syncUsersToList(listId, users)`

Upsert subscribers into a list by `uid`, updating email/name/attribs when they
differ.

- `listId`: target list id.
- `users`: `LMCUser[]` (each entry must include `uid`).
- Returns `LMCResponse<LMCSyncUsersResult>` with counts for `blocked`,
  `unsubscribed`, `added`, `updated` (added and updated can overlap when both
  occur for the same subscriber).

### `client.setSubscriptions(identifier, listIds, options?)`

Set a subscriber's list memberships (opted-in) with optional pruning.

- `identifier`: `{ id?: number; uuid?: string; email?: string }` (one required)
- `listIds`: `number[]` target lists to be subscribed to (preconfirmed).
- `options?`: `{ removeOthers?: boolean }` (`false` by default). When `true`,
  unsubscribe from lists not present in `listIds`.
- Returns
  `LMCResponse<{ subscriberId: number; lists: { listId: number; listName?: string; status: "Subscribed" | "Unsubscribed" | "Unchanged" | "Unknown List"; }[] }>`
  (`status` reflects actions taken; list names included when available from the
  cache/subscriber record).

### `client.updateUser(identifier, updates)`

Update a subscriber by id, uuid, or email.

- `identifier`: `{ id?: number; uuid?: string; email?: string }` (one required)
- `updates`: `Partial<LMCUser>`; `uid` is mirrored into `attribs.uid` when set.
- `options?`: `{ forceUidChange?: boolean }`; when `uid` is provided and an
  existing `attribs.uid` is present, the update is rejected unless
  `forceUidChange` is `true`.
- Returns `LMCResponse<LMCSubscriber>`.

### `client.subscribe(listId, { email, name?, attribs? }, options?)`

Create a subscriber (if it doesn't exist) and subscribe it to a list.

- `listId`: numeric list id.
- `attribs`: arbitrary JSON-safe map to store alongside the subscriber.
- `options`: `LMCSubscribeOptions` (`preconfirm`, `status`).
- Returns `LMCResponse<LMCSubscribeResult>`; `message` is
  `"Successfully subscribed"` when the list was updated, `"Already subscribed"`
  when no change was needed, or `Failed to subscribe: ...` when an error occurs.
  Existing unsubscribed members are re-attached (unless blocklisted).

### `client.unsubscribe(identifier, lists?)`

Unsubscribe a subscriber from all lists or specific lists.

- `identifier`: `{ id?: number; uuid?: string; email?: string }` (one required)
- `lists`: `number | number[] | undefined` (omit or `[]` to unsubscribe from all
  lists)
- Returns
  `LMCResponse<{ subscriberId: number; lists: { listId: number; listName?: string; statusChanged: boolean; message: "Subscribed" | "Unsubscribed" | "Unknown List" }[] }>`
  - `lists` includes list names when `listCacheSeconds` is configured and the
    cache is populated; falls back to ids when names are unavailable.
    `statusChanged` is `true` when the subscriber was on that list before the
    call. Unknown list ids are tolerated and reported with
    `message: "Unknown List"`.

### `client.listMembersByStatus(listId, status, pagination?)`

List subscribers on a list by status.

- `status`: `LMCListMemberStatus`
- `pagination`: `{ page?: number; perPage?: number }` (defaults `perPage` to
  `listPageSize` from config)
- Returns `LMCResponse<LMCSubscriberPage>`.

### `client.addSubscribersToList(listId, entries, options?)`

Bulk create/add subscribers.

- `entries: LMCBulkSubscriberInput[]` where each entry is
  `{ email: string; name?: string; attribs?: Record<string, JsonValue>; uid?: string }`
- `options`: `{ attachToList?: boolean }` (default `true`)
  - `true`: creates and attaches to the list.
  - `false`: creates if missing, but does **not** attach to the list.
- Returns `LMCResponse<LMCBulkAddResult>` with:
  - `created: LMCSubscriber[]`
  - `added: LMCSubscriber[]`
  - `skippedBlocked: string[]`
  - `skippedUnsubscribed: string[]`
  - `memberships?: { email: string; lists?: LMCSubscription[] }[]` (current
    lists seen for each processed email)
  - `errors?: { email: string; message: string; code?: number }[]` when one or
    more entries fail (partial success returns `success: false`, `code: 207`).

### `client.deleteSubscriber(id)`

Delete a single subscriber by id. Returns `LMCResponse<boolean>`.

### `client.blockSubscriber(id)`

Blocklist a subscriber by id. Returns `LMCResponse<LMCSubscriber>`.

### `client.unblockSubscriber(id)`

Remove blocklist status for a subscriber by id. Returns
`LMCResponse<LMCSubscriber>`.

### `client.deleteSubscribers(ids)`

Delete many subscribers. Returns `LMCResponse<boolean>`.

## Debugging

Set `debug: true` in the client config to log all requests/headers and follow
API calls during tests or troubleshooting.

## Example: WordPress user sync

`scripts/wp-sync-example.mjs` shows how to:

- Read WordPress users via Sequelize.
- Sync them to a Listmonk list by `uid`/email/name (creates or updates).
- Store the Listmonk subscriber id in a `listmonk_subscriber_id` usermeta row.

Env vars expected: `WP_DB_HOST`, `WP_DB_USER`, `WP_DB_PASSWORD`, `WP_DB_NAME`,
`WP_TABLE_PREFIX?`, `LISTMONK_URL`, `LISTMONK_USER`, `LISTMONK_TOKEN`,
`LISTMONK_LIST_ID`.
