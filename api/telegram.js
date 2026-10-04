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
    throw new Error(`Redis response parse error: ${text}`);
  }

  if (!response.ok || data?.error) {
    throw new Error(
      `Redis error: ${data?.error || response.statusText || text}`
    );
  }

  return data?.result;
}

async function redisMulti(commands) {
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
    throw new Error(`Redis multi response parse error: ${text}`);
  }

  if (!response.ok || data?.error) {
    throw new Error(
      `Redis multi error: ${data?.error || response.statusText || text}`
    );
  }

  const results = data?.result;

  if (!Array.isArray(results)) {
    throw new Error(`Redis multi invalid result: ${JSON.stringify(data)}`);
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

  const jst = new Date(
    now.toLocaleString("en-US", {
      timeZone: "Asia/Tokyo",
    })
  );

  return jst;
}

function getDateKey(date = getJstNow()) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-");
}

function getMonthKey(date = getJstNow()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function getYearKey(date = getJstNow()) {
  return String(date.getFullYear());
}

function getMonthStart(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function getRecordId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ja-JP");
}

function calcAverage(totalSales, totalOrders) {
  if (!totalOrders) return 0;
  return Math.floor(Number(totalSales || 0) / Number(totalOrders));
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ============================================================
// Redis keys
// ============================================================

function dailyKey(dateKey) {
  return `moheji:delivery:daily:${dateKey}`;
}

function monthKey(month) {
  return `moheji:delivery:month:${month}`;
}

function yearKey(year) {
  return `moheji:delivery:year:${year}`;
}

function alltimeKey() {
  return `moheji:delivery:alltime`;
}

function recordKey(chatId, recordId) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}

// ============================================================
// Hash helper
// ============================================================

async function getHash(key) {
  const result = await redis("HGETALL", key);

  if (!result) return {};

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

function numField(hash, field) {
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

  const data = await response.json();

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
    parse_mode: "HTML",
  });
}

async function sendPhoto(chatId, caption) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo: SALES_IMAGE_URL,
    caption,
    parse_mode: "HTML",
  });
}

// ============================================================
// Individual record
//
// IMPORTANT:
// Never use:
// moheji:delivery:records:${chatId}
//
// It may be an old/wrong Redis type.
// Individual records are discovered only through SCAN.
// ============================================================

async function getRecordKeys(chatId) {
  let cursor = "0";
  const keys = [];

  const pattern = `moheji:delivery:record:${chatId}:*`;

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "100"
    );

    cursor = String(result?.[0] ?? "0");

    const found = result?.[1] || [];

    for (const key of found) {
      keys.push(key);
    }
  } while (cursor !== "0");

  return keys;
}

async function getRecordHistory(chatId) {
  const keys = await getRecordKeys(chatId);

  if (keys.length === 0) {
    return [];
  }

  const commands = keys.map((key) => ["GET", key]);

  const results = await redisMulti(commands);

  const records = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];

    if (!item || item.result == null) {
      continue;
    }

    try {
      const record = JSON.parse(item.result);

      if (record && typeof record === "object") {
        records.push(record);
      }
    } catch {
      // Ignore invalid historical records
    }
  }

  records.sort((a, b) => {
    const ta = Date.parse(a.createdAt || "") || 0;
    const tb = Date.parse(b.createdAt || "") || 0;

    return tb - ta;
  });

  return records;
}

async function getLatestActiveRecord(chatId) {
  const records = await getRecordHistory(chatId);

  for (const record of records) {
    if (record.cancelled !== true) {
      return record;
    }
  }

  return null;
}

// ============================================================
// Working days
//
// Do NOT use:
// moheji:delivery:workingdays:${month}
//
// Old key may have the wrong Redis type.
// Calculate working days from daily keys.
// ============================================================

async function getWorkingDays(month) {
  let cursor = "0";
  const keys = [];

  const pattern = `moheji:delivery:daily:${month}-*`;

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "100"
    );

    cursor = String(result?.[0] ?? "0");

    const found = result?.[1] || [];

    for (const key of found) {
      keys.push(key);
    }
  } while (cursor !== "0");

  if (keys.length === 0) {
    return 0;
  }

  const commands = keys.map((key) => ["HGET", key, "orders"]);

  const results = await redisMulti(commands);

  let workingDays = 0;

  for (const item of results) {
    const orders = Number(item?.result || 0);

    if (orders > 0) {
      workingDays++;
    }
  }

  return workingDays;
}

// ============================================================
// Sales processing
// ============================================================

