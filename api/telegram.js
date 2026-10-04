// api/telegram.js

const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTHLY_TARGET = 500000;

/*
 * ------------------------------------------------------------
 * Redis
 * ------------------------------------------------------------
 */

function redisHeaders() {
  return {
    Authorization: `Bearer ${REDIS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function redis(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Redis environment variables are missing");
  }

  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: redisHeaders(),
    body: JSON.stringify([command, ...args]),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Redis error ${response.status}: ${text}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Redis command error: ${data.error}`);
  }

  return data.result;
}

/*
 * LuaをRedisサーバー側で原子的に実行する。
 */
async function redisEval(script, keys, args) {
  return await redis(
    "EVAL",
    script,
    String(keys.length),
    ...keys,
    ...args.map((v) => String(v))
  );
}

/*
 * ------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------
 */

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatYen(value) {
  return number(value).toLocaleString("ja-JP");
}

function formatNumber(value) {
  return number(value).toLocaleString("ja-JP");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getTokyoDateInfo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const obj = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      obj[part.type] = part.value;
    }
  }

  const year = Number(obj.year);
  const month = Number(obj.month);
  const day = Number(obj.day);

  return {
    year,
    month,
    day,
    hour: Number(obj.hour),
    minute: Number(obj.minute),
    second: Number(obj.second),
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
    monthKey: `${year}-${pad2(month)}`,
    yearKey: `${year}`,
  };
}

function dailyKey(dateKey) {
  return `moheji:delivery:daily:${dateKey}`;
}

function monthKey(key) {
  return `moheji:delivery:month:${key}`;
}

function yearKey(key) {
  return `moheji:delivery:year:${key}`;
}

function workingDaysKey(key) {
  return `moheji:delivery:workingdays:${key}`;
}

function allTimeKey() {
  return "moheji:delivery:alltime";
}

function recordsIndexKey(chatId) {
  return `moheji:delivery:records:${chatId}`;
}

function recordKey(chatId, recordId) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}

function makeRecordId() {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/*
 * ------------------------------------------------------------
 * Redis Hash
 * ------------------------------------------------------------
 */

async function getHash(key) {
  const result = await redis("HGETALL", key);

  if (!result) {
    return {};
  }

  if (Array.isArray(result)) {
    const obj = {};

    for (let i = 0; i < result.length; i += 2) {
      obj[result[i]] = result[i + 1];
    }

    return obj;
  }

  if (typeof result === "object") {
    return result;
  }

  return {};
}

async function setHash(key, values) {
  const entries = Object.entries(values);

  if (entries.length === 0) {
    return;
  }

  const args = [];

  for (const [field, value] of entries) {
    args.push(field, String(value));
  }

  await redis("HSET", key, ...args);
}

/*
 * ------------------------------------------------------------
 * Redis SCAN
 * ------------------------------------------------------------
 */

async function scanKeys(pattern) {
  let cursor = "0";
  const keys = [];

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "500"
    );

    if (
      !Array.isArray(result) ||
      result.length < 2
    ) {
      break;
    }

    cursor = String(result[0]);

    if (Array.isArray(result[1])) {
      keys.push(...result[1]);
    }
  } while (cursor !== "0");

  return keys;
}

/*
 * ------------------------------------------------------------
 * Telegram
 * ------------------------------------------------------------
 */

async function sendTelegramMessage(chatId, text) {
  const url =
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Telegram sendMessage error: ${body}`
    );
  }
}

async function sendTelegramPhoto(chatId, caption) {
  const url =
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      photo: IMAGE_URL,
      caption,
    }),
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Telegram sendPhoto error: ${body}`
    );
  }
}

/*
 * ------------------------------------------------------------
 * Basic data
 * ------------------------------------------------------------
 */

async function getDaily(dateKey) {
  return await getHash(dailyKey(dateKey));
}

async function getMonth(monthKeyValue) {
  return await getHash(monthKey(monthKeyValue));
}

async function getYear(yearKeyValue) {
  return await getHash(yearKey(yearKeyValue));
}

async function getAllTime() {
  return await getHash(allTimeKey());
}

async function getWorkingDays(monthKeyValue) {
  const value = await redis(
    "GET",
    workingDaysKey(monthKeyValue)
  );

  return number(value);
}

/*
 * ------------------------------------------------------------
 * Records
 * ------------------------------------------------------------
 */

