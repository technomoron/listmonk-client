/**
 * Example: sync WordPress users into a Listmonk list by uid/email/name.
 *
 * Prereqs:
 *   pnpm add -D sequelize mysql2
 *   Configure .env with:
 *     WP_DB_HOST, WP_DB_USER, WP_DB_PASSWORD, WP_DB_NAME, WP_TABLE_PREFIX?
 *     LISTMONK_URL, LISTMONK_USER, LISTMONK_TOKEN, LISTMONK_LIST_ID
 *
 * Run:
 *   node ./scripts/wp-sync-example.mjs
 */
import { config as loadEnv } from "dotenv";
import { Sequelize, DataTypes } from "sequelize";
import { ListMonkClient } from "../dist/esm/index.js";

loadEnv({ path: new URL("../.env", import.meta.url).pathname });

const {
  WP_DB_HOST = "127.0.0.1",
  WP_DB_USER,
  WP_DB_PASSWORD,
  WP_DB_NAME,
  WP_TABLE_PREFIX = "wp_",
  LISTMONK_URL,
  LISTMONK_USER,
  LISTMONK_TOKEN,
  LISTMONK_LIST_ID,
} = process.env;

if (
  !WP_DB_NAME ||
  !WP_DB_USER ||
  !LISTMONK_URL ||
  !LISTMONK_USER ||
  !LISTMONK_TOKEN ||
  !LISTMONK_LIST_ID
) {
  throw new Error(
    "Missing required env vars: WP_DB_NAME, WP_DB_USER, LISTMONK_URL, LISTMONK_USER, LISTMONK_TOKEN, LISTMONK_LIST_ID",
  );
}

const listId = Number.parseInt(String(LISTMONK_LIST_ID), 10);
if (!Number.isFinite(listId)) {
  throw new Error("LISTMONK_LIST_ID must be a number");
}

const sequelize = new Sequelize(WP_DB_NAME, WP_DB_USER, WP_DB_PASSWORD ?? "", {
  host: WP_DB_HOST,
  dialect: "mysql",
  logging: false,
});

const User = sequelize.define(
  "User",
  {
    ID: { type: DataTypes.BIGINT, primaryKey: true },
    user_email: DataTypes.STRING,
    display_name: DataTypes.STRING,
    user_nicename: DataTypes.STRING,
    user_login: DataTypes.STRING,
    user_status: DataTypes.INTEGER,
  },
  { tableName: `${WP_TABLE_PREFIX}users`, timestamps: false },
);

const UserMeta = sequelize.define(
  "UserMeta",
  {
    umeta_id: { type: DataTypes.BIGINT, primaryKey: true },
    user_id: DataTypes.BIGINT,
    meta_key: DataTypes.STRING,
    meta_value: DataTypes.TEXT,
  },
  { tableName: `${WP_TABLE_PREFIX}usermeta`, timestamps: false },
);

const client = new ListMonkClient({
  apiURL: LISTMONK_URL,
  user: LISTMONK_USER,
  token: LISTMONK_TOKEN,
  debug: true,
});

const counts = {
  blocked: 0,
  unsubscribed: 0,
  added: 0,
  updated: 0,
};

function escapeValue(value) {
  return value.replace(/'/g, "''");
}

async function findSubscriberByUid(uid) {
  const query = encodeURIComponent(`attribs->>'uid' = '${escapeValue(uid)}'`);
  const res = await client.get(`/subscribers?per_page=1&query=${query}`);
  if (res.success && res.data && res.data.results.length > 0) {
    return res.data.results[0];
  }
  return null;
}

function isSubscribed(subscriber) {
  const entry = subscriber.lists?.find((l) => l.id === listId);
  const status = entry?.subscription_status;
  if (status === "unsubscribed") return false;
  return Boolean(entry);
}

async function attachToList(subscriberId) {
  await client.put(`/subscribers/lists/${listId}`, {
    ids: [subscriberId],
    action: "add",
  });
}

async function upsertMeta(userId, subscriberId) {
  const metaKey = "listmonk_subscriber_id";
  const existing = await UserMeta.findOne({
    where: { user_id: userId, meta_key: metaKey },
  });
  if (existing) {
    await existing.update({ meta_value: String(subscriberId) });
  } else {
    await UserMeta.create({
      user_id: userId,
      meta_key: metaKey,
      meta_value: String(subscriberId),
    });
  }
}

async function syncUser(user) {
  const email = (user.user_email || "").trim();
  if (!email) return;
  const name =
    user.display_name?.trim() ||
    user.user_nicename?.trim() ||
    user.user_login ||
    email;
  const uid = String(user.ID);

  const existing = await findSubscriberByUid(uid);
  if (existing?.status === "blocklisted") {
    counts.blocked += 1;
    return;
  }
  const membership = existing?.lists?.find((l) => l.id === listId);
  if (membership?.subscription_status === "unsubscribed") {
    counts.unsubscribed += 1;
    return;
  }

  if (existing) {
    const updateRes = await client.updateUser(
      { id: existing.id },
      { email, name, attribs: { source: "wp-sync", uid } },
    );
    if (!updateRes.success || !updateRes.data) {
      throw new Error(
        `Failed updating subscriber ${uid}: ${updateRes.message}`,
      );
    }
    counts.updated += 1;
    if (!isSubscribed(updateRes.data)) {
      await attachToList(updateRes.data.id);
      counts.added += 1;
    }
    await upsertMeta(user.ID, updateRes.data.id);
    return;
  }

  const createRes = await client.subscribe(
    listId,
    { email, name, attribs: { source: "wp-sync", uid } },
    { preconfirm: true, status: "enabled" },
  );
  if (!createRes.success || !createRes.data) {
    throw new Error(`Failed creating subscriber ${uid}: ${createRes.message}`);
  }
  counts.added += 1;
  await upsertMeta(user.ID, createRes.data.id);
}

async function main() {
  await sequelize.authenticate();
  const users = await User.findAll({
    where: { user_status: 0 },
    attributes: [
      "ID",
      "user_email",
      "display_name",
      "user_nicename",
      "user_login",
      "user_status",
    ],
  });

  console.log(`Syncing ${users.length} WordPress users to list ${listId}...`);

  for (const user of users) {
    await syncUser(user);
  }

  console.log("Sync complete:", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