async function processSales(chatId, sales, orders) {
  const now = getJstNow();

  const dateKey = getDateKey(now);
  const month = getMonthKey(now);
  const year = getYearKey(now);

  const dKey = dailyKey(dateKey);
  const mKey = monthKey(month);
  const yKey = yearKey(year);
  const aKey = alltimeKey();

  const recordId = getRecordId();

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

  const rKey = recordKey(chatId, recordId);

  // IMPORTANT:
  // No ZADD.
  // No moheji:delivery:records:${chatId}
  //
  // Only individual SET + aggregate HINCRBY/HSET.

  const commands = [
    ["HINCRBY", dKey, "sales", Number(sales)],
    ["HINCRBY", dKey, "orders", Number(orders)],

    ["HSET", dKey, "bestSales", Number(sales)],
    ["HSET", dKey, "bestOrders", Number(orders)],

    ["HINCRBY", mKey, "sales", Number(sales)],
    ["HINCRBY", mKey, "orders", Number(orders)],

    ["HSET", mKey, "bestSales", Number(sales)],
    ["HSET", mKey, "bestOrders", Number(orders)],

    ["HINCRBY", yKey, "sales", Number(sales)],
    ["HINCRBY", yKey, "orders", Number(orders)],

    ["HINCRBY", aKey, "sales", Number(sales)],
    ["HINCRBY", aKey, "orders", Number(orders)],

    ["SET", rKey, JSON.stringify(record)],
  ];

  await redisMulti(commands);

  // Recalculate daily/monthly best values correctly.
  await updateBestValues(dateKey, month);

  return record;
}

// ============================================================
// Best value update
// ============================================================

async function updateBestValues(dateKey, month) {
  const dKey = dailyKey(dateKey);
  const mKey = monthKey(month);

  const daily = await getHash(dKey);

  const currentDailySales = numField(daily, "sales");
  const currentDailyOrders = numField(daily, "orders");

  const monthlyBest = await calculateMonthlyBest(month);

  await redis(
    "HSET",
    dKey,
    "bestSales",
    currentDailySales,
    "bestOrders",
    currentDailyOrders
  );

  await redis(
    "HSET",
    mKey,
    "bestSales",
    monthlyBest.bestSales,
    "bestOrders",
    monthlyBest.bestOrders
  );
}

async function calculateMonthlyBest(month) {
  let cursor = "0";
  const keys = [];

  const pattern = `moheji:delivery:daily:${month}-*`;

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "100"
    );

    cursor = String(result?.[0] ?? "0");

    const found = result?.[1] || [];

    for (const key of found) {
      keys.push(key);
    }
  } while (cursor !== "0");

  if (keys.length === 0) {
    return {
      bestSales: 0,
      bestOrders: 0,
    };
  }

  const commands = keys.map((key) => ["HGETALL", key]);

  const results = await redisMulti(commands);

  let bestSales = 0;
  let bestOrders = 0;

  for (const item of results) {
    const result = item?.result;

    let hash = {};

    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i += 2) {
        hash[result[i]] = result[i + 1];
      }
    } else if (result && typeof result === "object") {
      hash = result;
    }

    const sales = Number(hash.sales || 0);
    const orders = Number(hash.orders || 0);

    if (sales > bestSales) {
      bestSales = sales;
    }

    if (orders > bestOrders) {
      bestOrders = orders;
    }
  }

  return {
    bestSales,
    bestOrders,
  };
}

// ============================================================
// Cancel
// ============================================================

async function cancelLatestSale(chatId) {
  const record = await getLatestActiveRecord(chatId);

  if (!record) {
    return {
      ok: false,
      message: "❌ キャンセルできる配達売上がありません。",
    };
  }

  const sales = Number(record.sales || 0);
  const orders = Number(record.orders || 0);

  const dateKey = record.dateKey;
  const month = record.monthKey;
  const year = record.yearKey;

  const dKey = dailyKey(dateKey);
  const mKey = monthKey(month);
  const yKey = yearKey(year);
  const aKey = alltimeKey();

  const rKey = recordKey(chatId, record.id);

  const updatedRecord = {
    ...record,
    cancelled: true,
    cancelledAt: new Date().toISOString(),
  };

  const commands = [
    ["HINCRBY", dKey, "sales", -sales],
    ["HINCRBY", dKey, "orders", -orders],

    ["HINCRBY", mKey, "sales", -sales],
    ["HINCRBY", mKey, "orders", -orders],

    ["HINCRBY", yKey, "sales", -sales],
    ["HINCRBY", yKey, "orders", -orders],

    ["HINCRBY", aKey, "sales", -sales],
    ["HINCRBY", aKey, "orders", -orders],

    ["SET", rKey, JSON.stringify(updatedRecord)],
  ];

  await redisMulti(commands);

  // Best values are historical max values.
  // They are intentionally NOT reduced by cancellation.

  return {
    ok: true,
    record: updatedRecord,
  };
}

// ============================================================
// Sales report
// ============================================================