async function getZRangeWithScores(key) {
  const result = await redis(
    "ZRANGE",
    key,
    "0",
    "-1",
    "WITHSCORES"
  );

  if (!Array.isArray(result)) {
    return [];
  }

  const output = [];

  for (let i = 0; i < result.length; i += 2) {
    output.push({
      member: result[i],
      score: number(result[i + 1]),
    });
  }

  return output;
}

async function getRecord(chatId, recordId) {
  return await getHash(
    recordKey(chatId, recordId)
  );
}

async function getAllRecords(chatId) {
  const items = await getZRangeWithScores(
    recordsIndexKey(chatId)
  );

  const records = [];

  for (const item of items) {
    const record = await getRecord(
      chatId,
      item.member
    );

    if (!record || !record.id) {
      continue;
    }

    records.push(record);
  }

  records.sort(
    (a, b) =>
      number(b.createdAt) -
      number(a.createdAt)
  );

  return records;
}

async function getLatestActiveRecord(chatId) {
  const records =
    await getAllRecords(chatId);

  for (const record of records) {
    if (String(record.cancelled) !== "1") {
      return record;
    }
  }

  return null;
}

function formatRecordDate(createdAt) {
  const date = new Date(number(createdAt));

  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const obj = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      obj[part.type] = part.value;
    }
  }

  return (
    `${obj.year}/${obj.month}/${obj.day} ` +
    `${obj.hour}:${obj.minute}`
  );
}

/*
 * ------------------------------------------------------------
 * Atomic /sales
 * ------------------------------------------------------------
 *
 * ここが今回の重要修正。
 *
 * 以下を全部1回のLua実行で処理する。
 *
 * ・個別レコード作成
 * ・個別レコードindex
 * ・日次
 * ・月次
 * ・年次
 * ・累計
 * ・稼働日
 * ・日次best
 * ・月次best
 *
 * 途中だけ成功する状態を防止。
 */

const SALES_LUA = `
local sales = tonumber(ARGV[1])
local orders = tonumber(ARGV[2])
local recordId = ARGV[3]
local chatId = ARGV[4]
local dateKey = ARGV[5]
local monthKeyValue = ARGV[6]
local yearKeyValue = ARGV[7]
local createdAt = ARGV[8]

local dailyKey = KEYS[1]
local monthKey = KEYS[2]
local yearKey = KEYS[3]
local allTimeKey = KEYS[4]
local workingDaysKey = KEYS[5]
local recordKey = KEYS[6]
local recordsIndexKey = KEYS[7]

local currentDailySales =
  tonumber(redis.call("HGET", dailyKey, "sales") or "0")

local currentDailyOrders =
  tonumber(redis.call("HGET", dailyKey, "orders") or "0")

local newDailySales =
  currentDailySales + sales

local newDailyOrders =
  currentDailyOrders + orders

local currentDailyBestSales =
  tonumber(redis.call("HGET", dailyKey, "bestSales") or "0")

local currentDailyBestOrders =
  tonumber(redis.call("HGET", dailyKey, "bestOrders") or "0")

local newDailyBestSales =
  math.max(currentDailyBestSales, newDailySales)

local newDailyBestOrders =
  math.max(currentDailyBestOrders, newDailyOrders)

redis.call(
  "HSET",
  recordKey,
  "id", recordId,
  "chatId", chatId,
  "sales", tostring(sales),
  "orders", tostring(orders),
  "dateKey", dateKey,
  "monthKey", monthKeyValue,
  "yearKey", yearKeyValue,
  "createdAt", createdAt,
  "cancelled", "0"
)

redis.call(
  "ZADD",
  recordsIndexKey,
  createdAt,
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
  "HSET",
  dailyKey,
  "bestSales",
  tostring(newDailyBestSales),
  "bestOrders",
  tostring(newDailyBestOrders)
)

redis.call(
  "HINCRBY",
  monthKey,
  "sales",
  sales
)

redis.call(
  "HINCRBY",
  monthKey,
  "orders",
  orders
)

local currentMonthBestSales =
  tonumber(redis.call("HGET", monthKey, "bestSales") or "0")

local currentMonthBestOrders =
  tonumber(redis.call("HGET", monthKey, "bestOrders") or "0")

redis.call(
  "HSET",
  monthKey,
  "bestSales",
  tostring(math.max(currentMonthBestSales, newDailySales)),
  "bestOrders",
  tostring(math.max(currentMonthBestOrders, newDailyOrders))
)

redis.call(
  "HINCRBY",
  yearKey,
  "sales",
  sales
)

redis.call(
  "HINCRBY",
  yearKey,
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

local counted =
  tonumber(redis.call("HGET", dailyKey, "workingDayCounted") or "0")

if counted ~= 1 then
  redis.call(
    "HSET",
    dailyKey,
    "workingDayCounted",
    "1"
  )

  redis.call(
    "INCR",
    workingDaysKey
  )
end

return recordId
`;

