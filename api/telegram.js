// api/telegram.js

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const SALES_IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTHLY_TARGET = 500000;

// ============================================================
// Redis REST
// ============================================================

async function redis(...args) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    throw new Error("Redis environment variables are missing.");
  }

  const response = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Redis JSON parse error: ${text.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Redis HTTP ${response.status}: ${
        data?.error || text.slice(0, 500)
      }`
    );
  }

  if (data?.error) {
    throw new Error(`Redis error: ${data.error}`);
  }

  return data?.result;
}

// ============================================================
// Redis multi-exec
// ============================================================

async function redisMulti(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return [];
  }

  const response = await fetch(`${KV_REST_API_URL}/multi-exec`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Redis multi JSON parse error: ${text.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Redis multi HTTP ${response.status}: ${
        data?.error || text.slice(0, 500)
      }`
    );
  }

  if (data?.error) {
    throw new Error(`Redis multi error: ${data.error}`);
  }

  const results = data?.result;

  if (!Array.isArray(results)) {
    throw new Error(
      `Redis multi invalid result: ${JSON.stringify(data).slice(0, 1000)}`
    );
  }

  for (const item of results) {
    if (item && item.error) {
      throw new Error(
        `Redis transaction command error: ${JSON.stringify(item)}`
      );
    }
  }

  return results;
}

// ============================================================
// Utility
// ============================================================

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getJstNow() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return new Date(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
}

function getDateKey(date = getJstNow()) {
  return (
    `${date.getFullYear()}-` +
    `${pad2(date.getMonth() + 1)}-` +
    `${pad2(date.getDate())}`
  );
}

function getMonthKey(date = getJstNow()) {
  return (
    `${date.getFullYear()}-` +
    `${pad2(date.getMonth() + 1)}`
  );
}

function getYearKey(date = getJstNow()) {
  return String(date.getFullYear());
}

function getRecordId() {
  return (
    `${Date.now()}-` +
    Math.random().toString(36).slice(2, 10)
  );
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ja-JP");
}

function calcAverage(totalSales, totalOrders) {
  if (!totalOrders) {
    return 0;
  }

  return Math.floor(
    Number(totalSales || 0) /
      Number(totalOrders || 0)
  );
}

// ============================================================
// Redis keys
// ============================================================

function dailyKey(dateKey) {
  return `moheji:delivery:daily:${dateKey}`;
}

function monthRedisKey(month) {
  return `moheji:delivery:month:${month}`;
}

function yearRedisKey(year) {
  return `moheji:delivery:year:${year}`;
}

function alltimeKey() {
  return `moheji:delivery:alltime`;
}

function individualRecordKey(chatId, recordId) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}

// ============================================================
// Hash
// ============================================================

async function getHash(key) {
  const result = await redis("HGETALL", key);

  if (!result) {
    return {};
  }

  if (Array.isArray(result)) {
    const hash = {};

    for (let i = 0; i < result.length; i += 2) {
      hash[result[i]] = result[i + 1];
    }

    return hash;
  }

  if (typeof result === "object") {
    return result;
  }

  return {};
}

function hashNumber(hash, field) {
  return Number(hash?.[field] || 0);
}

// ============================================================
// Telegram
// ============================================================

