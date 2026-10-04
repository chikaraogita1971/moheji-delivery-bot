// api/sales.js

import crypto from "crypto";


/* =========================================================
   Environment
========================================================= */

const KV_REST_API_URL =
  process.env.KV_REST_API_URL;

const KV_REST_API_TOKEN =
  process.env.KV_REST_API_TOKEN;

const SALES_HMAC_SECRET =
  process.env.SALES_HMAC_SECRET;


/* =========================================================
   Constants
========================================================= */

const TIME_ZONE =
  "Asia/Tokyo";

const MONTHLY_TARGET =
  500000;

const AUDIT_LOG_MAX =
  5000;

const LEGACY_DATE =
  "2026-10-04";

const LEGACY_SALES =
  17014;

const LEGACY_ORDERS =
  17;


/* =========================================================
   Environment validation
========================================================= */

function requireRedisEnvironment() {
  const missing = [];

  if (!KV_REST_API_URL) {
    missing.push(
      "KV_REST_API_URL"
    );
  }

  if (!KV_REST_API_TOKEN) {
    missing.push(
      "KV_REST_API_TOKEN"
    );
  }

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}


function requireHmacSecret() {
  if (!SALES_HMAC_SECRET) {
    throw new Error(
      "Missing environment variable: SALES_HMAC_SECRET"
    );
  }
}


/* =========================================================
   Formatting
========================================================= */

function integer(value) {
  return Number(
    value || 0
  ).toLocaleString(
    "ja-JP"
  );
}


function yen(value) {
  return `¥${integer(value)}`;
}


function percent(value) {
  return `${Number(
    value || 0
  ).toFixed(1)}%`;
}


/* =========================================================
   Number helpers
========================================================= */

function toSafeInteger(
  value,
  name
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    )
  ) {
    throw new Error(
      `${name} must be a safe integer.`
    );
  }

  return number;
}


function positiveInteger(
  value,
  name
) {
  const number =
    toSafeInteger(
      value,
      name
    );

  if (number <= 0) {
    throw new Error(
      `${name} must be greater than 0.`
    );
  }

  return number;
}


/* =========================================================
   Redis HTTP
========================================================= */

async function redisRequest(
  command
) {
  requireRedisEnvironment();

  const response =
    await fetch(
      KV_REST_API_URL,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${KV_REST_API_TOKEN}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(command),
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    data?.error
  ) {
    throw new Error(
      `Redis HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}


/* =========================================================
   Redis command
========================================================= */

async function redisCommand(
  command,
  ...args
) {
  const result =
    await redisRequest([
      command,
      ...args,
    ]);

  return result.result;
}


/* =========================================================
   Redis pipeline
========================================================= */

async function redisPipeline(
  commands
) {
  requireRedisEnvironment();

  const response =
    await fetch(
      `${KV_REST_API_URL}/pipeline`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${KV_REST_API_TOKEN}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            commands
          ),
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    data?.error
  ) {
    throw new Error(
      `Redis pipeline HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data.result;
}


/* =========================================================
   Redis EVAL
========================================================= */

async function redisEval(
  script,
  keys,
  args
) {
  return redisCommand(
    "EVAL",
    script,
    String(keys.length),
    ...keys,
    ...args.map(String)
  );
}


/* =========================================================
   Tokyo date
========================================================= */

function getTokyoDateParts(
  date = new Date()
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          TIME_ZONE,

        year: "numeric",
        month: "2-digit",
        day: "2-digit",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",

        hourCycle: "h23",
      }
    ).formatToParts(date);

  const map = {};

  for (const part of parts) {
    map[part.type] =
      part.value;
  }

  const year =
    Number(map.year);

  const month =
    Number(map.month);

  const day =
    Number(map.day);

  const hour =
    Number(map.hour);

  const minute =
    Number(map.minute);

  const second =
    Number(map.second);

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,

    dateKey:
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,

    monthKey:
      `${year}-${String(month).padStart(2, "0")}`,

    yearKey:
      String(year),
  };
}


/* =========================================================
   Keys
========================================================= */

function dailyKey(
  dateKey
) {
  return `moheji:delivery:daily:${dateKey}`;
}


function monthlyKey(
  monthKey
) {
  return `moheji:delivery:month:${monthKey}`;
}


function yearlyKey(
  yearKey
) {
  return `moheji:delivery:year:${yearKey}`;
}


