"use strict";

const crypto = require("crypto");

/*
 * ============================================================
 * MOHEJI DELIVERY SALES CORE
 * sales.js
 *
 * 役割:
 * - Redisアクセス
 * - 売上登録
 * - 売上取消
 * - HMAC-SHA256署名
 * - 冪等性
 * - Redis Lua原子処理
 * - 監査ログ
 * - 集計
 * - レポート生成
 * - 旧データ互換
 *
 * 外部パッケージ不要
 * Node.js標準 crypto のみ使用
 * ============================================================
 */

const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const HMAC_SECRET = process.env.SALES_HMAC_SECRET;

const PREFIX = "moheji:delivery";

const MAX_SALES = 1000000000;
const MAX_ORDERS = 1000000;

/*
 * ------------------------------------------------------------
 * 基本検証
 * ------------------------------------------------------------
 */

function assertEnvironment() {
  if (!REDIS_URL) {
    throw new Error("KV_REST_API_URL is not configured");
  }

  if (!REDIS_TOKEN) {
    throw new Error("KV_REST_API_TOKEN is not configured");
  }

  if (!HMAC_SECRET || HMAC_SECRET.length < 32) {
    throw new Error("SALES_HMAC_SECRET must be at least 32 characters");
  }
}

/*
 * ------------------------------------------------------------
 * Redis REST
 * ------------------------------------------------------------
 */

async function redisCommand(command) {
  assertEnvironment();

  if (!Array.isArray(command) || command.length === 0) {
    throw new Error("Invalid Redis command");
  }

  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    throw new Error(`Redis HTTP error: ${response.status}`);
  }

  const data = await response.json();

  if (data && data.error) {
    throw new Error(`Redis error: ${data.error}`);
  }

  return data ? data.result : null;
}

/*
 * ------------------------------------------------------------
 * Lua EVAL
 *
 * Upstash REST:
 * ["EVAL", script, numkeys, key1, ..., arg1, ...]
 * ------------------------------------------------------------
 */

async function redisEval(script, keys = [], args = []) {
  return redisCommand([
    "EVAL",
    script,
    String(keys.length),
    ...keys,
    ...args.map(String)
  ]);
}

/*
 * ------------------------------------------------------------
 * Utility
 * ------------------------------------------------------------
 */

function safeNumber(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return n;
}

function positiveInteger(value) {
  const n = Number(value);

  if (!Number.isSafeInteger(n) || n <= 0) {
    return null;
  }

  return n;
}

function normalizeDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid date key");
  }

  return value;
}

function normalizeMonthKey(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error("Invalid month key");
  }

  return value;
}

function normalizeYearKey(value) {
  if (!/^\d{4}$/.test(value)) {
    throw new Error("Invalid year key");
  }

  return value;
}

function createId(prefix = "op") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getTokyoDateInfo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const map = {};

  for (const part of parts) {
    map[part.type] = part.value;
  }

  const dateKey =
    `${map.year}-${map.month}-${map.day}`;

  const monthKey =
    `${map.year}-${map.month}`;

  const yearKey =
    `${map.year}`;

  return {
    dateKey,
    monthKey,
    yearKey,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

/*
 * ------------------------------------------------------------
 * Redis key
 * ------------------------------------------------------------
 */

function dailyKey(dateKey) {
  return `${PREFIX}:daily:${normalizeDateKey(dateKey)}`;
}

function monthlyKey(monthKey) {
  return `${PREFIX}:month:${normalizeMonthKey(monthKey)}`;
}

function yearlyKey(yearKey) {
  return `${PREFIX}:year:${normalizeYearKey(yearKey)}`;
}

function alltimeKey() {
  return `${PREFIX}:alltime`;
}

function workingDaysKey(monthKey) {
  return `${PREFIX}:workingdays:${normalizeMonthKey(monthKey)}`;
}

function recordsIndexKey(chatId) {
  return `${PREFIX}:records:${String(chatId)}`;
}

function recordKey(chatId, recordId) {
  return `${PREFIX}:record:${String(chatId)}:${String(recordId)}`;
}

function operationKey(operationId) {
  return `${PREFIX}:operation:${operationId}`;
}

function auditKey() {
  return `${PREFIX}:audit`;
}

function migrationFlagKey(chatId) {
  return `${PREFIX}:migration:${String(chatId)}:legacy-cancelled`;
}

/*
 * ------------------------------------------------------------
 * HMAC
 * ------------------------------------------------------------
 */

function canonicalRecordPayload(record) {
  return [
    record.recordId,
    record.chatId,
    record.userId,
    record.sales,
    record.orders,
    record.dateKey,
    record.monthKey,
    record.yearKey,
    record.createdAt
  ].join("|");
}

function signRecord(record) {
  assertEnvironment();

  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(canonicalRecordPayload(record), "utf8")
    .digest("hex");
}

function verifyRecordSignature(record) {
  if (!record || !record.signature) {
    return false;
  }

  const expected = signRecord(record);

  if (
    typeof expected !== "string" ||
    typeof record.signature !== "string"
  ) {
    return false;
  }

  if (expected.length !== record.signature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(record.signature, "hex")
    );
  } catch {
    return false;
  }
}

/*
 * ------------------------------------------------------------
 * Audit
 * ------------------------------------------------------------
 */

async function writeAudit({
  operationId,
  action,
  chatId,
  userId,
  recordId = "",
  status,
  sales = 0,
  orders = 0,
  reason = ""
}) {
  const event = {
    operationId,
    action,
    chatId: String(chatId),
    userId: String(userId || ""),
    recordId: String(recordId || ""),
    status,
    sales: Number(sales),
    orders: Number(orders),
    reason: String(reason || ""),
    timestamp: new Date().toISOString()
  };

  /*
   * Audit data itself is not used as business state.
   * LPUSH is intentionally best-effort here.
   */
  try {
    await redisCommand([
      "LPUSH",
      auditKey(),
      JSON.stringify(event)
    ]);

    await redisCommand([
      "LTRIM",
      auditKey(),
      "0",
      "4999"
    ]);
  } catch {
    /*
     * Audit failure must not silently change financial state.
     * Caller can continue only when the business transaction
     * itself already succeeded.
     */
  }
}

