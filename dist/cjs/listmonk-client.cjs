"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiResponse = void 0;
/**
 * Minimal Listmonk API client with Basic auth and helper methods.
 * Borrowed the ApiResponse wrapper pattern from api-client-base, but removed tokens/retries.
 */
const node_buffer_1 = require("node:buffer");
class ApiResponse {
    constructor(response = {}) {
        this.success = false;
        this.code = 500;
        this.message = "Unknown error";
        this.data = null;
        this.errors = {};
        this.success = response.success ?? false;
        this.code = response.code ?? 500;
        this.message = response.message ?? "Unknown error";
        this.data = response.data ?? null;
        this.errors = response.errors ?? {};
    }
    static ok(data, overrides = {}) {
        return new ApiResponse({
            success: true,
            code: overrides.code ?? 200,
            message: overrides.message ?? "OK",
            data,
            errors: overrides.errors ?? {},
        });
    }
    static error(messageOrError, overrides = {}) {
        const message = messageOrError instanceof Error
            ? messageOrError.message
            : typeof messageOrError === "string"
                ? messageOrError
                : "Error";
        return new ApiResponse({
            success: false,
            code: overrides.code ?? 500,
            message: message || overrides.message || "Error",
            data: null,
            errors: overrides.errors ?? {},
        });
    }
    isSuccess() {
        return this.success && this.data !== null;
    }
}
exports.ApiResponse = ApiResponse;
class ListmonkClient {
    constructor(apiUrl, config = {}) {
        this.apiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
        this.timeoutMs = config.timeoutMs ?? 15000;
        this.debug = config.debug ?? false;
        if (config.username && config.password) {
            const encoded = node_buffer_1.Buffer.from(`${config.username}:${config.password}`).toString("base64");
            this.authHeader = `Basic ${encoded}`;
        }
        else if (config.apiKey) {
            this.authHeader = `Bearer ${config.apiKey}`;
        }
    }
    buildHeaders(initHeaders) {
        const headers = new Headers(initHeaders);
        if (this.authHeader) {
            headers.set("Authorization", this.authHeader);
        }
        return headers;
    }
    async safeFetch(input, init = {}) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeoutMs);
        const method = (init.method ?? "GET").toUpperCase();
        const headers = this.buildHeaders(init.headers);
        if (method !== "GET" &&
            !headers.has("Content-Type") &&
            !(init.body instanceof FormData)) {
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
        }
        catch (err) {
            if (err.name === "AbortError") {
                throw ApiResponse.error("Request timed out", { code: 504 });
            }
            throw ApiResponse.error(err, { code: 500 });
        }
        finally {
            clearTimeout(id);
        }
    }
    async parseJson(res) {
        try {
            return (await res.json());
        }
        catch (err) {
            const parseMessage = err instanceof Error ? err.message : "Failed to parse JSON response";
            throw ApiResponse.error("Failed to parse JSON response", {
                code: res.status,
                errors: { parse: parseMessage },
            });
        }
    }
    async request(method, command, body) {
        const url = `${this.apiUrl}${command}`;
        const init = { method };
        if (body !== undefined) {
            try {
                init.body = JSON.stringify(body);
            }
            catch (err) {
                return ApiResponse.error(err);
            }
        }
        if (this.debug) {
            console.log(`Making ${method} request to: ${url} (timeout: ${this.timeoutMs}ms)`);
            if (body !== undefined) {
                console.log("Request body:", init.body);
            }
        }
        try {
            const res = await this.safeFetch(url, init);
            const payload = await this.parseJson(res);
            if (res.ok) {
                return ApiResponse.ok(payload.data, {
                    code: res.status,
                    message: payload.message ?? res.statusText,
                    errors: payload.errors ?? {},
                });
            }
            return ApiResponse.error(payload.message ?? res.statusText, {
                code: res.status,
                errors: payload.errors ?? {},
            });
        }
        catch (err) {
            if (err instanceof ApiResponse)
                return err;
            return ApiResponse.error(err);
        }
    }
    async get(command) {
        return this.request("GET", command);
    }
    async post(command, body) {
        return this.request("POST", command, body);
    }
    async put(command, body) {
        return this.request("PUT", command, body);
    }
    async delete(command, body) {
        return this.request("DELETE", command, body);
    }
    async deleteSubscriber(id) {
        return this.delete(`/subscribers/${id}`);
    }
    async deleteSubscribers(ids) {
        if (ids.length === 0) {
            return ApiResponse.error("No subscriber ids provided", { code: 400 });
        }
        const params = new URLSearchParams();
        ids.forEach((id) => params.append("id", String(id)));
        return this.delete(`/subscribers?${params.toString()}`);
    }
    async subscribe(listId, email, name = "", attribs = {}, options = {}) {
        const lists = options.listUuid ? [] : [listId];
        const listUuids = options.listUuid ? [options.listUuid] : [];
        const body = {
            email,
            name,
            attribs,
            lists,
            list_uuids: listUuids,
            preconfirm_subscriptions: options.preconfirm ?? true,
            ...(options.status ? { status: options.status } : {}),
        };
        return this.post("/subscribers", body);
    }
    async listMembersByStatus(listId, status, pagination = {}) {
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
        return this.get(path);
    }
    async addSubscribersToList(listId, entries) {
        if (entries.length === 0) {
            return ApiResponse.ok({
                created: [],
                added: [],
                skippedBlocked: [],
                skippedUnsubscribed: [],
            }, { message: "No entries to process" });
        }
        const deduped = new Map(entries.map((e) => [e.email.toLowerCase(), e]));
        const emails = Array.from(deduped.keys());
        const existingSubs = new Map();
        const lookupChunkSize = 2500;
        for (let i = 0; i < emails.length; i += lookupChunkSize) {
            const chunk = emails.slice(i, i + lookupChunkSize);
            const inList = chunk.map((e) => `'${e.replace(/'/g, "''")}'`).join(",");
            const query = encodeURIComponent(`email IN (${inList})`);
            const perPage = Math.max(chunk.length, 50);
            const res = await this.get(`/subscribers?per_page=${perPage}&query=${query}`);
            if (res.success && res.data) {
                res.data.results.forEach((s) => {
                    existingSubs.set(s.email.toLowerCase(), s);
                });
            }
            else if (this.debug) {
                console.warn("Lookup failed for chunk", res.code, res.message);
            }
        }
        const created = [];
        const added = [];
        const skippedBlocked = [];
        const skippedUnsubscribed = [];
        const addIds = [];
        for (const [email, entry] of deduped.entries()) {
            const existing = existingSubs.get(email);
            if (!existing) {
                const createRes = await this.subscribe(listId, entry.email, entry.name ?? "", entry.attribs ?? {}, { preconfirm: true, status: "enabled" });
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
    translateStatus(status) {
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
exports.default = ListmonkClient;
