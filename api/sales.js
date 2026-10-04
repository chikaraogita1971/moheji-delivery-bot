// api/sales.js

import crypto from "crypto";

/* =========================================================
   ENV
========================================================= */

const KV_REST_API_URL =
  process.env.KV_REST_API_URL;

const KV_REST_API_TOKEN =
  process.env.KV_REST_API_TOKEN;

const SALES_HMAC_SECRET =
  process.env.SALES_HMAC_SECRET;

const TIME_ZONE =
  "Asia/Tokyo";

const MONTHLY_TARGET =
  500000;

const AUDIT_LOG_MAX =
  5000;


/* =========================================================
   ENV CHECK
========================================================= */

function requireRedisEnv() {
  if (
    !KV_REST_API_URL ||
    !KV_REST_API_TOKEN
  ) {
    throw new Error(
      "Redis environment variables are missing."
    );
  }
}

function requireHmacSecret() {
  if (!SALES_HMAC_SECRET) {
    throw new Error(
      "SALES_HMAC_SECRET is missing."
    );
  }
}


/* =========================================================
   FORMAT
========================================================= */

function integer(value) {
  return Number(
    value || 0
  ).toLocaleString(
    "ja-JP"
  );
}

function yen(value) {
  return `${integer(value)}円`;
}

function percent(value) {
  return `${Number(
    value || 0
  ).toFixed(1)}%`;
}


/* =========================================================
   VALIDATION
========================================================= */

function positiveInteger(
  value,
  name
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    ) ||
    number <= 0
  ) {
    throw new Error(
      `${name} must be a positive integer.`
    );
  }

  return number;
}


/* =========================================================
   REDIS REST
========================================================= */