/*
 * ------------------------------------------------------------
 * HGETALL helper
 * ------------------------------------------------------------
 */

function hashArrayToObject(value) {
  if (!Array.isArray(value)) {
    return {};
  }

  const result = {};

  for (let i = 0; i < value.length; i += 2) {
    const key = value[i];
    const val = value[i + 1];

    if (key !== undefined) {
      result[key] = val;
    }
  }

  return result;
}

async function getHash(key) {
  const result = await redisCommand([
    "HGETALL",
    key
  ]);

  return hashArrayToObject(result);
}

/*
 * ------------------------------------------------------------
 * Save Sales
 *
 * Luaで以下を完全に原子化:
 *
 * 1. operation重複チェック
 * 2. record作成
 * 3. record index
 * 4. daily
 * 5. monthly
 * 6. yearly
 * 7. alltime
 * 8. working day
 * 9. operation完了
 * ------------------------------------------------------------
 */

const SALES_LUA = `
local operationKey = KEYS[1]
local recordKey = KEYS[2]
local indexKey = KEYS[3]
local dailyKey = KEYS[4]
local monthlyKey = KEYS[5]
local yearlyKey = KEYS[6]
local alltimeKey = KEYS[7]
local workingDaysKey = KEYS[8]

local operationId = ARGV[1]
local recordId = ARGV[2]
local chatId = ARGV[3]
local userId = ARGV[4]
local sales = tonumber(ARGV[5])
local orders = tonumber(ARGV[6])
local dateKey = ARGV[7]
local monthKey = ARGV[8]
local yearKey = ARGV[9]
local createdAt = ARGV[10]
local signature = ARGV[11]
local score = tonumber(ARGV[12])

if redis.call("EXISTS", operationKey) == 1 then
  local status = redis.call("HGET", operationKey, "status")

  if status == "completed" then
    return {"DUPLICATE", recordId}
  end

  return {"RETRY", recordId}
end

if redis.call("EXISTS", recordKey) == 1 then
  return {"RECORD_EXISTS", recordId}
end

if sales <= 0 or orders <= 0 then
  return {"INVALID_AMOUNT", recordId}
end

redis.call(
  "HSET",
  recordKey,
  "recordId", recordId,
  "chatId", chatId,
  "userId", userId,
  "sales", sales,
  "orders", orders,
  "dateKey", dateKey,
  "monthKey", monthKey,
  "yearKey", yearKey,
  "createdAt", createdAt,
  "cancelled", "0",
  "signature", signature
)

redis.call(
  "ZADD",
  indexKey,
  score,
  recordId
)

redis.call(
  "HINCRBY",
  dailyKey,
  "sales",
  sales
)

redis.call(
  "HINCRBY",
  dailyKey,
  "orders",
  orders
)

redis.call(
  "HINCRBY",
  monthlyKey,
  "sales",
  sales
)

redis.call(
  "HINCRBY",
  monthlyKey,
  "orders",
  orders
)

redis.call(
  "HINCRBY",
  yearlyKey,
  "sales",
  sales
)

redis.call(
  "HINCRBY",
  yearlyKey,
  "orders",
  orders
)

redis.call(
  "HINCRBY",
  alltimeKey,
  "sales",
  sales
)

redis.call(
  "HINCRBY",
  alltimeKey,
  "orders",
  orders
)

redis.call(
  "SADD",
  workingDaysKey,
  dateKey
)

redis.call(
  "HSET",
  operationKey,
  "status", "completed",
  "recordId", recordId,
  "action", "sales",
  "completedAt", createdAt
)

redis.call(
  "EXPIRE",
  operationKey,
  172800
)

return {"OK", recordId}
`;

/*
 * ------------------------------------------------------------
 * Cancel Sales
 *
 * 最新未取消レコードをLua内部で探す。
 * これにより:
 * 「読み取り→あとで取消」の競合を減らす。
 *
 * レコード署名もLua側で比較。
 * ------------------------------------------------------------
 */