function workingDaysKey(
  monthKey
) {
  return `moheji:delivery:workingdays:${monthKey}`;
}


function allTimeKey() {
  return "moheji:delivery:alltime";
}


function recordKey(
  chatId,
  recordId
) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}


/*
  IMPORTANT:
  Existing Redis schema uses ZSET here.
*/
function recordIndexKey(
  chatId
) {
  return `moheji:delivery:records:${chatId}`;
}


function operationKey(
  operationId
) {
  return `moheji:delivery:operation:${operationId}`;
}


function auditKey(
  chatId
) {
  return `moheji:delivery:audit:${chatId}`;
}


function legacyKey(
  chatId
) {
  return `moheji:delivery:legacy:${chatId}:${LEGACY_DATE}`;
}


/* =========================================================
   Chat ID validation
========================================================= */

function normalizeChatId(
  chatId
) {
  const value =
    Number(chatId);

  if (
    !Number.isSafeInteger(
      value
    )
  ) {
    throw new Error(
      "Invalid chat ID."
    );
  }

  return String(value);
}


/* =========================================================
   Record ID
========================================================= */

function createRecordId() {
  return crypto.randomUUID();
}


/* =========================================================
   HMAC-SHA256
========================================================= */

function hmacSha256(
  value
) {
  requireHmacSecret();

  return crypto
    .createHmac(
      "sha256",
      SALES_HMAC_SECRET
    )
    .update(
      value,
      "utf8"
    )
    .digest("hex");
}


function canonicalRecord(
  record
) {
  return [
    record.recordId,
    record.chatId,
    record.dateKey,
    record.sales,
    record.orders,
    record.createdAt,
  ].join("|");
}


function signRecord(
  record
) {
  return hmacSha256(
    canonicalRecord(
      record
    )
  );
}


function canonicalAudit(
  audit
) {
  return [
    audit.operationId,
    audit.type,
    audit.chatId,
    audit.recordId || "",
    audit.dateKey || "",
    audit.sales || 0,
    audit.orders || 0,
    audit.createdAt,
  ].join("|");
}


function signAudit(
  audit
) {
  return hmacSha256(
    canonicalAudit(
      audit
    )
  );
}


/* =========================================================
   Record creation
========================================================= */

function buildRecord({
  chatId,
  sales,
  orders,
  operationId,
  createdAt,
}) {
  const date =
    getTokyoDateParts(
      new Date(createdAt)
    );

  const record = {
    recordId:
      createRecordId(),

    operationId,

    chatId:
      String(chatId),

    dateKey:
      date.dateKey,

    monthKey:
      date.monthKey,

    yearKey:
      date.yearKey,

    sales:
      String(sales),

    orders:
      String(orders),

    createdAt,

    status:
      "active",
  };

  record.signature =
    signRecord(
      record
    );

  return record;
}


/* =========================================================
   Type inspection
========================================================= */

async function inspectKeyType(
  key
) {
  return redisCommand(
    "TYPE",
    key
  );
}


async function assertType(
  key,
  expected
) {
  const actual =
    await inspectKeyType(
      key
    );

  if (
    actual !== "none" &&
    actual !== expected
  ) {
    throw new Error(
      `REDIS_TYPE_MISMATCH: ${key} expected=${expected} actual=${actual}`
    );
  }
}


/* =========================================================
   Sale key validation
========================================================= */

async function assertSaleKeyTypes({
  chatId,
  dateKey,
  monthKey,
  yearKey,
}) {
  await Promise.all([
    assertType(
      dailyKey(dateKey),
      "hash"
    ),

    assertType(
      monthlyKey(monthKey),
      "hash"
    ),

    assertType(
      yearlyKey(yearKey),
      "hash"
    ),

    assertType(
      allTimeKey(),
      "hash"
    ),

    assertType(
      workingDaysKey(monthKey),
      "set"
    ),

    assertType(
      recordIndexKey(chatId),
      "zset"
    ),
  ]);
}


/* =========================================================
   Cancel key validation
========================================================= */

async function assertCancelKeyTypes({
  chatId,
  record,
}) {
  await Promise.all([
    assertType(
      dailyKey(record.dateKey),
      "hash"
    ),

    assertType(
      monthlyKey(record.monthKey),
      "hash"
    ),

    assertType(
      yearlyKey(record.yearKey),
      "hash"
    ),

    assertType(
      allTimeKey(),
      "hash"
    ),

    assertType(
      workingDaysKey(record.monthKey),
      "set"
    ),

    assertType(
      recordIndexKey(chatId),
      "zset"
    ),

    assertType(
      recordKey(
        chatId,
        record.recordId
      ),
      "hash"
    ),
  ]);
}


