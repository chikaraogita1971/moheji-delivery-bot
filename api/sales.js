// api/sales.js

import crypto from "crypto";

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const SALES_HMAC_SECRET = process.env.SALES_HMAC_SECRET;

const MONTHLY_TARGET = 500000;
const AUDIT_LOG_MAX = 5000;

const LEGACY_DATE_KEY = "2026-10-04";
const LEGACY_MONTH_KEY = "2026-10";
const LEGACY_YEAR_KEY = "2026";
const LEGACY_SALES = 17014;
const LEGACY_ORDERS = 17;

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

function requireEnvironment() {
  const missing = [];

  if (!KV_REST_API_URL) missing.push("KV_REST_API_URL");
  if (!KV_REST_API_TOKEN) missing.push("KV_REST_API_TOKEN");
  if (!SALES_HMAC_SECRET) missing.push("SALES_HMAC_SECRET");

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Redis REST                                                                  */
/* -------------------------------------------------------------------------- */

async function redisRequest(endpoint, body) {
  requireEnvironment();

  const base = KV_REST_API_URL.replace(/\/+$/, "");

  const url =
    endpoint === ""
      ? base
      : `${base}/${endpoint.replace(/^\/+/, "")}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Redis returned invalid JSON. HTTP ${response.status}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Redis HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (data?.error) {
    throw new Error(`Redis error: ${data.error}`);
  }

  return data;
}

async function redisCommand(command, ...args) {
  const data = await redisRequest("", [command, ...args]);
  return data?.result;
}

async function redisEval(script, keys = [], args = []) {
  return redisCommand(
    "EVAL",
    script,
    String(keys.length),
    ...keys,
    ...args.map(String)
  );
}

async function redisPipeline(commands) {
  requireEnvironment();

  const base = KV_REST_API_URL.replace(/\/+$/, "");

  const response = await fetch(`${base}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("Redis pipeline returned invalid JSON");
  }

  if (!response.ok) {
    throw new Error(
      `Redis pipeline HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/* -------------------------------------------------------------------------- */
/* Redis keys                                                                  */
/* -------------------------------------------------------------------------- */

function dailyKey(dateKey) {
  return `moheji:delivery:daily:${dateKey}`;
}

function monthlyKey(monthKey) {
  return `moheji:delivery:month:${monthKey}`;
}

function yearlyKey(yearKey) {
  return `moheji:delivery:year:${yearKey}`;
}

function workingDaysKey(monthKey) {
  return `moheji:delivery:workingdays:${monthKey}`;
}

function allTimeKey() {
  return "moheji:delivery:alltime";
}

function recordKey(recordId) {
  return `moheji:delivery:record:${recordId}`;
}

function recordIndexKey(chatId) {
  return `moheji:delivery:records:${chatId}`;
}

function operationKey(operationId) {
  return `moheji:delivery:operation:${operationId}`;
}

function auditKey() {
  return "moheji:delivery:audit";
}

function legacyFlagKey() {
  return "moheji:delivery:legacy-cancel-2026-10-04";
}

/* -------------------------------------------------------------------------- */
/* Tokyo date                                                                  */
/* -------------------------------------------------------------------------- */

function getTokyoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  const dateKey =
    `${result.year}-${result.month}-${result.day}`;

  const monthKey =
    `${result.year}-${result.month}`;

  const yearKey = result.year;

  return {
    dateKey,
    monthKey,
    yearKey,
  };
}

/* -------------------------------------------------------------------------- */
/* HMAC                                                                        */
/* -------------------------------------------------------------------------- */

function hmacSha256(value) {
  return crypto
    .createHmac("sha256", SALES_HMAC_SECRET)
    .update(value)
    .digest("hex");
}

function canonicalRecord(record) {
  return [
    record.id,
    record.chatId,
    record.dateKey,
    record.monthKey,
    record.yearKey,
    record.sales,
    record.orders,
    record.createdAt,
  ].join("|");
}

function signRecord(record) {
  return hmacSha256(canonicalRecord(record));
}

function verifyRecordSignature(record) {
  if (!record?.signature) {
    return false;
  }

  const expected = signRecord(record);

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(record.signature), "utf8");

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function canonicalAudit(audit) {
  return [
    audit.operationId,
    audit.action,
    audit.recordId,
    audit.chatId,
    audit.sales,
    audit.orders,
    audit.timestamp,
  ].join("|");
}

function signAudit(audit) {
  return hmacSha256(canonicalAudit(audit));
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function normalizeChatId(chatId) {
  const value = String(chatId ?? "").trim();

  if (!/^-?\d{1,20}$/.test(value)) {
    throw new Error("Invalid chatId");
  }

  return value;
}

function normalizeSales(value) {
  const sales = Number(value);

  if (!Number.isSafeInteger(sales)) {
    throw new Error("Sales must be an integer");
  }

  if (sales <= 0 || sales > 1000000000) {
    throw new Error("Sales is out of range");
  }

  return sales;
}

function normalizeOrders(value) {
  const orders = Number(value);

  if (!Number.isSafeInteger(orders)) {
    throw new Error("Orders must be an integer");
  }

  if (orders <= 0 || orders > 1000000) {
    throw new Error("Orders is out of range");
  }

  return orders;
}

function createOperationId() {
  return crypto.randomUUID();
}

function buildRecord({
  chatId,
  sales,
  orders,
  createdAt = new Date().toISOString(),
}) {
  const normalizedChatId = normalizeChatId(chatId);
  const normalizedSales = normalizeSales(sales);
  const normalizedOrders = normalizeOrders(orders);

  const {
    dateKey,
    monthKey,
    yearKey,
  } = getTokyoDateParts(new Date(createdAt));

  const id = crypto.randomUUID();

  const record = {
    id,
    chatId: normalizedChatId,
    dateKey,
    monthKey,
    yearKey,
    sales: normalizedSales,
    orders: normalizedOrders,
    createdAt,
  };

  record.signature = signRecord(record);

  return record;
}

/* -------------------------------------------------------------------------- */
/* Redis type inspection                                                       */
/* -------------------------------------------------------------------------- */

async function inspectKeyTypes(keys) {
  const commands = keys.map((key) => ["TYPE", key]);
  const results = await redisPipeline(commands);

  return keys.map((key, index) => ({
    key,
    type: results?.[index]?.result ?? "unknown",
  }));
}

function isMissingOrType(type, expected) {
  return type === "none" || type === expected;
}

async function assertSaleKeyTypes({
  operationId,
  recordId,
  chatId,
  dateKey,
  monthKey,
  yearKey,
}) {
  const keys = [
    operationKey(operationId),
    recordKey(recordId),
    recordIndexKey(chatId),
    dailyKey(dateKey),
    monthlyKey(monthKey),
    yearlyKey(yearKey),
    allTimeKey(),
    workingDaysKey(monthKey),
    auditKey(),
  ];

  /*
   * IMPORTANT:
   *
   * records:<chatId> is an existing ZSET in Redis.
   * Do NOT change it to LIST and do NOT delete it.
   */
  const expected = [
    "string",
    "hash",
    "zset",
    "hash",
    "hash",
    "hash",
    "hash",
    "set",
    "list",
  ];

  const inspected = await inspectKeyTypes(keys);

  const bad = [];

  for (let i = 0; i < inspected.length; i++) {
    const actual = inspected[i].type;
    const wanted = expected[i];

    if (!isMissingOrType(actual, wanted)) {
      bad.push({
        key: inspected[i].key,
        expected: wanted,
        actual,
      });
    }
  }

  if (bad.length) {
    const details = bad
      .map(
        (item) =>
          `${item.key} expected=${item.expected} actual=${item.actual}`
      )
      .join("; ");

    throw new Error(
      `REDIS_TYPE_MISMATCH: ${details}`
    );
  }
}

async function assertCancelKeyTypes({
  operationId,
  recordId,
  monthKey,
  dateKey,
  yearKey,
}) {
  const keys = [
    operationKey(operationId),
    recordKey(recordId),
    dailyKey(dateKey),
    monthlyKey(monthKey),
    yearlyKey(yearKey),
    allTimeKey(),
    workingDaysKey(monthKey),
    auditKey(),
  ];

  const expected = [
    "string",
    "hash",
    "hash",
    "hash",
    "hash",
    "hash",
    "set",
    "list",
  ];

  const inspected = await inspectKeyTypes(keys);

  const bad = [];

  for (let i = 0; i < inspected.length; i++) {
    const actual = inspected[i].type;
    const wanted = expected[i];

    if (!isMissingOrType(actual, wanted)) {
      bad.push({
        key: inspected[i].key,
        expected: wanted,
        actual,
      });
    }
  }

  if (bad.length) {
    const details = bad
      .map(
        (item) =>
          `${item.key} expected=${item.expected} actual=${item.actual}`
      )
      .join("; ");

    throw new Error(
      `REDIS_TYPE_MISMATCH: ${details}`
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Sale transaction                                                            */
/* -------------------------------------------------------------------------- */

const SALE_SCRIPT = `
local operationKey = KEYS[1]
local recordKey = KEYS[2]
local recordIndexKey = KEYS[3]
local dailyKey = KEYS[4]
local monthlyKey = KEYS[5]
local yearlyKey = KEYS[6]
local allTimeKey = KEYS[7]
local workingDaysKey = KEYS[8]
local auditKey = KEYS[9]

local operationId = ARGV[1]

local existing = redis.call('GET', operationKey)

if existing then
  return {'DUPLICATE', existing}
end

redis.call(
  'HSET',
  recordKey,
  'id', ARGV[2],
  'chatId', ARGV[3],
  'dateKey', ARGV[4],
  'monthKey', ARGV[5],
  'yearKey', ARGV[6],
  'sales', ARGV[7],
  'orders', ARGV[8],
  'createdAt', ARGV[9],
  'status', 'active',
  'signature', ARGV[10]
)

-- Existing Redis schema uses ZSET for records:<chatId>.
-- Score is the creation timestamp in milliseconds.
redis.call(
  'ZADD',
  recordIndexKey,
  ARGV[12],
  ARGV[2]
)

redis.call(
  'HINCRBY',
  dailyKey,
  'sales',
  ARGV[7]
)

redis.call(
  'HINCRBY',
  dailyKey,
  'orders',
  ARGV[8]
)

redis.call(
  'HINCRBY',
  monthlyKey,
  'sales',
  ARGV[7]
)

redis.call(
  'HINCRBY',
  monthlyKey,
  'orders',
  ARGV[8]
)

redis.call(
  'HINCRBY',
  yearlyKey,
  'sales',
  ARGV[7]
)

redis.call(
  'HINCRBY',
  yearlyKey,
  'orders',
  ARGV[8]
)

redis.call(
  'HINCRBY',
  allTimeKey,
  'sales',
  ARGV[7]
)

redis.call(
  'HINCRBY',
  allTimeKey,
  'orders',
  ARGV[8]
)

redis.call(
  'SADD',
  workingDaysKey,
  ARGV[4]
)

redis.call(
  'LPUSH',
  auditKey,
  ARGV[11]
)

redis.call(
  'LTRIM',
  auditKey,
  0,
  4999
)

redis.call(
  'SET',
  operationKey,
  ARGV[2]
)

return {'OK', ARGV[2]}
`;

async function registerSale({
  chatId,
  sales,
  orders,
}) {
  const operationId = createOperationId();

  const record = buildRecord({
    chatId,
    sales,
    orders,
  });

  /*
   * Validate every Redis key before the transaction.
   * Existing data is never deleted here.
   */
  await assertSaleKeyTypes({
    operationId,
    recordId: record.id,
    chatId: record.chatId,
    dateKey: record.dateKey,
    monthKey: record.monthKey,
    yearKey: record.yearKey,
  });

  const audit = {
    operationId,
    action: "sale",
    recordId: record.id,
    chatId: record.chatId,
    sales: record.sales,
    orders: record.orders,
    timestamp: new Date().toISOString(),
  };

  audit.signature = signAudit(audit);

  const timestamp = Date.parse(record.createdAt);

  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid record timestamp");
  }

  const result = await redisEval(
    SALE_SCRIPT,
    [
      operationKey(operationId),
      recordKey(record.id),
      recordIndexKey(record.chatId),
      dailyKey(record.dateKey),
      monthlyKey(record.monthKey),
      yearlyKey(record.yearKey),
      allTimeKey(),
      workingDaysKey(record.monthKey),
      auditKey(),
    ],
    [
      operationId,
      record.id,
      record.chatId,
      record.dateKey,
      record.monthKey,
      record.yearKey,
      record.sales,
      record.orders,
      record.createdAt,
      record.signature,
      JSON.stringify(audit),
      timestamp,
    ]
  );

  if (!Array.isArray(result)) {
    throw new Error(
      `Unexpected sale result: ${JSON.stringify(result)}`
    );
  }

  if (result[0] === "DUPLICATE") {
    throw new Error(
      `Duplicate operation detected: ${String(result[1] ?? "")}`
    );
  }

  if (result[0] !== "OK") {
    throw new Error(
      `Sale transaction failed: ${JSON.stringify(result)}`
    );
  }

  return {
    operationId,
    record,
  };
}

/* -------------------------------------------------------------------------- */
/* Hash / records                                                              */
/* -------------------------------------------------------------------------- */

async function getHash(key) {
  const result = await redisCommand("HGETALL", key);

  if (!Array.isArray(result)) {
    return {};
  }

  const object = {};

  for (let i = 0; i < result.length; i += 2) {
    object[result[i]] = result[i + 1];
  }

  return object;
}

async function getRecord(recordId) {
  const record = await getHash(recordKey(recordId));

  if (!record?.id) {
    return null;
  }

  return {
    ...record,
    sales: Number(record.sales),
    orders: Number(record.orders),
  };
}

async function getLatestActiveRecord(chatId) {
  const normalizedChatId = normalizeChatId(chatId);

  /*
   * Existing records:<chatId> is ZSET.
   * Highest timestamp = newest record.
   */
  const ids = await redisCommand(
    "ZREVRANGE",
    recordIndexKey(normalizedChatId),
    0,
    100
  );

  if (!Array.isArray(ids)) {
    return null;
  }

  for (const id of ids) {
    const record = await getRecord(id);

    if (!record) {
      continue;
    }

    if (String(record.chatId) !== normalizedChatId) {
      continue;
    }

    if (record.status !== "active") {
      continue;
    }

    return record;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Cancel transaction                                                          */
/* -------------------------------------------------------------------------- */

const CANCEL_SCRIPT = `
local operationKey = KEYS[1]
local recordKey = KEYS[2]
local dailyKey = KEYS[3]
local monthlyKey = KEYS[4]
local yearlyKey = KEYS[5]
local allTimeKey = KEYS[6]
local workingDaysKey = KEYS[7]
local auditKey = KEYS[8]

local operationId = ARGV[1]
local dateKey = ARGV[2]

local existing = redis.call('GET', operationKey)

if existing then
  return {'DUPLICATE', existing}
end

local status = redis.call(
  'HGET',
  recordKey,
  'status'
)

if not status then
  return {'NOT_FOUND'}
end

if status ~= 'active' then
  return {'ALREADY_CANCELLED'}
end

local sales = tonumber(
  redis.call('HGET', recordKey, 'sales') or '0'
)

local orders = tonumber(
  redis.call('HGET', recordKey, 'orders') or '0'
)

local dailySales = tonumber(
  redis.call('HGET', dailyKey, 'sales') or '0'
)

local dailyOrders = tonumber(
  redis.call('HGET', dailyKey, 'orders') or '0'
)

local monthlySales = tonumber(
  redis.call('HGET', monthlyKey, 'sales') or '0'
)

local monthlyOrders = tonumber(
  redis.call('HGET', monthlyKey, 'orders') or '0'
)

local yearlySales = tonumber(
  redis.call('HGET', yearlyKey, 'sales') or '0'
)

local yearlyOrders = tonumber(
  redis.call('HGET', yearlyKey, 'orders') or '0'
)

local allTimeSales = tonumber(
  redis.call('HGET', allTimeKey, 'sales') or '0'
)

local allTimeOrders = tonumber(
  redis.call('HGET', allTimeKey, 'orders') or '0'
)

if dailySales < sales or dailyOrders < orders then
  return {'INSUFFICIENT_DAILY'}
end

if monthlySales < sales or monthlyOrders < orders then
  return {'INSUFFICIENT_MONTHLY'}
end

if yearlySales < sales or yearlyOrders < orders then
  return {'INSUFFICIENT_YEARLY'}
end

if allTimeSales < sales or allTimeOrders < orders then
  return {'INSUFFICIENT_ALLTIME'}
end

redis.call(
  'HINCRBY',
  dailyKey,
  'sales',
  -sales
)

redis.call(
  'HINCRBY',
  dailyKey,
  'orders',
  -orders
)

redis.call(
  'HINCRBY',
  monthlyKey,
  'sales',
  -sales
)

redis.call(
  'HINCRBY',
  monthlyKey,
  'orders',
  -orders
)

redis.call(
  'HINCRBY',
  yearlyKey,
  'sales',
  -sales
)

redis.call(
  'HINCRBY',
  yearlyKey,
  'orders',
  -orders
)

redis.call(
  'HINCRBY',
  allTimeKey,
  'sales',
  -sales
)

redis.call(
  'HINCRBY',
  allTimeKey,
  'orders',
  -orders
)

local finalDailySales = tonumber(
  redis.call('HGET', dailyKey, 'sales') or '0'
)

local finalDailyOrders = tonumber(
  redis.call('HGET', dailyKey, 'orders') or '0'
)

if finalDailySales <= 0 and finalDailyOrders <= 0 then
  redis.call(
    'SREM',
    workingDaysKey,
    dateKey
  )
end

redis.call(
  'HSET',
  recordKey,
  'status',
  'cancelled',
  'cancelledAt',
  ARGV[3],
  'cancelOperationId',
  operationId
)

redis.call(
  'LPUSH',
  auditKey,
  ARGV[4]
)

redis.call(
  'LTRIM',
  auditKey,
  0,
  4999
)

redis.call(
  'SET',
  operationKey,
  ARGV[5]
)

return {'OK'}
`;

async function cancelLatestSale(chatId) {
  const normalizedChatId = normalizeChatId(chatId);

  const record = await getLatestActiveRecord(
    normalizedChatId
  );

  if (!record) {
    throw new Error(
      "No active sales record found"
    );
  }

  if (!verifyRecordSignature(record)) {
    throw new Error(
      "Record signature verification failed"
    );
  }

  const operationId = createOperationId();
  const cancelledAt = new Date().toISOString();

  await assertCancelKeyTypes({
    operationId,
    recordId: record.id,
    monthKey: record.monthKey,
    dateKey: record.dateKey,
    yearKey: record.yearKey,
  });

  const audit = {
    operationId,
    action: "cancel",
    recordId: record.id,
    chatId: record.chatId,
    sales: record.sales,
    orders: record.orders,
    timestamp: cancelledAt,
  };

  audit.signature = signAudit(audit);

  const result = await redisEval(
    CANCEL_SCRIPT,
    [
      operationKey(operationId),
      recordKey(record.id),
      dailyKey(record.dateKey),
      monthlyKey(record.monthKey),
      yearlyKey(record.yearKey),
      allTimeKey(),
      workingDaysKey(record.monthKey),
      auditKey(),
    ],
    [
      operationId,
      record.dateKey,
      cancelledAt,
      JSON.stringify(audit),
      record.id,
    ]
  );

  if (!Array.isArray(result)) {
    throw new Error(
      `Unexpected cancel result: ${JSON.stringify(result)}`
    );
  }

  const code = result[0];

  if (code === "DUPLICATE") {
    throw new Error(
      `Duplicate cancel operation: ${String(result[1] ?? "")}`
    );
  }

  if (code === "NOT_FOUND") {
    throw new Error("Record was not found");
  }

  if (code === "ALREADY_CANCELLED") {
    throw new Error(
      "This record is already cancelled"
    );
  }

  if (code === "INSUFFICIENT_DAILY") {
    throw new Error(
      "Daily aggregate is smaller than the record"
    );
  }

  if (code === "INSUFFICIENT_MONTHLY") {
    throw new Error(
      "Monthly aggregate is smaller than the record"
    );
  }

  if (code === "INSUFFICIENT_YEARLY") {
    throw new Error(
      "Yearly aggregate is smaller than the record"
    );
  }

  if (code === "INSUFFICIENT_ALLTIME") {
    throw new Error(
      "All-time aggregate is smaller than the record"
    );
  }

  if (code !== "OK") {
    throw new Error(
      `Cancel transaction failed: ${JSON.stringify(result)}`
    );
  }

  return {
    operationId,
    record: {
      ...record,
      status: "cancelled",
      cancelledAt,
      cancelOperationId: operationId,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Legacy migration                                                            */
/* -------------------------------------------------------------------------- */

async function migrateLegacyCancellation() {
  const alreadyDone = await redisCommand(
    "GET",
    legacyFlagKey()
  );

  if (alreadyDone) {
    return false;
  }

  const result = await redisEval(
    `
    local flagKey = KEYS[1]
    local dailyKey = KEYS[2]
    local monthlyKey = KEYS[3]
    local yearlyKey = KEYS[4]
    local allTimeKey = KEYS[5]
    local workingDaysKey = KEYS[6]

    if redis.call('GET', flagKey) then
      return {'ALREADY'}
    end

    redis.call(
      'HINCRBY',
      dailyKey,
      'sales',
      -ARGV[1]
    )

    redis.call(
      'HINCRBY',
      dailyKey,
      'orders',
      -ARGV[2]
    )

    redis.call(
      'HINCRBY',
      monthlyKey,
      'sales',
      -ARGV[1]
    )

    redis.call(
      'HINCRBY',
      monthlyKey,
      'orders',
      -ARGV[2]
    )

    redis.call(
      'HINCRBY',
      yearlyKey,
      'sales',
      -ARGV[1]
    )

    redis.call(
      'HINCRBY',
      yearlyKey,
      'orders',
      -ARGV[2]
    )

    redis.call(
      'HINCRBY',
      allTimeKey,
      'sales',
      -ARGV[1]
    )

    redis.call(
      'HINCRBY',
      allTimeKey,
      'orders',
      -ARGV[2]
    )

    redis.call(
      'SREM',
      workingDaysKey,
      ARGV[3]
    )

    redis.call(
      'SET',
      flagKey,
      '1'
    )

    return {'OK'}
    `,
    [
      legacyFlagKey(),
      dailyKey(LEGACY_DATE_KEY),
      monthlyKey(LEGACY_MONTH_KEY),
      yearlyKey(LEGACY_YEAR_KEY),
      allTimeKey(),
      workingDaysKey(LEGACY_MONTH_KEY),
    ],
    [
      LEGACY_SALES,
      LEGACY_ORDERS,
      LEGACY_DATE_KEY,
    ]
  );

  return (
    Array.isArray(result) &&
    result[0] === "OK"
  );
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

async function getDaily(dateKey) {
  return getHash(dailyKey(dateKey));
}

async function getMonthly(monthKey) {
  return getHash(monthlyKey(monthKey));
}

async function getYearly(yearKey) {
  return getHash(yearlyKey(yearKey));
}

async function getAllTime() {
  return getHash(allTimeKey());
}

async function getWorkingDays(monthKey) {
  const result = await redisCommand(
    "SMEMBERS",
    workingDaysKey(monthKey)
  );

  return Array.isArray(result) ? result : [];
}

async function getMonthlyBest(monthKey) {
  const workingDays =
    await getWorkingDays(monthKey);

  if (!workingDays.length) {
    return {
      sales: 0,
      salesDate: null,
      orders: 0,
      ordersDate: null,
    };
  }

  const commands = workingDays.map(
    (dateKey) => [
      "HGETALL",
      dailyKey(dateKey),
    ]
  );

  const results =
    await redisPipeline(commands);

  let bestSales = 0;
  let bestSalesDate = null;

  let bestOrders = 0;
  let bestOrdersDate = null;

  for (let i = 0; i < results.length; i++) {
    const dateKey = workingDays[i];
    const raw = results[i]?.result;

    if (!Array.isArray(raw)) {
      continue;
    }

    const hash = {};

    for (let j = 0; j < raw.length; j += 2) {
      hash[raw[j]] = raw[j + 1];
    }

    const sales = Number(
      hash.sales || 0
    );

    const orders = Number(
      hash.orders || 0
    );

    if (sales > bestSales) {
      bestSales = sales;
      bestSalesDate = dateKey;
    }

    if (orders > bestOrders) {
      bestOrders = orders;
      bestOrdersDate = dateKey;
    }
  }

  return {
    sales: bestSales,
    salesDate: bestSalesDate,
    orders: bestOrders,
    ordersDate: bestOrdersDate,
  };
}

function yen(value) {
  return `¥${Number(
    value || 0
  ).toLocaleString("ja-JP")}`;
}

function percent(value) {
  return `${Number(
    value || 0
  ).toFixed(1)}%`;
}

async function buildReport() {
  const {
    dateKey,
    monthKey,
    yearKey,
  } = getTokyoDateParts();

  const [
    today,
    month,
    year,
    allTime,
    workingDays,
    best,
  ] = await Promise.all([
    getDaily(dateKey),
    getMonthly(monthKey),
    getYearly(yearKey),
    getAllTime(),
    getWorkingDays(monthKey),
    getMonthlyBest(monthKey),
  ]);

  const todaySales =
    Number(today.sales || 0);

  const todayOrders =
    Number(today.orders || 0);

  const monthSales =
    Number(month.sales || 0);

  const monthOrders =
    Number(month.orders || 0);

  const yearSales =
    Number(year.sales || 0);

  const yearOrders =
    Number(year.orders || 0);

  const allSales =
    Number(allTime.sales || 0);

  const allOrders =
    Number(allTime.orders || 0);

  const workingDayCount =
    workingDays.length;

  const dailyAverage =
    workingDayCount > 0
      ? monthSales / workingDayCount
      : 0;

  const averageOrderValue =
    monthOrders > 0
      ? monthSales / monthOrders
      : 0;

  const achievementRate =
    MONTHLY_TARGET > 0
      ? (monthSales / MONTHLY_TARGET) * 100
      : 0;

  const remaining =
    Math.max(
      MONTHLY_TARGET - monthSales,
      0
    );

  return {
    dateKey,
    monthKey,
    yearKey,

    today: {
      sales: todaySales,
      orders: todayOrders,
    },

    month: {
      sales: monthSales,
      orders: monthOrders,
    },

    year: {
      sales: yearSales,
      orders: yearOrders,
    },

    allTime: {
      sales: allSales,
      orders: allOrders,
    },

    workingDays: workingDayCount,

    dailyAverage,
    averageOrderValue,

    monthlyTarget: MONTHLY_TARGET,
    achievementRate,
    remaining,

    bestDailySales: best.sales,
    bestDailySalesDate: best.salesDate,

    bestDailyOrders: best.orders,
    bestDailyOrdersDate: best.ordersDate,

    formatted: {
      todaySales: yen(todaySales),
      monthSales: yen(monthSales),
      yearSales: yen(yearSales),
      allTimeSales: yen(allSales),
      dailyAverage: yen(
        Math.round(dailyAverage)
      ),
      averageOrderValue: yen(
        Math.round(averageOrderValue)
      ),
      monthlyTarget: yen(
        MONTHLY_TARGET
      ),
      remaining: yen(remaining),
      achievementRate:
        percent(achievementRate),
      bestDailySales:
        yen(best.sales),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 24 month record report                                                      */
/* -------------------------------------------------------------------------- */

async function buildRecordReport() {
  const now = new Date();

  const months = [];

  for (let i = 0; i < 24; i++) {
    const date = new Date(
      now.getFullYear(),
      now.getMonth() - i,
      1
    );

    const year =
      date.getFullYear();

    const month =
      String(
        date.getMonth() + 1
      ).padStart(2, "0");

    months.push(
      `${year}-${month}`
    );
  }

  const rows = await Promise.all(
    months.map(async (monthKey) => {
      const [
        monthly,
        workingDays,
        best,
      ] = await Promise.all([
        getMonthly(monthKey),
        getWorkingDays(monthKey),
        getMonthlyBest(monthKey),
      ]);

      const sales =
        Number(monthly.sales || 0);

      const orders =
        Number(monthly.orders || 0);

      const days =
        workingDays.length;

      return {
        monthKey,
        sales,
        orders,
        workingDays: days,
        dailyAverage:
          days > 0
            ? sales / days
            : 0,
        bestDailySales:
          best.sales,
        bestDailyOrders:
          best.orders,
      };
    })
  );

  return rows;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

async function getAuditLogs(limit = 50) {
  const safeLimit = Math.min(
    Math.max(
      Number(limit) || 50,
      1
    ),
    500
  );

  const result = await redisCommand(
    "LRANGE",
    auditKey(),
    0,
    safeLimit - 1
  );

  if (!Array.isArray(result)) {
    return [];
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

async function diagnoseSaleRedis(chatId) {
  const normalizedChatId =
    normalizeChatId(chatId);

  const {
    dateKey,
    monthKey,
    yearKey,
  } = getTokyoDateParts();

  const keys = [
    dailyKey(dateKey),
    monthlyKey(monthKey),
    yearlyKey(yearKey),
    allTimeKey(),
    workingDaysKey(monthKey),
    recordIndexKey(normalizedChatId),
    auditKey(),
  ];

  const inspected =
    await inspectKeyTypes(keys);

  return {
    dateKey,
    monthKey,
    yearKey,
    keys: inspected,
  };
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                     */
/* -------------------------------------------------------------------------- */

export {
  registerSale,
  cancelLatestSale,
  buildReport,
  buildRecordReport,
  getAuditLogs,
  migrateLegacyCancellation,
  getDaily,
  getMonthly,
  getYearly,
  getAllTime,
  getWorkingDays,
  getMonthlyBest,
  getRecord,
  getLatestActiveRecord,
  verifyRecordSignature,
  diagnoseSaleRedis,
  redisCommand,
  redisPipeline,
};
