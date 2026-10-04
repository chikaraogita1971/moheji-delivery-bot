// api/sales.js

import crypto from "crypto";

/* =========================================================
   Environment
========================================================= */

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const SALES_HMAC_SECRET = process.env.SALES_HMAC_SECRET;


/* =========================================================
   Constants
========================================================= */

const MONTHLY_TARGET = 500000;

const AUDIT_LOG_MAX = 5000;

const LEGACY_DATE_KEY = "2026-10-04";
const LEGACY_MONTH_KEY = "2026-10";
const LEGACY_YEAR_KEY = "2026";

const LEGACY_SALES = 17014;
const LEGACY_ORDERS = 17;


/* =========================================================
   Validation
========================================================= */

function requireEnvironment() {
  const missing = [];

  if (!KV_REST_API_URL) {
    missing.push("KV_REST_API_URL");
  }

  if (!KV_REST_API_TOKEN) {
    missing.push("KV_REST_API_TOKEN");
  }

  if (!SALES_HMAC_SECRET) {
    missing.push("SALES_HMAC_SECRET");
  }

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}


/* =========================================================
   Redis REST
========================================================= */

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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Redis HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (data && data.error) {
    throw new Error(
      `Redis error: ${data.error}`
    );
  }

  return data;
}


async function redisCommand(command, ...args) {
  const data = await redisRequest("", [
    command,
    ...args,
  ]);

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


/* =========================================================
   Pipeline
   Used only for read-heavy reporting.
   NOT used for financial mutation.
========================================================= */

async function redisPipeline(commands) {
  requireEnvironment();

  const base = KV_REST_API_URL.replace(/\/+$/, "");

  const response = await fetch(
    `${base}/pipeline`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Redis pipeline HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}


/* =========================================================
   Keys
========================================================= */

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


/* =========================================================
   Date
========================================================= */

export function getTokyoDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  );

  const value = formatter.format(date);

  const [year, month, day] =
    value.split("-").map(Number);

  return {
    year,
    month,
    day,

    dateKey:
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,

    monthKey:
      `${year}-${String(month).padStart(2, "0")}`,

    yearKey:
      String(year),
  };
}


/* =========================================================
   UUID
========================================================= */

export function createOperationId() {
  return crypto.randomUUID();
}


/* =========================================================
   HMAC
========================================================= */

function hmac(value) {
  requireEnvironment();

  return crypto
    .createHmac(
      "sha256",
      SALES_HMAC_SECRET
    )
    .update(value, "utf8")
    .digest("hex");
}


function canonicalRecord(record) {
  return [
    record.recordId,
    record.chatId,
    record.dateKey,
    record.monthKey,
    record.yearKey,
    String(record.sales),
    String(record.orders),
    record.createdAt,
  ].join("|");
}


function signRecord(record) {
  return hmac(
    canonicalRecord(record)
  );
}


export function verifyRecordSignature(record) {
  if (
    !record ||
    typeof record.signature !== "string"
  ) {
    return false;
  }

  const expected =
    signRecord(record);

  const actual =
    record.signature;

  if (
    expected.length !== actual.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(actual)
  );
}


/* =========================================================
   Audit signature
========================================================= */

function canonicalAudit(audit) {
  return [
    audit.operationId,
    audit.action,
    audit.recordId || "",
    audit.chatId,
    audit.sales || "",
    audit.orders || "",
    audit.timestamp,
  ].join("|");
}


function signAudit(audit) {
  return hmac(
    canonicalAudit(audit)
  );
}


/* =========================================================
   Number
========================================================= */

function toInteger(value) {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    !Number.isInteger(number)
  ) {
    throw new Error(
      "数値が正しくありません。"
    );
  }

  return number;
}


/* =========================================================
   Record creation
========================================================= */

