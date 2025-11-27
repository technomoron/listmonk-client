import ListMonkClient, {
  ListMonkClient as NamedListMonkClient,
} from "../src/index.js";

import type { LMCSubscriber } from "../src/index.js";

const baseConfig = {
  apiURL: "https://example.com/api",
  user: "user",
  token: "token",
  timeoutMS: 50,
};

const nodeBtoa = (value: string) =>
  Buffer.from(value, "binary").toString("base64");

const makeJsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });

const queueFetch = (responses: Array<Response | (() => Response)>) => {
  const queue = [...responses];
  const mock = vi.fn(async () => {
    if (queue.length === 0) {
      throw new Error("Fetch queue exhausted");
    }
    const next = queue.shift() as Response | (() => Response);
    return typeof next === "function" ? (next as () => Response)() : next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
};

describe("ListMonkClient", () => {
  beforeEach(() => {
    vi.stubGlobal("btoa", nodeBtoa);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed via default and named export", () => {
    expect(ListMonkClient).toBe(NamedListMonkClient);
    const client = new ListMonkClient(baseConfig);
    expect(client).toBeInstanceOf(ListMonkClient);
  });

  it("throws when btoa is not available", () => {
    vi.restoreAllMocks();
    vi.stubGlobal("btoa", undefined as unknown as (data: string) => string);
    expect(() => new ListMonkClient(baseConfig)).toThrow(
      "btoa is not available in this runtime",
    );
  });

  it("returns null data on empty 204 responses", async () => {
    const client = new ListMonkClient(baseConfig);
    const fetchMock = queueFetch([
      new Response(null, { status: 204, statusText: "No Content" }),
    ]);

    const res = await client.get("/noop");

    expect(res.success).toBe(true);
    expect(res.data).toBeNull();
    expect(res.code).toBe(204);
    expect(res.message).toBe("No Content");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("re-subscribes previously unsubscribed subscribers", async () => {
    const listId = 123;
    const existing: LMCSubscriber = {
      id: 1,
      uuid: "uuid-1",
      email: "unsub@example.com",
      name: "Unsub User",
      attribs: {},
      status: "enabled",
      lists: [{ id: listId, subscription_status: "unsubscribed" }],
    };
    const refreshed = {
      ...existing,
      lists: [{ id: listId, subscription_status: "confirmed" }],
    };

    const client = new ListMonkClient(baseConfig);
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
      makeJsonResponse({ data: true }),
      makeJsonResponse({ data: refreshed }),
    ]);

    const res = await client.subscribe(listId, { email: existing.email });

    expect(res.success).toBe(true);
    expect(res.message).toBe("Successfully subscribed");
    expect(res.data?.added).toBe(true);
    expect(res.data?.created).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const attachCall = fetchMock.mock.calls[1];
    expect(attachCall[0]).toBe(`${baseConfig.apiURL}/subscribers/lists`);
    const attachBody = JSON.parse((attachCall[1]?.body as string) ?? "{}");
    expect(attachBody).toEqual({
      ids: [existing.id],
      action: "add",
      target_list_ids: [listId],
    });
  });

  it("unsubscribes a subscriber from all lists by default", async () => {
    const existing: LMCSubscriber = {
      id: 200,
      uuid: "uuid-200",
      email: "all-unsub@example.com",
      name: "All Unsub",
      attribs: { uid: "uid-200" },
      status: "enabled",
      lists: [{ id: 5, name: "All Lists" }],
    };

    const client = new ListMonkClient(baseConfig);
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
      makeJsonResponse({ data: true }),
    ]);

    const res = await client.unsubscribe({ email: existing.email });

    expect(res.success).toBe(true);
    expect(res.data?.lists).toEqual([
      {
        listId: 5,
        listName: "All Lists",
        statusChanged: true,
        message: "Subscribed",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const call = fetchMock.mock.calls[1];
    expect(call[0]).toBe(`${baseConfig.apiURL}/subscribers/lists`);
    const body = JSON.parse((call[1]?.body as string) ?? "{}");
    expect(body).toEqual({ ids: [existing.id], action: "unsubscribe" });
  });

  it("unsubscribes a subscriber from specific lists when provided", async () => {
    const listIds = [10, 20];
    const existing: LMCSubscriber = {
      id: 201,
      uuid: "uuid-201",
      email: "list-unsub@example.com",
      name: "List Unsub",
      attribs: { uid: "uid-201" },
      status: "enabled",
    };

    const client = new ListMonkClient({ ...baseConfig, listCacheSeconds: 60 });
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
      makeJsonResponse({
        data: listIds.map((id) => ({ id, name: `List ${id}` })),
      }),
      makeJsonResponse({ data: true }),
    ]);

    const res = await client.unsubscribe({ email: existing.email }, listIds);

    expect(res.success).toBe(true);
    expect(res.data?.lists).toEqual([
      {
        listId: 10,
        listName: "List 10",
        statusChanged: false,
        message: "Unsubscribed",
      },
      {
        listId: 20,
        listName: "List 20",
        statusChanged: false,
        message: "Unsubscribed",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const call = fetchMock.mock.calls[2];
    expect(call[0]).toBe(`${baseConfig.apiURL}/subscribers/lists`);
    const body = JSON.parse((call[1]?.body as string) ?? "{}");
    expect(body).toEqual({
      ids: [existing.id],
      action: "unsubscribe",
      target_list_ids: listIds,
    });
  });

  it("includes list names when cache is enabled", async () => {
    const listId = 42;
    const existing: LMCSubscriber = {
      id: 202,
      uuid: "uuid-202",
      email: "cache-unsub@example.com",
      name: "Cache Unsub",
      attribs: { uid: "uid-202" },
      status: "enabled",
      lists: [{ id: listId }],
    };
    const listsPayload = [{ id: listId, name: "Cached List" }];

    const client = new ListMonkClient({
      ...baseConfig,
      listCacheSeconds: 60,
    });
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
      makeJsonResponse({ data: listsPayload }),
      makeJsonResponse({ data: true }),
    ]);

    const res = await client.unsubscribe({ email: existing.email });

    expect(res.success).toBe(true);
    expect(res.data?.lists).toEqual([
      {
        listId: listId,
        listName: "Cached List",
        statusChanged: true,
        message: "Subscribed",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects unknown list ids when cache metadata is available", async () => {
    const existing: LMCSubscriber = {
      id: 203,
      uuid: "uuid-203",
      email: "unknown-list@example.com",
      name: "Unknown List",
      attribs: { uid: "uid-203" },
      status: "enabled",
    };

    const client = new ListMonkClient({
      ...baseConfig,
      listCacheSeconds: 60,
    });
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
      makeJsonResponse({ data: [{ id: 1, name: "Known List" }] }),
      makeJsonResponse({ data: true }),
    ]);

    const res = await client.unsubscribe({ email: existing.email }, 999);

    expect(res.success).toBe(true);
    expect(res.data?.lists).toEqual([
      { listId: 999, statusChanged: false, message: "Unknown List" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns per-entry errors for bulk adds", async () => {
    const listId = 999;
    const okSubscriber: LMCSubscriber = {
      id: 2,
      uuid: "uuid-2",
      email: "ok@example.com",
      name: "Ok User",
      attribs: {},
      status: "enabled",
      lists: [{ id: listId, subscription_status: "confirmed" }],
    };

    const client = new ListMonkClient(baseConfig);
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [] } }),
      makeJsonResponse({ message: "boom" }, { status: 500 }),
      makeJsonResponse({ data: { results: [] } }),
      makeJsonResponse({ data: okSubscriber }),
    ]);

    const res = await client.addSubscribersToList(listId, [
      { email: "fail@example.com" },
      { email: okSubscriber.email, name: okSubscriber.name },
    ]);

    expect(res.success).toBe(false);
    expect(res.code).toBe(207);
    expect(res.data?.errors).toHaveLength(1);
    expect(res.data?.errors?.[0].email).toBe("fail@example.com");
    expect(res.data?.created).toHaveLength(1);
    expect(res.data?.created?.[0].email).toBe(okSubscriber.email);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("prevents uid change unless forced", async () => {
    const existing: LMCSubscriber = {
      id: 10,
      uuid: "uuid-10",
      email: "uidtest@example.com",
      name: "Uid Test",
      attribs: { uid: "abc" },
      status: "enabled",
      lists: [{ id: 1, subscription_status: "confirmed" }],
    };
    const updated = {
      ...existing,
      email: "uidtest2@example.com",
      attribs: { uid: "def" },
    };

    const client = new ListMonkClient(baseConfig);
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
    ]);

    const res1 = await client.updateUser(
      { email: existing.email },
      { email: updated.email, uid: updated.attribs.uid },
    );

    expect(res1.success).toBe(false);
    expect(res1.code).toBe(400);
    expect(res1.message).toContain("UID mismatch");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Allow forced change
    const fetchMockForce = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
      makeJsonResponse({ data: updated }),
    ]);
    const res2 = await client.updateUser(
      { email: existing.email },
      { email: updated.email, uid: updated.attribs.uid },
      { forceUidChange: true },
    );
    expect(res2.success).toBe(true);
    expect(res2.data?.attribs.uid).toBe("def");
    expect(fetchMockForce).toHaveBeenCalledTimes(2);
  });

  it("sets subscriptions with adds/resubscribes without removing others", async () => {
    const listA = 1;
    const listB = 2;
    const listC = 3;
    const existing: LMCSubscriber = {
      id: 300,
      uuid: "uuid-300",
      email: "pref@example.com",
      name: "Pref",
      attribs: { uid: "uid-300" },
      status: "enabled",
      lists: [
        { id: listA, subscription_status: "unsubscribed", name: "List A" },
        { id: listB, subscription_status: "confirmed", name: "List B" },
      ],
    };

    const client = new ListMonkClient(baseConfig);
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
      makeJsonResponse({ data: true }),
    ]);

    const res = await client.setSubscriptions({ email: existing.email }, [
      listA,
      listB,
      listC,
    ]);

    expect(res.success).toBe(true);
    expect(res.data?.lists).toEqual([
      { listId: listA, listName: "List A", status: "Subscribed" },
      { listId: listB, listName: "List B", status: "Unchanged" },
      { listId: listC, listName: undefined, status: "Subscribed" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const call = fetchMock.mock.calls[1];
    expect(call[0]).toBe(`${baseConfig.apiURL}/subscribers/lists`);
    const body = JSON.parse((call[1]?.body as string) ?? "{}");
    expect(body).toEqual({
      ids: [existing.id],
      action: "add",
      target_list_ids: [listA, listC],
    });
  });

  it("sets subscriptions and unsubscribes others when requested", async () => {
    const listA = 11;
    const listB = 22;
    const existing: LMCSubscriber = {
      id: 301,
      uuid: "uuid-301",
      email: "pref2@example.com",
      name: "Pref2",
      attribs: { uid: "uid-301" },
      status: "enabled",
      lists: [
        { id: listA, subscription_status: "confirmed", name: "List A" },
        { id: listB, subscription_status: "confirmed", name: "List B" },
      ],
    };

    const client = new ListMonkClient(baseConfig);
    const fetchMock = queueFetch([
      makeJsonResponse({ data: { results: [existing] } }),
      makeJsonResponse({ data: true }),
    ]);

    const res = await client.setSubscriptions(
      { email: existing.email },
      [listA],
      {
        removeOthers: true,
      },
    );

    expect(res.success).toBe(true);
    expect(res.data?.lists).toEqual([
      { listId: listA, listName: "List A", status: "Unchanged" },
      { listId: listB, listName: "List B", status: "Unsubscribed" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const call = fetchMock.mock.calls[1];
    const body = JSON.parse((call[1]?.body as string) ?? "{}");
    expect(body).toEqual({
      ids: [existing.id],
      action: "unsubscribe",
      target_list_ids: [listB],
    });
  });

  it("blocks and unblocks a subscriber by id", async () => {
    const existing: LMCSubscriber = {
      id: 400,
      uuid: "uuid-400",
      email: "block@example.com",
      name: "Block Test",
      attribs: {},
      status: "enabled",
    };
    const blocked = { ...existing, status: "blocklisted" };
    const unblocked = { ...existing, status: "enabled" };

    const client = new ListMonkClient(baseConfig);
    const fetchMock = queueFetch([
      makeJsonResponse({ data: blocked }),
      makeJsonResponse({ data: unblocked }),
    ]);

    const blockRes = await client.blockSubscriber(existing.id);
    expect(blockRes.success).toBe(true);
    expect(blockRes.data?.status).toBe("blocklisted");

    const unblockRes = await client.unblockSubscriber(existing.id);
    expect(unblockRes.success).toBe(true);
    expect(unblockRes.data?.status).toBe("enabled");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const blockCall = fetchMock.mock.calls[0];
    expect(blockCall[0]).toBe(
      `${baseConfig.apiURL}/subscribers/${existing.id}`,
    );
    expect(JSON.parse((blockCall[1]?.body as string) ?? "{}")).toEqual({
      status: "blocklisted",
    });
    const unblockCall = fetchMock.mock.calls[1];
    expect(unblockCall[0]).toBe(
      `${baseConfig.apiURL}/subscribers/${existing.id}`,
    );
    expect(JSON.parse((unblockCall[1]?.body as string) ?? "{}")).toEqual({
      status: "enabled",
    });
  });
});
