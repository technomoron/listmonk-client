import { createRequire } from "node:module";

import { config as loadEnv } from "dotenv";

loadEnv({ path: new URL("../.env", import.meta.url).pathname });

const require = createRequire(import.meta.url);
const { ListmonkClient } = require("../dist/cjs/index.cjs");

const url = process.env.LISTMONK_URL;
const username = process.env.LISTMONK_USERNAME;
const password = process.env.LISTMONK_PASSWORD;
const listId = process.env.LISTMONK_LIST_ID
  ? Number.parseInt(process.env.LISTMONK_LIST_ID, 10)
  : NaN;

if (!url || !username || !password || Number.isNaN(listId)) {
  throw new Error(
    "Missing LISTMONK_URL/LISTMONK_USERNAME/LISTMONK_PASSWORD/LISTMONK_LIST_ID in .env",
  );
}

const client = new ListmonkClient(url, {
  username,
  password,
  debug: true,
});

async function main() {
  await cleanupCliSubscribers();

  const randomEmail = `cli-${Date.now()}@example.com`;
  console.log(
    `Bulk adding ${randomEmail} to list ${listId} with addSubscribersToList...`,
  );
  const bulkRes = await client.addSubscribersToList(listId, [
    {
      email: randomEmail,
      name: "CLI Smoke",
      attribs: { source: "cli-smoke" },
    },
  ]);
  if (!bulkRes.success) {
    console.error("Bulk add failed:", bulkRes.errors);
    process.exit(1);
  }
  const target =
    bulkRes.data?.created[0] ??
    bulkRes.data?.added.find((s) => s.email === randomEmail);
  if (!target) {
    console.error("Bulk add did not return a subscriber record");
    process.exit(1);
  }

  console.log(
    `Using subscriber id ${target.id} (${target.email}) for status tests...`,
  );
  const subscriberId = target.id;

  const listRes = await client.listMembersByStatus(listId, "subscribed", {
    perPage: 50,
  });
  console.log(
    "List members (subscribed) status:",
    listRes.code,
    listRes.message,
  );

  if (!listRes.success || !listRes.data) {
    console.error("Failed to fetch members:", listRes.errors);
    process.exit(1);
  }

  const found = listRes.data.results.find((s) => s.email === randomEmail);
  console.log("New subscriber present?", Boolean(found));
  if (!found) {
    console.error(
      "Newly subscribed user not found in the first page of results",
    );
    process.exit(1);
  }

  console.log("Unsubscribing the subscriber from the list...");
  const unsubRes = await client.put(`/subscribers/lists`, {
    ids: [subscriberId],
    action: "unsubscribe",
    target_list_ids: [listId],
  });
  console.log("Unsubscribe result:", unsubRes.code, unsubRes.message);
  if (!unsubRes.success) {
    console.error("Unsubscribe errors:", unsubRes.errors);
    process.exit(1);
  }

  const unsubbedList = await client.listMembersByStatus(
    listId,
    "unsubscribed",
    { perPage: 50 },
  );
  console.log(
    "List members (unsubbed) status:",
    unsubbedList.code,
    unsubbedList.message,
  );
  if (!unsubbedList.success || !unsubbedList.data) {
    console.error("Failed to fetch unsubscribed members:", unsubbedList.errors);
    process.exit(1);
  }
  const unsubbedFound = unsubbedList.data.results.find(
    (s) => s.email === randomEmail,
  );
  console.log("Subscriber appears as unsubscribed?", Boolean(unsubbedFound));
  if (!unsubbedFound) {
    console.error("Unsubscribed user not found in unsubscribed listing");
    process.exit(1);
  }

  console.log("Blocklisting the subscriber...");
  const blockRes = await client.put(`/subscribers/${subscriberId}/blocklist`, {
    ids: [subscriberId],
  });
  console.log("Blocklist result:", blockRes.code, blockRes.message);
  if (!blockRes.success) {
    console.error("Blocklist errors:", blockRes.errors);
    process.exit(1);
  }

  const blockedList = await client.listMembersByStatus(listId, "blocked", {
    perPage: 50,
  });
  console.log(
    "List members (blocked) status:",
    blockedList.code,
    blockedList.message,
  );
  if (!blockedList.success || !blockedList.data) {
    console.error("Failed to fetch blocked members:", blockedList.errors);
    process.exit(1);
  }
  const blockedFound = blockedList.data.results.find(
    (s) => s.email === randomEmail,
  );
  console.log("Subscriber appears as blocked?", Boolean(blockedFound));
  if (!blockedFound) {
    console.warn(
      "Blocked user not visible in blocked list; checking direct subscriber status...",
    );
    const subscriber = await client.get(`/subscribers/${subscriberId}`);
    if (!subscriber.success || !subscriber.data) {
      console.error(
        "Unable to fetch subscriber to verify blocklist status:",
        subscriber.errors,
      );
      process.exit(1);
    }
    const status = subscriber.data.status;
    console.log("Direct subscriber status:", status);
    if (status !== "blocklisted") {
      console.error("Subscriber status is not blocklisted");
      process.exit(1);
    }
  }

  await cleanupCliSubscribers();

  console.log(
    "Smoke test (subscribe, unsubscribe, blocklist) completed successfully.",
  );
}

async function cleanupCliSubscribers() {
  const params = new URLSearchParams();
  params.set("per_page", "all");
  params.set("query", "email ILIKE 'cli-%'");
  const res = await client.get(`/subscribers?${params.toString()}`);
  if (!res.success || !res.data) {
    console.warn(
      "Cleanup skipped: unable to list cli-* subscribers",
      res.errors,
    );
    return;
  }
  const cliSubs = res.data.results.filter((s) => s.email.startsWith("cli-"));
  if (cliSubs.length === 0) {
    console.log("Cleanup: no cli-* subscribers found");
    return;
  }
  const ids = cliSubs.map((s) => s.id);
  console.log(`Cleanup: deleting ${ids.length} cli-* subscribers...`);
  const del = await client.deleteSubscribers(ids);
  console.log("Cleanup delete result:", del.code, del.message);
  if (!del.success) {
    console.warn("Cleanup delete errors:", del.errors);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