function buildRecord({
  chatId,
  sales,
  orders,
  operationId,
}) {
  const amount =
    toInteger(sales);

  const orderCount =
    toInteger(orders);

  if (amount <= 0) {
    throw new Error(
      "売上金額は1円以上にしてください。"
    );
  }

  if (orderCount <= 0) {
    throw new Error(
      "件数は1件以上にしてください。"
    );
  }

  if (
    amount > 100000000
  ) {
    throw new Error(
      "売上金額が大きすぎます。"
    );
  }

  if (
    orderCount > 100000
  ) {
    throw new Error(
      "件数が大きすぎます。"
    );
  }

  const now = new Date();

  const {
    dateKey,
    monthKey,
    yearKey,
  } = getTokyoDateParts(now);

  const record = {
    recordId: createOperationId(),
    operationId,
    chatId: String(chatId),
    dateKey,
    monthKey,
    yearKey,
    sales: amount,
    orders: orderCount,
    createdAt: now.toISOString(),
  };

  record.signature =
    signRecord(record);

  return record;
}


/* =========================================================
   Atomic SALE
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

local existing = redis.call(
  'GET',
  operationKey
)

if existing then
  return {'DUPLICATE', existing}
end

redis.call(
  'HSET',
  recordKey,
  'recordId', ARGV[2],
  'operationId', ARGV[1],
  'chatId', ARGV[3],
  'dateKey', ARGV[4],
  'monthKey', ARGV[5],
  'yearKey', ARGV[6],
  'sales', ARGV[7],
  'orders', ARGV[8],
  'createdAt', ARGV[9],
  'signature', ARGV[10],
  'status', 'active'
)

redis.call(
  'LPUSH',
  recordIndexKey,
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

local audit = cjson.encode({
  operationId = ARGV[1],
  action = 'SALE',
  recordId = ARGV[2],
  chatId = ARGV[3],
  sales = ARGV[7],
  orders = ARGV[8],
  timestamp = ARGV[9],
  signature = ARGV[11]
})

redis.call(
  'LPUSH',
  auditKey,
  audit
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


/* =========================================================
   Register sale
========================================================= */

export async function registerSale({
  chatId,
  sales,
  orders,
}) {
  const operationId =
    createOperationId();

  const record =
    buildRecord({
      chatId,
      sales,
      orders,
      operationId,
    });


  const auditBase = {
    operationId,
    action: "SALE",
    recordId: record.recordId,
    chatId: record.chatId,
    sales: String(record.sales),
    orders: String(record.orders),
    timestamp: record.createdAt,
  };

  const auditSignature =
    signAudit(auditBase);


  const result =
    await redisEval(
      SALE_SCRIPT,
      [
        operationKey(operationId),
        recordKey(record.recordId),
        recordIndexKey(chatId),
        dailyKey(record.dateKey),
        monthlyKey(record.monthKey),
        yearlyKey(record.yearKey),
        allTimeKey(),
        workingDaysKey(record.monthKey),
        auditKey(),
      ],
      [
        operationId,
        record.recordId,
        record.chatId,
        record.dateKey,
        record.monthKey,
        record.yearKey,
        record.sales,
        record.orders,
        record.createdAt,
        record.signature,
        auditSignature,
      ]
    );


  if (
    Array.isArray(result) &&
    result[0] === "DUPLICATE"
  ) {
    throw new Error(
      "この操作はすでに処理されています。"
    );
  }


  if (
    !Array.isArray(result) ||
    result[0] !== "OK"
  ) {
    throw new Error(
      `売上登録の原子処理に失敗しました: ${JSON.stringify(result)}`
    );
  }


  return {
    operationId,
    record,
  };
}


/* =========================================================
   Hash reader
========================================================= */

async function getHash(key) {
  const result =
    await redisCommand(
      "HGETALL",
      key
    );

  if (
    Array.isArray(result)
  ) {
    const object = {};

    for (
      let i = 0;
      i < result.length;
      i += 2
    ) {
      object[result[i]] =
        result[i + 1];
    }

    return object;
  }

  return result || {};
}


/* =========================================================
   Record reader
========================================================= */

export async function getRecord(
  recordId
) {
  const record =
    await getHash(
      recordKey(recordId)
    );

  if (
    !record ||
    !record.recordId
  ) {
    return null;
  }

  return {
    ...record,

    chatId:
      String(record.chatId),

    sales:
      Number(record.sales),

    orders:
      Number(record.orders),
  };
}