const CANCEL_LUA = `
local indexKey = KEYS[1]
local alltimeKey = KEYS[2]
local operationKey = KEYS[3]
local auditListKey = KEYS[4]

local chatId = ARGV[1]
local operationId = ARGV[2]
local now = ARGV[3]
local expectedSignature = ARGV[4]

if redis.call("EXISTS", operationKey) == 1 then
  local status = redis.call("HGET", operationKey, "status")

  if status == "completed" then
    local oldRecord = redis.call("HGET", operationKey, "recordId") or ""
    return {"DUPLICATE", oldRecord}
  end

  return {"RETRY", ""}
end

local ids = redis.call(
  "ZREVRANGE",
  indexKey,
  0,
  -1
)

local selected = nil
local selectedKey = nil

for _, id in ipairs(ids) do
  local rk = "moheji:delivery:record:" .. chatId .. ":" .. id
  local cancelled = redis.call("HGET", rk, "cancelled")

  if cancelled ~= "1" then
    selected = id
    selectedKey = rk
    break
  end
end

if not selected then
  return {"NO_ACTIVE", ""}
end

local storedSignature =
  redis.call("HGET", selectedKey, "signature") or ""

if expectedSignature ~= "" and
   storedSignature ~= expectedSignature then
  return {"SIGNATURE_MISMATCH", selected}
end

local sales =
  tonumber(redis.call("HGET", selectedKey, "sales") or "0")

local orders =
  tonumber(redis.call("HGET", selectedKey, "orders") or "0")

local dateKey =
  redis.call("HGET", selectedKey, "dateKey")

local monthKey =
  redis.call("HGET", selectedKey, "monthKey")

local yearKey =
  redis.call("HGET", selectedKey, "yearKey")

if not sales or not orders then
  return {"CORRUPTED", selected}
end

if not dateKey or not monthKey or not yearKey then
  return {"CORRUPTED", selected}
end

local dailyKey =
  "moheji:delivery:daily:" .. dateKey

local monthlyKey =
  "moheji:delivery:month:" .. monthKey

local yearlyKey =
  "moheji:delivery:year:" .. yearKey

local workingDaysKey =
  "moheji:delivery:workingdays:" .. monthKey

local dailySales =
  tonumber(redis.call("HGET", dailyKey, "sales") or "0")

local dailyOrders =
  tonumber(redis.call("HGET", dailyKey, "orders") or "0")

local monthlySales =
  tonumber(redis.call("HGET", monthlyKey, "sales") or "0")

local monthlyOrders =
  tonumber(redis.call("HGET", monthlyKey, "orders") or "0")

local yearlySales =
  tonumber(redis.call("HGET", yearlyKey, "sales") or "0")

local yearlyOrders =
  tonumber(redis.call("HGET", yearlyKey, "orders") or "0")

local alltimeSales =
  tonumber(redis.call("HGET", alltimeKey, "sales") or "0")

local alltimeOrders =
  tonumber(redis.call("HGET", alltimeKey, "orders") or "0")

if dailySales < sales or
   dailyOrders < orders or
   monthlySales < sales or
   monthlyOrders < orders or
   yearlySales < sales or
   yearlyOrders < orders or
   alltimeOrders < orders then
  return {"BALANCE_ERROR", selected}
end

redis.call(
  "HINCRBY",
  dailyKey,
  "sales",
  -sales
)

redis.call(
  "HINCRBY",
  dailyKey,
  "orders",
  -orders
)

redis.call(
  "HINCRBY",
  monthlyKey,
  "sales",
  -sales
)

redis.call(
  "HINCRBY",
  monthlyKey,
  "orders",
  -orders
)

redis.call(
  "HINCRBY",
  yearlyKey,
  "sales",
  -sales
)

redis.call(
  "HINCRBY",
  yearlyKey,
  "orders",
  -orders
)

if alltimeSales >= sales then
  redis.call(
    "HINCRBY",
    alltimeKey,
    "sales",
    -sales
  )
end

redis.call(
  "HINCRBY",
  alltimeKey,
  "orders",
  -orders
)

local newDailyOrders =
  tonumber(redis.call("HGET", dailyKey, "orders") or "0")

if newDailyOrders <= 0 then
  redis.call(
    "SREM",
    workingDaysKey,
    dateKey
  )
end

redis.call(
  "HSET",
  selectedKey,
  "cancelled",
  "1",
  "cancelledAt",
  now,
  "cancelOperationId",
  operationId
)

redis.call(
  "HSET",
  operationKey,
  "status",
  "completed",
  "recordId",
  selected,
  "action",
  "cancel",
  "completedAt",
  now
)

redis.call(
  "EXPIRE",
  operationKey,
  172800
)

return {
  "OK",
  selected,
  tostring(sales),
  tostring(orders),
  dateKey
}
`;

/*
 * ------------------------------------------------------------
 * Record取得
 * ------------------------------------------------------------
 */

async function getRecord(chatId, recordId) {
  return getHash(
    recordKey(chatId, recordId)
  );
}

/*
 * ------------------------------------------------------------
 * Sales登録
 * ------------------------------------------------------------
 */

async function processSales({
  chatId,
  userId,
  sales,
  orders,
  dateInfo = null
}) {
  const safeSales = positiveInteger(sales);
  const safeOrders = positiveInteger(orders);

  if (safeSales === null || safeOrders === null) {
    throw new Error("INVALID_INPUT");
  }

  if (safeSales > MAX_SALES) {
    throw new Error("SALES_TOO_LARGE");
  }

  if (safeOrders > MAX_ORDERS) {
    throw new Error("ORDERS_TOO_LARGE");
  }

  const info =
    dateInfo || getTokyoDateInfo();

  const recordId = createId("sale");
  const operationId = createId("op");

  const createdAt =
    new Date().toISOString();

  const record = {
    recordId,
    chatId: String(chatId),
    userId: String(userId || ""),
    sales: safeSales,
    orders: safeOrders,
    dateKey: info.dateKey,
    monthKey: info.monthKey,
    yearKey: info.yearKey,
    createdAt
  };

  const signature =
    signRecord(record);

  const score =
    Date.now();

  const result = await redisEval(
    SALES_LUA,
    [
      operationKey(operationId),
      recordKey(chatId, recordId),
      recordsIndexKey(chatId),
      dailyKey(info.dateKey),
      monthlyKey(info.monthKey),
      yearlyKey(info.yearKey),
      alltimeKey(),
      workingDaysKey(info.monthKey)
    ],
    [
      operationId,
      recordId,
      String(chatId),
      String(userId || ""),
      safeSales,
      safeOrders,
      info.dateKey,
      info.monthKey,
      info.yearKey,
      createdAt,
      signature,
      score
    ]
  );

  if (!Array.isArray(result)) {
    throw new Error("INVALID_REDIS_RESULT");
  }

  const status = result[0];

  if (status === "OK") {
    await writeAudit({
      operationId,
      action: "sales",
      chatId,
      userId,
      recordId,
      status: "success",
      sales: safeSales,
      orders: safeOrders
    });

    return {
      ok: true,
      duplicate: false,
      operationId,
      recordId,
      sales: safeSales,
      orders: safeOrders,
      dateKey: info.dateKey,
      monthKey: info.monthKey,
      yearKey: info.yearKey
    };
  }

  if (status === "DUPLICATE") {
    return {
      ok: true,
      duplicate: true,
      operationId,
      recordId: result[1]
    };
  }

  throw new Error(`SALES_REJECTED:${status}`);
}

/*
 * ------------------------------------------------------------
 * Cancel
 * ------------------------------------------------------------
 */

