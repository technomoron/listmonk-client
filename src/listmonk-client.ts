/**
 * Minimal Listmonk API client with Basic auth and helper methods.
 * Borrowed the ApiResponse wrapper pattern from api-client-base, but removed tokens/retries.
 */
import { Buffer } from "node:buffer";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SubscriberAttribs = Record<string, JsonValue>;

export interface SubscriberListMeta {
  subscription_status?: string;
  id: number;
  uuid?: string;
  name?: string;
  type?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface Subscriber {
  id: number;
  uuid: string;
  email: string;
  name: string;
  attribs: SubscriberAttribs;
  status: string;
  created_at?: string;
  updated_at?: string;
  lists?: SubscriberListMeta[];
}

export interface SubscriberPage {
  results: Subscriber[];
  query?: string;
  total: number;
  per_page: number;
  page: number;
}

export type ListMemberStatus =
  | "subscribed"
  | "unsubscribed"
  | "unsubbed"
  | "blocked";

export interface BulkSubscriberInput {
  email: string;
  name?: string;
  attribs?: SubscriberAttribs;
}

export interface BulkAddResult {
  created: Subscriber[];
  added: Subscriber[];
  skippedBlocked: string[];
  skippedUnsubscribed: string[];
}

export interface SubscribeOptions {
  preconfirm?: boolean;
  status?: string;
  listUuid?: string;
}

export interface ListmonkClientConfig {
  username?: string;
  password?: string;
  apiKey?: string;
  timeoutMs?: number;
  debug?: boolean;
}

export interface ApiResponseData<T = unknown> {
  success: boolean;
  code: number;
  message: string;
  data: T | null;
  errors: Record<string, string>;
}

export class ApiResponse<T = unknown> implements ApiResponseData<T> {
  success = false;
  code = 500;
  message = "Unknown error";
  data: T | null = null;
  errors: Record<string, string> = {};

  constructor(response: Partial<ApiResponseData<T>> = {}) {
    this.success = response.success ?? false;
    this.code = response.code ?? 500;
    this.message = response.message ?? "Unknown error";
    this.data = response.data ?? null;
    this.errors = response.errors ?? {};
  }

  static ok<T>(
    data: T,
    overrides: Partial<Omit<ApiResponseData<T>, "data">> = {},
  ): ApiResponse<T> {
    return new ApiResponse<T>({
      success: true,
      code: overrides.code ?? 200,
      message: overrides.message ?? "OK",
      data,
      errors: overrides.errors ?? {},
    });
  }

  static error<T>(
    messageOrError: unknown,
    overrides: Partial<Omit<ApiResponseData<T>, "data">> = {},
  ): ApiResponse<T> {
    const message =
      messageOrError instanceof Error
        ? messageOrError.message
        : typeof messageOrError === "string"
          ? messageOrError
          : "Error";
    return new ApiResponse<T>({
      success: false,
      code: overrides.code ?? 500,
      message: message || overrides.message || "Error",
      data: null,
      errors: overrides.errors ?? {},
    });
  }

  isSuccess(): this is ApiResponse<T> & { data: T } {
    return this.success && this.data !== null;
  }
}

export default class ListmonkClient {
  private apiUrl: string;
  private timeoutMs: number;
  private debug: boolean;
  private authHeader?: string;

