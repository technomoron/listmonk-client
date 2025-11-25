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
 * - `LMCBulkSubscription`: shape of bulk-add entries.
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
type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
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
export type LMCSubscriptionStatus = "enabled" | "disabled" | "blocklisted" | "unconfirmed" | "bounced";
export interface LMCSubscribeOptions {
    preconfirm?: boolean;
    status?: LMCSubscriptionStatus;
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
    subscribe(listId: number, email: string, name?: string, attribs?: LMCSubscriberAttribs, options?: LMCSubscribeOptions): Promise<LMCResponse<LMCSubscriber>>;
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
