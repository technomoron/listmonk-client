"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LMCResponse = void 0;
/**
 * Minimal Listmonk API client with Basic/Bearer auth and helper methods.
 * Borrowed the response wrapper pattern from api-client-base, but removed tokens/retries.
 */
const node_buffer_1 = require("node:buffer");
class LMCResponse {
    constructor(response = {}) {
        this.success = false;
        this.code = 500;
        this.message = "Unknown error";
        this.data = null;
        this.success = response.success ?? false;
        this.code = response.code ?? 500;
        this.message = response.message ?? "Unknown error";
        this.data = response.data ?? null;
    }
    static ok(data, overrides = {}) {
        return new LMCResponse({
            success: true,
            code: overrides.code ?? 200,
            message: overrides.message ?? "OK",
            data: overrides.data ?? data,
        });
    }
    static error(messageOrError, overrides = {}) {
        const message = messageOrError instanceof Error
            ? messageOrError.message
            : typeof messageOrError === "string"
                ? messageOrError
                : "Error";
        return new LMCResponse({
            success: false,
            code: overrides.code ?? 500,
            message: overrides.message ?? (message || "Error"),
            data: overrides.data ?? null,
        });
    }
    isSuccess() {
        return this.success && this.data !== null;
    }
}
exports.LMCResponse = LMCResponse;
class ListMonkClient {
    constructor(config) {
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
        this.timeoutMs = config.timeoutMS ?? 15000;
        this.debug = config.debug ?? false;
        this.listPageSize = config.listPageSize ?? 100;
        this.authHeader = `Basic ${node_buffer_1.Buffer.from(`${config.user}:${config.token}`).toString("base64")}`;
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
                throw LMCResponse.error("Request timed out", { code: 504 });
            }
            throw LMCResponse.error(err, { code: 500 });
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
            throw LMCResponse.error("Failed to parse JSON response", {
                code: res.status,
                message: parseMessage,
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
                return LMCResponse.error(err);
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
            const data = payload.data !== undefined
                ? payload.data
                : (payload ?? null);
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
        }
        catch (err) {
            if (err instanceof LMCResponse)
                return err;
            return LMCResponse.error(err);
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
            return LMCResponse.error("No subscriber ids provided", { code: 400 });
        }
        const params = new URLSearchParams();
        ids.forEach((id) => params.append("id", String(id)));
        return this.delete(`/subscribers?${params.toString()}`);
    }
    async subscribe(input, options = {}) {
        const lists = [input.listId];
        const body = {
            email: input.email,
            name: input.name ?? "",
            attribs: input.attribs ?? {},
            lists,
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
        return this.get(path);
    }
    async addSubscribersToList(listId, entries, options = {}) {
        if (entries.length === 0) {
            return LMCResponse.ok({
                created: [],
                added: [],
                skippedBlocked: [],
                skippedUnsubscribed: [],
                memberships: [],
            }, { message: "No entries to process" });
        }
        const normalized = entries.map((entry) => {
            const derivedUid = entry.uid ??
                (typeof entry.attribs?.uid === "string"
                    ? String(entry.attribs.uid)
                    : undefined);
            const attribs = { ...(entry.attribs ?? {}) };
            if (derivedUid)
                attribs.uid = derivedUid;
            return { ...entry, uid: derivedUid, attribs };
        });
        const deduped = new Map();
        normalized.forEach((entry) => {
            const key = entry.uid
                ? `uid:${entry.uid}`
                : `email:${entry.email.toLowerCase()}`;
            deduped.set(key, entry);
        });
        const uids = new Set();
        const emails = new Set();
        deduped.forEach((entry) => {
            if (entry.uid)
                uids.add(entry.uid);
            emails.add(entry.email.toLowerCase());
        });
        const existingByUid = new Map();
        const existingByEmail = new Map();
        const lookupChunkSize = 2500;
        const escapeValue = (value) => value.replace(/'/g, "''");
        const fetchSubscribers = async (values, buildQuery) => {
            for (let i = 0; i < values.length; i += lookupChunkSize) {
                const chunk = values.slice(i, i + lookupChunkSize);
                const query = buildQuery(chunk);
                const perPage = Math.max(chunk.length, 50);
                const res = await this.get(`/subscribers?per_page=${perPage}&query=${query}`);
                if (res.success && res.data) {
                    res.data.results.forEach((s) => {
                        const emailKey = s.email.toLowerCase();
                        existingByEmail.set(emailKey, s);
                        const subUid = typeof s.attribs?.uid === "string" ? String(s.attribs.uid) : null;
                        if (subUid) {
                            existingByUid.set(subUid, s);
                        }
                    });
                }
                else if (this.debug) {
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
        const created = [];
        const added = [];
        const skippedBlocked = [];
        const skippedUnsubscribed = [];
        const addIds = [];
        const memberships = [];
        const attachToList = options.attachToList ?? true;
        for (const entry of deduped.values()) {
            const emailKey = entry.email.toLowerCase();
            const entryAttribs = { ...(entry.attribs ?? {}) };
            if (entry.uid)
                entryAttribs.uid = entry.uid;
            let existing = entry.uid !== undefined
                ? (existingByUid.get(entry.uid) ?? existingByEmail.get(emailKey))
                : existingByEmail.get(emailKey);
            if (!existing) {
                const createRes = attachToList
                    ? await this.subscribe({
                        listId,
                        email: entry.email,
                        name: entry.name ?? "",
                        attribs: entryAttribs,
                    }, { preconfirm: true, status: "enabled" })
                    : await this.post("/subscribers", {
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
                const updateRes = await this.put(`/subscribers/${existing.id}`, {
                    email: entry.email,
                    name: entry.name ?? existing.name,
                    attribs: entryAttribs,
                });
                if (!updateRes.success || !updateRes.data) {
                    return LMCResponse.error(updateRes.message || "Failed to update subscriber email", { code: updateRes.code });
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
    async changeEmail(currentEmail, newEmail) {
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
        const updateRes = await this.put(`/subscribers/${subscriber.data.id}`, {
            email: trimmedNew,
            name: subscriber.data.name,
            attribs: subscriber.data.attribs,
        });
        if (!updateRes.success)
            return updateRes;
        return updateRes;
    }
    async findSubscriberByEmail(email) {
        const escape = (value) => value.replace(/'/g, "''");
        const query = encodeURIComponent(`email = '${escape(email)}'`);
        const res = await this.get(`/subscribers?per_page=1&query=${query}`);
        if (res.success && res.data && res.data.results.length > 0) {
            return LMCResponse.ok(res.data.results[0], {
                code: res.code,
                message: res.message,
            });
        }
        return LMCResponse.error("Subscriber not found", { code: 404 });
    }
    translateStatus(status) {
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
exports.default = ListMonkClient;
