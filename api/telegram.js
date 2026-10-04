// api/telegram.js

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const DEBUG_KEY = process.env.DEBUG_KEY;

const TARGET_MONTHLY = 500000;

const SALES_IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";


/* =========================================================
   Redis REST
========================================================= */

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

  if (!response.ok) {
    throw new Error(
      `Redis error ${response.status}: ${text}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Redis invalid JSON: ${text}`
    );
  }

  if (data && data.error) {
    throw new Error(
      `Redis command error: ${JSON.stringify(data)}`
    );
  }

  return data.result;
}


/* =========================================================
   Redis Multi
========================================================= */

async function redisMulti(commands) {
  const response = await fetch(
    `${KV_REST_API_URL}/multi-exec`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Redis transaction error ${response.status}: ${text}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Redis transaction invalid JSON: ${text}`
    );
  }

  if (!Array.isArray(data.result)) {
    throw new Error(
      `Redis transaction invalid result: ${JSON.stringify(data)}`
    );
  }

  for (const item of data.result) {
    if (
      item &&
      typeof item === "object" &&
      item.error
    ) {
      throw new Error(
        `Redis transaction command error: ${JSON.stringify(item)}`
      );
    }
  }

  return data.result;
}


/* =========================================================
   Telegram
========================================================= */

async function telegram(method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Telegram error ${response.status}: ${text}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Telegram invalid JSON: ${text}`
    );
  }

  if (!data.ok) {
    throw new Error(
      `Telegram API error: ${JSON.stringify(data)}`
    );
  }

  return data;
}


/* =========================================================
   Utility
========================================================= */

function pad2(value) {
  return String(value).padStart(2, "0");
}


function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());

  return `${year}-${month}-${day}`;
}


function getMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);

  return `${year}-${month}`;
}


function getYearKey(date = new Date()) {
  return String(date.getFullYear());
}


function formatNumber(value) {
  return Number(value || 0).toLocaleString("ja-JP");
}


function toInt(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.trunc(number);
}


function createRecordId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}


/* =========================================================
   Redis keys
========================================================= */

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
  return "moheji:delivery:alltime";
}


function individualRecordKey(chatId, recordId) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}


/* =========================================================
   Hash
========================================================= */

async function getHash(key) {
  const result = await redis(
    "HGETALL",
    key
  );

  if (!result) {
    return {};
  }

  if (Array.isArray(result)) {
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

  if (typeof result === "object") {
    return result;
  }

  return {};
}


async function getHashNumber(key, field) {
  const value = await redis(
    "HGET",
    key,
    field
  );

  return toInt(value);
}


/* =========================================================
   SCAN
========================================================= */

async function scanKeys(match) {
  let cursor = "0";
  const keys = [];

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      match,
      "COUNT",
      "100"
    );

    const nextCursor =
      result?.[0];

    const foundKeys =
      result?.[1] || [];

    cursor =
      String(nextCursor);

    if (Array.isArray(foundKeys)) {
      keys.push(...foundKeys);
    }

  } while (cursor !== "0");

  return keys;
}


/* =========================================================
   Individual records
========================================================= */

async function scanIndividualRecordKeys(chatId) {
  return await scanKeys(
    `moheji:delivery:record:${chatId}:*`
  );
}


async function getRecordHistory(chatId) {
  const keys =
    await scanIndividualRecordKeys(
      chatId
    );

  const records = [];

  for (const key of keys) {
    try {
      const raw =
        await redis(
          "GET",
          key
        );

      if (!raw) {
        continue;
      }

      const record =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;

      if (
        !record ||
        typeof record !== "object"
      ) {
        continue;
      }

      if (
        record.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(record.dateKey)
        )
      ) {
        const parts =
          String(record.dateKey)
            .split("-");

        if (!record.monthKey) {
          record.monthKey =
            `${parts[0]}-${parts[1]}`;
        }

        if (!record.yearKey) {
          record.yearKey =
            parts[0];
        }
      }

      records.push(record);

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
      Date.parse(
        a.createdAt || ""
      ) || 0;

    const tb =
      Date.parse(
        b.createdAt || ""
      ) || 0;

    return tb - ta;
  });

  return records;
}


/* =========================================================
   Working days
========================================================= */