  constructor(apiUrl: string, config: ListmonkClientConfig = {}) {
    this.apiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.debug = config.debug ?? false;

    if (config.username && config.password) {
      const encoded = Buffer.from(
        `${config.username}:${config.password}`,
      ).toString("base64");
      this.authHeader = `Basic ${encoded}`;
    } else if (config.apiKey) {
      this.authHeader = `Bearer ${config.apiKey}`;
    }
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
        throw ApiResponse.error("Request timed out", { code: 504 });
      }
      throw ApiResponse.error(err, { code: 500 });
    } finally {
      clearTimeout(id);
    }
  }

  private async parseJson<T>(
    res: Response,
  ): Promise<Partial<ApiResponseData<T>>> {
    try {
      return (await res.json()) as Partial<ApiResponseData<T>>;
    } catch (err: unknown) {
      const parseMessage =
        err instanceof Error ? err.message : "Failed to parse JSON response";
      throw ApiResponse.error("Failed to parse JSON response", {
        code: res.status,
        errors: { parse: parseMessage },
      });
    }
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    command: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    const url = `${this.apiUrl}${command}`;
    const init: RequestInit = { method };
    if (body !== undefined) {
      try {
        init.body = JSON.stringify(body);
      } catch (err) {
        return ApiResponse.error(err);
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

      if (res.ok) {
        return ApiResponse.ok(payload.data as T, {
          code: res.status,
          message: payload.message ?? res.statusText,
          errors: payload.errors ?? {},
        });
      }

      return ApiResponse.error(payload.message ?? res.statusText, {
        code: res.status,
        errors: payload.errors ?? {},
      });
    } catch (err: unknown) {
      if (err instanceof ApiResponse) return err;
      return ApiResponse.error(err);
    }
  }

  async get<T>(command: string): Promise<ApiResponse<T>> {
    return this.request<T>("GET", command);
  }

  async post<T>(
    command: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>("POST", command, body);
  }

  async put<T>(
    command: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>("PUT", command, body);
  }

  async delete<T>(
    command: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>("DELETE", command, body);
  }

  async deleteSubscriber(id: number): Promise<ApiResponse<boolean>> {
    return this.delete<boolean>(`/subscribers/${id}`);
  }

  async deleteSubscribers(ids: number[]): Promise<ApiResponse<boolean>> {
    if (ids.length === 0) {
      return ApiResponse.error("No subscriber ids provided", { code: 400 });
    }
    const params = new URLSearchParams();
    ids.forEach((id) => params.append("id", String(id)));
    return this.delete<boolean>(`/subscribers?${params.toString()}`);
  }

  async subscribe(
    listId: number,
    email: string,
    name: string = "",
    attribs: SubscriberAttribs = {},
    options: SubscribeOptions = {},
  ): Promise<ApiResponse<Subscriber>> {
    const lists: number[] = options.listUuid ? [] : [listId];
    const listUuids: string[] = options.listUuid ? [options.listUuid] : [];

    const body = {
      email,
      name,
      attribs,
      lists,
      list_uuids: listUuids,
      preconfirm_subscriptions: options.preconfirm ?? true,
      ...(options.status ? { status: options.status } : {}),
    };

    return this.post<Subscriber>("/subscribers", body);
  }

  async listMembersByStatus(
    listId: number,
    status: ListMemberStatus,
    pagination: { page?: number; perPage?: number } = {},
  ): Promise<ApiResponse<SubscriberPage>> {
    const params = new URLSearchParams();
    params.set("list_id", String(listId));

    if (pagination.page !== undefined) {
      params.set("page", String(pagination.page));
    }
    if (pagination.perPage !== undefined) {
      params.set("per_page", String(pagination.perPage));
    }

    const translated = this.translateStatus(status);
    if (translated.subscriptionStatus) {
      params.set("subscription_status", translated.subscriptionStatus);
    }
    if (translated.query) {
      params.set("query", translated.query);
    }

    const queryString = params.toString();
    const path = queryString ? `/subscribers?${queryString}` : "/subscribers";

    return this.get<SubscriberPage>(path);
  }

  async addSubscribersToList(
    listId: number,
    entries: BulkSubscriberInput[],
  ): Promise<ApiResponse<BulkAddResult>> {
    if (entries.length === 0) {
      return ApiResponse.ok(
        {
          created: [],
          added: [],
          skippedBlocked: [],
          skippedUnsubscribed: [],
        },
        { message: "No entries to process" },
      );
    }

    const deduped = new Map(
      entries.map((e) => [e.email.toLowerCase(), e]),
    ) as Map<string, BulkSubscriberInput>;
    const emails = Array.from(deduped.keys());

    const existingSubs = new Map<string, Subscriber>();
    const lookupChunkSize = 2500;
    for (let i = 0; i < emails.length; i += lookupChunkSize) {
      const chunk = emails.slice(i, i + lookupChunkSize);
      const inList = chunk.map((e) => `'${e.replace(/'/g, "''")}'`).join(",");
      const query = encodeURIComponent(`email IN (${inList})`);
      const perPage = Math.max(chunk.length, 50);
      const res = await this.get<SubscriberPage>(
        `/subscribers?per_page=${perPage}&query=${query}`,
      );
      if (res.success && res.data) {
        res.data.results.forEach((s) => {
          existingSubs.set(s.email.toLowerCase(), s);
        });
      } else if (this.debug) {
        console.warn("Lookup failed for chunk", res.code, res.message);
      }
    }

    const created: Subscriber[] = [];
    const added: Subscriber[] = [];
    const skippedBlocked: string[] = [];
    const skippedUnsubscribed: string[] = [];
    const addIds: number[] = [];

    for (const [email, entry] of deduped.entries()) {
      const existing = existingSubs.get(email);
      if (!existing) {
        const createRes = await this.subscribe(
          listId,
          entry.email,
          entry.name ?? "",
          entry.attribs ?? {},
          { preconfirm: true, status: "enabled" },
        );
        if (createRes.success && createRes.data) {
          created.push(createRes.data);
        }
        continue;
      }

      if (existing.status === "blocklisted") {
        skippedBlocked.push(existing.email);
        continue;
      }

      const listInfo = existing.lists?.find((l) => l.id === listId);
      if (listInfo?.subscription_status === "unsubscribed") {
        skippedUnsubscribed.push(existing.email);
        continue;
      }

      if (listInfo && listInfo.subscription_status !== "unsubscribed") {
        // Already on the list in a good state
        added.push(existing);
        continue;
      }

      addIds.push(existing.id);
      added.push(existing);
    }

    if (addIds.length > 0) {
      const addChunkSize = 2500;
      for (let i = 0; i < addIds.length; i += addChunkSize) {
        const chunk = addIds.slice(i, i + addChunkSize);
        await this.put(`/subscribers/lists/${listId}`, {
          ids: chunk,
          action: "add",
        });
      }
    }

    return ApiResponse.ok({
      created,
      added,
      skippedBlocked,
      skippedUnsubscribed,
    });
  }

  private translateStatus(status: ListMemberStatus): {
    subscriptionStatus?: string;
    query?: string;
  } {
    switch (status) {
      case "subscribed":
        return { subscriptionStatus: "confirmed" };
      case "unsubscribed":
      case "unsubbed":
        return { subscriptionStatus: "unsubscribed" };
      case "blocked":
        return { query: "subscribers.status = 'blocklisted'" };
      default:
        return {};
    }
  }
}