async function redisRequest(
  command
) {
  requireRedisEnv();

  const response =
    await fetch(
      KV_REST_API_URL,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${KV_REST_API_TOKEN}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            command
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
      `Redis HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}


async function redisCommand(
  command,
  ...args
) {
  const data =
    await redisRequest([
      command,
      ...args,
    ]);

  return data.result;
}


async function redisPipeline(
  commands
) {
  requireRedisEnv();

  const response =
    await fetch(
      `${KV_REST_API_URL}/pipeline`,
      {
        method:
          "POST",

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
   TOKYO DATE
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

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hourCycle:
          "h23",
      }
    ).formatToParts(
      date
    );

  const values = {};

  for (
    const part of parts
  ) {
    values[
      part.type
    ] =
      part.value;
  }

  const year =
    Number(
      values.year
    );

  const month =
    Number(
      values.month
    );

  const day =
    Number(
      values.day
    );

  const hour =
    Number(
      values.hour
    );

  const minute =
    Number(
      values.minute
    );

  const second =
    Number(
      values.second
    );

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
   REDIS KEYS
========================================================= */

function dailyKey(
  dateKey
) {
  return (
    `moheji:delivery:daily:${dateKey}`
  );
}

function monthlyKey(
  monthKey
) {
  return (
    `moheji:delivery:month:${monthKey}`
  );
}

function yearlyKey(
  yearKey
) {
  return (
    `moheji:delivery:year:${yearKey}`
  );
}

function workingDaysKey(
  monthKey
) {
  return (
    `moheji:delivery:workingdays:${monthKey}`
  );
}

function allTimeKey() {
  return (
    "moheji:delivery:alltime"
  );
}

function recordIndexKey(
  chatId
) {
  return (
    `moheji:delivery:records:${chatId}`
  );
}

function recordKey(
  chatId,
  recordId
) {
  return (
    `moheji:delivery:record:${chatId}:${recordId}`
  );
}

function operationKey(
  operationId
) {
  return (
    `moheji:delivery:operation:${operationId}`
  );
}

function auditKey(
  chatId
) {
  return (
    `moheji:delivery:audit:${chatId}`
  );
}


/* =========================================================
   CHAT ID
========================================================= */

function normalizeChatId(
  chatId
) {
  const number =
    Number(chatId);

  if (
    !Number.isSafeInteger(
      number
    )
  ) {
    throw new Error(
      "Invalid chat ID."
    );
  }

  return String(number);
}


/* =========================================================
   HMAC
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
    .digest(
      "hex"
    );
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
   REDIS TYPE
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
   RECORD
========================================================= */

function createRecordId() {
  return crypto.randomUUID();
}


function createRecord({
  chatId,
  sales,
  orders,
  operationId,
}) {
  const now =
    new Date();

  const date =
    getTokyoDateParts(
      now
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

    createdAt:
      now.toISOString(),

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
local score = tonumber(ARGV[12])

local existing =
  redis.call(
    "GET",
    operationKey
  )

if existing then
  return {
    "DUPLICATE",
    existing
  }
end

redis.call(
  "HSET",
  recordKey,
  "recordId",
  recordId,
  "operationId",
  operationId,
  "chatId",
  chatId,
  "dateKey",
  dateKey,
  "monthKey",
  monthKey,
  "yearKey",
  yearKey,
  "sales",
  sales,
  "orders",
  orders,
  "createdAt",
  createdAt,
  "status",
  "active",
  "signature",
  signature
)

redis.call(
  "ZADD",
  recordIndexKey,
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

return {
  "OK",
  recordId
}
`;


/* =========================================================
   REGISTER SALE
========================================================= */

async function registerSale({
  chatId,
  sales,
  orders,
  operationId,
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
    operationId.length === 0
  ) {
    throw new Error(
      "Invalid operationId."
    );
  }

  const date =
    getTokyoDateParts();

  const record =
    createRecord({
      chatId:
        normalizedChatId,

      sales:
        normalizedSales,

      orders:
        normalizedOrders,

      operationId,
    });

  const keys = [
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
  ];

  await Promise.all([
    assertType(
      keys[0],
      "string"
    ),

    assertType(
      keys[1],
      "hash"
    ),

    assertType(
      keys[2],
      "zset"
    ),

    assertType(
      keys[3],
      "hash"
    ),

    assertType(
      keys[4],
      "hash"
    ),

    assertType(
      keys[5],
      "hash"
    ),

    assertType(
      keys[6],
      "hash"
    ),

    assertType(
      keys[7],
      "set"
    ),

    assertType(
      keys[8],
      "list"
    ),
  ]);

  const audit = {
    operationId,

    type:
      "sale",

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
      keys,
      [
        operationId,

        record.recordId,

        normalizedChatId,

        record.dateKey,

        record.monthKey,

        record.yearKey,

        normalizedSales,

        normalizedOrders,

        record.createdAt,

        record.signature,

        auditJson,

        Date.parse(
          record.createdAt
        ),
      ]
    );

  if (
    result?.[0] ===
    "DUPLICATE"
  ) {
    const oldRecord =
      await getRecord(
        normalizedChatId,
        result[1]
      );

    return {
      duplicate:
        true,

      operationId,

      record:
        oldRecord,
    };
  }

  if (
    result?.[0] !==
    "OK"
  ) {
    throw new Error(
      `Sale failed: ${JSON.stringify(result)}`
    );
  }

  return {
    duplicate:
      false,

    operationId,

    record,
  };
}


/* =========================================================
   HASH
========================================================= */

async function getHash(
  key
) {
  const values =
    await redisCommand(
      "HGETALL",
      key
    );

  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return null;
  }

  const result = {};

  for (
    let i = 0;
    i < values.length;
    i += 2
  ) {
    result[
      values[i]
    ] =
      values[i + 1];
  }

  return result;
}


/* =========================================================
   RECORD GET
========================================================= */

async function getRecord(
  chatId,
  recordId
) {
  return getHash(
    recordKey(
      normalizeChatId(
        chatId
      ),
      recordId
    )
  );
}


/* =========================================================
   LATEST ACTIVE RECORD
========================================================= */

async function getLatestActiveRecord(
  chatId
) {
  const normalizedChatId =
    normalizeChatId(
      chatId
    );

  await assertType(
    recordIndexKey(
      normalizedChatId
    ),
    "zset"
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

  for (
    const recordId of ids
  ) {
    const record =
      await getRecord(
        normalizedChatId,
        recordId
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
   SIGNATURE VERIFY
========================================================= */

function verifyRecordSignature(
  record
) {
  if (
    !record?.signature
  ) {
    return false;
  }

  try {
    const expected =
      signRecord(
        record
      );

    const a =
      Buffer.from(
        record.signature,
        "utf8"
      );

    const b =
      Buffer.from(
        expected,
        "utf8"
      );

    if (
      a.length !==
      b.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      a,
      b
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
local cancelledAt = ARGV[6]

local existing =
  redis.call(
    "GET",
    operationKey
  )

if existing then
  return {
    "DUPLICATE",
    existing
  }
end

local status =
  redis.call(
    "HGET",
    recordKey,
    "status"
  )

if status ~= "active" then
  return {
    "NOT_ACTIVE"
  }
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
  return {
    "UNDERFLOW"
  }
end

if dailyOrders < orders then
  return {
    "UNDERFLOW"
  }
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

local remainingOrders =
  tonumber(
    redis.call(
      "HGET",
      dailyKey,
      "orders"
    ) or "0"
  )

if
  remainingSales <= 0
  and
  remainingOrders <= 0
then
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
  cancelledAt
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

return {
  "OK"
}
`;


/* =========================================================
   CANCEL
========================================================= */

async function cancelLatestSale({
  chatId,
  operationId,
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

  const keys = [
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
  ];

  await Promise.all([
    assertType(
      keys[0],
      "string"
    ),

    assertType(
      keys[1],
      "hash"
    ),

    assertType(
      keys[2],
      "hash"
    ),

    assertType(
      keys[3],
      "hash"
    ),

    assertType(
      keys[4],
      "hash"
    ),

    assertType(
      keys[5],
      "hash"
    ),

    assertType(
      keys[6],
      "set"
    ),

    assertType(
      keys[7],
      "list"
    ),
  ]);

  const audit = {
    operationId,

    type:
      "cancel",

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
      CANCEL_SCRIPT,
      keys,
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
    result?.[0] ===
    "DUPLICATE"
  ) {
    return {
      duplicate:
        true,

      record,
    };
  }

  if (
    result?.[0] ===
    "NOT_ACTIVE"
  ) {
    throw new Error(
      "この売上はすでに取り消されています。"
    );
  }

  if (
    result?.[0] ===
    "UNDERFLOW"
  ) {
    throw new Error(
      "集計値が不正なため、取消を中止しました。"
    );
  }

  if (
    result?.[0] !==
    "OK"
  ) {
    throw new Error(
      `Cancel failed: ${JSON.stringify(result)}`
    );
  }

  return {
    duplicate:
      false,

    record,
  };
}


/* =========================================================
   AGGREGATES
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


/* =========================================================
   WORKING DAYS
========================================================= */

async function getWorkingDays(
  monthKey
) {
  const key =
    workingDaysKey(
      monthKey
    );

  await assertType(
    key,
    "set"
  );

  return Number(
    await redisCommand(
      "SCARD",
      key
    )
  );
}


/* =========================================================
   MONTHLY BEST
========================================================= */

async function getMonthlyBest(
  monthKey
) {
  const keys =
    await redisCommand(
      "KEYS",
      `moheji:delivery:daily:${monthKey}-*`
    );

  let bestSales = 0;
  let bestOrders = 0;

  if (
    !Array.isArray(keys)
  ) {
    return {
      sales: 0,
      orders: 0,
    };
  }

  for (
    const key of keys
  ) {
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

    bestSales =
      Math.max(
        bestSales,
        sales
      );

    bestOrders =
      Math.max(
        bestOrders,
        orders
      );
  }

  return {
    sales:
      bestSales,

    orders:
      bestOrders,
  };
}


/* =========================================================
   REPORT
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

  const bestSales =
    monthlyBest.sales;

  const bestOrders =
    monthlyBest.orders;

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
        ) *
        100
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
    `${now.year}/` +
    `${String(now.month).padStart(2, "0")}/` +
    `${String(now.day).padStart(2, "0")} ` +
    `${String(now.hour).padStart(2, "0")}:` +
    `${String(now.minute).padStart(2, "0")}`;

  return [
    "🏍️ 配達売上",
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
    `🏆 月間最高売上 ${yen(bestSales)}`,
    `🏆 月間最高件数 ${integer(bestOrders)}件`,
    `📆 稼働日数 ${integer(workDays)}日`,
    `🛵 累計配達件数 ${integer(totalOrders)}件`,
    `🕐 ${timestamp}`,
    "🛵 今日も配達お疲れ様でした！",
  ].join("\n");
}


/* =========================================================
   RECORD REPORT
========================================================= */

async function buildRecordReport() {
  const now =
    getTokyoDateParts();

  const lines = [
    "📚 売上記録",
  ];

  for (
    let offset = 0;
    offset < 24;
    offset++
  ) {
    const date =
      new Date(
        Date.UTC(
          now.year,
          now.month -
            1 -
            offset,
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

    const workDays =
      await getWorkingDays(
        monthKey
      );

    const average =
      workDays > 0
        ? Math.floor(
            monthly.sales /
            workDays
          )
        : 0;

    lines.push(
      `${year}/${String(month).padStart(2, "0")}`,
      `💰 売上 ${yen(monthly.sales)}`,
      `📦 件数 ${integer(monthly.orders)}件`,
      `📆 稼働日数 ${integer(workDays)}日`,
      `📈 日平均 ${yen(average)}`
    );
  }

  return lines.join(
    "\n"
  );
}


/* =========================================================
   AUDIT
========================================================= */

async function getAuditLogs(
  chatId,
  limit = 100
) {
  const key =
    auditKey(
      normalizeChatId(
        chatId
      )
    );

  await assertType(
    key,
    "list"
  );

  const safeLimit =
    Math.min(
      AUDIT_LOG_MAX,
      Math.max(
        1,
        Number(limit) || 100
      )
    );

  return redisCommand(
    "LRANGE",
    key,
    "0",
    String(
      safeLimit - 1
    )
  );
}


/* =========================================================
   DIAGNOSTIC
========================================================= */

async function diagnoseSaleRedis(
  chatId
) {
  const now =
    getTokyoDateParts();

  const id =
    normalizeChatId(
      chatId
    );

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
      id
    ),

    auditKey(
      id
    ),
  ];

  const result = {};

  for (
    const key of keys
  ) {
    result[key] =
      await inspectKeyType(
        key
      );
  }

  return result;
}


/* =========================================================
   EXPORTS
========================================================= */

export {
  registerSale,
  cancelLatestSale,

  buildReport,
  buildRecordReport,

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