/* =========================================================
   Latest active record
========================================================= */

export async function getLatestActiveRecord(
  chatId
) {
  const ids =
    await redisCommand(
      "LRANGE",
      recordIndexKey(chatId),
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
      await getRecord(id);

    if (
      record &&
      record.chatId === String(chatId) &&
      record.status === "active"
    ) {
      return record;
    }
  }

  return null;
}


/* =========================================================
   Atomic CANCEL
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

local existingOperation =
  redis.call('GET', operationKey)

if existingOperation then
  return {'DUPLICATE', existingOperation}
end

local status =
  redis.call(
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

local sales =
  tonumber(
    redis.call(
      'HGET',
      recordKey,
      'sales'
    ) or '0'
  )

local orders =
  tonumber(
    redis.call(
      'HGET',
      recordKey,
      'orders'
    ) or '0'
  )

local dailySales =
  tonumber(
    redis.call(
      'HGET',
      dailyKey,
      'sales'
    ) or '0'
  )

local dailyOrders =
  tonumber(
    redis.call(
      'HGET',
      dailyKey,
      'orders'
    ) or '0'
  )

if dailySales < sales or dailyOrders < orders then
  return {'INCONSISTENT_DAILY'}
end

local monthlySales =
  tonumber(
    redis.call(
      'HGET',
      monthlyKey,
      'sales'
    ) or '0'
  )

local monthlyOrders =
  tonumber(
    redis.call(
      'HGET',
      monthlyKey,
      'orders'
    ) or '0'
  )

if monthlySales < sales or monthlyOrders < orders then
  return {'INCONSISTENT_MONTHLY'}
end

local yearlySales =
  tonumber(
    redis.call(
      'HGET',
      yearlyKey,
      'sales'
    ) or '0'
  )

local yearlyOrders =
  tonumber(
    redis.call(
      'HGET',
      yearlyKey,
      'orders'
    ) or '0'
  )

if yearlySales < sales or yearlyOrders < orders then
  return {'INCONSISTENT_YEARLY'}
end

local allTimeSales =
  tonumber(
    redis.call(
      'HGET',
      allTimeKey,
      'sales'
    ) or '0'
  )

local allTimeOrders =
  tonumber(
    redis.call(
      'HGET',
      allTimeKey,
      'orders'
    ) or '0'
  )

if allTimeSales < sales or allTimeOrders < orders then
  return {'INCONSISTENT_ALLTIME'}
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

redis.call(
  'HSET',
  recordKey,
  'status',
  'cancelled',
  'cancelledAt',
  ARGV[5],
  'cancelOperationId',
  ARGV[1]
)

local remainingSales =
  tonumber(
    redis.call(
      'HGET',
      dailyKey,
      'sales'
    ) or '0'
  )

local remainingOrders =
  tonumber(
    redis.call(
      'HGET',
      dailyKey,
      'orders'
    ) or '0'
  )

if remainingSales == 0 and remainingOrders == 0 then
  redis.call(
    'SREM',
    workingDaysKey,
    ARGV[4]
  )
end

local audit = cjson.encode({
  operationId = ARGV[1],
  action = 'CANCEL',
  recordId = ARGV[2],
  chatId = ARGV[3],
  sales = ARGV[6],
  orders = ARGV[7],
  timestamp = ARGV[5],
  signature = ARGV[8]
})

redis.call(
  'LPUSH',
  auditKey,
  audit
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


/* =========================================================
   Cancel latest sale
========================================================= */