async function getWorkingDays(month) {
  const keys =
    await scanKeys(
      `moheji:delivery:daily:${month}-*`
    );

  let workingDays = 0;

  for (const key of keys) {
    const orders =
      await getHashNumber(
        key,
        "orders"
      );

    if (orders > 0) {
      workingDays++;
    }
  }

  return workingDays;
}


/* =========================================================
   Monthly best
========================================================= */

async function recalculateMonthlyBestFromRecords(
  chatId,
  month
) {
  const records =
    await getRecordHistory(
      chatId
    );

  let bestSales = 0;
  let bestOrders = 0;

  for (const record of records) {
    if (record.cancelled) {
      continue;
    }

    const recordMonth =
      record.monthKey ||
      (
        record.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(record.dateKey)
        )
          ? String(record.dateKey)
              .slice(0, 7)
          : ""
      );

    if (recordMonth !== month) {
      continue;
    }

    bestSales =
      Math.max(
        bestSales,
        toInt(record.sales)
      );

    bestOrders =
      Math.max(
        bestOrders,
        toInt(record.orders)
      );
  }

  await redisMulti([
    [
      "HSET",
      monthRedisKey(month),
      "bestSales",
      String(bestSales),
      "bestOrders",
      String(bestOrders),
    ],
  ]);

  return {
    bestSales,
    bestOrders,
  };
}


/* =========================================================
   Daily best
========================================================= */

async function recalculateDailyBestFromRecords(
  chatId,
  dateKey
) {
  const records =
    await getRecordHistory(
      chatId
    );

  let bestSales = 0;
  let bestOrders = 0;

  for (const record of records) {
    if (
      record.cancelled ||
      String(record.dateKey) !==
        String(dateKey)
    ) {
      continue;
    }

    bestSales =
      Math.max(
        bestSales,
        toInt(record.sales)
      );

    bestOrders =
      Math.max(
        bestOrders,
        toInt(record.orders)
      );
  }

  await redisMulti([
    [
      "HSET",
      dailyKey(dateKey),
      "bestSales",
      String(bestSales),
      "bestOrders",
      String(bestOrders),
    ],
  ]);

  return {
    bestSales,
    bestOrders,
  };
}


/* =========================================================
   /sales
========================================================= */