async function processCancel({
  chatId,
  userId
}) {
  const operationId =
    createId("cancel");

  const now =
    new Date().toISOString();

  /*
   * 最新レコードを事前取得して署名を渡す。
   * Lua内部でも必ず最新未取消レコードを再検索する。
   */
  const index = await redisCommand([
    "ZREVRANGE",
    recordsIndexKey(chatId),
    "0",
    "-1"
  ]);

  let expectedSignature = "";

  if (Array.isArray(index)) {
    for (const id of index) {
      const record =
        await getRecord(chatId, id);

      if (
        record &&
        record.cancelled !== "1"
      ) {
        expectedSignature =
          String(record.signature || "");
        break;
      }
    }
  }

  const result = await redisEval(
    CANCEL_LUA,
    [
      recordsIndexKey(chatId),
      alltimeKey(),
      operationKey(operationId),
      auditKey()
    ],
    [
      String(chatId),
      operationId,
      now,
      expectedSignature
    ]
  );

  if (!Array.isArray(result)) {
    throw new Error("INVALID_CANCEL_RESULT");
  }

  const status = result[0];

  if (status === "OK") {
    const recordId = result[1];
    const sales = Number(result[2]);
    const orders = Number(result[3]);
    const dateKey = result[4];

    await writeAudit({
      operationId,
      action: "cancel",
      chatId,
      userId,
      recordId,
      status: "success",
      sales,
      orders
    });

    return {
      ok: true,
      duplicate: false,
      operationId,
      recordId,
      sales,
      orders,
      dateKey
    };
  }

  if (status === "DUPLICATE") {
    return {
      ok: true,
      duplicate: true,
      operationId,
      recordId: result[1]
    };
  }

  /*
   * 新形式の売上が無い場合のみ、
   * 旧形式データの互換取消へ進む。
   */
  if (status === "NO_ACTIVE") {
    return processLegacyCancel({
      chatId,
      userId,
      operationId
    });
  }

  if (status === "SIGNATURE_MISMATCH") {
    throw new Error("RECORD_TAMPERED");
  }

  if (status === "BALANCE_ERROR") {
    throw new Error("AGGREGATE_INCONSISTENT");
  }

  if (status === "CORRUPTED") {
    throw new Error("RECORD_CORRUPTED");
  }

  throw new Error(`CANCEL_REJECTED:${status}`);
}

/*
 * ------------------------------------------------------------
 * Legacy cancel
 *
 * 2026-10-04
 * 17,014円 / 17件
 *
 * 旧システムで個別レコードが存在しない場合のみ使用。
 * 一度だけ。
 * ------------------------------------------------------------
 */

const LEGACY_DATE = "2026-10-04";
const LEGACY_MONTH = "2026-10";
const LEGACY_YEAR = "2026";
const LEGACY_SALES = 17014;
const LEGACY_ORDERS = 17;

const LEGACY_CANCEL_LUA = `
local flagKey = KEYS[1]
local dailyKey = KEYS[2]
local monthlyKey = KEYS[3]
local yearlyKey = KEYS[4]
local alltimeKey = KEYS[5]
local workingDaysKey = KEYS[6]
local operationKey = KEYS[7]

if redis.call("EXISTS", flagKey) == 1 then
  return {"ALREADY_USED"}
end

if redis.call("EXISTS", operationKey) == 1 then
  local status = redis.call("HGET", operationKey, "status")

  if status == "completed" then
    return {"DUPLICATE"}
  end
end

local dailySales =
  tonumber(redis.call("HGET", dailyKey, "sales") or "0")

local dailyOrders =
  tonumber(redis.call("HGET", dailyKey, "orders") or "0")

local monthlySales =
  tonumber(redis.call("HGET", monthlyKey, "sales") or "0")

local monthlyOrders =
  tonumber(redis.call("HGET", monthlyKey, "orders") or "0")

local yearlySales =
  tonumber(redis.call("HGET", yearlyKey, "sales") or "0")

local yearlyOrders =
  tonumber(redis.call("HGET", yearlyKey, "orders") or "0")

local alltimeOrders =
  tonumber(redis.call("HGET", alltimeKey, "orders") or "0")

if dailySales < 17014 or
   dailyOrders < 17 or
   monthlySales < 17014 or
   monthlyOrders < 17 or
   yearlySales < 17014 or
   yearlyOrders < 17 or
   alltimeOrders < 17 then
  return {"BALANCE_ERROR"}
end

redis.call(
  "HINCRBY",
  dailyKey,
  "sales",
  -17014
)

redis.call(
  "HINCRBY",
  dailyKey,
  "orders",
  -17
)

redis.call(
  "HINCRBY",
  monthlyKey,
  "sales",
  -17014
)

redis.call(
  "HINCRBY",
  monthlyKey,
  "orders",
  -17
)

redis.call(
  "HINCRBY",
  yearlyKey,
  "sales",
  -17014
)

redis.call(
  "HINCRBY",
  yearlyKey,
  "orders",
  -17
)

local alltimeSales =
  tonumber(redis.call("HGET", alltimeKey, "sales") or "0")

if alltimeSales >= 17014 then
  redis.call(
    "HINCRBY",
    alltimeKey,
    "sales",
    -17014
  )
end

redis.call(
  "HINCRBY",
  alltimeKey,
  "orders",
  -17
)

local newOrders =
  tonumber(redis.call("HGET", dailyKey, "orders") or "0")

if newOrders <= 0 then
  redis.call(
    "SREM",
    workingDaysKey,
    "2026-10-04"
  )
end

redis.call(
  "HSET",
  operationKey,
  "status",
  "completed",
  "action",
  "legacy-cancel",
  "completedAt",
  ARGV[1]
)

redis.call(
  "SET",
  flagKey,
  "1",
  "EX",
  "31536000"
)

return {"OK"}
`;

async function processLegacyCancel({
  chatId,
  userId,
  operationId
}) {
  const now =
    new Date().toISOString();

  const result = await redisEval(
    LEGACY_CANCEL_LUA,
    [
      migrationFlagKey(chatId),
      dailyKey(LEGACY_DATE),
      monthlyKey(LEGACY_MONTH),
      yearlyKey(LEGACY_YEAR),
      alltimeKey(),
      workingDaysKey(LEGACY_MONTH),
      operationKey(operationId)
    ],
    [now]
  );

  if (!Array.isArray(result)) {
    throw new Error("INVALID_LEGACY_RESULT");
  }

  const status = result[0];

  if (status === "OK") {
    await writeAudit({
      operationId,
      action: "legacy-cancel",
      chatId,
      userId,
      recordId: "legacy-2026-10-04",
      status: "success",
      sales: LEGACY_SALES,
      orders: LEGACY_ORDERS,
      reason: "legacy compatibility migration"
    });

    return {
      ok: true,
      legacy: true,
      duplicate: false,
      operationId,
      recordId: "legacy-2026-10-04",
      sales: LEGACY_SALES,
      orders: LEGACY_ORDERS,
      dateKey: LEGACY_DATE
    };
  }

  if (status === "ALREADY_USED") {
    throw new Error("NO_ACTIVE_SALE");
  }

  if (status === "DUPLICATE") {
    return {
      ok: true,
      duplicate: true,
      legacy: true,
      operationId
    };
  }

  if (status === "BALANCE_ERROR") {
    throw new Error("LEGACY_BALANCE_ERROR");
  }

  throw new Error(`LEGACY_CANCEL_REJECTED:${status}`);
}