/*
 * ------------------------------------------------------------
 * Atomic /cancel
 * ------------------------------------------------------------
 *
 * ・対象レコード取得
 * ・キャンセル済み確認
 * ・レコードをキャンセル
 * ・日次減算
 * ・月次減算
 * ・年次減算
 * ・累計減算
 *
 * 全部を1回のLuaで実行。
 */

const CANCEL_LUA = `
local recordKey = KEYS[1]
local dailyKey = KEYS[2]
local monthKey = KEYS[3]
local yearKey = KEYS[4]
local allTimeKey = KEYS[5]

local sales =
  tonumber(redis.call("HGET", recordKey, "sales") or "0")

local orders =
  tonumber(redis.call("HGET", recordKey, "orders") or "0")

local cancelled =
  redis.call("HGET", recordKey, "cancelled")

if cancelled == "1" then
  return {"ALREADY_CANCELLED", "0", "0"}
end

redis.call(
  "HSET",
  recordKey,
  "cancelled",
  "1",
  "cancelledAt",
  ARGV[1]
)

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
  monthKey,
  "sales",
  -sales
)

redis.call(
  "HINCRBY",
  monthKey,
  "orders",
  -orders
)

redis.call(
  "HINCRBY",
  yearKey,
  "sales",
  -sales
)

redis.call(
  "HINCRBY",
  yearKey,
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

return {"CANCELLED", tostring(sales), tostring(orders)}
`;

/*
 * ------------------------------------------------------------
 * /sales
 * ------------------------------------------------------------
 */

async function processSales(
  chatId,
  sales,
  orders
) {
  const now =
    getTokyoDateInfo();

  const recordId =
    makeRecordId();

  const createdAt =
    Date.now();

  await redisEval(
    SALES_LUA,
    [
      dailyKey(now.dateKey),
      monthKey(now.monthKey),
      yearKey(now.yearKey),
      allTimeKey(),
      workingDaysKey(now.monthKey),
      recordKey(chatId, recordId),
      recordsIndexKey(chatId),
    ],
    [
      sales,
      orders,
      recordId,
      chatId,
      now.dateKey,
      now.monthKey,
      now.yearKey,
      createdAt,
    ]
  );

  return await buildReport(now);
}

/*
 * ------------------------------------------------------------
 * Report
 * ------------------------------------------------------------
 */

function getAverage(sales, workingDays) {
  if (workingDays <= 0) {
    return 0;
  }

  return Math.floor(
    sales / workingDays
  );
}

async function buildReport(now) {
  const daily =
    await getDaily(now.dateKey);

  const month =
    await getMonth(now.monthKey);

  const year =
    await getYear(now.yearKey);

  const allTime =
    await getAllTime();

  const workingDays =
    await getWorkingDays(now.monthKey);

  const todaySales =
    number(daily.sales);

  const todayOrders =
    number(daily.orders);

  const monthlySales =
    number(month.sales);

  const monthlyOrders =
    number(month.orders);

  const yearlySales =
    number(year.sales);

  const yearlyOrders =
    number(year.orders);

  const averageSales =
    getAverage(
      monthlySales,
      workingDays
    );

  const achievement =
    MONTHLY_TARGET > 0
      ? Math.floor(
          (monthlySales /
            MONTHLY_TARGET) *
            100
        )
      : 0;

  const bestSales =
    number(month.bestSales);

  const bestOrders =
    number(month.bestOrders);

  const totalOrders =
    number(allTime.orders);

  const timestamp =
    `${now.year}年${now.month}月${now.day}日 ` +
    `${pad2(now.hour)}:${pad2(now.minute)}`;

  return (
`🏍️ 配達売上
💰 今日の売上　${formatYen(todaySales)}円
📦 今日の件数　${formatNumber(todayOrders)}件
💵 1件あたり　${
      todayOrders > 0
        ? formatYen(
            Math.floor(
              todaySales /
                todayOrders
            )
          )
        : "0"
    }円
📅 今月売上　${formatYen(monthlySales)}円
📦 今月件数　${formatNumber(monthlyOrders)}件
🗓️ 年間売上　${formatYen(yearlySales)}円
📦 年間件数　${formatNumber(yearlyOrders)}件
📈 平均売上／日　${formatYen(averageSales)}円
🎯 月間目標　${formatYen(MONTHLY_TARGET)}円
📊 目標達成率　${achievement}%
🏆 月間最高売上　${formatYen(bestSales)}円
🏆 月間最高件数　${formatNumber(bestOrders)}件
📆 稼働日数　${formatNumber(workingDays)}日
🛵 累計配達件数　${formatNumber(totalOrders)}件
🕐 ${timestamp}
🛵 今日も配達お疲れ様でした！`
  );
}