/* =========================================================
   SALE LUA
========================================================= */

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
local recordId = ARGV[2]
local chatId = ARGV[3]
local dateKey = ARGV[4]
local monthKey = ARGV[5]
local yearKey = ARGV[6]
local sales = tonumber(ARGV[7])
local orders = tonumber(ARGV[8])
local createdAt = ARGV[9]
local signature = ARGV[10]
local auditJson = ARGV[11]
local auditSignature = ARGV[12]
local timestamp = tonumber(ARGV[13])

local existing = redis.call("GET", operationKey)

if existing then
  return {"DUPLICATE", existing}
end

redis.call(
  "HSET",
  recordKey,
  "recordId", recordId,
  "operationId", operationId,
  "chatId", chatId,
  "dateKey", dateKey,
  "monthKey", monthKey,
  "yearKey", yearKey,
  "sales", sales,
  "orders", orders,
  "createdAt", createdAt,
  "status", "active",
  "signature", signature
)

redis.call(
  "ZADD",
  recordIndexKey,
  timestamp,
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
  allTimeKey,
  "sales",
  sales
)

redis.call(
  "HINCRBY",
  allTimeKey,
  "orders",
  orders
)

redis.call(
  "SADD",
  workingDaysKey,
  dateKey
)

redis.call(
  "LPUSH",
  auditKey,
  auditJson
)

redis.call(
  "LTRIM",
  auditKey,
  0,
  4999
)

redis.call(
  "SET",
  operationKey,
  recordId
)