async function processSales(
  chatId,
  sales,
  orders
) {
  const now =
    new Date();

  const dateKey =
    getDateKey(now);

  const month =
    getMonthKey(now);

  const year =
    getYearKey(now);

  const recordId =
    createRecordId();

  const record = {
    recordId,
    chatId: String(chatId),

    dateKey,
    monthKey: month,
    yearKey: year,

    sales,
    orders,

    cancelled: false,

    createdAt:
      now.toISOString(),
  };

  await redisMulti([
    [
      "HINCRBY",
      dailyKey(dateKey),
      "sales",
      String(sales),
    ],

    [
      "HINCRBY",
      dailyKey(dateKey),
      "orders",
      String(orders),
    ],

    [
      "HINCRBY",
      monthRedisKey(month),
      "sales",
      String(sales),
    ],

    [
      "HINCRBY",
      monthRedisKey(month),
      "orders",
      String(orders),
    ],

    [
      "HINCRBY",
      yearRedisKey(year),
      "sales",
      String(sales),
    ],

    [
      "HINCRBY",
      yearRedisKey(year),
      "orders",
      String(orders),
    ],

    [
      "HINCRBY",
      alltimeKey(),
      "sales",
      String(sales),
    ],

    [
      "HINCRBY",
      alltimeKey(),
      "orders",
      String(orders),
    ],

    [
      "SET",
      individualRecordKey(
        chatId,
        recordId
      ),
      JSON.stringify(record),
    ],
  ]);

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


/* =========================================================
   /cancel
========================================================= */

async function cancelLatestSale(chatId) {
  const records =
    await getRecordHistory(
      chatId
    );

  const latest =
    records.find(
      (record) =>
        !record.cancelled
    );

  if (!latest) {
    return null;
  }

  const sales =
    toInt(latest.sales);

  const orders =
    toInt(latest.orders);

  const originalDate =
    latest.dateKey;

  const originalMonth =
    latest.monthKey ||
    (
      originalDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(
        String(originalDate)
      )
        ? String(originalDate)
            .slice(0, 7)
        : ""
    );

  const originalYear =
    latest.yearKey ||
    (
      originalDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(
        String(originalDate)
      )
        ? String(originalDate)
            .slice(0, 4)
        : ""
    );

  if (
    !originalDate ||
    !originalMonth ||
    !originalYear
  ) {
    throw new Error(
      "キャンセル対象の記録に日付情報がありません。"
    );
  }

  const key =
    individualRecordKey(
      chatId,
      latest.recordId
    );

  const cancelledRecord = {
    ...latest,
    cancelled: true,
    cancelledAt:
      new Date().toISOString(),
  };

  await redisMulti([
    [
      "HINCRBY",
      dailyKey(originalDate),
      "sales",
      String(-sales),
    ],

    [
      "HINCRBY",
      dailyKey(originalDate),
      "orders",
      String(-orders),
    ],

    [
      "HINCRBY",
      monthRedisKey(originalMonth),
      "sales",
      String(-sales),
    ],

    [
      "HINCRBY",
      monthRedisKey(originalMonth),
      "orders",
      String(-orders),
    ],

    [
      "HINCRBY",
      yearRedisKey(originalYear),
      "sales",
      String(-sales),
    ],

    [
      "HINCRBY",
      yearRedisKey(originalYear),
      "orders",
      String(-orders),
    ],

    [
      "HINCRBY",
      alltimeKey(),
      "sales",
      String(-sales),
    ],

    [
      "HINCRBY",
      alltimeKey(),
      "orders",
      String(-orders),
    ],

    [
      "SET",
      key,
      JSON.stringify(
        cancelledRecord
      ),
    ],
  ]);

  await recalculateDailyBestFromRecords(
    chatId,
    originalDate
  );

  await recalculateMonthlyBestFromRecords(
    chatId,
    originalMonth
  );

  return cancelledRecord;
}


/* =========================================================
   /sales report
========================================================= */

async function buildSalesReport(chatId) {
  const now =
    new Date();

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

    getWorkingDays(
      month
    ),
  ]);

  const todaySales =
    toInt(daily.sales);

  const todayOrders =
    toInt(daily.orders);

  const monthSales =
    toInt(monthly.sales);

  const monthOrders =
    toInt(monthly.orders);

  const yearSales =
    toInt(yearly.sales);

  const yearOrders =
    toInt(yearly.orders);

  const totalOrders =
    toInt(alltime.orders);

  const bestSales =
    toInt(monthly.bestSales);

  const bestOrders =
    toInt(monthly.bestOrders);

  const perOrder =
    todayOrders > 0
      ? Math.floor(
          todaySales /
            todayOrders
        )
      : 0;

  const averagePerDay =
    workingDays > 0
      ? Math.floor(
          monthSales /
            workingDays
        )
      : 0;

  const achievement =
    TARGET_MONTHLY > 0
      ? Math.floor(
          (monthSales /
            TARGET_MONTHLY) *
            100
        )
      : 0;

  const timestamp =
    `${now.getFullYear()}年` +
    `${pad2(now.getMonth() + 1)}月` +
    `${pad2(now.getDate())}日 ` +
    `${pad2(now.getHours())}:` +
    `${pad2(now.getMinutes())}`;

  return (
    `🏍️ 配達売上\n` +
    `💰 今日の売上　${formatNumber(todaySales)}円\n` +
    `📦 今日の件数　${formatNumber(todayOrders)}件\n` +
    `💵 1件あたり　${formatNumber(perOrder)}円\n` +
    `📅 今月売上　${formatNumber(monthSales)}円\n` +
    `📦 今月件数　${formatNumber(monthOrders)}件\n` +
    `🗓️ 年間売上　${formatNumber(yearSales)}円\n` +
    `📦 年間件数　${formatNumber(yearOrders)}件\n` +
    `📈 平均売上／日　${formatNumber(averagePerDay)}円\n` +
    `🎯 月間目標　${formatNumber(TARGET_MONTHLY)}円\n` +
    `📊 目標達成率　${formatNumber(achievement)}%\n` +
    `🏆 月間最高売上　${formatNumber(bestSales)}円\n` +
    `🏆 月間最高件数　${formatNumber(bestOrders)}件\n` +
    `📆 稼働日数　${formatNumber(workingDays)}日\n` +
    `🛵 累計配達件数　${formatNumber(totalOrders)}件\n` +
    `🕐 ${timestamp}\n` +
    `🛵 今日も配達お疲れ様でした！`
  );
}


/* =========================================================
   /record
========================================================= */

