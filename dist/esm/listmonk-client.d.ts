type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
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
export type ListMemberStatus = "subscribed" | "unsubscribed" | "unsubbed" | "blocked";
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
export declare class ApiResponse<T = unknown> implements ApiResponseData<T> {
    success: boolean;
    code: number;
    message: string;
    data: T | null;
    errors: Record<string, string>;
    constructor(response?: Partial<ApiResponseData<T>>);
    static ok<T>(data: T, overrides?: Partial<Omit<ApiResponseData<T>, "data">>): ApiResponse<T>;
    static error<T>(messageOrError: unknown, overrides?: Partial<Omit<ApiResponseData<T>, "data">>): ApiResponse<T>;
    isSuccess(): this is ApiResponse<T> & {
        data: T;
    };
}
export default class ListmonkClient {
    private apiUrl;
    private timeoutMs;
    private debug;
    private authHeader?;
    constructor(apiUrl: string, config?: ListmonkClientConfig);
    private buildHeaders;
    private safeFetch;
    private parseJson;
    private request;
    get<T>(command: string): Promise<ApiResponse<T>>;
    post<T>(command: string, body?: Record<string, unknown>): Promise<ApiResponse<T>>;
    put<T>(command: string, body?: Record<string, unknown>): Promise<ApiResponse<T>>;
    delete<T>(command: string, body?: Record<string, unknown>): Promise<ApiResponse<T>>;
    deleteSubscriber(id: number): Promise<ApiResponse<boolean>>;
    deleteSubscribers(ids: number[]): Promise<ApiResponse<boolean>>;
    subscribe(listId: number, email: string, name?: string, attribs?: SubscriberAttribs, options?: SubscribeOptions): Promise<ApiResponse<Subscriber>>;
    listMembersByStatus(listId: number, status: ListMemberStatus, pagination?: {
        page?: number;
        perPage?: number;
    }): Promise<ApiResponse<SubscriberPage>>;
    addSubscribersToList(listId: number, entries: BulkSubscriberInput[]): Promise<ApiResponse<BulkAddResult>>;
    private translateStatus;
}
export {};