return {"OK", recordId}
`;


/* =========================================================
   Register sale
========================================================= */

async function registerSale({
  chatId,
  sales,
  orders,
  operationId = crypto.randomUUID(),
}) {
  const normalizedChatId =
    normalizeChatId(
      chatId
    );

  const normalizedSales =
    positiveInteger(
      sales,
      "sales"
    );

  const normalizedOrders =
    positiveInteger(
      orders,
      "orders"
    );

  if (
    typeof operationId !==
      "string" ||
    operationId.length < 1 ||
    operationId.length > 200
  ) {
    throw new Error(
      "Invalid operationId."
    );
  }

  const now =
    new Date();

  const date =
    getTokyoDateParts(
      now
    );

  await assertSaleKeyTypes({
    chatId:
      normalizedChatId,

    dateKey:
      date.dateKey,

    monthKey:
      date.monthKey,

    yearKey:
      date.yearKey,
  });

  const record =
    buildRecord({
      chatId:
        normalizedChatId,

      sales:
        normalizedSales,

      orders:
        normalizedOrders,

      operationId,

      createdAt:
        now.toISOString(),
    });

  const audit = {
    operationId,
    type: "sale",
    chatId:
      normalizedChatId,
    recordId:
      record.recordId,
    dateKey:
      record.dateKey,
    sales:
      normalizedSales,
    orders:
      normalizedOrders,
    createdAt:
      record.createdAt,
  };

  const auditJson =
    JSON.stringify({
      ...audit,
      signature:
        signAudit(
          audit
        ),
    });

  const result =
    await redisEval(
      SALE_SCRIPT,
      [
        operationKey(
          operationId
        ),

        recordKey(
          normalizedChatId,
          record.recordId
        ),

        recordIndexKey(
          normalizedChatId
        ),

        dailyKey(
          date.dateKey
        ),

        monthlyKey(
          date.monthKey
        ),

        yearlyKey(
          date.yearKey
        ),

        allTimeKey(),

        workingDaysKey(
          date.monthKey
        ),

        auditKey(
          normalizedChatId
        ),
      ],
      [
        operationId,
        record.recordId,
        normalizedChatId,
        date.dateKey,
        date.monthKey,
        date.yearKey,
        normalizedSales,
        normalizedOrders,
        record.createdAt,
        record.signature,
        auditJson,
        signAudit(audit),
        Date.parse(
          record.createdAt
        ),
      ]
    );

  if (
    !Array.isArray(result)
  ) {
    throw new Error(
      "Invalid Redis sale result."
    );
  }

  if (
    result[0] ===
    "DUPLICATE"
  ) {
    const duplicateRecord =
      await getRecord(
        normalizedChatId,
        result[1]
      );

    if (
      duplicateRecord
    ) {
      return {
        duplicate: true,
        operationId,
        record:
          duplicateRecord,
      };
    }

    throw new Error(
      "Operation already exists but its record could not be found."
    );
  }

  if (
    result[0] !==
    "OK"
  ) {
    throw new Error(
      `Sale operation failed: ${JSON.stringify(result)}`
    );
  }

  return {
    duplicate: false,
    operationId,
    record,
  };
}


/* =========================================================
   Hash helpers
========================================================= */

async function getHash(
  key
) {
  const value =
    await redisCommand(
      "HGETALL",
      key
    );

  if (
    !value ||
    value.length === 0
  ) {
    return null;
  }

  const result = {};

  for (
    let i = 0;
    i < value.length;
    i += 2
  ) {
    result[value[i]] =
      value[i + 1];
  }

  return result;
}


/* =========================================================
   Record
========================================================= */

async function getRecord(
  chatId,
  recordId
) {
  const normalizedChatId =
    normalizeChatId(
      chatId
    );

  const record =
    await getHash(
      recordKey(
        normalizedChatId,
        recordId
      )
    );

  if (!record) {
    return null;
  }

  return record;
}


/* =========================================================
   Latest active record
========================================================= */

async function getLatestActiveRecord(
  chatId
) {
  const normalizedChatId =
    normalizeChatId(
      chatId
    );

  const ids =
    await redisCommand(
      "ZREVRANGE",
      recordIndexKey(
        normalizedChatId
      ),
      "0",
      "100"
    );

  if (
    !Array.isArray(ids)
  ) {
    return null;
  }

  for (const id of ids) {
    const record =
      await getRecord(
        normalizedChatId,
        id
      );

    if (
      record &&
      record.status ===
        "active"
    ) {
      return record;
    }
  }

  return null;
}


/* =========================================================
   Verify record signature
========================================================= */

function verifyRecordSignature(
  record
) {
  if (
    !record ||
    !record.signature
  ) {
    return false;
  }

  try {
    const expected =
      signRecord(
        record
      );

    return crypto.timingSafeEqual(
      Buffer.from(
        record.signature,
        "utf8"
      ),
      Buffer.from(
        expected,
        "utf8"
      )
    );
  } catch {
    return false;
  }
}


/* =========================================================
   CANCEL LUA
========================================================= */

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
local sales = tonumber(ARGV[3])
local orders = tonumber(ARGV[4])
local auditJson = ARGV[5]
local timestamp = ARGV[6]

local existing = redis.call(
  "GET",
  operationKey
)

if existing then
  return {"DUPLICATE", existing}
end

local status =
  redis.call(
    "HGET",
    recordKey,
    "status"
  )

if status ~= "active" then
  return {"NOT_ACTIVE", status or ""}
end

local dailySales =
  tonumber(
    redis.call(
      "HGET",
      dailyKey,
      "sales"
    ) or "0"
  )

local dailyOrders =
  tonumber(
    redis.call(
      "HGET",
      dailyKey,
      "orders"
    ) or "0"
  )

if dailySales < sales then
  return {"UNDERFLOW", "daily_sales"}
end

if dailyOrders < orders then
  return {"UNDERFLOW", "daily_orders"}
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

redis.call(
  "HINCRBY",
  allTimeKey,
  "sales",
  -sales
)

redis.call(
  "HINCRBY",
  allTimeKey,
  "orders",
  -orders
)

local remainingSales =
  tonumber(
    redis.call(
      "HGET",
      dailyKey,
      "sales"
    ) or "0"
  )

if remainingSales <= 0 then
  redis.call(
    "SREM",
    workingDaysKey,
    dateKey
  )
end

redis.call(
  "HSET",
  recordKey,
  "status",
  "cancelled",
  "cancelledAt",
  timestamp
)

redis.call(
  "LPUSH",
  auditKey,
  auditJson
)

redis.call(
  "LTRIM",
  auditKey,
  0,
  4999
)

redis.call(
  "SET",
  operationKey,
  "cancelled"
)

return {"OK", "cancelled"}
`;


/* =========================================================
   Cancel latest sale
========================================================= */

