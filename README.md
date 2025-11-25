# Listmonk Client

Minimal TypeScript client for the Listmonk HTTP API with a small response
wrapper and helpers for common flows (create subscribers, list members, bulk
add, change email).

## Interfaces (LMC*)

- `LMCConfig`
  - `apiURL` (string, required): base API URL.
  - `token` (string, required): Basic auth token/password.
  - `user` (string, required): Basic auth username.
  - `timeoutMS` (number, optional): request timeout in milliseconds (default `15000`).
  - `debug` (boolean, optional): enable request logging.
  - `listPageSize` (number, optional): default `per_page` for paging.

- `LMCResponseData<T>`
  - `success` (boolean, required): indicates the request succeeded.
  - `code` (number, required): HTTP status code returned by the API.
  - `message` (string, required): human-readable status text.
  - `data` (T | null, required): typed payload or `null`.

- `LMCSubscriberAttribs`
  - Record<string, JsonValue> (JSON-safe attributes).

- `LMCSubscription`
  - `id` (number, required): numeric list id.
  - `subscription_status` (string, optional): status of the subscriber on this list.

- `LMCSubscriber`
  - `id` (number, required): subscriber id.
  - `uuid` (string, required): subscriber UUID.
  - `email` (string, required): subscriber email address.
  - `name` (string, required): subscriber display name.
  - `attribs` (LMCSubscriberAttribs, required): custom attributes.
  - `status` (string, required): global subscriber status (e.g., enabled, blocklisted).
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
  - `subscription_status` (string, optional): merged membership status when attached to a subscriber.

- `LMCSubscriberPage`
  - `results` (LMCSubscriber[], required): page of subscribers.
  - `total` (number, required): total matching subscribers for the query.
  - `per_page` (number, required): page size used.
  - `page` (number, required): current page number.
  - `query` (string, optional): applied filter (when present).

- `LMCListMemberStatus`
  - `"subscribed" | "unsubscribed" | "blocked"`.

- `LMCSubscriptionStatus`
  - `"enabled" | "disabled" | "blocklisted" | "unconfirmed" | "bounced"`.

- `LMCSubscribeOptions`
  - `preconfirm` (boolean, optional): preconfirm subscriptions (default `true`).
  - `status` (LMCSubscriptionStatus, optional): override subscriber status.

- `LMCBulkSubscription`
  - `email` (string, required): subscriber email.
  - `name` (string, optional): display name.
  - `uid` (string, optional): caller-defined unique id for deduplication.
  - `attribs` (LMCSubscriberAttribs, optional): attributes; `uid` is mirrored when present.

- `LMCSubscriptionSnapshot`
  - `email` (string, required): processed email.
  - `lists` (LMCSubscription[], optional): memberships observed.

- `LMCBulkAddResult`
  - `created` (LMCSubscriber[], required): subscribers created.
  - `added` (LMCSubscriber[], required): existing subscribers attached.
  - `skippedBlocked` (string[], required): emails skipped due to blocklist.
  - `skippedUnsubscribed` (string[], required): emails skipped due to unsubscribed status.
  - `memberships` (LMCSubscriptionSnapshot[], optional): membership snapshots.

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
```

All methods return `LMCResponse<T>`:

```ts
type LMCResponse<T> = {
  success: boolean;
  code: number;
  message: string;
  data: T | null;
};
```

Use `response.isSuccess()` as a type guard, or inspect `success`/`data`.

## API

### `new ListMonkClient(config)`

- `config: LMCConfig`
  `{ apiURL: string;
     token: string;
     user?: string;
     timeoutMS?: number;
     debug?: boolean;
     listPageSize?: number;
   }`
  - Basic auth only (user + token).


### `client.get<T>(path)`

Generic GET helper. Returns `LMCResponse<T>`.

### `client.post<T>(path, body?)`

Generic POST helper. Returns `LMCResponse<T>`.

### `client.put<T>(path, body?)`

Generic PUT helper. Returns `LMCResponse<T>`.

### `client.delete<T>(path, body?)`

Generic DELETE helper. Returns `LMCResponse<T>`.

### `client.subscribe(listId, email, name?, attribs?, options?)`

Create a subscriber (if it doesn't exist) and subscribe it to a list.

- `listId`: numeric list id.
- `attribs`: arbitrary JSON-safe map to store alongside the subscriber.
- `options`: `LMCSubscribeOptions` (`preconfirm`, `status`).
- Returns `LMCResponse<LMCSubscriber>` (includes `id`, `uuid`, `lists`, `attribs`, etc.).

### `client.listMembersByStatus(listId, status, pagination?)`

List subscribers on a list by status.

- `status`: `LMCListMemberStatus`
- `pagination`: `{ page?: number; perPage?: number }` (defaults `perPage` to `listPageSize` from config)
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

### `client.deleteSubscriber(id)`

Delete a single subscriber by id. Returns `LMCResponse<boolean>`.

### `client.deleteSubscribers(ids)`

Delete many subscribers. Returns `LMCResponse<boolean>`.

### `client.changeEmail(currentEmail, newEmail)`

Finds by current email and issues a `PUT /subscribers/{id}` to set
`email=newEmail`. Returns `LMCResponse<LMCSubscriber>` (updated subscriber).
Preserves existing `attribs`/name.

## Debugging

Set `debug: true` in the client config to log all requests/headers and follow
API calls during tests or troubleshooting.