async function buildRecordReport(chatId) {
  const now =
    new Date();

  const currentMonth =
    getMonthKey(now);

  const records =
    await getRecordHistory(
      chatId
    );

  const activeRecords =
    records.filter(
      (record) =>
        !record.cancelled
    );

  const monthlyMap = {};

  for (const record of activeRecords) {
    const month =
      record.monthKey ||
      (
        record.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(record.dateKey)
        )
          ? String(record.dateKey)
              .slice(0, 7)
          : "不明"
      );

    if (!monthlyMap[month]) {
      monthlyMap[month] = {
        sales: 0,
        orders: 0,
        bestSales: 0,
        bestOrders: 0,
      };
    }

    monthlyMap[month].sales +=
      toInt(record.sales);

    monthlyMap[month].orders +=
      toInt(record.orders);

    monthlyMap[month].bestSales =
      Math.max(
        monthlyMap[month].bestSales,
        toInt(record.sales)
      );

    monthlyMap[month].bestOrders =
      Math.max(
        monthlyMap[month].bestOrders,
        toInt(record.orders)
      );
  }

  const monthList =
    Object.keys(monthlyMap)
      .sort()
      .reverse();

  let monthlyText = "";

  if (monthList.length === 0) {
    monthlyText =
      "📅 記録なし\n";
  } else {
    for (const month of monthList) {
      const item =
        monthlyMap[month];

      monthlyText +=
        `📅 ${month}\n` +
        `💰 売上　${formatNumber(item.sales)}円\n` +
        `📦 件数　${formatNumber(item.orders)}件\n` +
        `🏆 最高売上　${formatNumber(item.bestSales)}円\n` +
        `🏆 最高件数　${formatNumber(item.bestOrders)}件\n\n`;
    }
  }

  let historyText = "";

  if (records.length === 0) {
    historyText =
      "記録なし\n";
  } else {
    for (const record of records) {
      const status =
        record.cancelled
          ? "❌取消"
          : "✅有効";

      historyText +=
        `${record.dateKey || "日付不明"} ` +
        `${formatNumber(record.sales)}円 / ` +
        `${formatNumber(record.orders)}件 ` +
        `${status}\n`;
    }
  }

  const monthRecords =
    activeRecords.filter((record) => {
      const recordMonth =
        record.monthKey ||
        (
          record.dateKey &&
          /^\d{4}-\d{2}-\d{2}$/.test(
            String(record.dateKey)
          )
            ? String(record.dateKey)
                .slice(0, 7)
            : ""
        );

      return (
        recordMonth ===
        currentMonth
      );
    });

  let individualMonthSales = 0;
  let individualMonthOrders = 0;

  for (const record of monthRecords) {
    individualMonthSales +=
      toInt(record.sales);

    individualMonthOrders +=
      toInt(record.orders);
  }

  const monthly =
    await getHash(
      monthRedisKey(
        currentMonth
      )
    );

  const redisMonthSales =
    toInt(monthly.sales);

  const redisMonthOrders =
    toInt(monthly.orders);

  const salesDiff =
    redisMonthSales -
    individualMonthSales;

  const ordersDiff =
    redisMonthOrders -
    individualMonthOrders;

  const workingDays =
    await getWorkingDays(
      currentMonth
    );

  const warning =
    salesDiff !== 0 ||
    ordersDiff !== 0
      ? "\n⚠️ 個別記録とRedis集計に差があります。\n" +
        "※既存の集計値は自動修正していません。"
      : "";

  return (
    `配達売上記録\n\n` +

    `【個別記録 月別集計】\n` +
    monthlyText +

    `【個別売上履歴】\n` +
    historyText +

    `\n【今月照合】\n` +
    `個別記録　${formatNumber(individualMonthSales)}円 / ` +
    `${formatNumber(individualMonthOrders)}件\n` +

    `Redis集計　${formatNumber(redisMonthSales)}円 / ` +
    `${formatNumber(redisMonthOrders)}件\n` +

    `差額　${formatNumber(salesDiff)}円 / ` +
    `${formatNumber(ordersDiff)}件\n` +

    warning +

    `\n📆 今月の稼働日数　${formatNumber(workingDays)}日`
  );
}


/* =========================================================
   DEBUG
   ※読み取り専用
   ※Redisを書き換える処理は一切しない
========================================================= */