async function cancelLatestSale({
  chatId,
  operationId =
    crypto.randomUUID(),
}) {
  const normalizedChatId =
    normalizeChatId(
      chatId
    );

  const record =
    await getLatestActiveRecord(
      normalizedChatId
    );

  if (!record) {
    throw new Error(
      "取り消せる売上がありません。"
    );
  }

  if (
    !verifyRecordSignature(
      record
    )
  ) {
    throw new Error(
      "売上記録の署名検証に失敗しました。"
    );
  }

  const sales =
    positiveInteger(
      record.sales,
      "sales"
    );

  const orders =
    positiveInteger(
      record.orders,
      "orders"
    );

  await assertCancelKeyTypes({
    chatId:
      normalizedChatId,

    record,
  });

  const audit = {
    operationId,
    type: "cancel",
    chatId:
      normalizedChatId,
    recordId:
      record.recordId,
    dateKey:
      record.dateKey,
    sales,
    orders,
    createdAt:
      new Date().toISOString(),
  };

  const auditSignature =
    signAudit(
      audit
    );

  const auditJson =
    JSON.stringify({
      ...audit,
      signature:
        auditSignature,
    });

  const result =
    await redisEval(
      CANCEL_SCRIPT,
      [
        operationKey(
          operationId
        ),

        recordKey(
          normalizedChatId,
          record.recordId
        ),

        dailyKey(
          record.dateKey
        ),

        monthlyKey(
          record.monthKey
        ),

        yearlyKey(
          record.yearKey
        ),

        allTimeKey(),

        workingDaysKey(
          record.monthKey
        ),

        auditKey(
          normalizedChatId
        ),
      ],
      [
        operationId,
        record.dateKey,
        sales,
        orders,
        auditJson,
        new Date().toISOString(),
      ]
    );

  if (
    !Array.isArray(result)
  ) {
    throw new Error(
      "Invalid Redis cancel result."
    );
  }

  if (
    result[0] ===
    "DUPLICATE"
  ) {
    return {
      duplicate: true,
      operationId,
      record,
    };
  }

  if (
    result[0] ===
    "NOT_ACTIVE"
  ) {
    throw new Error(
      "この売上はすでに取り消されています。"
    );
  }

  if (
    result[0] ===
    "UNDERFLOW"
  ) {
    throw new Error(
      "集計値が不正なため、取消を中止しました。"
    );
  }

  if (
    result[0] !==
    "OK"
  ) {
    throw new Error(
      `Cancel operation failed: ${JSON.stringify(result)}`
    );
  }

  return {
    duplicate: false,
    operationId,
    record,
  };
}


/* =========================================================
   Aggregate readers
========================================================= */

async function getAggregate(
  key
) {
  const data =
    await getHash(
      key
    );

  return {
    sales:
      Number(
        data?.sales || 0
      ),

    orders:
      Number(
        data?.orders || 0
      ),
  };
}


async function getDaily(
  dateKey
) {
  return getAggregate(
    dailyKey(
      dateKey
    )
  );
}


async function getMonthly(
  monthKey
) {
  return getAggregate(
    monthlyKey(
      monthKey
    )
  );
}


async function getYearly(
  yearKey
) {
  return getAggregate(
    yearlyKey(
      yearKey
    )
  );
}


async function getAllTime() {
  return getAggregate(
    allTimeKey()
  );
}


async function getWorkingDays(
  monthKey
) {
  const type =
    await inspectKeyType(
      workingDaysKey(
        monthKey
      )
    );

  if (
    type === "none"
  ) {
    return 0;
  }

  if (
    type !== "set"
  ) {
    throw new Error(
      `REDIS_TYPE_MISMATCH: ${workingDaysKey(monthKey)} expected=set actual=${type}`
    );
  }

  return Number(
    await redisCommand(
      "SCARD",
      workingDaysKey(
        monthKey
      )
    )
  );
}


/* =========================================================
   Monthly best
========================================================= */

async function getMonthlyBest(
  monthKey
) {
  const prefix =
    "moheji:delivery:daily:";

  const dates =
    await redisCommand(
      "KEYS",
      `${prefix}${monthKey}-*`
    );

  if (
    !Array.isArray(dates) ||
    dates.length === 0
  ) {
    return {
      sales: 0,
      orders: 0,
    };
  }

  let bestSales = 0;
  let bestOrders = 0;

  for (const key of dates) {
    const data =
      await getHash(
        key
      );

    const sales =
      Number(
        data?.sales || 0
      );

    const orders =
      Number(
        data?.orders || 0
      );

    if (
      sales > bestSales
    ) {
      bestSales =
        sales;
    }

    if (
      orders > bestOrders
    ) {
      bestOrders =
        orders;
    }
  }

  return {
    sales:
      bestSales,

    orders:
      bestOrders,
  };
}


