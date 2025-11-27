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
    listCacheSeconds?: number;
}
export interface LMCResponseData<T = unknown> {
    success: boolean;
    code: number;
    message: string;
    data: T | null;
}
export type LMCSubscriberAttribs = Record<string, JsonValue>;
export type LMCSubscriptionStatus = "enabled" | "disabled" | "blocklisted" | "unconfirmed" | "bounced" | "unsubscribed";
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
export type LMCSetSubscriptionsStatus = "Subscribed" | "Unsubscribed" | "Unchanged" | "Unknown List";
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
    private listCacheSeconds?;
    private listCache?;
    private authHeader?;
    constructor(config: LMCConfig);
    private static encodeBase64;
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
    getSubscriberById(id: number): Promise<LMCResponse<LMCSubscriber>>;
    getSubscriberByUuid(uuid: string): Promise<LMCResponse<LMCSubscriber>>;
    getSubscriberByEmail(email: string): Promise<LMCResponse<LMCSubscriber>>;
    getSubscriber(identifier: {
        id?: number;
        uuid?: string;
        email?: string;
    }): Promise<LMCResponse<LMCSubscriber>>;
    blockSubscriber(id: number): Promise<LMCResponse<LMCSubscriber>>;
    unblockSubscriber(id: number): Promise<LMCResponse<LMCSubscriber>>;
    unsubscribe(identifier: {
        id?: number;
        uuid?: string;
        email?: string;
    }, lists?: number | number[]): Promise<LMCResponse<LMCUnsubscribeResult>>;
    setSubscriptions(identifier: {
        id?: number;
        uuid?: string;
        email?: string;
    }, listIds: number[], options?: LMCSetSubscriptionsOptions): Promise<LMCResponse<LMCSetSubscriptionsResult>>;
    listAllLists(visibility?: LMCListVisibility | "all"): Promise<LMCResponse<LMCListRecord[]>>;
    subscribe(listId: number, input: {
        email: string;
        name?: string;
        attribs?: LMCSubscriberAttribs;
    }, options?: LMCSubscribeOptions): Promise<LMCResponse<LMCSubscribeResult>>;
    listMembersByStatus(listId: number, status: LMCListMemberStatus, pagination?: {
        page?: number;
        perPage?: number;
    }): Promise<LMCResponse<LMCSubscriberPage>>;
    addSubscribersToList(listId: number, entries: LMCBulkSubscription[], options?: {
        attachToList?: boolean;
    }): Promise<LMCResponse<LMCBulkAddResult>>;
    syncUsersToList(listId: number, users: LMCUser[]): Promise<LMCResponse<LMCSyncUsersResult>>;
    updateUser(identifier: {
        id?: number;
        uuid?: string;
        email?: string;
    }, updates: Partial<LMCUser>, options?: {
        forceUidChange?: boolean;
    }): Promise<LMCResponse<LMCSubscriber>>;
    private findSubscriber;
    private translateStatus;
    private areAttribsEqual;
    private stableStringify;
    private buildEqualityQuery;
    private getListNameMap;
    private describeListStatus;
}
export {};