async function buildDebugReport(chatId) {
  const now =
    new Date();

  const currentMonth =
    getMonthKey(now);

  const currentYear =
    getYearKey(now);

  /*
    個別記録
  */
  const records =
    await getRecordHistory(
      chatId
    );

  const activeRecords =
    records.filter(
      (record) =>
        !record.cancelled
    );

  let recordSales = 0;
  let recordOrders = 0;

  let cancelledSales = 0;
  let cancelledOrders = 0;

  const recordsByDate = {};

  for (const record of records) {
    const sales =
      toInt(record.sales);

    const orders =
      toInt(record.orders);

    if (record.cancelled) {
      cancelledSales += sales;
      cancelledOrders += orders;
      continue;
    }

    recordSales += sales;
    recordOrders += orders;

    const date =
      record.dateKey ||
      "不明";

    if (!recordsByDate[date]) {
      recordsByDate[date] = {
        sales: 0,
        orders: 0,
      };
    }

    recordsByDate[date].sales +=
      sales;

    recordsByDate[date].orders +=
      orders;
  }

  /*
    日別Redis
  */
  const dailyKeys =
    await scanKeys(
      "moheji:delivery:daily:*"
    );

  const dailyData = [];

  let dailyTotalSales = 0;
  let dailyTotalOrders = 0;

  for (const key of dailyKeys) {
    const data =
      await getHash(key);

    const date =
      key.replace(
        "moheji:delivery:daily:",
        ""
      );

    const sales =
      toInt(data.sales);

    const orders =
      toInt(data.orders);

    if (
      sales !== 0 ||
      orders !== 0
    ) {
      dailyData.push({
        date,
        sales,
        orders,
      });

      dailyTotalSales += sales;
      dailyTotalOrders += orders;
    }
  }

  dailyData.sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  /*
    月別Redis
  */
  const monthKeys =
    await scanKeys(
      "moheji:delivery:month:*"
    );

  const monthData = [];

  for (const key of monthKeys) {
    const data =
      await getHash(key);

    const month =
      key.replace(
        "moheji:delivery:month:",
        ""
      );

    const sales =
      toInt(data.sales);

    const orders =
      toInt(data.orders);

    monthData.push({
      month,
      sales,
      orders,
      bestSales:
        toInt(data.bestSales),
      bestOrders:
        toInt(data.bestOrders),
    });
  }

  monthData.sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  /*
    年別Redis
  */
  const yearKeys =
    await scanKeys(
      "moheji:delivery:year:*"
    );

  const yearData = [];

  for (const key of yearKeys) {
    const data =
      await getHash(key);

    const year =
      key.replace(
        "moheji:delivery:year:",
        ""
      );

    yearData.push({
      year,
      sales:
        toInt(data.sales),
      orders:
        toInt(data.orders),
    });
  }

  yearData.sort((a, b) =>
    a.year.localeCompare(b.year)
  );

  /*
    alltime
  */
  const alltime =
    await getHash(
      alltimeKey()
    );

  /*
    現在の月
  */
  const currentMonthRedis =
    await getHash(
      monthRedisKey(
        currentMonth
      )
    );

  /*
    現在の年
  */
  const currentYearRedis =
    await getHash(
      yearRedisKey(
        currentYear
      )
    );

  /*
    現在月の個別記録
  */
  let currentMonthRecordSales = 0;
  let currentMonthRecordOrders = 0;

  for (const record of activeRecords) {
    const recordMonth =
      record.monthKey ||
      (
        record.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(record.dateKey)
        )
          ? String(record.dateKey)
              .slice(0, 7)
          : ""
      );

    if (
      recordMonth ===
      currentMonth
    ) {
      currentMonthRecordSales +=
        toInt(record.sales);

      currentMonthRecordOrders +=
        toInt(record.orders);
    }
  }

  /*
    差額
  */
  const currentMonthSalesDiff =
    toInt(
      currentMonthRedis.sales
    ) -
    currentMonthRecordSales;

  const currentMonthOrdersDiff =
    toInt(
      currentMonthRedis.orders
    ) -
    currentMonthRecordOrders;

  /*
    出力
  */
  let text =
    `🔎 Redis調査レポート\n` +
    `※この処理は読み取り専用です\n` +
    `※Redisのデータは変更していません\n\n`;

  text +=
    `【現在月】\n` +
    `${currentMonth}\n\n`;

  text +=
    `【個別記録】\n` +
    `有効記録　${formatNumber(activeRecords.length)}件\n` +
    `有効売上　${formatNumber(recordSales)}円\n` +
    `有効件数　${formatNumber(recordOrders)}件\n` +
    `取消売上　${formatNumber(cancelledSales)}円\n` +
    `取消件数　${formatNumber(cancelledOrders)}件\n\n`;

  text +=
    `【今月：個別記録】\n` +
    `売上　${formatNumber(currentMonthRecordSales)}円\n` +
    `件数　${formatNumber(currentMonthRecordOrders)}件\n\n`;

  text +=
    `【今月：Redis】\n` +
    `売上　${formatNumber(toInt(currentMonthRedis.sales))}円\n` +
    `件数　${formatNumber(toInt(currentMonthRedis.orders))}件\n` +
    `最高売上　${formatNumber(toInt(currentMonthRedis.bestSales))}円\n` +
    `最高件数　${formatNumber(toInt(currentMonthRedis.bestOrders))}件\n\n`;

  text +=
    `【今月：差額】\n` +
    `売上　${formatNumber(currentMonthSalesDiff)}円\n` +
    `件数　${formatNumber(currentMonthOrdersDiff)}件\n\n`;

  text +=
    `【現在年：Redis】\n` +
    `売上　${formatNumber(toInt(currentYearRedis.sales))}円\n` +
    `件数　${formatNumber(toInt(currentYearRedis.orders))}件\n\n`;

  text +=
    `【全期間：Redis】\n` +
    `売上　${formatNumber(toInt(alltime.sales))}円\n` +
    `件数　${formatNumber(toInt(alltime.orders))}件\n\n`;

  text +=
    `【日別Redis合計】\n` +
    `売上　${formatNumber(dailyTotalSales)}円\n` +
    `件数　${formatNumber(dailyTotalOrders)}件\n\n`;

  text +=
    `【日別Redis】\n`;

  if (dailyData.length === 0) {
    text += "データなし\n";
  } else {
    for (const item of dailyData) {
      const recordDay =
        recordsByDate[item.date];

      const diffSales =
        recordDay
          ? item.sales -
            recordDay.sales
          : item.sales;

      const diffOrders =
        recordDay
          ? item.orders -
            recordDay.orders
          : item.orders;

      text +=
        `${item.date} ` +
        `${formatNumber(item.sales)}円 / ` +
        `${formatNumber(item.orders)}件`;

      if (
        diffSales !== 0 ||
        diffOrders !== 0
      ) {
        text +=
          ` ← 個別との差 ` +
          `${formatNumber(diffSales)}円 / ` +
          `${formatNumber(diffOrders)}件`;
      }

      text += "\n";
    }
  }

  text +=
    `\n【月別Redis】\n`;

  if (monthData.length === 0) {
    text += "データなし\n";
  } else {
    for (const item of monthData) {
      text +=
        `${item.month} ` +
        `${formatNumber(item.sales)}円 / ` +
        `${formatNumber(item.orders)}件\n`;
    }
  }

  text +=
    `\n【年別Redis】\n`;

  if (yearData.length === 0) {
    text += "データなし\n";
  } else {
    for (const item of yearData) {
      text +=
        `${item.year} ` +
        `${formatNumber(item.sales)}円 / ` +
        `${formatNumber(item.orders)}件\n`;
    }
  }

  text +=
    `\n【個別記録一覧】\n`;

  if (records.length === 0) {
    text += "データなし\n";
  } else {
    for (const record of records) {
      text +=
        `${record.dateKey || "不明"} ` +
        `${formatNumber(record.sales)}円 / ` +
        `${formatNumber(record.orders)}件 ` +
        `${record.cancelled ? "❌取消" : "✅有効"}\n`;
    }
  }

  return text;
}