/* =========================================================
   Report
========================================================= */

async function buildReport() {
  const now =
    getTokyoDateParts();

  const [
    daily,
    monthly,
    yearly,
    allTime,
    workingDays,
    monthlyBest,
  ] =
    await Promise.all([
      getDaily(
        now.dateKey
      ),

      getMonthly(
        now.monthKey
      ),

      getYearly(
        now.yearKey
      ),

      getAllTime(),

      getWorkingDays(
        now.monthKey
      ),

      getMonthlyBest(
        now.monthKey
      ),
    ]);

  const todaySales =
    daily.sales;

  const todayOrders =
    daily.orders;

  const monthlySales =
    monthly.sales;

  const monthlyOrders =
    monthly.orders;

  const yearlySales =
    yearly.sales;

  const yearlyOrders =
    yearly.orders;

  const totalOrders =
    allTime.orders;

  const workDays =
    workingDays;

  const averageOrderValue =
    todayOrders > 0
      ? Math.floor(
          todaySales /
            todayOrders
        )
      : 0;

  const averageDailySales =
    workDays > 0
      ? Math.floor(
          monthlySales /
            workDays
        )
      : 0;

  const achievementRate =
    MONTHLY_TARGET > 0
      ? (
          monthlySales /
          MONTHLY_TARGET
        ) * 100
      : 0;

  const progressCount =
    Math.min(
      10,
      Math.max(
        0,
        Math.floor(
          achievementRate /
            10
        )
      )
    );

  const progress =
    "🟢".repeat(
      progressCount
    ) +
    "⚪".repeat(
      10 -
        progressCount
    );

  const timestamp =
    `${now.year}/${String(now.month).padStart(2, "0")}/${String(now.day).padStart(2, "0")} ` +
    `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;

  return [
    "🏍配達売上",
    `💰 今日の売上 ${yen(todaySales)}`,
    progress,
    `📦 今日の件数 ${integer(todayOrders)}件`,
    `💵 1件あたり ${yen(averageOrderValue)}`,
    `📅 今月売上 ${yen(monthlySales)}`,
    `📦 今月件数 ${integer(monthlyOrders)}件`,
    `🗓️ 年間売上 ${yen(yearlySales)}`,
    `📦 年間件数 ${integer(yearlyOrders)}件`,
    `📈 平均売上／日 ${yen(averageDailySales)}`,
    `🎯 月間目標 ${yen(MONTHLY_TARGET)}`,
    `📊 目標達成率 ${percent(achievementRate)}`,
    `🏆 月間最高売上 ${yen(monthlyBest.sales)}`,
    `🏆 月間最高件数 ${integer(monthlyBest.orders)}件`,
    `📆 稼働日数 ${integer(workDays)}日`,
    `🛵 累計配達件数 ${integer(totalOrders)}件`,
    `🕐 ${timestamp}`,
    "🛵 今日も配達お疲れ様でした！",
  ].join("\n");
}


/* =========================================================
   Record report
========================================================= */

async function buildRecordReport() {
  const now =
    getTokyoDateParts();

  const lines = [
    "📚 過去24か月 売上記録",
    "",
  ];

  const current =
    new Date();

  for (
    let i = 0;
    i < 24;
    i++
  ) {
    const date =
      new Date(
        Date.UTC(
          current.getUTCFullYear(),
          current.getUTCMonth() -
            i,
          1
        )
      );

    const year =
      date.getUTCFullYear();

    const month =
      date.getUTCMonth() + 1;

    const monthKey =
      `${year}-${String(month).padStart(2, "0")}`;

    const monthly =
      await getMonthly(
        monthKey
      );

    const days =
      await getWorkingDays(
        monthKey
      );

    const average =
      days > 0
        ? Math.floor(
            monthly.sales /
              days
          )
        : 0;

    lines.push(
      `${year}/${String(month).padStart(2, "0")}`,
      `💰 ${yen(monthly.sales)}`,
      `📦 ${integer(monthly.orders)}件`,
      `📆 稼働 ${integer(days)}日`,
      `📈 日平均 ${yen(average)}`,
      ""
    );
  }

  return lines.join("\n");
}


/* =========================================================
   Audit logs
========================================================= */

async function getAuditLogs(
  chatId,
  limit = 100
) {
  const normalizedChatId =
    normalizeChatId(
      chatId
    );

  const safeLimit =
    Math.min(
      500,
      Math.max(
        1,
        Number(limit) || 100
      )
    );

  const type =
    await inspectKeyType(
      auditKey(
        normalizedChatId
      )
    );

  if (
    type === "none"
  ) {
    return [];
  }

  if (
    type !== "list"
  ) {
    throw new Error(
      `REDIS_TYPE_MISMATCH: ${auditKey(normalizedChatId)} expected=list actual=${type}`
    );
  }

  return redisCommand(
    "LRANGE",
    auditKey(
      normalizedChatId
    ),
    "0",
    String(
      safeLimit - 1
    )
  );
}


/* =========================================================
   Legacy migration
========================================================= */

async function migrateLegacyCancellation(
  chatId
) {
  const normalizedChatId =
    normalizeChatId(
      chatId
    );

  const flagKey =
    legacyKey(
      normalizedChatId
    );

  const existing =
    await redisCommand(
      "GET",
      flagKey
    );

  if (existing) {
    return {
      migrated: false,
      alreadyDone: true,
    };
  }

  const date =
    getTokyoDateParts(
      new Date(
        `${LEGACY_DATE}T00:00:00+09:00`
      )
    );

  await assertSaleKeyTypes({
    chatId:
      normalizedChatId,

    dateKey:
      date.dateKey,

    monthKey:
      date.monthKey,

    yearKey:
      date.yearKey,
  });

  await redisPipeline([
    [
      "HINCRBY",
      dailyKey(
        LEGACY_DATE
      ),
      "sales",
      String(
        LEGACY_SALES
      ),
    ],

    [
      "HINCRBY",
      dailyKey(
        LEGACY_DATE
      ),
      "orders",
      String(
        LEGACY_ORDERS
      ),
    ],

    [
      "HINCRBY",
      monthlyKey(
        "2026-10"
      ),
      "sales",
      String(
        LEGACY_SALES
      ),
    ],

    [
      "HINCRBY",
      monthlyKey(
        "2026-10"
      ),
      "orders",
      String(
        LEGACY_ORDERS
      ),
    ],

    [
      "HINCRBY",
      yearlyKey(
        "2026"
      ),
      "sales",
      String(
        LEGACY_SALES
      ),
    ],

    [
      "HINCRBY",
      yearlyKey(
        "2026"
      ),
      "orders",
      String(
        LEGACY_ORDERS
      ),
    ],

    [
      "HINCRBY",
      allTimeKey(),
      "sales",
      String(
        LEGACY_SALES
      ),
    ],

    [
      "HINCRBY",
      allTimeKey(),
      "orders",
      String(
        LEGACY_ORDERS
      ),
    ],

    [
      "SADD",
      workingDaysKey(
        "2026-10"
      ),
      LEGACY_DATE,
    ],

    [
      "SET",
      flagKey,
      "done",
    ],
  ]);

  return {
    migrated: true,
    alreadyDone: false,
  };
}


/*
  telegram.js currently imports runLegacyMigration.
  Keep a compatibility name.
*/
const runLegacyMigration =
  migrateLegacyCancellation;


/* =========================================================
   Diagnostics
========================================================= */

async function diagnoseSaleRedis(
  chatId
) {
  const normalizedChatId =
    normalizeChatId(
      chatId
    );

  const now =
    getTokyoDateParts();

  const keys = [
    dailyKey(
      now.dateKey
    ),

    monthlyKey(
      now.monthKey
    ),

    yearlyKey(
      now.yearKey
    ),

    allTimeKey(),

    workingDaysKey(
      now.monthKey
    ),

    recordIndexKey(
      normalizedChatId
    ),

    auditKey(
      normalizedChatId
    ),
  ];

  const result = {};

  for (const key of keys) {
    result[key] =
      await inspectKeyType(
        key
      );
  }

  return result;
}


/* =========================================================
   Exports
========================================================= */

export {
  registerSale,
  cancelLatestSale,

  buildReport,
  buildRecordReport,

  runLegacyMigration,
  migrateLegacyCancellation,

  getAuditLogs,

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

  yen,
  integer,
  percent,
};