export async function cancelLatestSale({
  chatId,
}) {
  const record =
    await getLatestActiveRecord(
      chatId
    );

  if (!record) {
    throw new Error(
      "取消できる売上記録がありません。"
    );
  }


  /*
    IMPORTANT:
    Never trust a record simply because
    it exists in Redis.
  */
  if (
    !verifyRecordSignature(record)
  ) {
    throw new Error(
      "売上記録の署名検証に失敗しました。改ざんの可能性があるため、取消処理を停止しました。"
    );
  }


  const operationId =
    createOperationId();

  const timestamp =
    new Date().toISOString();


  const auditBase = {
    operationId,
    action: "CANCEL",
    recordId: record.recordId,
    chatId: String(chatId),
    sales: String(record.sales),
    orders: String(record.orders),
    timestamp,
  };

  const auditSignature =
    signAudit(auditBase);


  const result =
    await redisEval(
      CANCEL_SCRIPT,
      [
        operationKey(operationId),
        recordKey(record.recordId),
        dailyKey(record.dateKey),
        monthlyKey(record.monthKey),
        yearlyKey(record.yearKey),
        allTimeKey(),
        workingDaysKey(record.monthKey),
        auditKey(),
      ],
      [
        operationId,
        record.recordId,
        String(chatId),
        record.dateKey,
        timestamp,
        record.sales,
        record.orders,
        auditSignature,
      ]
    );


  if (!Array.isArray(result)) {
    throw new Error(
      `取消処理の結果が不正です: ${JSON.stringify(result)}`
    );
  }


  const code = result[0];


  if (code === "DUPLICATE") {
    throw new Error(
      "この取消操作はすでに処理されています。"
    );
  }

  if (code === "NOT_FOUND") {
    throw new Error(
      "取消対象の記録が存在しません。"
    );
  }

  if (code === "ALREADY_CANCELLED") {
    throw new Error(
      "この売上はすでに取消済みです。"
    );
  }

  if (
    code === "INCONSISTENT_DAILY" ||
    code === "INCONSISTENT_MONTHLY" ||
    code === "INCONSISTENT_YEARLY" ||
    code === "INCONSISTENT_ALLTIME"
  ) {
    throw new Error(
      `集計データと売上記録の整合性エラー (${code})。安全のため取消を停止しました。`
    );
  }

  if (code !== "OK") {
    throw new Error(
      `取消処理に失敗しました: ${JSON.stringify(result)}`
    );
  }


  return {
    operationId,
    record,
  };
}


/* =========================================================
   Legacy one-time cancellation
========================================================= */

export async function runLegacyMigration() {
  const exists =
    await redisCommand(
      "GET",
      legacyFlagKey()
    );

  if (exists) {
    return false;
  }

  /*
    Legacy migration is intentionally isolated.
    It is not part of ordinary cancel operations.
  */

  const script = `
local flagKey = KEYS[1]
local dailyKey = KEYS[2]
local monthlyKey = KEYS[3]
local yearlyKey = KEYS[4]
local allTimeKey = KEYS[5]
local workingDaysKey = KEYS[6]

if redis.call('GET', flagKey) then
  return 'ALREADY_DONE'
end

local dailySales =
  tonumber(redis.call('HGET', dailyKey, 'sales') or '0')

local dailyOrders =
  tonumber(redis.call('HGET', dailyKey, 'orders') or '0')

if dailySales < tonumber(ARGV[1])
or dailyOrders < tonumber(ARGV[2]) then
  return 'INSUFFICIENT_DAILY'
end

redis.call('HINCRBY', dailyKey, 'sales', -ARGV[1])
redis.call('HINCRBY', dailyKey, 'orders', -ARGV[2])

redis.call('HINCRBY', monthlyKey, 'sales', -ARGV[1])
redis.call('HINCRBY', monthlyKey, 'orders', -ARGV[2])

redis.call('HINCRBY', yearlyKey, 'sales', -ARGV[1])
redis.call('HINCRBY', yearlyKey, 'orders', -ARGV[2])

redis.call('HINCRBY', allTimeKey, 'sales', -ARGV[1])
redis.call('HINCRBY', allTimeKey, 'orders', -ARGV[2])

redis.call('SREM', workingDaysKey, ARGV[3])

redis.call(
  'SET',
  flagKey,
  ARGV[4]
)

return 'OK'
`;


  const result =
    await redisEval(
      script,
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
        new Date().toISOString(),
      ]
    );


  return result === "OK";
}


/* =========================================================
   Reporting
========================================================= */

