/**
 * Minimal Listmonk API client with Basic/Bearer auth and helper methods.
 * Borrowed the response wrapper pattern from api-client-base, but removed tokens/retries.
 */
import { Buffer } from "node:buffer";

/**
 * API interface quick reference
 * - `LMCConfig`: configure authentication and timeouts.
 *   - `apiURL`: base API URL (required).
 *   - `user`: Basic auth username (required when using `basic` auth).
 *   - `token`: API token or password used for either auth mode.
 *   - `timeoutMS`: abort requests after the given milliseconds (default 15000).
 *   - `debug`: log fetch details for troubleshooting.
 *   - `listPageSize`: default `per_page` to use when paging list endpoints.
 * - `LMCSubscriberAttribs`: arbitrary JSON-safe attributes stored with a subscriber.
 * - `LMCSubscription`: minimal list membership summary for a subscriber.
 *   - `id`: numeric list id.
 *   - `subscription_status`: status of the subscriber on this list.
 * - `LMCSubscriber`: a Listmonk subscriber record.
 *   - `id`, `uuid`: subscriber identifiers.
 *   - `email`, `name`: subscriber contact info.
 *   - `attribs`: custom attributes bag.
 *   - `status`: global subscriber status.
 *   - `lists`: optional `LMCSubscription[]` membership entries.
 *   - `created_at`/`updated_at`: ISO timestamps.
 * - `LMCListRecord`: full list record returned by Listmonk list endpoints.
 *   - `id`: numeric list id (primary key).
 *   - `uuid`: optional list UUID.
 *   - `name`: display name for the list.
 *   - `type`: list type as reported by Listmonk (e.g., public/opt-in).
 *   - `tags`: string array of list tags.
 *   - `created_at`/`updated_at`: ISO timestamps for the list.
 *   - `subscription_status`: merged membership status when attached to a subscriber.
 * - `LMCSubscriberPage`: paginated subscriber results.
 *   - `results`: array of `LMCSubscriber` entries.
 *   - `total`: total matching subscribers.
 *   - `per_page`: page size for the query.
 *   - `page`: current page number.
 *   - `query`: optional filter applied.
 * - `LMCBulkSubscriberInput`: shape of bulk-add entries.
 *   - `email`, `name`, `uid`: identifying fields for the subscriber.
 *   - `attribs`: optional custom attributes (uid is mirrored here when present).
 * - `LMCBulkAddResult`: outcome of `addSubscribersToList`.
 *   - `created`: newly created subscribers.
 *   - `added`: existing subscribers attached to the list.
 *   - `skippedBlocked`/`skippedUnsubscribed`: emails not added due to status.
 *   - `memberships`: membership snapshots for each processed email.
 * - `LMCSubscribeOptions`: tune subscription behavior.
 *   - `preconfirm`: preconfirm subscriptions (default true).
 *   - `status`: override subscriber status (`"enabled" | "disabled" | "blocklisted" | "unconfirmed" | "bounced"`).
 * - `LMCResponseData<T>`: response envelope returned by all client methods.
 *   - `success`: boolean flag indicating the call succeeded.
 *   - `code`: HTTP status code from the API.
 *   - `message`: human-readable status detail (API message or status text).
 *   - `data`: typed payload when present, otherwise `null`.
 */
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type LMCSubscriberAttribs = Record<string, JsonValue>;

export interface LMCSubscription {
  id: number;
  subscription_status?: string;
}

export interface LMCSubscriber {
  id: number;
  uuid: string;
  email: string;
  name: string;
  attribs: LMCSubscriberAttribs;
  status: string;
  created_at?: string;
  updated_at?: string;
  lists?: Array<LMCSubscription | LMCListRecord>;
}

export interface LMCListRecord {
  id: number;
  uuid?: string;
  name?: string;
  type?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  subscription_status?: string;
}

export interface LMCSubscriberPage {
  results: LMCSubscriber[];
  query?: string;
  total: number;
  per_page: number;
  page: number;
}

export type LMCListMemberStatus = "subscribed" | "unsubscribed" | "blocked";

export interface LMCBulkSubscriberInput {
  email: string;
  name?: string;
  uid?: string;
  attribs?: LMCSubscriberAttribs;
}

