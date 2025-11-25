import { createRequire } from "node:module";

import { config as loadEnv } from "dotenv";

loadEnv({ path: new URL("../.env", import.meta.url).pathname });

const require = createRequire(import.meta.url);
const { ListMonkClient } = require("../dist/cjs/index.cjs");

const url = process.env.LISTMONK_URL;
const username = process.env.LISTMONK_USERNAME;
const token = process.env.LISTMONK_TOKEN;
const preferredListId = process.env.LISTMONK_LIST_ID
  ? Number.parseInt(process.env.LISTMONK_LIST_ID, 10)
  : undefined;

if (!url || !username || !token) {
  throw new Error(
    "Missing LISTMONK_URL/LISTMONK_USERNAME/LISTMONK_TOKEN in .env",
  );
}

const client = new ListMonkClient({
  apiURL: url,
  user: username,
  token,
  debug: true,
});

async function main() {
  const listsRes = await client.get("/lists?per_page=all");
  if (!listsRes.success || !listsRes.data) {
    console.error("Unable to list lists:", listsRes.errors);
    process.exit(1);
  }
  const lists = Array.isArray(listsRes.data.results)
    ? listsRes.data.results
    : [];
  console.log(
    "Available lists:",
    lists.map((l) => `${l.id}:${l.name ?? "unnamed"}`).join(", "),
  );
  const listIds = lists.map((l) => l.id);
  if (listIds.length < 2) {
    console.error("Need at least two lists to run the multi-list test");
    process.exit(1);
  }
  const primaryListId =
    preferredListId && listIds.includes(preferredListId)
      ? preferredListId
      : listIds[0];
  const otherLists = listIds.filter((id) => id !== primaryListId);
  const secondaryListId = otherLists[0];
  const allLists = [primaryListId, ...otherLists];
  console.log(
    `Primary list: ${primaryListId}, Secondary list: ${secondaryListId}, All lists: [${allLists.join(", ")}]`,
  );

  await cleanupCliSubscribers();

  const user1 = {
    email: "client-test-1@example.com",
    uid: "client-test-1",
    name: "Client Test One",
  };
  const user2 = {
    email: "client-test-2@example.com",
    uid: "client-test-2",
    name: "Client Test Two",
  };

  const user1Id = await createAndVerifySubscriber(user1, [...allLists]);
  await sleep(300);
  await ensureSubscribedInList(user1, user1Id, primaryListId, "primary");
  await ensureSubscribedInList(user1, user1Id, secondaryListId, "secondary");

  const user2Id = await createAndVerifySubscriber(user2, [...allLists]);
  await sleep(300);
  await ensureSubscribedInList(
    user2,
    user2Id,
    primaryListId,
    "primary (pre-unsubscribe)",
  );
  console.log(
    `Unsubscribing ${user2.email} from primary list ${primaryListId}...`,
  );
  const unsubRes = await client.put(`/subscribers/lists`, {
    ids: [user2Id],
    action: "unsubscribe",
    target_list_ids: [primaryListId],
  });
  console.log("Unsubscribe result:", unsubRes.code, unsubRes.message);
  if (!unsubRes.success) {
    console.error("Unsubscribe errors:", unsubRes.errors);
    process.exit(1);
  }
  await sleep(300);
  await ensureUnsubscribedInList(user2, user2Id, primaryListId, "primary");
  await ensureSubscribedInList(
    user2,
    user2Id,
    secondaryListId,
    "secondary (should remain subscribed)",
  );

  console.log(
    "Smoke test (multi-list subscribe/unsubscribe with uids) completed successfully.",
  );
}

async function cleanupCliSubscribers() {
  const params = new URLSearchParams();
  params.set("per_page", "all");
  params.set("query", "email ILIKE 'client-test-%'");
  const res = await client.get(`/subscribers?${params.toString()}`);
  if (!res.success || !res.data) {
    console.warn(
      "Cleanup skipped: unable to list client-test-* subscribers",
      res.errors,
    );
    return;
  }
  const cliSubs = res.data.results.filter((s) =>
    s.email.startsWith("client-test-"),
  );
  if (cliSubs.length === 0) {
    console.log("Cleanup: no client-test-* subscribers found");
    return;
  }
  const ids = cliSubs.map((s) => s.id);
  console.log(`Cleanup: deleting ${ids.length} client-test-* subscribers...`);
  const del = await client.deleteSubscribers(ids);
  console.log("Cleanup delete result:", del.code, del.message);
  if (!del.success) {
    console.warn("Cleanup delete errors:", del.errors);
  }
}