async function getDaily(
  dateKey
) {
  const data =
    await getHash(
      dailyKey(dateKey)
    );

  return {
    sales:
      Number(data.sales || 0),

    orders:
      Number(data.orders || 0),
  };
}


async function getMonthly(
  monthKey
) {
  const data =
    await getHash(
      monthlyKey(monthKey)
    );

  return {
    sales:
      Number(data.sales || 0),

    orders:
      Number(data.orders || 0),
  };
}


async function getYearly(
  yearKey
) {
  const data =
    await getHash(
      yearlyKey(yearKey)
    );

  return {
    sales:
      Number(data.sales || 0),

    orders:
      Number(data.orders || 0),
  };
}


async function getAllTime() {
  const data =
    await getHash(
      allTimeKey()
    );

  return {
    sales:
      Number(data.sales || 0),

    orders:
      Number(data.orders || 0),
  };
}


async function getWorkingDays(
  monthKey
) {
  const result =
    await redisCommand(
      "SMEMBERS",
      workingDaysKey(monthKey)
    );

  return Array.isArray(result)
    ? result
    : [];
}


/* =========================================================
   Monthly best
========================================================= */

async function getMonthlyBest(
  monthKey
) {
  const dates =
    await getWorkingDays(
      monthKey
    );

  if (!dates.length) {
    return {
      sales: 0,
      orders: 0,
      salesDate: null,
      ordersDate: null,
    };
  }


  const commands =
    dates.map((dateKey) => [
      "HGETALL",
      dailyKey(dateKey),
    ]);


  const results =
    await redisPipeline(
      commands
    );


  let bestSales = 0;
  let bestOrders = 0;

  let salesDate = null;
  let ordersDate = null;


  for (
    let i = 0;
    i < results.length;
    i++
  ) {
    const dateKey =
      dates[i];

    const result =
      results[i]?.result;


    let data = {};


    if (
      Array.isArray(result)
    ) {
      for (
        let j = 0;
        j < result.length;
        j += 2
      ) {
        data[result[j]] =
          result[j + 1];
      }
    }


    const sales =
      Number(data.sales || 0);

    const orders =
      Number(data.orders || 0);


    if (sales > bestSales) {
      bestSales = sales;
      salesDate = dateKey;
    }


    if (orders > bestOrders) {
      bestOrders = orders;
      ordersDate = dateKey;
    }
  }


  return {
    sales: bestSales,
    orders: bestOrders,
    salesDate,
    ordersDate,
  };
}


/* =========================================================
   Formatting
========================================================= */

function yen(value) {
  return `¥${Math.round(
    Number(value || 0)
  ).toLocaleString("ja-JP")}`;
}


function integer(value) {
  return Math.round(
    Number(value || 0)
  ).toLocaleString("ja-JP");
}


function percentage(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}


function formatDate(dateKey) {
  if (!dateKey) {
    return "-";
  }

  const [
    year,
    month,
    day,
  ] = dateKey.split("-");

  return `${year}/${Number(month)}/${Number(day)}`;
}


function formatMonth(monthKey) {
  const [
    year,
    month,
  ] = monthKey.split("-");

  return `${year}年${Number(month)}月`;
}


/* =========================================================
   Main report
========================================================= */