async function buildSalesReport() {
  const now = getJstNow();

  const dateKey = getDateKey(now);
  const month = getMonthKey(now);
  const year = getYearKey(now);

  const [daily, monthly, yearly, alltime, workingDays] =
    await Promise.all([
      getHash(dailyKey(dateKey)),
      getHash(monthKey(month)),
      getHash(yearKey(year)),
      getHash(alltimeKey()),
      getWorkingDays(month),
    ]);

  const todaySales = numField(daily, "sales");
  const todayOrders = numField(daily, "orders");

  const monthlySales = numField(monthly, "sales");
  const monthlyOrders = numField(monthly, "orders");

  const yearlySales = numField(yearly, "sales");
  const yearlyOrders = numField(yearly, "orders");

  const alltimeOrders = numField(alltime, "orders");

  const avgPerDay =
    workingDays > 0
      ? Math.floor(monthlySales / workingDays)
      : 0;

  const monthlyAchievement =
    MONTHLY_TARGET > 0
      ? Math.floor((monthlySales / MONTHLY_TARGET) * 100)
      : 0;

  const bestSales = numField(monthly, "bestSales");
  const bestOrders = numField(monthly, "bestOrders");

  const timestamp =
    `${now.getFullYear()}年` +
    `${now.getMonth() + 1}月` +
    `${now.getDate()}日 ` +
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  return (
    `🏍️ 配達売上\n` +
    `💰 今日の売上　${formatNumber(todaySales)}円\n` +
    `📦 今日の件数　${formatNumber(todayOrders)}件\n` +
    `💵 1件あたり　${formatNumber(calcAverage(todaySales, todayOrders))}円\n` +
    `📅 今月売上　${formatNumber(monthlySales)}円\n` +
    `📦 今月件数　${formatNumber(monthlyOrders)}件\n` +
    `🗓️ 年間売上　${formatNumber(yearlySales)}円\n` +
    `📦 年間件数　${formatNumber(yearlyOrders)}件\n` +
    `📈 平均売上／日　${formatNumber(avgPerDay)}円\n` +
    `🎯 月間目標　${formatNumber(MONTHLY_TARGET)}円\n` +
    `📊 目標達成率　${formatNumber(monthlyAchievement)}%\n` +
    `🏆 月間最高売上　${formatNumber(bestSales)}円\n` +
    `🏆 月間最高件数　${formatNumber(bestOrders)}件\n` +
    `📆 稼働日数　${formatNumber(workingDays)}日\n` +
    `🛵 累計配達件数　${formatNumber(alltimeOrders)}件\n` +
    `🕐 ${timestamp}\n` +
    `🛵 今日も配達お疲れ様でした！`
  );
}

// ============================================================
// Record report
// ============================================================