/*
 * ------------------------------------------------------------
 * /cancel
 * ------------------------------------------------------------
 */

async function processCancel(chatId) {
  const record =
    await getLatestActiveRecord(chatId);

  if (!record) {
    await sendTelegramMessage(
      chatId,
      "❌ キャンセルできる売上がありません。"
    );

    return;
  }

  const result =
    await redisEval(
      CANCEL_LUA,
      [
        recordKey(chatId, record.id),
        dailyKey(record.dateKey),
        monthKey(record.monthKey),
        yearKey(record.yearKey),
        allTimeKey(),
      ],
      [
        Date.now(),
      ]
    );

  if (
    !Array.isArray(result) ||
    result[0] !== "CANCELLED"
  ) {
    await sendTelegramMessage(
      chatId,
      "❌ この売上はすでにキャンセルされています。"
    );

    return;
  }

  const sales =
    number(result[1]);

  const orders =
    number(result[2]);

  const now =
    getTokyoDateInfo();

  const report =
    await buildReport(now);

  await sendTelegramMessage(
    chatId,
`❌ 売上をキャンセルしました。

💰 ${formatYen(sales)}円
📦 ${formatNumber(orders)}件
📅 売上日 ${record.dateKey}

${report}`
  );
}

/*
 * ------------------------------------------------------------
 * /record
 * ------------------------------------------------------------
 *
 * ここは完全に読み取り専用。
 *
 * 以前のように /record 実行時に
 * Redisの値を書き換えない。
 */

async function processRecord(chatId) {
  const now =
    getTokyoDateInfo();

  /*
   * 月間記録
   */
  const monthlyParts = [];

  for (
    let offset = 0;
    offset < 24;
    offset++
  ) {
    const date =
      new Date(
        Date.UTC(
          now.year,
          now.month - 1 - offset,
          1
        )
      );

    const year =
      date.getUTCFullYear();

    const month =
      date.getUTCMonth() + 1;

    const key =
      `${year}-${pad2(month)}`;

    const monthData =
      await getMonth(key);

    const sales =
      number(monthData.sales);

    const orders =
      number(monthData.orders);

    if (
      sales === 0 &&
      orders === 0 &&
      !monthData.bestSales &&
      !monthData.bestOrders
    ) {
      continue;
    }

    const bestSales =
      number(monthData.bestSales);

    const bestOrders =
      number(monthData.bestOrders);

    monthlyParts.push(
`📅 ${year}年${month}月
📅 月間売上 ${formatYen(sales)}円
📦 月間件数 ${formatNumber(orders)}件
🏆 月間最高売上 ${formatYen(bestSales)}円
🏆 月間最高件数 ${formatNumber(bestOrders)}件`
    );
  }

  /*
   * 個別履歴
   */
  const records =
    await getAllRecords(chatId);

  const history =
    records.slice(0, 30);

  const historyParts = [];

  for (const record of history) {
    const status =
      String(record.cancelled) === "1"
        ? "❌ キャンセル済み"
        : "✅ 有効";

    historyParts.push(
`${formatRecordDate(record.createdAt)}
💰 売上 ${formatYen(record.sales)}円
📦 件数 ${formatNumber(record.orders)}件
${status}`
    );
  }

  /*
   * 有効個別履歴
   */
  let activeSalesTotal = 0;
  let activeOrdersTotal = 0;

  for (const record of records) {
    if (
      String(record.cancelled) === "1"
    ) {
      continue;
    }

    activeSalesTotal +=
      number(record.sales);

    activeOrdersTotal +=
      number(record.orders);
  }

  /*
   * 現在のRedis
   */
  const daily =
    await getDaily(now.dateKey);

  const month =
    await getMonth(now.monthKey);

  const year =
    await getYear(now.yearKey);

  const allTime =
    await getAllTime();

  const auditParts = [
`🔎 現在値と個別履歴の照合

【有効な個別履歴】
💰 ${formatYen(activeSalesTotal)}円
📦 ${formatNumber(activeOrdersTotal)}件

【今日のRedis集計】
💰 ${formatYen(daily.sales)}円
📦 ${formatNumber(daily.orders)}件

【今月のRedis集計】
💰 ${formatYen(month.sales)}円
📦 ${formatNumber(month.orders)}件

【今年のRedis集計】
💰 ${formatYen(year.sales)}円
📦 ${formatNumber(year.orders)}件

【累計Redis集計】
💰 ${formatYen(allTime.sales)}円
📦 ${formatNumber(allTime.orders)}件`
  ];

  let text =
    "📊 月間記録\n\n";

  if (monthlyParts.length > 0) {
    text +=
      monthlyParts.join("\n\n");
  } else {
    text +=
      "記録がありません。";
  }

  text +=
    "\n\n━━━━━━━━━━━━━━\n";

  text +=
    "📋 個別売上履歴\n\n";

  if (historyParts.length > 0) {
    text +=
      historyParts.join("\n\n");
  } else {
    text +=
      "個別売上履歴がありません。\n";
  }

  text +=
    "\n\n━━━━━━━━━━━━━━\n";

  text +=
    auditParts.join("\n\n");

  text +=
    `\n\n🕐 ${now.year}年${now.month}月${now.day}日 ` +
    `${pad2(now.hour)}:${pad2(now.minute)}`;

  await sendTelegramMessage(
    chatId,
    text
  );
}