export async function buildReport() {
  const {
    dateKey,
    monthKey,
    yearKey,
  } = getTokyoDateParts();


  const [
    daily,
    monthly,
    yearly,
    allTime,
    workingDays,
    best,
  ] =
    await Promise.all([
      getDaily(dateKey),
      getMonthly(monthKey),
      getYearly(yearKey),
      getAllTime(),
      getWorkingDays(monthKey),
      getMonthlyBest(monthKey),
    ]);


  const dailyAverage =
    daily.orders > 0
      ? daily.sales / daily.orders
      : 0;


  const averageOrderValue =
    monthly.orders > 0
      ? monthly.sales /
        monthly.orders
      : 0;


  const monthlyAverage =
    workingDays.length > 0
      ? monthly.sales /
        workingDays.length
      : 0;


  const achievement =
    MONTHLY_TARGET > 0
      ? monthly.sales /
        MONTHLY_TARGET *
        100
      : 0;


  const remaining =
    Math.max(
      0,
      MONTHLY_TARGET -
        monthly.sales
    );


  const filled =
    Math.round(
      Math.min(
        100,
        Math.max(
          0,
          achievement
        )
      ) / 10
    );


  const progress =
    "🟢".repeat(filled) +
    "⚪".repeat(10 - filled);


  return [
    "📊 売上レポート",
    "",
    `📅 ${formatDate(dateKey)}`,
    "",
    "【本日】",
    `💰 売上：${yen(daily.sales)}`,
    `📦 件数：${integer(daily.orders)}件`,
    `💵 平均単価：${yen(dailyAverage)}`,
    "",
    "【今月】",
    `💰 売上：${yen(monthly.sales)}`,
    `📦 件数：${integer(monthly.orders)}件`,
    `🗓 稼働日：${integer(workingDays.length)}日`,
    `📈 1日平均：${yen(monthlyAverage)}`,
    `💵 平均単価：${yen(averageOrderValue)}`,
    "",
    `🎯 目標：${yen(MONTHLY_TARGET)}`,
    `📊 達成率：${percentage(achievement)}`,
    progress,
    `🔥 残り：${yen(remaining)}`,
    "",
    "【今月最高】",
    `🏆 最高売上：${yen(best.sales)}`,
    best.salesDate
      ? `　${formatDate(best.salesDate)}`
      : "",
    `🏆 最高件数：${integer(best.orders)}件`,
    best.ordersDate
      ? `　${formatDate(best.ordersDate)}`
      : "",
    "",
    "【今年】",
    `💰 売上：${yen(yearly.sales)}`,
    `📦 件数：${integer(yearly.orders)}件`,
    "",
    "【累計】",
    `💰 売上：${yen(allTime.sales)}`,
    `📦 件数：${integer(allTime.orders)}件`,
  ]
    .filter(Boolean)
    .join("\n");
}


/* =========================================================
   24-month record
========================================================= */

export async function buildRecordReport() {
  const {
    year,
    month,
  } = getTokyoDateParts();


  const monthKeys = [];


  for (
    let offset = 0;
    offset < 24;
    offset++
  ) {
    let y = year;
    let m = month - offset;

    while (m <= 0) {
      y--;
      m += 12;
    }

    monthKeys.push(
      `${y}-${String(m).padStart(2, "0")}`
    );
  }


  const reports =
    await Promise.all(
      monthKeys.map(
        async (monthKey) => {
          const [
            monthly,
            workingDays,
            best,
          ] =
            await Promise.all([
              getMonthly(monthKey),
              getWorkingDays(monthKey),
              getMonthlyBest(monthKey),
            ]);


          const dailyAverage =
            workingDays.length
              ? monthly.sales /
                workingDays.length
              : 0;


          return [
            `【${formatMonth(monthKey)}】`,
            `💰 売上：${yen(monthly.sales)}`,
            `📦 件数：${integer(monthly.orders)}件`,
            `🗓 稼働日：${integer(workingDays.length)}日`,
            `📈 1日平均：${yen(dailyAverage)}`,
            `🏆 最高売上：${yen(best.sales)}`,
            `🏆 最高件数：${integer(best.orders)}件`,
          ].join("\n");
        }
      )
    );


  return [
    "📚 過去24か月 売上記録",
    "",
    ...reports,
  ].join("\n\n");
}


/* =========================================================
   Audit verification
========================================================= */

export async function getAuditLogs(
  limit = 100
) {
  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 100,
        1
      ),
      AUDIT_LOG_MAX
    );


  return redisCommand(
    "LRANGE",
    auditKey(),
    "0",
    String(safeLimit - 1)
  );
}


/* =========================================================
   Export helpers
========================================================= */

export {
  getDaily,
  getMonthly,
  getYearly,
  getAllTime,
  getWorkingDays,
  getMonthlyBest,
  yen,
  integer,
  percentage,
};