/*
 * ------------------------------------------------------------
 * Aggregate
 * ------------------------------------------------------------
 */

async function getDaily(dateKey) {
  const data =
    await getHash(dailyKey(dateKey));

  return {
    sales: safeNumber(data.sales),
    orders: safeNumber(data.orders)
  };
}

async function getMonthly(monthKey) {
  const data =
    await getHash(monthlyKey(monthKey));

  return {
    sales: safeNumber(data.sales),
    orders: safeNumber(data.orders)
  };
}

async function getYearly(yearKey) {
  const data =
    await getHash(yearlyKey(yearKey));

  return {
    sales: safeNumber(data.sales),
    orders: safeNumber(data.orders)
  };
}

async function getAlltime() {
  const data =
    await getHash(alltimeKey());

  return {
    sales: safeNumber(data.sales),
    orders: safeNumber(data.orders)
  };
}

/*
 * ------------------------------------------------------------
 * Working days
 * ------------------------------------------------------------
 */

async function getWorkingDays(monthKey) {
  const result =
    await redisCommand([
      "SMEMBERS",
      workingDaysKey(monthKey)
    ]);

  if (!Array.isArray(result)) {
    return [];
  }

  return result.sort();
}

/*
 * ------------------------------------------------------------
 * Monthly best
 * ------------------------------------------------------------
 */

async function getMonthlyBest(monthKey) {
  const days =
    await getWorkingDays(monthKey);

  if (days.length === 0) {
    return {
      dateKey: null,
      sales: 0,
      orders: 0
    };
  }

  let best = {
    dateKey: null,
    sales: 0,
    orders: 0
  };

  /*
   * 並列取得ではなく順次取得。
   * Redis負荷を抑える。
   */
  for (const dateKey of days) {
    const data =
      await getDaily(dateKey);

    if (data.sales > best.sales) {
      best = {
        dateKey,
        sales: data.sales,
        orders: data.orders
      };
    }
  }

  return best;
}

/*
 * ------------------------------------------------------------
 * Record history
 * ------------------------------------------------------------
 */

async function getRecordHistory(chatId) {
  const ids =
    await redisCommand([
      "ZREVRANGE",
      recordsIndexKey(chatId),
      "0",
      "-1"
    ]);

  if (!Array.isArray(ids)) {
    return [];
  }

  const result = [];

  for (const id of ids) {
    const record =
      await getRecord(chatId, id);

    if (record && record.recordId) {
      result.push(record);
    }
  }

  return result;
}

/*
 * ------------------------------------------------------------
 * 整合性チェック
 * ------------------------------------------------------------
 *
 * 個別レコードを走査し、
 * cancelled=0 の合計と alltime が一致するか確認。
 *
 * 大規模DBでは重くなるため health 用。
 * ------------------------------------------------------------
 */

async function verifyConsistency(chatId) {
  const records =
    await getRecordHistory(chatId);

  let activeSales = 0;
  let activeOrders = 0;

  let invalidSignatures = 0;

  for (const record of records) {
    if (!verifyRecordSignature(record)) {
      invalidSignatures++;
    }

    if (record.cancelled !== "1") {
      activeSales += safeNumber(record.sales);
      activeOrders += safeNumber(record.orders);
    }
  }

  const alltime =
    await getAlltime();

  return {
    ok:
      invalidSignatures === 0 &&
      activeSales <= alltime.sales &&
      activeOrders <= alltime.orders,

    activeSales,
    activeOrders,
    alltimeSales: alltime.sales,
    alltimeOrders: alltime.orders,
    invalidSignatures,
    recordCount: records.length
  };
}

/*
 * ------------------------------------------------------------
 * Report
 * ------------------------------------------------------------
 */

function formatYen(value) {
  return `${Math.floor(safeNumber(value)).toLocaleString("ja-JP")}円`;
}

function formatNumber(value) {
  return Math.floor(
    safeNumber(value)
  ).toLocaleString("ja-JP");
}

async function buildReport() {
  const now =
    getTokyoDateInfo();

  const [
    daily,
    monthly,
    yearly,
    alltime,
    best,
    workingDays
  ] = await Promise.all([
    getDaily(now.dateKey),
    getMonthly(now.monthKey),
    getYearly(now.yearKey),
    getAlltime(),
    getMonthlyBest(now.monthKey),
    getWorkingDays(now.monthKey)
  ]);

  const target = 500000;

  const achievementRate =
    target > 0
      ? (monthly.sales / target) * 100
      : 0;

  const remaining =
    Math.max(0, target - monthly.sales);

  const averagePerOrder =
    monthly.orders > 0
      ? monthly.sales / monthly.orders
      : 0;

  const dailyAverage =
    workingDays.length > 0
      ? monthly.sales / workingDays.length
      : 0;

  return [
    "📊 売上レポート",
    "",
    `📅 今日: ${now.dateKey}`,
    "",
    "【本日】",
    `売上: ${formatYen(daily.sales)}`,
    `件数: ${formatNumber(daily.orders)}件`,
    "",
    "【今月】",
    `売上: ${formatYen(monthly.sales)}`,
    `件数: ${formatNumber(monthly.orders)}件`,
    `稼働日: ${formatNumber(workingDays.length)}日`,
    "",
    "【今月目標】",
    `目標: ${formatYen(target)}`,
    `達成率: ${achievementRate.toFixed(2)}%`,
    `残り: ${formatYen(remaining)}`,
    "",
    "【平均】",
    `1件平均: ${formatYen(averagePerOrder)}`,
    `1日平均: ${formatYen(dailyAverage)}`,
    "",
    "【年間】",
    `売上: ${formatYen(yearly.sales)}`,
    `件数: ${formatNumber(yearly.orders)}件`,
    "",
    "【累計】",
    `売上: ${formatYen(alltime.sales)}`,
    `件数: ${formatNumber(alltime.orders)}件`,
    "",
    "【今月最高日】",
    best.dateKey
      ? `${best.dateKey} / ${formatYen(best.sales)} / ${formatNumber(best.orders)}件`
      : "記録なし",
    "",
    achievementRate >= 100
      ? "🟢 目標達成"
      : achievementRate >= 80
        ? "🟢 順調"
        : achievementRate >= 50
          ? "🟡 進行中"
          : "🔴 要加速"
  ].join("\n");
}