function matchesUser(subscriber, user) {
  return (
    subscriber.email === user.email ||
    (typeof subscriber.attribs?.uid === "string" &&
      subscriber.attribs.uid === user.uid)
  );
}

function pickSubscriber(res, user) {
  const fromCreated = res.data?.created?.find((s) => matchesUser(s, user));
  if (fromCreated) return fromCreated;
  const fromAdded = res.data?.added?.find((s) => matchesUser(s, user));
  return fromAdded;
}

async function createAndVerifySubscriber(user, listIds) {
  const [firstList, ...restLists] = listIds;
  let subscriberId;

  const baseEntry = {
    email: user.email,
    name: user.name,
    attribs: { source: "cli-smoke", uid: user.uid },
    uid: user.uid,
  };

  const firstRes = await client.addSubscribersToList(firstList, [baseEntry]);
  if (!firstRes.success) {
    console.error(
      `Failed adding ${user.email} to list ${firstList}:`,
      firstRes.errors,
    );
    process.exit(1);
  }
  const firstCandidate = pickSubscriber(firstRes, user);
  if (firstCandidate) {
    subscriberId = firstCandidate.id;
  }

  for (const list of restLists) {
    const res = await client.addSubscribersToList(list, [baseEntry]);
    if (!res.success) {
      console.error(`Failed adding ${user.email} to list ${list}:`, res.errors);
      process.exit(1);
    }
  }

  if (!subscriberId) {
    console.error("Unable to determine subscriber id for", user.email);
    process.exit(1);
  }

  const update = await client.put(`/subscribers/${subscriberId}`, {
    email: user.email,
    name: user.name,
    attribs: { source: "cli-smoke", uid: user.uid },
    lists: listIds,
  });
  if (!update.success) {
    console.error(`Failed to update lists for ${user.email}:`, update.errors);
    process.exit(1);
  }

  console.log(
    `Using subscriber id ${subscriberId} (${user.email}) for list(s) [${listIds.join(", ")}]`,
  );
  return subscriberId;
}

async function ensureSubscribedInList(user, subscriberId, list, label) {
  const res = await client.get(`/subscribers/${subscriberId}`);
  if (!res.success || !res.data) {
    console.error(`Failed to fetch subscriber for ${label}:`, res.errors);
    process.exit(1);
  }
  const listMeta = res.data.lists?.find((l) => l.id === list);
  let found =
    matchesUser(res.data, user) &&
    listMeta &&
    listMeta.subscription_status !== "unsubscribed";

  if (!found) {
    const filter = encodeURIComponent(`id = ${subscriberId}`);
    const listRes = await client.get(
      `/subscribers?list_id=${list}&per_page=all&query=${filter}`,
    );
    if (listRes.success && listRes.data) {
      found = listRes.data.results.some((s) => matchesUser(s, user));
    }
  }

  console.log(
    `${user.email} present as subscribed in ${label}?`,
    Boolean(found),
  );
  if (!found) {
    console.error(`Expected ${user.email} subscribed in ${label}`);
    process.exit(1);
  }
}

async function ensureUnsubscribedInList(user, subscriberId, list, label) {
  const res = await client.get(`/subscribers/${subscriberId}`);
  if (!res.success || !res.data) {
    console.error(`Failed to fetch subscriber for ${label}:`, res.errors);
    process.exit(1);
  }
  const listMeta = res.data.lists?.find((l) => l.id === list);
  let found =
    matchesUser(res.data, user) &&
    listMeta &&
    listMeta.subscription_status === "unsubscribed";

  if (!found) {
    const filter = encodeURIComponent(`id = ${subscriberId}`);
    const listRes = await client.get(
      `/subscribers?list_id=${list}&per_page=all&subscription_status=unsubscribed&query=${filter}`,
    );
    if (listRes.success && listRes.data) {
      found = listRes.data.results.some((s) => matchesUser(s, user));
    }
  }

  console.log(
    `${user.email} present as unsubscribed in ${label}?`,
    Boolean(found),
  );
  if (!found) {
    console.error(`Expected ${user.email} unsubscribed in ${label}`);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
