# Listmonk Client

Minimal TypeScript client for the Listmonk HTTP API with a small response
wrapper and helpers for common flows (create subscribers, list members, bulk
add, change email).

## Interfaces (LMC*)

- `LMCConfig`
  - `apiURL`: base API URL (required).
  - `token`: API token or password.
  - `user`: Basic auth username (required when using `basic` auth).
  - `timeoutMS`: request timeout in milliseconds (default `15000`).
  - `debug`: enable request logging.
  - `listPageSize`: default `per_page` to use when paging list endpoints.
- `LMCResponseData<T>`
  - `success`: boolean indicator the request succeeded.
  - `code`: HTTP status code returned by the API.
  - `message`: human-readable status text.
  - `data`: typed payload or `null`.
- `LMCSubscriberAttribs`: arbitrary JSON-safe attributes attached to a subscriber.
- `LMCSubscriberListMeta`
  - `id`: numeric list id.
  - `subscription_status`: status of the subscriber on this list.
- `LMCSubscriber`
  - `id`: numeric subscriber id.
  - `uuid`: subscriber UUID.
  - `email`: subscriber email address.
  - `name`: subscriber display name.
  - `attribs`: `LMCSubscriberAttribs` custom attributes.
  - `status`: global subscriber status (e.g., enabled, blocklisted).
  - `lists`: optional `LMCSubscriberListMeta[]` memberships (minimal form).
  - `created_at`, `updated_at`: ISO timestamps.
- `LMCListRecord`
  - Full list object from the Listmonk `/lists` endpoint.
  - `id`: numeric list id (primary key).
  - `uuid`: optional list UUID.
  - `name`: display name for the list.
  - `type`: list type as reported by Listmonk (e.g., public/opt-in).
  - `tags`: string array of list tags.
  - `created_at`, `updated_at`: ISO timestamps for the list itself.
  - `subscription_status`: merged membership status when attached to a subscriber.
- `LMCSubscriberPage`
  - `results`: `LMCSubscriber[]`.
  - `total`, `per_page`, `page`, `query`.
- `LMCListMemberStatus`: `"subscribed" | "unsubscribed" | "blocked"`.
- `LMCSubscribeOptions`
  - `preconfirm`: preconfirm subscriptions (default `true`).
  - `status`: override subscriber status (e.g. `"enabled"`).
  - `listUuid`: target a list by UUID instead of id.
- `LMCBulkSubscriberInput`
  - `email`, `name`, `uid`, `attribs` (uid is mirrored into attribs when present).
- `LMCBulkAddResult`
  - `created`, `added`: subscribers created or attached.
  - `skippedBlocked`, `skippedUnsubscribed`: emails not added due to status.
  - `memberships`: `{ email; lists?: LMCSubscriberListMeta[] }[]` snapshot.

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

- `listId`: numeric list id (ignored when `options.listUuid` is provided).
- `attribs`: arbitrary JSON-safe map to store alongside the subscriber.
- `options`: `LMCSubscribeOptions` (`preconfirm`, `status`, `listUuid`).
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
  - `memberships?: { email: string; lists?: LMCSubscriberListMeta[] }[]` (current
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