/*
 * ------------------------------------------------------------
 * Command parser
 * ------------------------------------------------------------
 */

function parseCommand(text) {
  const trimmed =
    String(text || "").trim();

  const parts =
    trimmed.split(/\s+/);

  const command =
    (parts[0] || "")
      .split("@")[0]
      .toLowerCase();

  return {
    command,
    args: parts.slice(1),
  };
}

/*
 * ------------------------------------------------------------
 * Telegram update
 * ------------------------------------------------------------
 */

async function handleUpdate(update) {
  if (
    !update ||
    !update.message
  ) {
    return;
  }

  const message =
    update.message;

  const chatId =
    message.chat &&
    message.chat.id;

  if (!chatId) {
    return;
  }

  const text =
    typeof message.text === "string"
      ? message.text.trim()
      : "";

  if (!text.startsWith("/")) {
    return;
  }

  const {
    command,
    args,
  } = parseCommand(text);

  /*
   * /sales
   */
  if (command === "/sales") {
    if (args.length !== 2) {
      await sendTelegramMessage(
        chatId,
        "使い方：/sales 売上 件数\n例：/sales 17014 17"
      );

      return;
    }

    const sales =
      Number(args[0]);

    const orders =
      Number(args[1]);

    if (
      !Number.isFinite(sales) ||
      !Number.isFinite(orders) ||
      sales < 0 ||
      orders < 0 ||
      !Number.isInteger(sales) ||
      !Number.isInteger(orders)
    ) {
      await sendTelegramMessage(
        chatId,
        "❌ 売上と件数は正しい数字で入力してください。"
      );

      return;
    }

    const report =
      await processSales(
        chatId,
        sales,
        orders
      );

    await sendTelegramPhoto(
      chatId,
      report
    );

    return;
  }

  /*
   * /cancel
   */
  if (command === "/cancel") {
    if (args.length !== 0) {
      await sendTelegramMessage(
        chatId,
        "❌ /cancel は引数不要です。"
      );

      return;
    }

    await processCancel(chatId);

    return;
  }

  /*
   * /record
   */
  if (command === "/record") {
    if (args.length !== 0) {
      await sendTelegramMessage(
        chatId,
        "❌ /record は引数不要です。"
      );

      return;
    }

    await processRecord(chatId);

    return;
  }

  /*
   * その他のコマンドは何もしない
   */
}

/*
 * ------------------------------------------------------------
 * Vercel
 * ------------------------------------------------------------
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
    });
  }

  try {
    await handleUpdate(req.body);

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "telegram handler error:",
      error
    );

    /*
     * エラー時に追加のRedis変更をしない。
     */
    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
    });
  }
}
