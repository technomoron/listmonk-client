type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface LMCConfig {
  apiURL: string;
  token: string;
  user?: string;
  timeoutMS?: number;
  debug?: boolean;
  listPageSize?: number;
  listCacheSeconds?: number;
}

export interface LMCResponseData<T = unknown> {
  success: boolean;
  code: number;
  message: string;
  data: T | null;
}

export type LMCSubscriberAttribs = Record<string, JsonValue>;

export type LMCSubscriptionStatus =
  | "enabled"
  | "disabled"
  | "blocklisted"
  | "unconfirmed"
  | "bounced"
  | "unsubscribed";

export interface LMCSubscribeOptions {
  preconfirm?: boolean;
  status?: LMCSubscriptionStatus;
}

export interface LMCUnsubscribeListResult {
  listId: number;
  listName?: string;
  statusChanged: boolean;
  message: "Subscribed" | "Unsubscribed" | "Unknown List";
}

export interface LMCUnsubscribeResult {
  subscriberId: number;
  lists: LMCUnsubscribeListResult[];
}

export type LMCSetSubscriptionsStatus =
  | "Subscribed"
  | "Unsubscribed"
  | "Unchanged"
  | "Unknown List";

export interface LMCSetSubscriptionsListResult {
  listId: number;
  listName?: string;
  status: LMCSetSubscriptionsStatus;
}

export interface LMCSetSubscriptionsResult {
  subscriberId: number;
  lists: LMCSetSubscriptionsListResult[];
}

export interface LMCSetSubscriptionsOptions {
  removeOthers?: boolean;
}

export type LMCListMemberStatus = "subscribed" | "unsubscribed" | "blocked";
export type LMCListVisibility = "private" | "public";

export interface LMCSubscription {
  id: number;
  subscription_status?: LMCSubscriptionStatus;
}

export interface LMCListRecord {
  id: number;
  uuid?: string;
  name?: string;
  type?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  subscription_status?: LMCSubscriptionStatus;
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

export interface LMCSubscriberPage {
  results: LMCSubscriber[];
  query?: string;
  total: number;
  per_page: number;
  page: number;
}

export interface LMCBulkSubscription {
  email: string;
  name?: string;
  uid?: string;
  attribs?: LMCSubscriberAttribs;
}

export interface LMCSubscriptionSnapshot {
  email: string;
  lists?: LMCSubscription[];
}

export interface LMCBulkAddResult {
  created: LMCSubscriber[];
  added: LMCSubscriber[];
  skippedBlocked: string[];
  skippedUnsubscribed: string[];
  memberships?: LMCSubscriptionSnapshot[];
  errors?: LMCBulkAddError[];
}

export interface LMCBulkAddError {
  email: string;
  message: string;
  code?: number;
}

export interface LMCSubscribeResult {
  subscriber: LMCSubscriber | null;
  added: boolean;
  alreadySubscribed: boolean;
  created: boolean;
}

export interface LMCUser {
  email: string;
  name?: string;
  attribs?: LMCSubscriberAttribs;
  uid?: string;
}

export interface LMCSyncUsersResult {
  blocked: number;
  unsubscribed: number;
  added: number;
  updated: number;
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
  private listCacheSeconds?: number;
  private listCache?: { expiresAt: number; lists: LMCListRecord[] };
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
    this.listCacheSeconds = config.listCacheSeconds;

    this.authHeader = `Basic ${ListMonkClient.encodeBase64(
      `${config.user}:${config.token}`,
    )}`;
  }