async function telegram(method, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Telegram JSON parse error: ${text.slice(0, 500)}`
    );
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram ${method} error: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function sendMessage(chatId, text) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
  });
}

async function sendPhoto(chatId, caption) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo: SALES_IMAGE_URL,
    caption,
  });
}

// ============================================================
// SCAN individual records
//
// IMPORTANT
// NEVER use:
// moheji:delivery:records:${chatId}
//
// NEVER use ZREVRANGE.
// NEVER use ZADD.
// ============================================================

async function scanIndividualRecordKeys(chatId) {
  let cursor = "0";

  const keys = [];

  const pattern =
    `moheji:delivery:record:${chatId}:*`;

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "100"
    );

    if (!Array.isArray(result)) {
      throw new Error(
        `Unexpected SCAN result: ${JSON.stringify(result)}`
      );
    }

    cursor = String(result[0] ?? "0");

    const found = Array.isArray(result[1])
      ? result[1]
      : [];

    for (const key of found) {
      if (typeof key === "string") {
        keys.push(key);
      }
    }
  } while (cursor !== "0");

  return [...new Set(keys)];
}

// ============================================================
// Individual record history
//
// Intentionally uses individual GET calls.
// This avoids another multi-exec/type issue in /record.
// ============================================================

async function getRecordHistory(chatId) {
  const keys = await scanIndividualRecordKeys(chatId);

  const records = [];

  for (const key of keys) {
    try {
      const raw = await redis("GET", key);

      if (!raw) {
        continue;
      }

      const record =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;

      if (
        record &&
        typeof record === "object"
      ) {
        records.push(record);
      }
    } catch (error) {
      console.error(
        "individual record read error:",
        key,
        error
      );
    }
  }

  records.sort((a, b) => {
    const ta =
      Date.parse(a.createdAt || "") || 0;

    const tb =
      Date.parse(b.createdAt || "") || 0;

    return tb - ta;
  });

  return records;
}

async function getLatestActiveRecord(chatId) {
  const records =
    await getRecordHistory(chatId);

  for (const record of records) {
    if (record.cancelled !== true) {
      return record;
    }
  }

  return null;
}

// ============================================================
// Calculate working days
//
// NEVER use:
// moheji:delivery:workingdays:${month}
// ============================================================

async function getWorkingDays(month) {
  let cursor = "0";

  const keys = [];

  const pattern =
    `moheji:delivery:daily:${month}-*`;

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "100"
    );

    if (!Array.isArray(result)) {
      throw new Error(
        `Unexpected working-day SCAN result: ${JSON.stringify(result)}`
      );
    }

    cursor = String(result[0] ?? "0");

    const found = Array.isArray(result[1])
      ? result[1]
      : [];

    for (const key of found) {
      keys.push(key);
    }
  } while (cursor !== "0");

  let workingDays = 0;

  for (const key of [...new Set(keys)]) {
    const orders = await redis(
      "HGET",
      key,
      "orders"
    );

    if (Number(orders || 0) > 0) {
      workingDays++;
    }
  }

  return workingDays;
}

// ============================================================
// Recalculate monthly best from ACTIVE individual records
//
// This is the important cancellation fix.
// ============================================================

async function recalculateMonthlyBestFromRecords(
  chatId,
  month
) {
  const records =
    await getRecordHistory(chatId);

  const activeRecords =
    records.filter(
      (record) =>
        record.cancelled !== true &&
        record.monthKey === month
    );

  let bestSales = 0;
  let bestOrders = 0;

  for (const record of activeRecords) {
    const sales =
      Number(record.sales || 0);

    const orders =
      Number(record.orders || 0);

    if (sales > bestSales) {
      bestSales = sales;
    }

    if (orders > bestOrders) {
      bestOrders = orders;
    }
  }

  await redis(
    "HSET",
    monthRedisKey(month),
    "bestSales",
    bestSales,
    "bestOrders",
    bestOrders
  );

  return {
    bestSales,
    bestOrders,
  };
}

// ============================================================
// Recalculate daily best from ACTIVE individual records
// ============================================================

async function recalculateDailyBestFromRecords(
  chatId,
  dateKey
) {
  const records =
    await getRecordHistory(chatId);

  const activeRecords =
    records.filter(
      (record) =>
        record.cancelled !== true &&
        record.dateKey === dateKey
    );

  let bestSales = 0;
  let bestOrders = 0;

  for (const record of activeRecords) {
    const sales =
      Number(record.sales || 0);

    const orders =
      Number(record.orders || 0);

    if (sales > bestSales) {
      bestSales = sales;
    }

    if (orders > bestOrders) {
      bestOrders = orders;
    }
  }

  await redis(
    "HSET",
    dailyKey(dateKey),
    "bestSales",
    bestSales,
    "bestOrders",
    bestOrders
  );

  return {
    bestSales,
    bestOrders,
  };
}

// ============================================================
// /sales
// ============================================================

async function processSales(
  chatId,
  sales,
  orders
) {
  const now = getJstNow();

  const dateKey =
    getDateKey(now);

  const month =
    getMonthKey(now);

  const year =
    getYearKey(now);

  const recordId =
    getRecordId();

  const record = {
    id: recordId,

    chatId: String(chatId),

    sales: Number(sales),
    orders: Number(orders),

    dateKey,
    monthKey: month,
    yearKey: year,

    createdAt: now.toISOString(),

    cancelled: false,
  };

  const recordKey =
    individualRecordKey(
      chatId,
      recordId
    );

  const commands = [
    // Daily
    [
      "HINCRBY",
      dailyKey(dateKey),
      "sales",
      Number(sales),
    ],

    [
      "HINCRBY",
      dailyKey(dateKey),
      "orders",
      Number(orders),
    ],

    // Monthly
    [
      "HINCRBY",
      monthRedisKey(month),
      "sales",
      Number(sales),
    ],

    [
      "HINCRBY",
      monthRedisKey(month),
      "orders",
      Number(orders),
    ],

    // Year
    [
      "HINCRBY",
      yearRedisKey(year),
      "sales",
      Number(sales),
    ],

    [
      "HINCRBY",
      yearRedisKey(year),
      "orders",
      Number(orders),
    ],

    // All time
    [
      "HINCRBY",
      alltimeKey(),
      "sales",
      Number(sales),
    ],

    [
      "HINCRBY",
      alltimeKey(),
      "orders",
      Number(orders),
    ],

    // Individual record
    [
      "SET",
      recordKey,
      JSON.stringify(record),
    ],
  ];

  await redisMulti(commands);

  // Recalculate best values AFTER the record exists.
  await recalculateDailyBestFromRecords(
    chatId,
    dateKey
  );

  await recalculateMonthlyBestFromRecords(
    chatId,
    month
  );

  return record;
}

// ============================================================
// /cancel
// ============================================================

async function cancelLatestSale(chatId) {
  const record =
    await getLatestActiveRecord(chatId);

  if (!record) {
    return {
      ok: false,
      message:
        "❌ キャンセルできる配達売上がありません。",
    };
  }

  const sales =
    Number(record.sales || 0);

  const orders =
    Number(record.orders || 0);

  const dateKey =
    record.dateKey;

  const month =
    record.monthKey;

  const year =
    record.yearKey;

  const updatedRecord = {
    ...record,

    cancelled: true,

    cancelledAt:
      new Date().toISOString(),
  };

  const commands = [
    // Original day
    [
      "HINCRBY",
      dailyKey(dateKey),
      "sales",
      -sales,
    ],

    [
      "HINCRBY",
      dailyKey(dateKey),
      "orders",
      -orders,
    ],

    // Original month
    [
      "HINCRBY",
      monthRedisKey(month),
      "sales",
      -sales,
    ],

    [
      "HINCRBY",
      monthRedisKey(month),
      "orders",
      -orders,
    ],

    // Original year
    [
      "HINCRBY",
      yearRedisKey(year),
      "sales",
      -sales,
    ],

    [
      "HINCRBY",
      yearRedisKey(year),
      "orders",
      -orders,
    ],

    // All time
    [
      "HINCRBY",
      alltimeKey(),
      "sales",
      -sales,
    ],

    [
      "HINCRBY",
      alltimeKey(),
      "orders",
      -orders,
    ],

    // Keep audit history.
    [
      "SET",
      individualRecordKey(
        chatId,
        record.id
      ),
      JSON.stringify(updatedRecord),
    ],
  ];

  await redisMulti(commands);

  // IMPORTANT:
  // Recalculate because the cancelled record
  // may have been the monthly/daily best.
  await recalculateDailyBestFromRecords(
    chatId,
    dateKey
  );

  await recalculateMonthlyBestFromRecords(
    chatId,
    month
  );

  return {
    ok: true,
    record: updatedRecord,
  };
}

// ============================================================
// Sales report
// ============================================================

async function buildSalesReport() {
  const now =
    getJstNow();

  const dateKey =
    getDateKey(now);

  const month =
    getMonthKey(now);

  const year =
    getYearKey(now);

  const [
    daily,
    monthly,
    yearly,
    alltime,
    workingDays,
  ] = await Promise.all([
    getHash(
      dailyKey(dateKey)
    ),

    getHash(
      monthRedisKey(month)
    ),

    getHash(
      yearRedisKey(year)
    ),

    getHash(
      alltimeKey()
    ),

    getWorkingDays(month),
  ]);

  const todaySales =
    hashNumber(daily, "sales");

  const todayOrders =
    hashNumber(daily, "orders");

  const monthlySales =
    hashNumber(monthly, "sales");

  const monthlyOrders =
    hashNumber(monthly, "orders");

  const yearlySales =
    hashNumber(yearly, "sales");

  const yearlyOrders =
    hashNumber(yearly, "orders");

  const alltimeOrders =
    hashNumber(alltime, "orders");

  const avgPerDay =
    workingDays > 0
      ? Math.floor(
          monthlySales / workingDays
        )
      : 0;

  const achievementRate =
    MONTHLY_TARGET > 0
      ? Math.floor(
          (monthlySales /
            MONTHLY_TARGET) *
            100
        )
      : 0;

  const bestSales =
    hashNumber(
      monthly,
      "bestSales"
    );

  const bestOrders =
    hashNumber(
      monthly,
      "bestOrders"
    );

  const timestamp =
    `${now.getFullYear()}年` +
    `${now.getMonth() + 1}月` +
    `${now.getDate()}日 ` +
    `${pad2(now.getHours())}:` +
    `${pad2(now.getMinutes())}`;

  return (
    `🏍️ 配達売上\n` +
    `💰 今日の売上　${formatNumber(todaySales)}円\n` +
    `📦 今日の件数　${formatNumber(todayOrders)}件\n` +
    `💵 1件あたり　${formatNumber(
      calcAverage(
        todaySales,
        todayOrders
      )
    )}円\n` +
    `📅 今月売上　${formatNumber(monthlySales)}円\n` +
    `📦 今月件数　${formatNumber(monthlyOrders)}件\n` +
    `🗓️ 年間売上　${formatNumber(yearlySales)}円\n` +
    `📦 年間件数　${formatNumber(yearlyOrders)}件\n` +
    `📈 平均売上／日　${formatNumber(avgPerDay)}円\n` +
    `🎯 月間目標　${formatNumber(
      MONTHLY_TARGET
    )}円\n` +
    `📊 目標達成率　${formatNumber(
      achievementRate
    )}%\n` +
    `🏆 月間最高売上　${formatNumber(bestSales)}円\n` +
    `🏆 月間最高件数　${formatNumber(bestOrders)}件\n` +
    `📆 稼働日数　${formatNumber(
      workingDays
    )}日\n` +
    `🛵 累計配達件数　${formatNumber(
      alltimeOrders
    )}件\n` +
    `🕐 ${timestamp}\n` +
    `🛵 今日も配達お疲れ様でした！`
  );
}

// ============================================================
// /record report
// ============================================================

async function buildRecordReport(chatId) {
  const now =
    getJstNow();

  const currentMonth =
    getMonthKey(now);

  const records =
    await getRecordHistory(chatId);

  const activeRecords =
    records.filter(
      (record) =>
        record.cancelled !== true
    );

  // ----------------------------------------------------------
  // Current month Redis
  // ----------------------------------------------------------

  const currentMonthRedis =
    await getHash(
      monthRedisKey(currentMonth)
    );

  const redisMonthSales =
    hashNumber(
      currentMonthRedis,
      "sales"
    );

  const redisMonthOrders =
    hashNumber(
      currentMonthRedis,
      "orders"
    );

  // ----------------------------------------------------------
  // Individual current month
  // ----------------------------------------------------------

  const monthRecords =
    activeRecords.filter(
      (record) =>
        record.monthKey ===
        currentMonth
    );

  const individualMonthSales =
    monthRecords.reduce(
      (sum, record) =>
        sum +
        Number(
          record.sales || 0
        ),
      0
    );

  const individualMonthOrders =
    monthRecords.reduce(
      (sum, record) =>
        sum +
        Number(
          record.orders || 0
        ),
      0
    );

  const salesDiff =
    redisMonthSales -
    individualMonthSales;

  const ordersDiff =
    redisMonthOrders -
    individualMonthOrders;

  // ----------------------------------------------------------
  // Monthly summary from individual records
  // ----------------------------------------------------------

  const monthlySummary = {};

  for (const record of activeRecords) {
    const month =
      record.monthKey ||
      "不明";

    if (!monthlySummary[month]) {
      monthlySummary[month] = {
        sales: 0,
        orders: 0,
        bestSales: 0,
        bestOrders: 0,
      };
    }

    const sales =
      Number(record.sales || 0);

    const orders =
      Number(record.orders || 0);

    monthlySummary[month].sales +=
      sales;

    monthlySummary[month].orders +=
      orders;

    if (
      sales >
      monthlySummary[month].bestSales
    ) {
      monthlySummary[month].bestSales =
        sales;
    }

    if (
      orders >
      monthlySummary[month].bestOrders
    ) {
      monthlySummary[month].bestOrders =
        orders;
    }
  }

  // ----------------------------------------------------------
  // Report
  // ----------------------------------------------------------

  let text =
    "📋 配達売上記録\n\n";

  const months =
    Object.keys(
      monthlySummary
    ).sort().reverse();

  if (months.length === 0) {
    text +=
      "個別記録はありません。\n";
  } else {
    text +=
      "【個別記録 月別集計】\n";

    for (const month of months) {
      const item =
        monthlySummary[month];

      text +=
        `📅 ${month}\n` +
        `💰 売上　${formatNumber(
          item.sales
        )}円\n` +
        `📦 件数　${formatNumber(
          item.orders
        )}件\n` +
        `🏆 最高売上　${formatNumber(
          item.bestSales
        )}円\n` +
        `🏆 最高件数　${formatNumber(
          item.bestOrders
        )}件\n\n`;
    }
  }

  // ----------------------------------------------------------
  // Individual history
  // ----------------------------------------------------------

  text +=
    "【個別売上履歴】\n";

  if (records.length === 0) {
    text += "記録なし\n";
  } else {
    const displayRecords =
      records.slice(0, 30);

    for (const record of displayRecords) {
      const status =
        record.cancelled === true
          ? "❌取消"
          : "✅有効";

      text +=
        `${record.dateKey || "-"} ` +
        `${formatNumber(
          record.sales
        )}円 / ` +
        `${formatNumber(
          record.orders
        )}件 ` +
        `${status}\n`;
    }

    if (records.length > 30) {
      text +=
        `…ほか ${
          records.length - 30
        }件\n`;
    }
  }

  // ----------------------------------------------------------
  // Current month audit
  // ----------------------------------------------------------

  text +=
    "\n【今月照合】\n";

  text +=
    `個別記録　${formatNumber(
      individualMonthSales
    )}円 / ${formatNumber(
      individualMonthOrders
    )}件\n`;

  text +=
    `Redis集計　${formatNumber(
      redisMonthSales
    )}円 / ${formatNumber(
      redisMonthOrders
    )}件\n`;

  text +=
    `差額　${formatNumber(
      salesDiff
    )}円 / ${formatNumber(
      ordersDiff
    )}件\n`;

  if (
    salesDiff === 0 &&
    ordersDiff === 0
  ) {
    text +=
      "✅ 個別記録とRedis集計は一致しています。\n";
  } else {
    text +=
      "⚠️ 個別記録とRedis集計に差があります。\n" +
      "※既存の集計値は自動修正していません。\n";
  }

  // ----------------------------------------------------------
  // Working days
  // ----------------------------------------------------------

  try {
    const workingDays =
      await getWorkingDays(
        currentMonth
      );

    text +=
      `📆 今月の稼働日数　${formatNumber(
        workingDays
      )}日\n`;
  } catch (error) {
    console.error(
      "working days error:",
      error
    );

    text +=
      "📆 今月の稼働日数　取得エラー\n";
  }

  return text;
}

// ============================================================
// /sales
// ============================================================

async function handleSales(
  chatId,
  args
) {
  if (args.length !== 2) {
    await sendMessage(
      chatId,
      "❗ 使い方：\n/sales 売上 件数\n\n例：\n/sales 17014 17"
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
    orders < 0
  ) {
    await sendMessage(
      chatId,
      "❗ 売上と件数は数字で入力してください。"
    );

    return;
  }

  await processSales(
    chatId,
    Math.floor(sales),
    Math.floor(orders)
  );

  const report =
    await buildSalesReport();

  await sendPhoto(
    chatId,
    report
  );
}

// ============================================================
// /cancel
// ============================================================

async function handleCancel(chatId) {
  const result =
    await cancelLatestSale(
      chatId
    );

  if (!result.ok) {
    await sendMessage(
      chatId,
      result.message
    );

    return;
  }

  const record =
    result.record;

  await sendMessage(
    chatId,
    `✅ 最新の売上をキャンセルしました。\n\n` +
      `📅 ${record.dateKey}\n` +
      `💰 ${formatNumber(
        record.sales
      )}円\n` +
      `📦 ${formatNumber(
        record.orders
      )}件`
  );
}

// ============================================================
// /record
// ============================================================

async function handleRecord(chatId) {
  const report =
    await buildRecordReport(
      chatId
    );

  await sendMessage(
    chatId,
    report
  );
}

// ============================================================
// Update handler
// ============================================================

async function handleUpdate(update) {
  const message =
    update?.message;

  if (!message?.chat?.id) {
    return;
  }

  const rawText =
    String(
      message.text || ""
    ).trim();

  if (!rawText) {
    return;
  }

  if (!rawText.startsWith("/")) {
    return;
  }

  const parts =
    rawText.split(/\s+/);

  const command =
    String(parts[0] || "")
      .split("@")[0]
      .toLowerCase();

  const args =
    parts.slice(1);

  const chatId =
    message.chat.id;

  // Only these 3 commands respond.
  if (command === "/sales") {
    await handleSales(
      chatId,
      args
    );

    return;
  }

  if (command === "/cancel") {
    await handleCancel(
      chatId
    );

    return;
  }

  if (command === "/record") {
    await handleRecord(
      chatId
    );

    return;
  }

  // All other commands are ignored.
}

// ============================================================
// Vercel
// ============================================================

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
    });
  }

  try {
    await handleUpdate(
      req.body
    );

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "telegram handler error:",
      error
    );

    // Important:
    // Tell Telegram user what happened instead of
    // silently returning nothing.
    try {
      const chatId =
        req.body?.message?.chat?.id;

      if (chatId) {
        const message =
          String(
            error?.message ||
              error ||
              "unknown error"
          );

        await sendMessage(
          chatId,
          `⚠️ 処理中にエラーが発生しました。\n\n${message.slice(
            0,
            3000
          )}`
        );
      }
    } catch (sendError) {
      console.error(
        "error message send failed:",
        sendError
      );
    }

    return res.status(200).json({
      ok: false,
      error: String(
        error?.message ||
          error
      ),
    });
  }
}