/* =========================================================
   DEBUG HTTP
========================================================= */

async function handleDebugRequest(req, res) {
  /*
    GETのみ許可
  */
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return true;
  }

  /*
    DEBUG_KEY が設定されていない場合は無効
  */
  if (!DEBUG_KEY) {
    res.status(404).send("Not Found");
    return true;
  }

  const url =
    new URL(
      req.url,
      `https://${req.headers.host}`
    );

  const suppliedKey =
    url.searchParams.get(
      "key"
    );

  const chatId =
    url.searchParams.get(
      "chat_id"
    );

  if (
    !suppliedKey ||
    suppliedKey !== DEBUG_KEY
  ) {
    res.status(403).send("Forbidden");
    return true;
  }

  if (!chatId) {
    res
      .status(400)
      .send(
        "chat_id is required"
      );

    return true;
  }

  try {
    const report =
      await buildDebugReport(
        chatId
      );

    res.status(200);

    res.setHeader(
      "Content-Type",
      "text/plain; charset=utf-8"
    );

    res.send(report);

  } catch (error) {
    console.error(
      "debug error:",
      error
    );

    res
      .status(500)
      .send(
        `DEBUG ERROR\n\n${error.message}`
      );
  }

  return true;
}


/* =========================================================
   Command parser
========================================================= */