async function buildRecordReport(chatId) {
  const now = getJstNow();

  const currentMonth = getMonthKey(now);

  const records = await getRecordHistory(chatId);

  const activeRecords = records.filter(
    (record) => record.cancelled !== true
  );

  // ----------------------------------------------------------
  // Current month Redis
  // ----------------------------------------------------------

  const currentMonthRedis = await getHash(
    monthKey(currentMonth)
  );

  const redisMonthSales = numField(
    currentMonthRedis,
    "sales"
  );

  const redisMonthOrders = numField(
    currentMonthRedis,
    "orders"
  );

  // ----------------------------------------------------------
  // Individual active records
  // ----------------------------------------------------------

  const monthRecords = activeRecords.filter(
    (record) => record.monthKey === currentMonth
  );

  const individualMonthSales = monthRecords.reduce(
    (sum, record) => sum + Number(record.sales || 0),
    0
  );

  const individualMonthOrders = monthRecords.reduce(
    (sum, record) => sum + Number(record.orders || 0),
    0
  );

  const salesDiff =
    redisMonthSales - individualMonthSales;

  const ordersDiff =
    redisMonthOrders - individualMonthOrders;

  // ----------------------------------------------------------
  // Monthly summary
  // ----------------------------------------------------------

  const monthlySummary = {};

  for (const record of activeRecords) {
    const month = record.monthKey;

    if (!monthlySummary[month]) {
      monthlySummary[month] = {
        sales: 0,
        orders: 0,
        bestSales: 0,
        bestOrders: 0,
      };
    }

    monthlySummary[month].sales += Number(record.sales || 0);
    monthlySummary[month].orders += Number(record.orders || 0);

    if (Number(record.sales || 0) > monthlySummary[month].bestSales) {
      monthlySummary[month].bestSales =
        Number(record.sales || 0);
    }

    if (Number(record.orders || 0) > monthlySummary[month].bestOrders) {
      monthlySummary[month].bestOrders =
        Number(record.orders || 0);
    }
  }

  // ----------------------------------------------------------
  // Build text
  // ----------------------------------------------------------

  let text = "📋 配達売上記録\n\n";

  const months = Object.keys(monthlySummary).sort().reverse();

  if (months.length === 0) {
    text += "個別記録はありません。\n";
  } else {
    text += "【個別記録 月別集計】\n";

    for (const month of months) {
      const item = monthlySummary[month];

      text +=
        `📅 ${month}\n` +
        `💰 売上　${formatNumber(item.sales)}円\n` +
        `📦 件数　${formatNumber(item.orders)}件\n` +
        `🏆 最高売上　${formatNumber(item.bestSales)}円\n` +
        `🏆 最高件数　${formatNumber(item.bestOrders)}件\n\n`;
    }
  }

  // ----------------------------------------------------------
  // Individual history
  // ----------------------------------------------------------

  text += "【個別売上履歴】\n";

  if (records.length === 0) {
    text += "記録なし\n";
  } else {
    const displayRecords = records.slice(0, 30);

    for (const record of displayRecords) {
      const status =
        record.cancelled === true ? "❌取消" : "✅有効";

      text +=
        `${record.dateKey || "-"} ` +
        `${formatNumber(record.sales)}円 / ` +
        `${formatNumber(record.orders)}件 ` +
        `${status}\n`;
    }

    if (records.length > 30) {
      text += `…ほか ${records.length - 30}件\n`;
    }
  }

  // ----------------------------------------------------------
  // Current month audit
  // ----------------------------------------------------------

  text += "\n【今月照合】\n";

  text +=
    `個別記録　${formatNumber(individualMonthSales)}円 / ` +
    `${formatNumber(individualMonthOrders)}件\n`;

  text +=
    `Redis集計　${formatNumber(redisMonthSales)}円 / ` +
    `${formatNumber(redisMonthOrders)}件\n`;

  text +=
    `差額　${formatNumber(salesDiff)}円 / ` +
    `${formatNumber(ordersDiff)}件\n`;

  if (salesDiff === 0 && ordersDiff === 0) {
    text += "✅ 個別記録とRedis集計は一致しています。\n";
  } else {
    text +=
      "⚠️ 個別記録とRedis集計に差があります。\n" +
      "※既存の集計値は自動修正していません。\n";
  }

  // ----------------------------------------------------------
  // Current month working days
  // ----------------------------------------------------------

  const workingDays = await getWorkingDays(currentMonth);

  text +=
    `📆 今月の稼働日数　${formatNumber(workingDays)}日\n`;

  return text;
}

// ============================================================
// /sales
// ============================================================

async function handleSales(chatId, args) {
  if (args.length !== 2) {
    await sendMessage(
      chatId,
      "❗ 使い方：\n/sales 売上 件数\n\n例：\n/sales 17014 17"
    );

    return;
  }

  const sales = Number(args[0]);
  const orders = Number(args[1]);

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

  const record = await processSales(
    chatId,
    Math.floor(sales),
    Math.floor(orders)
  );

  const report = await buildSalesReport();

  await sendPhoto(chatId, report);
}

// ============================================================
// /cancel
// ============================================================

async function handleCancel(chatId) {
  const result = await cancelLatestSale(chatId);

  if (!result.ok) {
    await sendMessage(chatId, result.message);
    return;
  }

  const record = result.record;

  await sendMessage(
    chatId,
    `✅ 最新の売上をキャンセルしました。\n\n` +
      `📅 ${record.dateKey}\n` +
      `💰 ${formatNumber(record.sales)}円\n` +
      `📦 ${formatNumber(record.orders)}件`
  );
}

// ============================================================
// /record
// ============================================================

async function handleRecord(chatId) {
  const report = await buildRecordReport(chatId);

  await sendMessage(chatId, report);
}

// ============================================================
// Command parser
// ============================================================

async function handleUpdate(update) {
  const message = update?.message;

  if (!message?.chat?.id) {
    return;
  }

  const text = String(message.text || "").trim();

  if (!text.startsWith("/")) {
    return;
  }

  const parts = text.split(/\s+/);

  const command = parts[0]
    .split("@")[0]
    .toLowerCase();

  const args = parts.slice(1);

  const chatId = message.chat.id;

  // Only these commands are supported.
  if (command === "/sales") {
    await handleSales(chatId, args);
    return;
  }

  if (command === "/cancel") {
    await handleCancel(chatId);
    return;
  }

  if (command === "/record") {
    await handleRecord(chatId);
    return;
  }

  // No response for other commands.
}

// ============================================================
// Vercel handler
// ============================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
    });
  }

  try {
    const update = req.body;

    await handleUpdate(update);

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error("telegram handler error:", error);

    return res.status(200).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}