  private static encodeBase64(value: string): string {
    const globalBtoa = (globalThis as { btoa?: (data: string) => string }).btoa;
    if (typeof globalBtoa !== "function") {
      throw new Error("btoa is not available in this runtime");
    }

    return globalBtoa(value);
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
    const contentType = res.headers.get("content-type") ?? "";

    if (res.status === 204 || res.status === 205) {
      return { data: null, message: res.statusText };
    }

    const text = await res.text();

    if (!text) {
      return { data: null, message: res.statusText };
    }

    if (!contentType.toLowerCase().includes("application/json")) {
      return { data: null, message: text };
    }

    try {
      return JSON.parse(text) as Partial<LMCResponseData<T>>;
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

  async getSubscriberById(id: number): Promise<LMCResponse<LMCSubscriber>> {
    return this.findSubscriber({ id });
  }

  async getSubscriberByUuid(uuid: string): Promise<LMCResponse<LMCSubscriber>> {
    return this.findSubscriber({ uuid });
  }

  async getSubscriberByEmail(
    email: string,
  ): Promise<LMCResponse<LMCSubscriber>> {
    return this.findSubscriber({ email });
  }

  async getSubscriber(identifier: {
    id?: number;
    uuid?: string;
    email?: string;
  }): Promise<LMCResponse<LMCSubscriber>> {
    return this.findSubscriber(identifier);
  }

  async blockSubscriber(id: number): Promise<LMCResponse<LMCSubscriber>> {
    if (!Number.isFinite(id)) {
      return LMCResponse.error("id must be a number", { code: 400 });
    }
    return this.put<LMCSubscriber>(`/subscribers/${id}`, {
      status: "blocklisted",
    });
  }

  async unblockSubscriber(id: number): Promise<LMCResponse<LMCSubscriber>> {
    if (!Number.isFinite(id)) {
      return LMCResponse.error("id must be a number", { code: 400 });
    }
    return this.put<LMCSubscriber>(`/subscribers/${id}`, {
      status: "enabled",
    });
  }

  async unsubscribe(
    identifier: { id?: number; uuid?: string; email?: string },
    lists?: number | number[],
  ): Promise<LMCResponse<LMCUnsubscribeResult>> {
    const subscriber = await this.findSubscriber(identifier);
    if (!subscriber.success || !subscriber.data) {
      return subscriber as unknown as LMCResponse<LMCUnsubscribeResult>;
    }

    const listArray =
      lists === undefined ? undefined : Array.isArray(lists) ? lists : [lists];

    if (
      listArray !== undefined &&
      !listArray.every((id) => Number.isFinite(id))
    ) {
      return LMCResponse.error("lists must be a number or array of numbers", {
        code: 400,
      });
    }

    let targetListIds: number[] | undefined;
    if (listArray !== undefined) {
      targetListIds = Array.from(new Set(listArray.map((id) => Number(id))));
      if (targetListIds.length === 0) {
        targetListIds = undefined;
      }
    }

    const memberListIds: number[] = [];
    const subscribedListIds = new Set<number>();
    (subscriber.data.lists ?? []).forEach((l) => {
      if (!Number.isFinite(l.id)) return;
      const id = Number(l.id);
      memberListIds.push(id);
      const status = (l as LMCSubscription).subscription_status;
      if (status === undefined || status !== "unsubscribed") {
        subscribedListIds.add(id);
      }
    });
    const memberListIdSet = new Set(memberListIds);

    const listNames = await this.getListNameMap(subscriber.data.lists);

    const res = await this.put(`/subscribers/lists`, {
      ids: [subscriber.data.id],
      action: "unsubscribe",
      ...(targetListIds ? { target_list_ids: targetListIds } : {}),
    });

    const attemptedIds =
      targetListIds && targetListIds.length > 0 ? targetListIds : memberListIds;

    const listsResult =
      attemptedIds.length === 0
        ? []
        : attemptedIds.map((listId) => ({
            listId,
            listName: listNames.get(listId),
            statusChanged:
              memberListIds.length > 0 && subscribedListIds.has(listId),
            message: this.describeListStatus(listId, {
              memberListIdSet,
              subscribedListIds,
              listNames,
            }),
          }));

    const result: LMCUnsubscribeResult = {
      subscriberId: subscriber.data.id,
      lists: listsResult,
    };

    if (res.success) {
      return LMCResponse.ok(result, { code: res.code, message: res.message });
    }

    return LMCResponse.error(res.message, {
      code: res.code,
      data: result,
    });
  }

  async setSubscriptions(
    identifier: { id?: number; uuid?: string; email?: string },
    listIds: number[],
    options: LMCSetSubscriptionsOptions = {},
  ): Promise<LMCResponse<LMCSetSubscriptionsResult>> {
    const normalized = Array.from(
      new Set(listIds.map((id) => Number(id))),
    ).filter((id) => Number.isFinite(id));

    if (listIds.length !== normalized.length) {
      return LMCResponse.error("listIds must be numbers", { code: 400 });
    }

    const subscriber = await this.findSubscriber(identifier);
    if (!subscriber.success || !subscriber.data) {
      return subscriber as unknown as LMCResponse<LMCSetSubscriptionsResult>;
    }

    const listNames = await this.getListNameMap(subscriber.data.lists);
    const targetSet = new Set<number>(normalized);

    const currentListIds: number[] = [];
    const subscribedListIds = new Set<number>();
    (subscriber.data.lists ?? []).forEach((l) => {
      if (!Number.isFinite(l.id)) return;
      const id = Number(l.id);
      currentListIds.push(id);
      const status = (l as LMCSubscription).subscription_status;
      if (status === undefined || status !== "unsubscribed") {
        subscribedListIds.add(id);
      }
    });

    const listsToAdd = normalized.filter((id) => !subscribedListIds.has(id));

    const removeOthers = options.removeOthers ?? false;
    const listsToRemove = removeOthers
      ? currentListIds.filter(
          (id) => subscribedListIds.has(id) && !targetSet.has(id),
        )
      : [];

    if (listsToAdd.length > 0) {
      const addRes = await this.put(`/subscribers/lists`, {
        ids: [subscriber.data.id],
        action: "add",
        target_list_ids: listsToAdd,
      });
      if (!addRes.success) {
        return addRes as unknown as LMCResponse<LMCSetSubscriptionsResult>;
      }
      listsToAdd.forEach((id) => subscribedListIds.add(id));
    }

    if (listsToRemove.length > 0) {
      const removeRes = await this.put(`/subscribers/lists`, {
        ids: [subscriber.data.id],
        action: "unsubscribe",
        target_list_ids: listsToRemove,
      });
      if (!removeRes.success) {
        return removeRes as unknown as LMCResponse<LMCSetSubscriptionsResult>;
      }
      listsToRemove.forEach((id) => subscribedListIds.delete(id));
    }

    const resultMap = new Map<number, LMCSetSubscriptionsListResult>();

    targetSet.forEach((id) => {
      resultMap.set(id, {
        listId: id,
        listName: listNames.get(id),
        status: subscribedListIds.has(id) ? "Unchanged" : "Subscribed",
      });
    });

    listsToAdd.forEach((id) => {
      resultMap.set(id, {
        listId: id,
        listName: listNames.get(id),
        status: "Subscribed",
      });
    });

    listsToRemove.forEach((id) => {
      resultMap.set(id, {
        listId: id,
        listName: listNames.get(id),
        status: "Unsubscribed",
      });
    });

    const result: LMCSetSubscriptionsResult = {
      subscriberId: subscriber.data.id,
      lists: Array.from(resultMap.values()),
    };

    return LMCResponse.ok(result, { message: "Subscriptions updated" });
  }

  async listAllLists(
    visibility: LMCListVisibility | "all" = "all",
  ): Promise<LMCResponse<LMCListRecord[]>> {
    const params = new URLSearchParams();
    params.set("per_page", "all");
    if (visibility !== "all") {
      params.set("type", visibility);
    }

    type LMCListResultsPayload =
      | LMCListRecord[]
      | { results?: LMCListRecord[] | undefined };

    const res = await this.get<LMCListResultsPayload>(
      `/lists?${params.toString()}`,
    );

    if (!res.success) {
      return res as unknown as LMCResponse<LMCListRecord[]>;
    }

    const payload = res.data;
    const results = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.results)
        ? payload.results
        : null;

    if (!results) {
      return LMCResponse.error("Unexpected response while fetching lists", {
        code: res.code,
      });
    }

    return LMCResponse.ok(results, { code: res.code, message: res.message });
  }

  async subscribe(
    listId: number,
    input: {
      email: string;
      name?: string;
      attribs?: LMCSubscriberAttribs;
    },
    options: LMCSubscribeOptions = {},
  ): Promise<LMCResponse<LMCSubscribeResult>> {
    if (!Number.isFinite(listId)) {
      return LMCResponse.error("Failed to subscribe: listId must be a number", {
        code: 400,
      });
    }

    const email = input.email?.trim();
    if (!email) {
      return LMCResponse.error("Failed to subscribe: email is required", {
        code: 400,
      });
    }
    const name = input.name ?? "";
    const attribs = input.attribs ?? {};
    const lists: number[] = [listId];

    const existing = await this.findSubscriber({ email });
    if (existing.success && existing.data) {
      const subscriber = existing.data;
      const membership = subscriber.lists?.find((l) => l.id === listId);
      const membershipStatus = membership?.subscription_status as
        | string
        | undefined;

      if (subscriber.status === "blocklisted") {
        return LMCResponse.error(
          "Failed to subscribe: subscriber is blocklisted",
          { code: 400 },
        );
      }

      if (membershipStatus && membershipStatus !== "unsubscribed") {
        return LMCResponse.ok(
          {
            subscriber,
            added: false,
            alreadySubscribed: true,
            created: false,
          },
          { code: existing.code, message: "Already subscribed" },
        );
      }

      const attachRes =
        membershipStatus === "unsubscribed"
          ? await this.put(`/subscribers/lists`, {
              ids: [subscriber.id],
              action: "add",
              target_list_ids: [listId],
            })
          : await this.put(`/subscribers/lists/${listId}`, {
              ids: [subscriber.id],
              action: "add",
            });
      if (!attachRes.success) {
        return LMCResponse.error(`Failed to subscribe: ${attachRes.message}`, {
          code: attachRes.code,
        });
      }

      const refreshed = await this.get<LMCSubscriber>(
        `/subscribers/${subscriber.id}`,
      );
      const updatedSubscriber =
        refreshed.success && refreshed.data ? refreshed.data : subscriber;

      return LMCResponse.ok(
        {
          subscriber: updatedSubscriber,
          added: true,
          alreadySubscribed: false,
          created: false,
        },
        {
          code: refreshed.success ? refreshed.code : attachRes.code,
          message: "Successfully subscribed",
        },
      );
    }

    if (!existing.success && existing.code !== 404) {
      return LMCResponse.error(`Failed to subscribe: ${existing.message}`, {
        code: existing.code,
      });
    }

    const body = {
      email,
      name,
      attribs,
      lists,
      preconfirm_subscriptions: options.preconfirm ?? true,
      ...(options.status ? { status: options.status } : {}),
    };

    const createRes = await this.post<LMCSubscriber>("/subscribers", body);
    if (!createRes.success || !createRes.data) {
      return LMCResponse.error(`Failed to subscribe: ${createRes.message}`, {
        code: createRes.code,
      });
    }

    return LMCResponse.ok(
      {
        subscriber: createRes.data,
        added: true,
        alreadySubscribed: false,
        created: true,
      },
      { code: createRes.code, message: "Successfully subscribed" },
    );
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
    entries: LMCBulkSubscription[],
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

    const deduped = new Map<string, LMCBulkSubscription>();
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
    const resubscribeIds: number[] = [];
    const memberships: LMCSubscriptionSnapshot[] = [];
    const errors: LMCBulkAddError[] = [];
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
        if (attachToList) {
          const createRes = await this.subscribe(
            listId,
            {
              email: entry.email,
              name: entry.name ?? "",
              attribs: entryAttribs,
            },
            { preconfirm: true, status: "enabled" },
          );
          const subscribeData = createRes.data;
          if (createRes.success && subscribeData?.subscriber) {
            if (subscribeData.created) {
              created.push(subscribeData.subscriber);
            } else {
              added.push(subscribeData.subscriber);
            }
            memberships.push({
              email: entry.email,
              lists: subscribeData.subscriber.lists,
            });
          } else {
            errors.push({
              email: entry.email,
              message: createRes.message,
              code: createRes.code,
            });
          }
        } else {
          const createRes = await this.post<LMCSubscriber>("/subscribers", {
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
          } else {
            errors.push({
              email: entry.email,
              message: createRes.message,
              code: createRes.code,
            });
          }
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
      const membershipStatus = listInfo?.subscription_status as
        | string
        | undefined;
      const isUnsubscribed = membershipStatus === "unsubscribed";
      if (listInfo && membershipStatus !== "unsubscribed") {
        // Already on the list in a good state
        if (attachToList) {
          added.push(existing);
        }
        memberships.push({ email: existing.email, lists: existing.lists });
        continue;
      }

      memberships.push({ email: existing.email, lists: existing.lists });

      if (attachToList) {
        if (isUnsubscribed) {
          resubscribeIds.push(existing.id);
          added.push(existing);
        } else {
          addIds.push(existing.id);
          added.push(existing);
        }
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

    if (attachToList && resubscribeIds.length > 0) {
      const chunkSize = 2500;
      for (let i = 0; i < resubscribeIds.length; i += chunkSize) {
        const chunk = resubscribeIds.slice(i, i + chunkSize);
        await this.put(`/subscribers/lists`, {
          ids: chunk,
          action: "add",
          target_list_ids: [listId],
        });
      }
    }

    if (errors.length > 0) {
      return LMCResponse.error("Failed to add some subscribers", {
        code: errors.length === deduped.size ? 500 : 207,
        data: {
          created,
          added,
          skippedBlocked,
          skippedUnsubscribed,
          memberships,
          errors,
        },
      });
    }

    return LMCResponse.ok(
      {
        created,
        added,
        skippedBlocked,
        skippedUnsubscribed,
        memberships,
        errors,
      },
      { message: "Successfully added subscribers" },
    );
  }

  async syncUsersToList(
    listId: number,
    users: LMCUser[],
  ): Promise<LMCResponse<LMCSyncUsersResult>> {
    if (!Number.isFinite(listId)) {
      return LMCResponse.error("listId must be a number", { code: 400 });
    }
    if (users.length === 0) {
      return LMCResponse.ok({
        blocked: 0,
        unsubscribed: 0,
        added: 0,
        updated: 0,
      });
    }

    type NormalizedUser = {
      email: string;
      name?: string;
      attribs: LMCSubscriberAttribs;
      uid: string;
    };

    const normalized: NormalizedUser[] = users.map((user) => ({
      email: user.email.trim(),
      name: user.name?.trim(),
      attribs: user.attribs ?? {},
      uid: (user.uid ?? "").trim(),
    }));

    const missingUid = normalized.find((u) => !u.uid);
    if (missingUid) {
      return LMCResponse.error("Each user must include a uid", { code: 400 });
    }
    const missingEmail = normalized.find((u) => !u.email);
    if (missingEmail) {
      return LMCResponse.error("Each user must include an email", {
        code: 400,
      });
    }

    const deduped = new Map<string, NormalizedUser>();
    normalized.forEach((user) => {
      deduped.set(user.uid, user);
    });

    const uids = Array.from(deduped.keys());
    const emails = new Set<string>();
    deduped.forEach((user) => emails.add(user.email.toLowerCase()));

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

    if (uids.length > 0) {
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

    const counts: LMCSyncUsersResult = {
      blocked: 0,
      unsubscribed: 0,
      added: 0,
      updated: 0,
    };
    const addIds: number[] = [];
    const resubscribeIds: number[] = [];

    for (const entry of deduped.values()) {
      const emailKey = entry.email.toLowerCase();
      let existing =
        existingByUid.get(entry.uid) ?? existingByEmail.get(emailKey);

      if (!existing) {
        const attribs: LMCSubscriberAttribs = { ...(entry.attribs ?? {}) };
        attribs.uid = entry.uid;

        const createRes = await this.subscribe(
          listId,
          {
            email: entry.email,
            name: entry.name ?? "",
            attribs,
          },
          { preconfirm: true, status: "enabled" },
        );
        if (!createRes.success || !createRes.data?.subscriber) {
          return createRes as unknown as LMCResponse<LMCSyncUsersResult>;
        }
        if (createRes.data.added) {
          counts.added += 1;
        }
        continue;
      }

      if (existing.status === "blocklisted") {
        counts.blocked += 1;
        continue;
      }

      const listInfo = existing.lists?.find((l) => l.id === listId);
      const membershipStatus = listInfo?.subscription_status as
        | string
        | undefined;
      const isUnsubscribed = membershipStatus === "unsubscribed";
      if (isUnsubscribed) {
        counts.unsubscribed += 1;
      }

      const targetAttribs: LMCSubscriberAttribs = {
        ...(existing.attribs ?? {}),
        ...(entry.attribs ?? {}),
      };
      targetAttribs.uid = entry.uid;

      const targetEmail = entry.email;
      const targetName = entry.name ?? existing.name ?? "";

      const needsEmailUpdate =
        existing.email.toLowerCase() !== targetEmail.toLowerCase();
      const needsNameUpdate = (existing.name ?? "") !== targetName;
      const needsAttribUpdate = !this.areAttribsEqual(
        existing.attribs,
        targetAttribs,
      );

      if (needsEmailUpdate || needsNameUpdate || needsAttribUpdate) {
        const updateRes = await this.put<LMCSubscriber>(
          `/subscribers/${existing.id}`,
          {
            email: targetEmail,
            name: targetName,
            attribs: targetAttribs,
          },
        );
        if (!updateRes.success || !updateRes.data) {
          return updateRes as unknown as LMCResponse<LMCSyncUsersResult>;
        }
        existing = updateRes.data;
        counts.updated += 1;
      }

      const listEntry = existing.lists?.find((l) => l.id === listId);
      const onList =
        listEntry &&
        (listEntry as LMCSubscription).subscription_status !== "unsubscribed";
      if (!onList || isUnsubscribed) {
        if (isUnsubscribed) {
          resubscribeIds.push(existing.id);
        } else {
          addIds.push(existing.id);
        }
        counts.added += 1;
      }
    }

    if (addIds.length > 0) {
      const addChunkSize = 2500;
      for (let i = 0; i < addIds.length; i += addChunkSize) {
        const chunk = addIds.slice(i, i + addChunkSize);
        const res = await this.put(`/subscribers/lists/${listId}`, {
          ids: chunk,
          action: "add",
        });
        if (!res.success) {
          return res as unknown as LMCResponse<LMCSyncUsersResult>;
        }
      }
    }

    if (resubscribeIds.length > 0) {
      const chunkSize = 2500;
      for (let i = 0; i < resubscribeIds.length; i += chunkSize) {
        const chunk = resubscribeIds.slice(i, i + chunkSize);
        const res = await this.put(`/subscribers/lists`, {
          ids: chunk,
          action: "add",
          target_list_ids: [listId],
        });
        if (!res.success) {
          return res as unknown as LMCResponse<LMCSyncUsersResult>;
        }
      }
    }

    return LMCResponse.ok(counts);
  }

  async updateUser(
    identifier: { id?: number; uuid?: string; email?: string },
    updates: Partial<LMCUser>,
    options: { forceUidChange?: boolean } = {},
  ): Promise<LMCResponse<LMCSubscriber>> {
    const { id, uuid, email } = identifier;
    if (id === undefined && !uuid && !email) {
      return LMCResponse.error("id, uuid, or email is required", {
        code: 400,
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return LMCResponse.error("No updates provided", { code: 400 });
    }

    const subscriber = await this.findSubscriber(identifier);
    if (!subscriber.success || !subscriber.data) {
      return subscriber;
    }

    const existing = subscriber.data;
    const nextAttribs: LMCSubscriberAttribs = {
      ...(existing.attribs ?? {}),
      ...(updates.attribs ?? {}),
    };

    if (
      updates.uid !== undefined &&
      existing.attribs?.uid !== undefined &&
      updates.uid !== existing.attribs.uid &&
      !options.forceUidChange
    ) {
      return LMCResponse.error(
        "UID mismatch; set forceUidChange to overwrite existing uid",
        { code: 400 },
      );
    }

    if (updates.uid !== undefined) {
      nextAttribs.uid = updates.uid;
    } else if (
      existing.attribs?.uid !== undefined &&
      nextAttribs.uid === undefined
    ) {
      nextAttribs.uid = existing.attribs.uid;
    }

    const nextEmail = updates.email?.trim() ?? existing.email;
    if (!nextEmail) {
      return LMCResponse.error("Email is required", { code: 400 });
    }

    const nextName =
      updates.name !== undefined ? updates.name : (existing.name ?? "");

    const currentLists = existing.lists
      ?.map((l) => l.id)
      .filter((id): id is number => Number.isFinite(id));

    return this.put<LMCSubscriber>(`/subscribers/${existing.id}`, {
      email: nextEmail,
      name: nextName,
      attribs: nextAttribs,
      ...(currentLists && currentLists.length > 0
        ? { lists: currentLists }
        : {}),
    });
  }

  private async findSubscriber(identifier: {
    id?: number;
    uuid?: string;
    email?: string;
  }): Promise<LMCResponse<LMCSubscriber>> {
    if (identifier.id !== undefined) {
      const res = await this.get<LMCSubscriber>(
        `/subscribers/${identifier.id}`,
      );
      if (res.success && res.data) return res;
      if (res.success) {
        return LMCResponse.error("Subscriber not found", { code: 404 });
      }
      return res as LMCResponse<LMCSubscriber>;
    }

    const params = new URLSearchParams();
    params.set("per_page", "1");

    if (identifier.uuid) {
      params.set("query", this.buildEqualityQuery("uuid", identifier.uuid));
    } else if (identifier.email) {
      params.set("query", this.buildEqualityQuery("email", identifier.email));
    } else {
      return LMCResponse.error("id, uuid, or email is required", {
        code: 400,
      });
    }

    const res = await this.get<LMCSubscriberPage>(
      `/subscribers?${params.toString()}`,
    );
    if (res.success && res.data && res.data.results.length > 0) {
      return LMCResponse.ok(res.data.results[0], {
        code: res.code,
        message: res.message,
      });
    }
    if (res.success) {
      return LMCResponse.error("Subscriber not found", { code: 404 });
    }
    return res as unknown as LMCResponse<LMCSubscriber>;
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

  private areAttribsEqual(
    a?: LMCSubscriberAttribs,
    b?: LMCSubscriberAttribs,
  ): boolean {
    return this.stableStringify(a ?? {}) === this.stableStringify(b ?? {});
  }

  private stableStringify(value: JsonValue): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.stableStringify(v)).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, JsonValue>).sort(
      ([aKey], [bKey]) => aKey.localeCompare(bKey),
    );
    return `{${entries
      .map(
        ([key, val]) => `${JSON.stringify(key)}:${this.stableStringify(val)}`,
      )
      .join(",")}}`;
  }

  private buildEqualityQuery(field: string, value: string): string {
    const escaped = value.replace(/'/g, "''");
    return `${field} = '${escaped}'`;
  }

  private async getListNameMap(
    subscriberLists?: Array<LMCSubscription | LMCListRecord>,
  ): Promise<Map<number, string>> {
    const map = new Map<number, string>();

    const tryAddName = (list: LMCSubscription | LMCListRecord) => {
      const name =
        "name" in list && typeof list.name === "string" ? list.name : undefined;
      if (Number.isFinite(list.id) && name) {
        map.set(list.id, name);
      }
    };

    subscriberLists?.forEach(tryAddName);

    if (!this.listCacheSeconds) {
      return map;
    }

    const now = Date.now();
    if (this.listCache && this.listCache.expiresAt > now) {
      this.listCache.lists.forEach(tryAddName);
      return map;
    }

    const res = await this.listAllLists();
    if (res.success && res.data) {
      this.listCache = {
        expiresAt: now + this.listCacheSeconds * 1000,
        lists: res.data,
      };
      res.data.forEach(tryAddName);
    }

    return map;
  }

  private describeListStatus(
    listId: number,
    context: {
      memberListIdSet: Set<number>;
      subscribedListIds: Set<number>;
      listNames: Map<number, string>;
    },
  ): "Subscribed" | "Unsubscribed" | "Unknown List" {
    const { memberListIdSet, subscribedListIds, listNames } = context;
    if (!listNames.has(listId) && !memberListIdSet.has(listId)) {
      return "Unknown List";
    }
    return subscribedListIds.has(listId) ? "Subscribed" : "Unsubscribed";
  }
}