export interface LMCBulkAddResult {
  created: LMCSubscriber[];
  added: LMCSubscriber[];
  skippedBlocked: string[];
  skippedUnsubscribed: string[];
  memberships?: { email: string; lists?: LMCSubscription[] }[];
}

export type LMCSubscriberStatus =
  | "enabled"
  | "disabled"
  | "blocklisted"
  | "unconfirmed"
  | "bounced";

export interface LMCSubscribeOptions {
  preconfirm?: boolean;
  status?: LMCSubscriberStatus;
}

export interface LMCConfig {
  apiURL: string;
  token: string;
  user?: string;
  timeoutMS?: number;
  debug?: boolean;
  listPageSize?: number;
}

export interface LMCResponseData<T = unknown> {
  success: boolean;
  code: number;
  message: string;
  data: T | null;
}

export class LMCResponse<T = unknown> implements LMCResponseData<T> {
  success = false;
  code = 500;
  message = "Unknown error";
  data: T | null = null;

  constructor(response: Partial<LMCResponseData<T>> = {}) {
    this.success = response.success ?? false;
    this.code = response.code ?? 500;
    this.message = response.message ?? "Unknown error";
    this.data = response.data ?? null;
  }

  static ok<T>(
    data: T | null,
    overrides: Partial<LMCResponseData<T>> = {},
  ): LMCResponse<T> {
    return new LMCResponse<T>({
      success: true,
      code: overrides.code ?? 200,
      message: overrides.message ?? "OK",
      data: overrides.data ?? data,
    });
  }

  static error<T>(
    messageOrError: unknown,
    overrides: Partial<LMCResponseData<T>> = {},
  ): LMCResponse<T> {
    const message =
      messageOrError instanceof Error
        ? messageOrError.message
        : typeof messageOrError === "string"
          ? messageOrError
          : "Error";
    return new LMCResponse<T>({
      success: false,
      code: overrides.code ?? 500,
      message: overrides.message ?? (message || "Error"),
      data: overrides.data ?? null,
    });
  }

  isSuccess(): this is LMCResponse<T> & { data: T } {
    return this.success && this.data !== null;
  }
}

export default class ListMonkClient {
  private apiUrl: string;
  private timeoutMs: number;
  private debug: boolean;
  private listPageSize: number;
  private authHeader?: string;

  constructor(config: LMCConfig) {
    if (!config?.apiURL) {
      throw new Error("apiURL is required");
    }
    if (!config?.token) {
      throw new Error("token is required");
    }

    if (!config.user) {
      throw new Error("user is required for basic auth");
    }

    const normalizedUrl = config.apiURL.endsWith("/")
      ? config.apiURL.slice(0, -1)
      : config.apiURL;
    this.apiUrl = normalizedUrl;
    this.timeoutMs = config.timeoutMS ?? 15_000;
    this.debug = config.debug ?? false;
    this.listPageSize = config.listPageSize ?? 100;

    this.authHeader = `Basic ${Buffer.from(
      `${config.user}:${config.token}`,
    ).toString("base64")}`;
  }

  private buildHeaders(initHeaders?: HeadersInit): Headers {
    const headers = new Headers(initHeaders);
    if (this.authHeader) {
      headers.set("Authorization", this.authHeader);
    }
    return headers;
  }

  private async safeFetch(
    input: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);

    const method = (init.method ?? "GET").toUpperCase();
    const headers = this.buildHeaders(init.headers);
    if (
      method !== "GET" &&
      !headers.has("Content-Type") &&
      !(init.body instanceof FormData)
    ) {
      headers.set("Content-Type", "application/json");
    }

    if (this.debug) {
      console.log("[safeFetch] Request:", input);
      console.log("[safeFetch] Method:", method);
      console.log("[safeFetch] Headers:", headers);
    }

