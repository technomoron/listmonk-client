import ListMonkClient from "../src/listmonk-client.js";

import type { LMCSubscriber } from "../src/listmonk-client.js";

const baseConfig = {
  apiURL: "https://example.com/api",
  user: "user",
  token: "token",
  timeoutMS: 50,
};

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
  afterEach(() => {
    vi.restoreAllMocks();
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
});