/*
 * ------------------------------------------------------------
 * Health
 * ------------------------------------------------------------
 */

async function healthCheck(chatId) {
  const ping =
    await redisCommand(["PING"]);

  const consistency =
    await verifyConsistency(chatId);

  return {
    ok:
      ping === "PONG" &&
      consistency.ok,
    redis: ping,
    consistency
  };
}

/*
 * ------------------------------------------------------------
 * Exports
 * ------------------------------------------------------------
 */

module.exports = {
  redisCommand,
  redisEval,

  getTokyoDateInfo,

  processSales,
  processCancel,

  getDaily,
  getMonthly,
  getYearly,
  getAlltime,

  getWorkingDays,
  getMonthlyBest,
  getRecordHistory,

  verifyConsistency,
  healthCheck,

  buildReport,

  signRecord,
  verifyRecordSignature,

  createId
};
"use strict";

const crypto = require("crypto");

const sales = require("./sales");

/*
 * ============================================================
 * MOHEJI DELIVERY TELEGRAM API
 * telegram.js
 *
 * 役割:
 * - Telegram Webhook
 * - Secret Token検証
 * - Chat/User認証
 * - Update重複防止
 * - コマンド解析
 * - Telegram API
 * - エラー隠蔽
 *
 * 業務ロジックは sales.js に集約。
 * ============================================================
 */

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET;

const ALLOWED_CHAT_IDS =
  parseAllowList(
    process.env.TELEGRAM_ALLOWED_CHAT_IDS
  );

const ALLOWED_USER_IDS =
  parseAllowList(
    process.env.TELEGRAM_ALLOWED_USER_IDS
  );

const PHOTO_URL =
  process.env.TELEGRAM_REPORT_PHOTO_URL ||
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MAX_UPDATE_AGE_SECONDS = 86400;

const MAX_MESSAGE_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;

const MAX_SALES = 1000000000;
const MAX_ORDERS = 1000000;

/*
 * ------------------------------------------------------------
 * Allowlist
 * ------------------------------------------------------------
 */

function parseAllowList(value) {
  if (!value) {
    return new Set();
  }

  return new Set(
    String(value)
      .split(",")
      .map(v => v.trim())
      .filter(Boolean)
  );
}

/*
 * ------------------------------------------------------------
 * Environment
 * ------------------------------------------------------------
 */

function assertEnvironment() {
  if (!BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  if (
    !WEBHOOK_SECRET ||
    WEBHOOK_SECRET.length < 16 ||
    WEBHOOK_SECRET.length > 256
  ) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET is invalid"
    );
  }

  /*
   * デフォルト拒否。
   * Chat/Userのどちらかが設定されていない場合、
   * Botを誰でも操作できる状態にしない。
   */
  if (
    ALLOWED_CHAT_IDS.size === 0 &&
    ALLOWED_USER_IDS.size === 0
  ) {
    throw new Error(
      "No Telegram allowlist configured"
    );
  }
}

/*
 * ------------------------------------------------------------
 * Constant-time compare
 * ------------------------------------------------------------
 */

function safeEqual(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

  const aa =
    Buffer.from(a, "utf8");

  const bb =
    Buffer.from(b, "utf8");

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    aa,
    bb
  );
}

/*
 * ------------------------------------------------------------
 * Telegram webhook secret
 * ------------------------------------------------------------
 */

function verifyWebhookSecret(req) {
  const received =
    req.headers[
      "x-telegram-bot-api-secret-token"
    ];

  return safeEqual(
    String(received || ""),
    WEBHOOK_SECRET
  );
}

/*
 * ------------------------------------------------------------
 * Authorization
 * ------------------------------------------------------------
 */

function isAuthorized(message) {
  const chatId =
    String(message?.chat?.id ?? "");

  const userId =
    String(message?.from?.id ?? "");

  const chatAllowed =
    ALLOWED_CHAT_IDS.has(chatId);

  const userAllowed =
    ALLOWED_USER_IDS.has(userId);

  return chatAllowed || userAllowed;
}

/*
 * ------------------------------------------------------------
 * Telegram API
 * ------------------------------------------------------------
 */