    try {
      return await fetch(input, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") {
        throw LMCResponse.error("Request timed out", { code: 504 });
      }
      throw LMCResponse.error(err, { code: 500 });
    } finally {
      clearTimeout(id);
    }
  }

  private async parseJson<T>(
    res: Response,
  ): Promise<Partial<LMCResponseData<T>>> {
    try {
      return (await res.json()) as Partial<LMCResponseData<T>>;
    } catch (err: unknown) {
      const parseMessage =
        err instanceof Error ? err.message : "Failed to parse JSON response";
      throw LMCResponse.error("Failed to parse JSON response", {
        code: res.status,
        message: parseMessage,
      });
    }
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    command: string,
    body?: Record<string, unknown>,
  ): Promise<LMCResponse<T>> {
    const url = `${this.apiUrl}${command}`;
    const init: RequestInit = { method };
    if (body !== undefined) {
      try {
        init.body = JSON.stringify(body);
      } catch (err) {
        return LMCResponse.error(err);
      }
    }

    if (this.debug) {
      console.log(
        `Making ${method} request to: ${url} (timeout: ${this.timeoutMs}ms)`,
      );
      if (body !== undefined) {
        console.log("Request body:", init.body);
      }
    }

    try {
      const res = await this.safeFetch(url, init);
      const payload = await this.parseJson<T>(res);
      const data =
        payload.data !== undefined
          ? (payload.data as T | null)
          : ((payload as unknown as T | null) ?? null);
      const message = payload.message ?? res.statusText;

      if (res.ok) {
        return LMCResponse.ok(data, {
          code: res.status,
          message,
        });
      }

      return LMCResponse.error(message, {
        code: res.status,
        data,
      });
    } catch (err: unknown) {
      if (err instanceof LMCResponse) return err;
      return LMCResponse.error(err);
    }
  }

  async get<T>(command: string): Promise<LMCResponse<T>> {
    return this.request<T>("GET", command);
  }

  async post<T>(
    command: string,
    body?: Record<string, unknown>,
  ): Promise<LMCResponse<T>> {
    return this.request<T>("POST", command, body);
  }

  async put<T>(
    command: string,
    body?: Record<string, unknown>,
  ): Promise<LMCResponse<T>> {
    return this.request<T>("PUT", command, body);
  }

  async delete<T>(
    command: string,
    body?: Record<string, unknown>,
  ): Promise<LMCResponse<T>> {
    return this.request<T>("DELETE", command, body);
  }

  async deleteSubscriber(id: number): Promise<LMCResponse<boolean>> {
    return this.delete<boolean>(`/subscribers/${id}`);
  }

  async deleteSubscribers(ids: number[]): Promise<LMCResponse<boolean>> {
    if (ids.length === 0) {
      return LMCResponse.error("No subscriber ids provided", { code: 400 });
    }
    const params = new URLSearchParams();
    ids.forEach((id) => params.append("id", String(id)));
    return this.delete<boolean>(`/subscribers?${params.toString()}`);
  }

  async subscribe(
    listId: number,
    email: string,
    name: string = "",
    attribs: LMCSubscriberAttribs = {},
    options: LMCSubscribeOptions = {},
  ): Promise<LMCResponse<LMCSubscriber>> {
    const lists: number[] = [listId];

    const body = {
      email,
      name,
      attribs,
      lists,
      preconfirm_subscriptions: options.preconfirm ?? true,
      ...(options.status ? { status: options.status } : {}),
    };

    return this.post<LMCSubscriber>("/subscribers", body);
  }

  async listMembersByStatus(
    listId: number,
    status: LMCListMemberStatus,
    pagination: { page?: number; perPage?: number } = {},
  ): Promise<LMCResponse<LMCSubscriberPage>> {
    const params = new URLSearchParams();
    params.set("list_id", String(listId));

    if (pagination.page !== undefined) {
      params.set("page", String(pagination.page));
    }
    const perPage = pagination.perPage ?? this.listPageSize;
    params.set("per_page", String(perPage));

    const translated = this.translateStatus(status);
    if (translated.subscriptionStatus) {
      params.set("subscription_status", translated.subscriptionStatus);
    }
    if (translated.query) {
      params.set("query", translated.query);
    }

    const queryString = params.toString();
    const path = queryString ? `/subscribers?${queryString}` : "/subscribers";

    return this.get<LMCSubscriberPage>(path);
  }

  async addSubscribersToList(
    listId: number,
    entries: LMCBulkSubscriberInput[],
    options: { attachToList?: boolean } = {},
  ): Promise<LMCResponse<LMCBulkAddResult>> {
    if (entries.length === 0) {
      return LMCResponse.ok(
        {
          created: [],
          added: [],
          skippedBlocked: [],
          skippedUnsubscribed: [],
          memberships: [],
        },
        { message: "No entries to process" },
      );
    }

    const normalized = entries.map((entry) => {
      const derivedUid =
        entry.uid ??
        (typeof entry.attribs?.uid === "string"
          ? String(entry.attribs.uid)
          : undefined);
      const attribs: LMCSubscriberAttribs = { ...(entry.attribs ?? {}) };
      if (derivedUid) attribs.uid = derivedUid;
      return { ...entry, uid: derivedUid, attribs };
    });

    const deduped = new Map<string, LMCBulkSubscriberInput>();
    normalized.forEach((entry) => {
      const key = entry.uid
        ? `uid:${entry.uid}`
        : `email:${entry.email.toLowerCase()}`;
      deduped.set(key, entry);
    });

    const uids = new Set<string>();
    const emails = new Set<string>();
    deduped.forEach((entry) => {
      if (entry.uid) uids.add(entry.uid);
      emails.add(entry.email.toLowerCase());
    });

    const existingByUid = new Map<string, LMCSubscriber>();
    const existingByEmail = new Map<string, LMCSubscriber>();
    const lookupChunkSize = 2500;

    const escapeValue = (value: string) => value.replace(/'/g, "''");

    const fetchSubscribers = async (
      values: string[],
      buildQuery: (chunk: string[]) => string,
    ) => {
      for (let i = 0; i < values.length; i += lookupChunkSize) {
        const chunk = values.slice(i, i + lookupChunkSize);
        const query = buildQuery(chunk);
        const perPage = Math.max(chunk.length, 50);
        const res = await this.get<LMCSubscriberPage>(
          `/subscribers?per_page=${perPage}&query=${query}`,
        );
        if (res.success && res.data) {
          res.data.results.forEach((s) => {
            const emailKey = s.email.toLowerCase();
            existingByEmail.set(emailKey, s);
            const subUid =
              typeof s.attribs?.uid === "string" ? String(s.attribs.uid) : null;
            if (subUid) {
              existingByUid.set(subUid, s);
            }
          });
        } else if (this.debug) {
          console.warn("Lookup failed for chunk", res.code, res.message);
        }
      }
    };

    if (uids.size > 0) {
      await fetchSubscribers(Array.from(uids), (chunk) => {
        const inList = chunk.map((u) => `'${escapeValue(u)}'`).join(",");
        return encodeURIComponent(`attribs->>'uid' IN (${inList})`);
      });
    }

    if (emails.size > 0) {
      await fetchSubscribers(Array.from(emails), (chunk) => {
        const inList = chunk.map((e) => `'${escapeValue(e)}'`).join(",");
        return encodeURIComponent(`email IN (${inList})`);
      });
    }

    const created: LMCSubscriber[] = [];
    const added: LMCSubscriber[] = [];
    const skippedBlocked: string[] = [];
    const skippedUnsubscribed: string[] = [];
    const addIds: number[] = [];
    const memberships: { email: string; lists?: LMCSubscription[] }[] = [];
    const attachToList = options.attachToList ?? true;

    for (const entry of deduped.values()) {
      const emailKey = entry.email.toLowerCase();
      const entryAttribs: LMCSubscriberAttribs = { ...(entry.attribs ?? {}) };
      if (entry.uid) entryAttribs.uid = entry.uid;

      let existing =
        entry.uid !== undefined
          ? (existingByUid.get(entry.uid) ?? existingByEmail.get(emailKey))
          : existingByEmail.get(emailKey);

      if (!existing) {
        const createRes = attachToList
          ? await this.subscribe(
              listId,
              entry.email,
              entry.name ?? "",
              entryAttribs,
              { preconfirm: true, status: "enabled" },
            )
          : await this.post<LMCSubscriber>("/subscribers", {
              email: entry.email,
              name: entry.name ?? "",
              attribs: entryAttribs,
              lists: [],
              preconfirm_subscriptions: true,
              status: "enabled",
            });
        if (createRes.success && createRes.data) {
          created.push(createRes.data);
          memberships.push({
            email: entry.email,
            lists: createRes.data.lists,
          });
        }
        continue;
      }

      if (entry.uid && existing.email.toLowerCase() !== emailKey) {
        const updateRes = await this.put<LMCSubscriber>(
          `/subscribers/${existing.id}`,
          {
            email: entry.email,
            name: entry.name ?? existing.name,
            attribs: entryAttribs,
          },
        );
        if (!updateRes.success || !updateRes.data) {
          return LMCResponse.error(
            updateRes.message || "Failed to update subscriber email",
            { code: updateRes.code },
          );
        }
        existing = updateRes.data;
        existingByEmail.set(emailKey, existing);
        if (entry.uid) {
          existingByUid.set(entry.uid, existing);
        }
      }

      if (existing.status === "blocklisted") {
        skippedBlocked.push(existing.email);
        memberships.push({ email: existing.email, lists: existing.lists });
        continue;
      }

      const listInfo = existing.lists?.find((l) => l.id === listId);
      if (listInfo?.subscription_status === "unsubscribed") {
        skippedUnsubscribed.push(existing.email);
        memberships.push({ email: existing.email, lists: existing.lists });
        continue;
      }

      if (listInfo && listInfo.subscription_status !== "unsubscribed") {
        // Already on the list in a good state
        if (attachToList) {
          added.push(existing);
        }
        memberships.push({ email: existing.email, lists: existing.lists });
        continue;
      }

      memberships.push({ email: existing.email, lists: existing.lists });

      if (attachToList) {
        addIds.push(existing.id);
        added.push(existing);
      }
    }

    if (attachToList && addIds.length > 0) {
      const addChunkSize = 2500;
      for (let i = 0; i < addIds.length; i += addChunkSize) {
        const chunk = addIds.slice(i, i + addChunkSize);
        await this.put(`/subscribers/lists/${listId}`, {
          ids: chunk,
          action: "add",
        });
      }
    }

    return LMCResponse.ok({
      created,
      added,
      skippedBlocked,
      skippedUnsubscribed,
      memberships,
    });
  }

  async changeEmail(
    currentEmail: string,
    newEmail: string,
  ): Promise<LMCResponse<LMCSubscriber>> {
    const trimmedNew = newEmail.trim();
    const trimmedCurrent = currentEmail.trim();
    if (!trimmedCurrent) {
      return LMCResponse.error("Current email is required", { code: 400 });
    }
    if (!trimmedNew) {
      return LMCResponse.error("New email is required", { code: 400 });
    }

    const subscriber = await this.findSubscriberByEmail(trimmedCurrent);
    if (!subscriber.success || !subscriber.data) {
      return subscriber;
    }

    if (subscriber.data.email.toLowerCase() === trimmedNew.toLowerCase()) {
      return LMCResponse.ok(subscriber.data, {
        message: "Email already set to the provided value",
      });
    }

    const updateRes = await this.put<LMCSubscriber>(
      `/subscribers/${subscriber.data.id}`,
      {
        email: trimmedNew,
        name: subscriber.data.name,
        attribs: subscriber.data.attribs,
      },
    );
    if (!updateRes.success) return updateRes;
    return updateRes;
  }

  private async findSubscriberByEmail(
    email: string,
  ): Promise<LMCResponse<LMCSubscriber>> {
    const escape = (value: string) => value.replace(/'/g, "''");
    const query = encodeURIComponent(`email = '${escape(email)}'`);
    const res = await this.get<LMCSubscriberPage>(
      `/subscribers?per_page=1&query=${query}`,
    );
    if (res.success && res.data && res.data.results.length > 0) {
      return LMCResponse.ok(res.data.results[0], {
        code: res.code,
        message: res.message,
      });
    }
    return LMCResponse.error("Subscriber not found", { code: 404 });
  }


  private translateStatus(status: LMCListMemberStatus): {
    subscriptionStatus?: string;
    query?: string;
  } {
    switch (status) {
      case "subscribed":
        return { subscriptionStatus: "confirmed" };
      case "unsubscribed":
        return { subscriptionStatus: "unsubscribed" };
      case "blocked":
        return { query: "subscribers.status = 'blocklisted'" };
      default:
        return {};
    }
  }
}
