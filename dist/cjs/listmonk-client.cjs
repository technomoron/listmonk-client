"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LMCResponse = void 0;
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
            return JSON.parse(text);
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
    async listAllLists(visibility = "all") {
        const params = new URLSearchParams();
        params.set("per_page", "all");
        if (visibility !== "all") {
            params.set("type", visibility);
        }
        const res = await this.get(`/lists?${params.toString()}`);
        if (!res.success) {
            return res;
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
    async subscribe(listId, input, options = {}) {
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
        const lists = [listId];
        const existing = await this.findSubscriber({ email });
        if (existing.success && existing.data) {
            const subscriber = existing.data;
            const membership = subscriber.lists?.find((l) => l.id === listId);
            const membershipStatus = membership?.subscription_status;
            if (subscriber.status === "blocklisted") {
                return LMCResponse.error("Failed to subscribe: subscriber is blocklisted", { code: 400 });
            }
            if (membershipStatus && membershipStatus !== "unsubscribed") {
                return LMCResponse.ok({
                    subscriber,
                    added: false,
                    alreadySubscribed: true,
                    created: false,
                }, { code: existing.code, message: "Already subscribed" });
            }
            const attachRes = membershipStatus === "unsubscribed"
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
            const refreshed = await this.get(`/subscribers/${subscriber.id}`);
            const updatedSubscriber = refreshed.success && refreshed.data ? refreshed.data : subscriber;
            return LMCResponse.ok({
                subscriber: updatedSubscriber,
                added: true,
                alreadySubscribed: false,
                created: false,
            }, {
                code: refreshed.success ? refreshed.code : attachRes.code,
                message: "Successfully subscribed",
            });
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
        const createRes = await this.post("/subscribers", body);
        if (!createRes.success || !createRes.data) {
            return LMCResponse.error(`Failed to subscribe: ${createRes.message}`, {
                code: createRes.code,
            });
        }
        return LMCResponse.ok({
            subscriber: createRes.data,
            added: true,
            alreadySubscribed: false,
            created: true,
        }, { code: createRes.code, message: "Successfully subscribed" });
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
        const resubscribeIds = [];
        const memberships = [];
        const errors = [];
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
                if (attachToList) {
                    const createRes = await this.subscribe(listId, {
                        email: entry.email,
                        name: entry.name ?? "",
                        attribs: entryAttribs,
                    }, { preconfirm: true, status: "enabled" });
                    const subscribeData = createRes.data;
                    if (createRes.success && subscribeData?.subscriber) {
                        if (subscribeData.created) {
                            created.push(subscribeData.subscriber);
                        }
                        else {
                            added.push(subscribeData.subscriber);
                        }
                        memberships.push({
                            email: entry.email,
                            lists: subscribeData.subscriber.lists,
                        });
                    }
                    else {
                        errors.push({
                            email: entry.email,
                            message: createRes.message,
                            code: createRes.code,
                        });
                    }
                }
                else {
                    const createRes = await this.post("/subscribers", {
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
                    else {
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
            const membershipStatus = listInfo?.subscription_status;
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
                }
                else {
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
        return LMCResponse.ok({
            created,
            added,
            skippedBlocked,
            skippedUnsubscribed,
            memberships,
            errors,
        }, { message: "Successfully added subscribers" });
    }
    async syncUsersToList(listId, users) {
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
        const normalized = users.map((user) => ({
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
        const deduped = new Map();
        normalized.forEach((user) => {
            deduped.set(user.uid, user);
        });
        const uids = Array.from(deduped.keys());
        const emails = new Set();
        deduped.forEach((user) => emails.add(user.email.toLowerCase()));
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
        const counts = {
            blocked: 0,
            unsubscribed: 0,
            added: 0,
            updated: 0,
        };
        const addIds = [];
        const resubscribeIds = [];
        for (const entry of deduped.values()) {
            const emailKey = entry.email.toLowerCase();
            let existing = existingByUid.get(entry.uid) ?? existingByEmail.get(emailKey);
            if (!existing) {
                const attribs = { ...(entry.attribs ?? {}) };
                attribs.uid = entry.uid;
                const createRes = await this.subscribe(listId, {
                    email: entry.email,
                    name: entry.name ?? "",
                    attribs,
                }, { preconfirm: true, status: "enabled" });
                if (!createRes.success || !createRes.data?.subscriber) {
                    return createRes;
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
            const membershipStatus = listInfo?.subscription_status;
            const isUnsubscribed = membershipStatus === "unsubscribed";
            if (isUnsubscribed) {
                counts.unsubscribed += 1;
            }
            const targetAttribs = {
                ...(existing.attribs ?? {}),
                ...(entry.attribs ?? {}),
            };
            targetAttribs.uid = entry.uid;
            const targetEmail = entry.email;
            const targetName = entry.name ?? existing.name ?? "";
            const needsEmailUpdate = existing.email.toLowerCase() !== targetEmail.toLowerCase();
            const needsNameUpdate = (existing.name ?? "") !== targetName;
            const needsAttribUpdate = !this.areAttribsEqual(existing.attribs, targetAttribs);
            if (needsEmailUpdate || needsNameUpdate || needsAttribUpdate) {
                const updateRes = await this.put(`/subscribers/${existing.id}`, {
                    email: targetEmail,
                    name: targetName,
                    attribs: targetAttribs,
                });
                if (!updateRes.success || !updateRes.data) {
                    return updateRes;
                }
                existing = updateRes.data;
                counts.updated += 1;
            }
            const listEntry = existing.lists?.find((l) => l.id === listId);
            const onList = listEntry &&
                listEntry.subscription_status !== "unsubscribed";
            if (!onList || isUnsubscribed) {
                if (isUnsubscribed) {
                    resubscribeIds.push(existing.id);
                }
                else {
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
                    return res;
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
                    return res;
                }
            }
        }
        return LMCResponse.ok(counts);
    }
    async updateUser(identifier, updates, options = {}) {
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
        const nextAttribs = {
            ...(existing.attribs ?? {}),
            ...(updates.attribs ?? {}),
        };
        if (updates.uid !== undefined &&
            existing.attribs?.uid !== undefined &&
            updates.uid !== existing.attribs.uid &&
            !options.forceUidChange) {
            return LMCResponse.error("UID mismatch; set forceUidChange to overwrite existing uid", { code: 400 });
        }
        if (updates.uid !== undefined) {
            nextAttribs.uid = updates.uid;
        }
        else if (existing.attribs?.uid !== undefined &&
            nextAttribs.uid === undefined) {
            nextAttribs.uid = existing.attribs.uid;
        }
        const nextEmail = updates.email?.trim() ?? existing.email;
        if (!nextEmail) {
            return LMCResponse.error("Email is required", { code: 400 });
        }
        const nextName = updates.name !== undefined ? updates.name : (existing.name ?? "");
        const currentLists = existing.lists
            ?.map((l) => l.id)
            .filter((id) => Number.isFinite(id));
        return this.put(`/subscribers/${existing.id}`, {
            email: nextEmail,
            name: nextName,
            attribs: nextAttribs,
            ...(currentLists && currentLists.length > 0
                ? { lists: currentLists }
                : {}),
        });
    }
    async findSubscriber(identifier) {
        if (identifier.id !== undefined) {
            const res = await this.get(`/subscribers/${identifier.id}`);
            if (res.success && res.data)
                return res;
            if (res.success) {
                return LMCResponse.error("Subscriber not found", { code: 404 });
            }
            return res;
        }
        const params = new URLSearchParams();
        params.set("per_page", "1");
        if (identifier.uuid) {
            params.set("query", this.buildEqualityQuery("uuid", identifier.uuid));
        }
        else if (identifier.email) {
            params.set("query", this.buildEqualityQuery("email", identifier.email));
        }
        else {
            return LMCResponse.error("id, uuid, or email is required", {
                code: 400,
            });
        }
        const res = await this.get(`/subscribers?${params.toString()}`);
        if (res.success && res.data && res.data.results.length > 0) {
            return LMCResponse.ok(res.data.results[0], {
                code: res.code,
                message: res.message,
            });
        }
        if (res.success) {
            return LMCResponse.error("Subscriber not found", { code: 404 });
        }
        return res;
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
    areAttribsEqual(a, b) {
        return this.stableStringify(a ?? {}) === this.stableStringify(b ?? {});
    }
    stableStringify(value) {
        if (value === null || typeof value !== "object") {
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            return `[${value.map((v) => this.stableStringify(v)).join(",")}]`;
        }
        const entries = Object.entries(value).sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
        return `{${entries
            .map(([key, val]) => `${JSON.stringify(key)}:${this.stableStringify(val)}`)
            .join(",")}}`;
    }
    buildEqualityQuery(field, value) {
        const escaped = value.replace(/'/g, "''");
        return `${field} = '${escaped}'`;
    }
}
exports.default = ListMonkClient;
