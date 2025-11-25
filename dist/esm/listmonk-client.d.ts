/**
 * API interface quick reference
 * - `LMCConfig`: configure authentication and timeouts.
 *   - `apiURL` (string, required): base API URL.
 *   - `user` (string, required): Basic auth username.
 *   - `token` (string, required): Basic auth token/password.
 *   - `timeoutMS` (number, optional): request timeout in ms (default 15000).
 *   - `debug` (boolean, optional): log fetch details.
 *   - `listPageSize` (number, optional): default `per_page` for paging.
 *
 * - `LMCResponseData<T>`: response envelope for client methods.
 *   - `success` (boolean, required): call succeeded flag.
 *   - `code` (number, required): HTTP status code.
 *   - `message` (string, required): status detail.
 *   - `data` (T | null, required): typed payload or null.
 *
 * - `LMCSubscriberAttribs`: arbitrary JSON-safe attributes for a subscriber.
 *
 * - `LMCSubscriptionStatus`: allowed subscription statuses for subscribe requests.
 *   - `"enabled" | "disabled" | "blocklisted" | "unconfirmed" | "bounced"`.
 *
 * - `LMCSubscribeOptions`: tune subscription behavior.
 *   - `preconfirm` (boolean, optional): preconfirm subscriptions (default true).
 *   - `status` (LMCSubscriptionStatus, optional): override subscriber status.
 *
 * - `LMCListMemberStatus`: filter used when listing members.
 *   - `"subscribed" | "unsubscribed" | "blocked"`.
 *
 * - `LMCSubscription`: minimal list membership summary.
 *   - `id` (number, required): list id.
 *   - `subscription_status` (string, optional): status on the list.
 *
 * - `LMCListRecord`: full list record returned by list endpoints.
 *   - `id` (number, required): list id.
 *   - `uuid` (string, optional): list UUID.
 *   - `name` (string, optional): list name.
 *   - `type` (string, optional): list type (e.g., public/opt-in).
 *   - `tags` (string[], optional): list tags.
 *   - `created_at` (string, optional): created timestamp.
 *   - `updated_at` (string, optional): updated timestamp.
 *   - `subscription_status` (string, optional): status when merged with a subscriber.
 *
 * - `LMCSubscriber`: subscriber record.
 *   - `id` (number, required): subscriber id.
 *   - `uuid` (string, required): subscriber UUID.
 *   - `email` (string, required): subscriber email.
 *   - `name` (string, required): subscriber name.
 *   - `attribs` (LMCSubscriberAttribs, required): custom attributes.
 *   - `status` (string, required): global subscriber status.
 *   - `lists` (array, optional): `LMCSubscription` or `LMCListRecord` entries.
 *   - `created_at` (string, optional): created timestamp.
 *   - `updated_at` (string, optional): updated timestamp.
 *
 * - `LMCSubscriberPage`: paginated subscriber results.
 *   - `results` (LMCSubscriber[], required): page of subscribers.
 *   - `total` (number, required): total matches for the query.
 *   - `per_page` (number, required): page size.
 *   - `page` (number, required): current page number.
 *   - `query` (string, optional): applied filter.
 *
 * - `LMCBulkSubscription`: shape of bulk-add entries.
 *   - `email` (string, required): subscriber email.
 *   - `name` (string, optional): subscriber name.
 *   - `uid` (string, optional): caller-defined unique id.
 *   - `attribs` (LMCSubscriberAttribs, optional): custom attributes; `uid` is mirrored when present.
 *
 * - `LMCSubscriptionSnapshot`: membership snapshot for a processed email.
 *   - `email` (string, required): processed email.
 *   - `lists` (LMCSubscription[], optional): memberships observed.
 *
 * - `LMCBulkAddResult`: outcome of `addSubscribersToList`.
 *   - `created` (LMCSubscriber[], required): newly created subscribers.
 *   - `added` (LMCSubscriber[], required): existing subscribers attached.
 *   - `skippedBlocked` (string[], required): emails skipped due to blocklist.
 *   - `skippedUnsubscribed` (string[], required): emails skipped due to unsubscribed status.
 *   - `memberships` (LMCSubscriptionSnapshot[], optional): membership snapshots.
 */
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
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
export type LMCSubscriberAttribs = Record<string, JsonValue>;
export type LMCSubscriptionStatus = "enabled" | "disabled" | "blocklisted" | "unconfirmed" | "bounced";
export interface LMCSubscribeOptions {
    preconfirm?: boolean;
    status?: LMCSubscriptionStatus;
}
export type LMCListMemberStatus = "subscribed" | "unsubscribed" | "blocked";
export interface LMCSubscription {
    id: number;
    subscription_status?: string;
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
}
export declare class LMCResponse<T = unknown> implements LMCResponseData<T> {
    success: boolean;
    code: number;
    message: string;
    data: T | null;
    constructor(response?: Partial<LMCResponseData<T>>);
    static ok<T>(data: T | null, overrides?: Partial<LMCResponseData<T>>): LMCResponse<T>;
    static error<T>(messageOrError: unknown, overrides?: Partial<LMCResponseData<T>>): LMCResponse<T>;
    isSuccess(): this is LMCResponse<T> & {
        data: T;
    };
}
export default class ListMonkClient {
    private apiUrl;
    private timeoutMs;
    private debug;
    private listPageSize;
    private authHeader?;
    constructor(config: LMCConfig);
    private buildHeaders;
    private safeFetch;
    private parseJson;
    private request;
    get<T>(command: string): Promise<LMCResponse<T>>;
    post<T>(command: string, body?: Record<string, unknown>): Promise<LMCResponse<T>>;
    put<T>(command: string, body?: Record<string, unknown>): Promise<LMCResponse<T>>;
    delete<T>(command: string, body?: Record<string, unknown>): Promise<LMCResponse<T>>;
    deleteSubscriber(id: number): Promise<LMCResponse<boolean>>;
    deleteSubscribers(ids: number[]): Promise<LMCResponse<boolean>>;
    subscribe(input: {
        listId: number;
        email: string;
        name?: string;
        attribs?: LMCSubscriberAttribs;
    }, options?: LMCSubscribeOptions): Promise<LMCResponse<LMCSubscriber>>;
    listMembersByStatus(listId: number, status: LMCListMemberStatus, pagination?: {
        page?: number;
        perPage?: number;
    }): Promise<LMCResponse<LMCSubscriberPage>>;
    addSubscribersToList(listId: number, entries: LMCBulkSubscription[], options?: {
        attachToList?: boolean;
    }): Promise<LMCResponse<LMCBulkAddResult>>;
    changeEmail(currentEmail: string, newEmail: string): Promise<LMCResponse<LMCSubscriber>>;
    private findSubscriberByEmail;
    private translateStatus;
}
export {};