function parseCommand(text) {
  if (!text) {
    return null;
  }

  const trimmed =
    String(text).trim();

  if (
    !trimmed.startsWith("/")
  ) {
    return null;
  }

  const parts =
    trimmed.split(/\s+/);

  const command =
    parts[0]
      .split("@")[0]
      .toLowerCase();

  return {
    command,
    args: parts.slice(1),
  };
}


/* =========================================================
   /sales
========================================================= */

async function handleSales(
  chatId,
  args
) {
  if (
    args.length !== 2
  ) {
    return;
  }

  const sales =
    Number(args[0]);

  const orders =
    Number(args[1]);

  if (
    !Number.isFinite(sales) ||
    !Number.isFinite(orders)
  ) {
    return;
  }

  if (
    sales < 0 ||
    orders < 0
  ) {
    return;
  }

  await processSales(
    chatId,
    Math.trunc(sales),
    Math.trunc(orders)
  );

  const report =
    await buildSalesReport(
      chatId
    );

  await telegram(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: SALES_IMAGE_URL,
      caption: report,
    }
  );
}


/* =========================================================
   /cancel
========================================================= */

async function handleCancel(
  chatId
) {
  const cancelled =
    await cancelLatestSale(
      chatId
    );

  if (!cancelled) {
    await telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text:
          "⚠️ キャンセルできる売上記録がありません。",
      }
    );

    return;
  }

  await telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text:
        `↩️ 最新の売上をキャンセルしました。\n\n` +
        `📅 ${cancelled.dateKey}\n` +
        `💰 ${formatNumber(cancelled.sales)}円\n` +
        `📦 ${formatNumber(cancelled.orders)}件`,
    }
  );
}


/* =========================================================
   /record
========================================================= */

async function handleRecord(
  chatId
) {
  const report =
    await buildRecordReport(
      chatId
    );

  await telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text: report,
    }
  );
}


/* =========================================================
   Telegram update
========================================================= */

async function handleTelegramUpdate(
  update
) {
  const message =
    update?.message;

  if (!message) {
    return;
  }

  const chatId =
    message.chat?.id;

  if (!chatId) {
    return;
  }

  const parsed =
    parseCommand(
      message.text
    );

  if (!parsed) {
    return;
  }

  switch (parsed.command) {
    case "/sales":
      await handleSales(
        chatId,
        parsed.args
      );
      break;

    case "/cancel":
      await handleCancel(
        chatId
      );
      break;

    case "/record":
      await handleRecord(
        chatId
      );
      break;

    default:
      return;
  }
}


/* =========================================================
   Vercel entry point
========================================================= */

export default async function handler(
  req,
  res
) {
  /*
    調査モード
    GET + DEBUG_KEY のみ
  */
  if (
    req.method === "GET"
  ) {
    const handled =
      await handleDebugRequest(
        req,
        res
      );

    if (handled) {
      return;
    }
  }

  /*
    Telegram webhook
  */
  if (
    req.method !== "POST"
  ) {
    res
      .status(200)
      .send("OK");

    return;
  }

  try {
    await handleTelegramUpdate(
      req.body
    );

  } catch (error) {
    console.error(
      "telegram handler error:",
      error
    );

    try {
      const chatId =
        req.body?.message?.chat?.id;

      if (chatId) {
        await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
              `⚠️ 処理中にエラーが発生しました。\n\n` +
              `${error?.message || error}`,
          }
        );
      }

    } catch (telegramError) {
      console.error(
        "telegram error message failed:",
        telegramError
      );
    }
  }

  res
    .status(200)
    .send("OK");
}