async function telegramApi(method, payload) {
  assertEnvironment();

  const url =
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(
      `Telegram HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  if (!data || data.ok !== true) {
    throw new Error(
      `Telegram API rejected ${method}`
    );
  }

  return data;
}

/*
 * ------------------------------------------------------------
 * Send message
 * ------------------------------------------------------------
 */

async function sendTelegramMessage(
  chatId,
  message
) {
  const text =
    String(message || "");

  if (!text) {
    return;
  }

  const chunks =
    splitTelegramText(
      text,
      MAX_MESSAGE_LENGTH
    );

  for (const chunk of chunks) {
    await telegramApi(
      "sendMessage",
      {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true
      }
    );
  }
}

/*
 * ------------------------------------------------------------
 * Send photo
 * ------------------------------------------------------------
 */

async function sendTelegramPhoto(
  chatId,
  caption
) {
  const text =
    String(caption || "");

  /*
   * Telegram caption上限は1024文字。
   * 超えたら写真＋本文に分離。
   */
  if (text.length <= MAX_CAPTION_LENGTH) {
    await telegramApi(
      "sendPhoto",
      {
        chat_id: chatId,
        photo: PHOTO_URL,
        caption: text
      }
    );

    return;
  }

  await telegramApi(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: PHOTO_URL
    }
  );

  await sendTelegramMessage(
    chatId,
    text
  );
}

/*
 * ------------------------------------------------------------
 * Text splitter
 * ------------------------------------------------------------
 */

function splitTelegramText(
  text,
  maxLength
) {
  const result = [];

  let remaining =
    String(text || "");

  while (remaining.length > maxLength) {
    let cut =
      remaining.lastIndexOf(
        "\n",
        maxLength
      );

    if (cut < Math.floor(maxLength * 0.5)) {
      cut = maxLength;
    }

    result.push(
      remaining.slice(0, cut)
    );

    remaining =
      remaining.slice(cut);
  }

  if (remaining) {
    result.push(remaining);
  }

  return result;
}

/*
 * ------------------------------------------------------------
 * Redis Update idempotency
 * ------------------------------------------------------------
 */

async function claimUpdate(updateId) {
  if (
    updateId === undefined ||
    updateId === null
  ) {
    return true;
  }

  const key =
    `moheji:telegram:processed:${String(updateId)}`;

  const result =
    await sales.redisCommand([
      "SET",
      key,
      "1",
      "NX",
      "EX",
      MAX_UPDATE_AGE_SECONDS
    ]);

  return result === "OK";
}

/*
 * ------------------------------------------------------------
 * Message extraction
 * ------------------------------------------------------------
 */

function extractMessage(update) {
  if (update?.message) {
    return update.message;
  }

  if (update?.edited_message) {
    return update.edited_message;
  }

  if (update?.channel_post) {
    return update.channel_post;
  }

  return null;
}

/*
 * ------------------------------------------------------------
 * Command parser
 * ------------------------------------------------------------
 */

function parseCommand(text) {
  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    return null;
  }

  const trimmed =
    text.trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts =
    trimmed.split(/\s+/);

  let command =
    parts.shift()
      .toLowerCase();

  /*
   * /sales@botname
   * を /sales に正規化。
   */
  if (command.includes("@")) {
    command =
      command.split("@")[0];
  }

  return {
    command,
    args: parts
  };
}

/*
 * ------------------------------------------------------------
 * Sales argument parser
 * ------------------------------------------------------------
 */

function parseSalesArgs(args) {
  if (!Array.isArray(args)) {
    return null;
  }

  if (args.length !== 2) {
    return null;
  }

  /*
   * 数字以外を完全拒否。
   */
  if (
    !/^\d+$/.test(args[0]) ||
    !/^\d+$/.test(args[1])
  ) {
    return null;
  }

  const salesAmount =
    Number(args[0]);

  const orders =
    Number(args[1]);

  if (
    !Number.isSafeInteger(salesAmount) ||
    !Number.isSafeInteger(orders)
  ) {
    return null;
  }

  if (
    salesAmount <= 0 ||
    orders <= 0
  ) {
    return null;
  }

  if (salesAmount > MAX_SALES) {
    return null;
  }

  if (orders > MAX_ORDERS) {
    return null;
  }

  return {
    sales: salesAmount,
    orders
  };
}

/*
 * ------------------------------------------------------------
 * Usage
 * ------------------------------------------------------------
 */

const HELP_TEXT = [
  "📖 使い方",
  "",
  "/sales 売上 件数",
  "例: /sales 17014 17",
  "",
  "/cancel",
  "最新の売上を1件取り消します。",
  "",
  "/record",
  "売上レポートを表示します。",
  "",
  "/health",
  "システム整合性を確認します。"
].join("\n");

/*
 * ------------------------------------------------------------
 * Error message mapping
 * ------------------------------------------------------------
 */

function publicErrorMessage(error) {
  const code =
    String(error?.message || "");

  switch (code) {
    case "INVALID_INPUT":
      return "❌ 入力値が正しくありません。";

    case "SALES_TOO_LARGE":
      return "❌ 売上金額が上限を超えています。";

    case "ORDERS_TOO_LARGE":
      return "❌ 件数が上限を超えています。";

    case "NO_ACTIVE_SALE":
      return "❌ 取り消せる売上がありません。";

    case "RECORD_TAMPERED":
      return "🚨 売上データの整合性エラーを検出しました。処理を停止しました。";

    case "RECORD_CORRUPTED":
      return "🚨 売上レコードが破損しています。処理を停止しました。";

    case "AGGREGATE_INCONSISTENT":
      return "🚨 集計データに不整合を検出しました。処理を停止しました。";

    case "LEGACY_BALANCE_ERROR":
      return "🚨 旧データの集計整合性エラーです。処理を停止しました。";

    case "INVALID_REDIS_RESULT":
    case "INVALID_CANCEL_RESULT":
    case "INVALID_LEGACY_RESULT":
      return "⚠️ データベース応答を確認できませんでした。";

    default:
      return "⚠️ 処理中にエラーが発生しました。データ保護のため処理を停止しました。";
  }
}

/*
 * ------------------------------------------------------------
 * /sales
 * ------------------------------------------------------------
 */

async function handleSales(
  message,
  args
) {
  const parsed =
    parseSalesArgs(args);

  if (!parsed) {
    await sendTelegramMessage(
      message.chat.id,
      [
        "❌ 入力形式が正しくありません。",
        "",
        "正しい形式:",
        "/sales 売上 件数",
        "",
        "例:",
        "/sales 17014 17"
      ].join("\n")
    );

    return;
  }

  const result =
    await sales.processSales({
      chatId: message.chat.id,
      userId: message.from?.id || "",
      sales: parsed.sales,
      orders: parsed.orders
    });

  if (result.duplicate) {
    await sendTelegramMessage(
      message.chat.id,
      "⚠️ 同じ処理はすでに登録済みです。二重計上はしていません。"
    );

    return;
  }

  await sendTelegramMessage(
    message.chat.id,
    [
      "✅ 売上登録完了",
      "",
      `売上: ${parsed.sales.toLocaleString("ja-JP")}円`,
      `件数: ${parsed.orders.toLocaleString("ja-JP")}件`,
      `日付: ${result.dateKey}`,
      "",
      "二重登録防止: OK",
      "整合性署名: OK"
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * /cancel
 * ------------------------------------------------------------
 */

async function handleCancel(
  message
) {
  const result =
    await sales.processCancel({
      chatId: message.chat.id,
      userId: message.from?.id || ""
    });

  if (result.duplicate) {
    await sendTelegramMessage(
      message.chat.id,
      "⚠️ 同じ取消処理はすでに完了しています。"
    );

    return;
  }

  await sendTelegramMessage(
    message.chat.id,
    [
      "✅ 売上取消完了",
      "",
      `売上: ${Number(result.sales).toLocaleString("ja-JP")}円`,
      `件数: ${Number(result.orders).toLocaleString("ja-JP")}件`,
      `対象日: ${result.dateKey}`,
      "",
      result.legacy
        ? "旧データ互換取消: 実行"
        : "個別レコード取消: 実行",
      "二重取消防止: OK"
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * /record
 * ------------------------------------------------------------
 */

async function handleRecord(
  message
) {
  const report =
    await sales.buildReport();

  await sendTelegramPhoto(
    message.chat.id,
    report
  );
}

/*
 * ------------------------------------------------------------
 * /health
 * ------------------------------------------------------------
 */

async function handleHealth(
  message
) {
  const result =
    await sales.healthCheck(
      message.chat.id
    );

  const status =
    result.ok
      ? "🟢 HEALTHY"
      : "🔴 ERROR";

  const consistency =
    result.consistency;

  await sendTelegramMessage(
    message.chat.id,
    [
      "🔐 システム監査",
      "",
      status,
      "",
      `Redis: ${result.redis}`,
      `レコード数: ${consistency.recordCount}`,
      `署名エラー: ${consistency.invalidSignatures}`,
      "",
      `Active売上: ${consistency.activeSales.toLocaleString("ja-JP")}円`,
      `Active件数: ${consistency.activeOrders.toLocaleString("ja-JP")}件`,
      "",
      `累計売上: ${consistency.alltimeSales.toLocaleString("ja-JP")}円`,
      `累計件数: ${consistency.alltimeOrders.toLocaleString("ja-JP")}件`
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * Main
 * ------------------------------------------------------------
 */

module.exports = async function handler(
  req,
  res
) {
  /*
   * HTTP security headers
   */
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  res.setHeader(
    "Referrer-Policy",
    "no-referrer"
  );

  /*
   * POST only
   */
  if (req.method !== "POST") {
    res.status(405).json({
      ok: false,
      error: "method_not_allowed"
    });

    return;
  }

  try {
    assertEnvironment();

    /*
     * Telegram Webhook Secret
     */
    if (!verifyWebhookSecret(req)) {
      res.status(401).json({
        ok: false,
        error: "unauthorized"
      });

      return;
    }

    /*
     * Body
     */
    const update =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    if (
      !update ||
      typeof update !== "object"
    ) {
      res.status(400).json({
        ok: false,
        error: "invalid_body"
      });

      return;
    }

    /*
     * Telegram update重複防止
     */
    const claimed =
      await claimUpdate(
        update.update_id
      );

    if (!claimed) {
      res.status(200).json({
        ok: true,
        duplicate: true
      });

      return;
    }

    /*
     * Message取得
     */
    const message =
      extractMessage(update);

    if (!message) {
      res.status(200).json({
        ok: true,
        ignored: true
      });

      return;
    }

    /*
     * Chat ID必須
     */
    if (
      message.chat?.id === undefined
    ) {
      res.status(200).json({
        ok: true,
        ignored: true
      });

      return;
    }

    /*
     * Authorization
     */
    if (!isAuthorized(message)) {
      /*
       * 不正利用者には詳細を返さない。
       */
      res.status(200).json({
        ok: true
      });

      return;
    }

    /*
     * Text
     */
    const text =
      typeof message.text === "string"
        ? message.text
        : "";

    /*
     * 長大入力拒否
     */
    if (
      text.length > 1000
    ) {
      await sendTelegramMessage(
        message.chat.id,
        "❌ 入力が長すぎます。"
      );

      res.status(200).json({
        ok: true
      });

      return;
    }

    /*
     * Command
     */
    const command =
      parseCommand(text);

    if (!command) {
      res.status(200).json({
        ok: true,
        ignored: true
      });

      return;
    }

    switch (command.command) {
      case "/start":
      case "/help":
        await sendTelegramMessage(
          message.chat.id,
          HELP_TEXT
        );
        break;

      case "/sales":
        await handleSales(
          message,
          command.args
        );
        break;

      case "/cancel":
        if (command.args.length !== 0) {
          await sendTelegramMessage(
            message.chat.id,
            "❌ /cancel に引数は不要です。"
          );
        } else {
          await handleCancel(
            message
          );
        }
        break;

      case "/record":
        if (command.args.length !== 0) {
          await sendTelegramMessage(
            message.chat.id,
            "❌ /record に引数は不要です。"
          );
        } else {
          await handleRecord(
            message
          );
        }
        break;

      case "/health":
        if (command.args.length !== 0) {
          await sendTelegramMessage(
            message.chat.id,
            "❌ /health に引数は不要です。"
          );
        } else {
          await handleHealth(
            message
          );
        }
        break;

      default:
        await sendTelegramMessage(
          message.chat.id,
          "❓ 不明なコマンドです。\n/help で使い方を確認できます。"
        );
        break;
    }

    /*
     * Telegramには必ず正常応答。
     */
    res.status(200).json({
      ok: true
    });

  } catch (error) {
    /*
     * サーバーログには詳細。
     * Telegram利用者には内部情報を出さない。
     */
    console.error(
      "[telegram webhook error]",
      {
        message: error?.message,
        stack: error?.stack
      }
    );

    /*
     * chatIdが取れる場合だけ安全なエラー通知。
     */
    try {
      const update =
        typeof req.body === "string"
          ? JSON.parse(req.body)
          : req.body;

      const message =
        extractMessage(update);

      if (message?.chat?.id !== undefined) {
        await sendTelegramMessage(
          message.chat.id,
          publicErrorMessage(error)
        );
      }
    } catch {
      /*
       * 二次エラーは無視。
       */
    }

    /*
     * Webhook自体は200。
     *
     * Telegramが何度も同じupdateを再送して
     * 二重処理するのを避ける。
     */
    res.status(200).json({
      ok: true
    });
  }
};
