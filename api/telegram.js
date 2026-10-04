// api/telegram.js

import crypto from "crypto";

/* =========================================================
   Environment
========================================================= */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

/*
  GitHub Raw image
*/
const PHOTO_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";


/* =========================================================
   Constants
========================================================= */

const MONTHLY_TARGET = 500000;

// Telegram message limit is 4096.
// Keep a little margin for safety.
const TELEGRAM_TEXT_LIMIT = 3500;

// Telegram photo caption limit is 1024.
// Keep a larger safety margin.
const TELEGRAM_CAPTION_LIMIT = 900;


/* =========================================================
   Redis
========================================================= */

async function redisCommand(command, ...args) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    throw new Error("Redis environment variables are not configured.");
  }

  const response = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command, ...args]),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      `Redis API error: ${response.status} ${JSON.stringify(data)}`
    );
  }

  return data.result;
}


/* =========================================================
   Telegram
========================================================= */

async function telegramRequest(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram API error: ${response.status} ${JSON.stringify(data)}`
    );
  }

  return data.result;
}


/* =========================================================
   Telegram text sender
========================================================= */

async function sendTelegramMessage(chatId, text) {
  if (!text) return;

  const chunks = [];

  for (let i = 0; i < text.length; i += TELEGRAM_TEXT_LIMIT) {
    chunks.push(text.slice(i, i + TELEGRAM_TEXT_LIMIT));
  }

  for (const chunk of chunks) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: chunk,
    });
  }
}


/* =========================================================
   Telegram photo sender
   Long caption automatically becomes text message.
========================================================= */

async function sendTelegramPhoto(chatId, caption) {
  /*
    IMPORTANT:
    Telegram photo captions have a much smaller limit than
    normal messages.

    Therefore:
    - short caption -> send photo
    - long caption -> send photo with short caption,
      then send full report as normal text
  */

  if (!caption) {
    return telegramRequest("sendPhoto", {
      chat_id: chatId,
      photo: PHOTO_URL,
    });
  }

  if (caption.length <= TELEGRAM_CAPTION_LIMIT) {
    return telegramRequest("sendPhoto", {
      chat_id: chatId,
      photo: PHOTO_URL,
      caption,
    });
  }

  // Long report:
  await telegramRequest("sendPhoto", {
    chat_id: chatId,
    photo: PHOTO_URL,
    caption: "📊 売上レポート",
  });

  await sendTelegramMessage(chatId, caption);
}


/* =========================================================
   Tokyo date
========================================================= */

function getTokyoDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const value = formatter.format(date);

  const [year, month, day] = value.split("-").map(Number);

  return {
    year,
    month,
    day,
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    monthKey: `${year}-${String(month).padStart(2, "0")}`,
    yearKey: String(year),
  };
}


/* =========================================================
   Number helpers
========================================================= */

function toNumber(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return n;
}

function yen(value) {
  return `¥${Math.round(toNumber(value)).toLocaleString("ja-JP")}`;
}

function integer(value) {
  return Math.round(toNumber(value)).toLocaleString("ja-JP");
}

function percentage(value) {
  return `${toNumber(value).toFixed(1)}%`;
}


/* =========================================================
   Redis keys
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

function recordIndexKey(chatId) {
  return `moheji:delivery:records:${chatId}`;
}

function recordKey(chatId, recordId) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}

function cancelLockKey(chatId) {
  return `moheji:delivery:cancel-lock:${chatId}`;
}

function processedUpdateKey(updateId) {
  return `moheji:delivery:processed:${updateId}`;
}

function legacyMigrationFlagKey() {
  return "moheji:delivery:legacy-cancel-2026-10-04";
}

function legacyMigrationLockKey() {
  return "moheji:delivery:legacy-cancel-2026-10-04:lock";
}


/* =========================================================
   UUID
========================================================= */

function createRecordId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}


/* =========================================================
   Redis data readers
========================================================= */

async function getHash(key) {
  const result = await redisCommand("HGETALL", key);

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

  return result;
}


async function getDaily(dateKey) {
  const data = await getHash(dailyKey(dateKey));

  return {
    sales: toNumber(data.sales),
    orders: toNumber(data.orders),
  };
}


async function getMonthly(monthKey) {
  const data = await getHash(monthlyKey(monthKey));

  return {
    sales: toNumber(data.sales),
    orders: toNumber(data.orders),
  };
}


async function getYearly(yearKey) {
  const data = await getHash(yearlyKey(yearKey));

  return {
    sales: toNumber(data.sales),
    orders: toNumber(data.orders),
  };
}


async function getAllTime() {
  const data = await getHash(allTimeKey());

  return {
    sales: toNumber(data.sales),
    orders: toNumber(data.orders),
  };
}


/* =========================================================
   Working days
========================================================= */

async function updateWorkingDay(monthKey, dateKey) {
  const key = workingDaysKey(monthKey);

  await redisCommand(
    "SADD",
    key,
    dateKey
  );
}


async function removeWorkingDayIfEmpty(monthKey, dateKey) {
  const daily = await getDaily(dateKey);

  if (daily.sales === 0 && daily.orders === 0) {
    await redisCommand(
      "SREM",
      workingDaysKey(monthKey),
      dateKey
    );
  }
}


async function getWorkingDays(monthKey) {
  const result = await redisCommand(
    "SMEMBERS",
    workingDaysKey(monthKey)
  );

  if (!Array.isArray(result)) {
    return [];
  }

  return result;
}


/* =========================================================
   Monthly best
========================================================= */

async function getMonthlyBest(monthKey) {
  const dates = await getWorkingDays(monthKey);

  if (!dates.length) {
    return {
      sales: 0,
      orders: 0,
      salesDate: null,
      ordersDate: null,
    };
  }

  let bestSales = 0;
  let bestOrders = 0;
  let bestSalesDate = null;
  let bestOrdersDate = null;

  /*
    Parallel read.
    This is much faster than waiting for each day one by one.
  */
  const dailyResults = await Promise.all(
    dates.map(async (dateKey) => {
      const daily = await getDaily(dateKey);

      return {
        dateKey,
        ...daily,
      };
    })
  );

  for (const item of dailyResults) {
    if (item.sales > bestSales) {
      bestSales = item.sales;
      bestSalesDate = item.dateKey;
    }

    if (item.orders > bestOrders) {
      bestOrders = item.orders;
      bestOrdersDate = item.dateKey;
    }
  }

  return {
    sales: bestSales,
    orders: bestOrders,
    salesDate: bestSalesDate,
    ordersDate: bestOrdersDate,
  };
}


/* =========================================================
   Records
========================================================= */

async function saveRecord(chatId, record) {
  await redisCommand(
    "HSET",
    recordKey(chatId, record.id),
    "id",
    record.id,
    "chatId",
    String(chatId),
    "dateKey",
    record.dateKey,
    "monthKey",
    record.monthKey,
    "yearKey",
    record.yearKey,
    "sales",
    String(record.sales),
    "orders",
    String(record.orders),
    "createdAt",
    record.createdAt,
    "status",
    "active"
  );

  await redisCommand(
    "LPUSH",
    recordIndexKey(chatId),
    record.id
  );
}


async function getRecord(chatId, recordId) {
  return getHash(recordKey(chatId, recordId));
}


async function getLatestActiveRecord(chatId) {
  const ids = await redisCommand(
    "LRANGE",
    recordIndexKey(chatId),
    0,
    100
  );

  if (!Array.isArray(ids) || !ids.length) {
    return null;
  }

  for (const id of ids) {
    const record = await getRecord(chatId, id);

    if (
      record &&
      record.status === "active"
    ) {
      return {
        id,
        ...record,
      };
    }
  }

  return null;
}


async function markRecordCancelled(chatId, recordId) {
  await redisCommand(
    "HSET",
    recordKey(chatId, recordId),
    "status",
    "cancelled",
    "cancelledAt",
    new Date().toISOString()
  );
}


/* =========================================================
   Formatting
========================================================= */

function formatDateJapanese(dateKey) {
  if (!dateKey) {
    return "-";
  }

  const [year, month, day] = dateKey
    .split("-")
    .map(Number);

  return `${year}/${month}/${day}`;
}


function formatMonthJapanese(monthKey) {
  const [year, month] = monthKey
    .split("-")
    .map(Number);

  return `${year}年${month}月`;
}


/* =========================================================
   Sales process
========================================================= */

async function processSales(chatId, sales, orders) {
  const now = new Date();

  const {
    dateKey,
    monthKey,
    yearKey,
  } = getTokyoDateParts(now);

  const amount = Math.floor(toNumber(sales));
  const orderCount = Math.floor(toNumber(orders));

  if (amount <= 0) {
    throw new Error("売上金額は1円以上で入力してください。");
  }

  if (orderCount <= 0) {
    throw new Error("件数は1件以上で入力してください。");
  }

  /*
    Save transaction record first.
  */
  const record = {
    id: createRecordId(),
    chatId,
    dateKey,
    monthKey,
    yearKey,
    sales: amount,
    orders: orderCount,
    createdAt: now.toISOString(),
  };

  await saveRecord(chatId, record);

  /*
    Daily
  */
  await redisCommand(
    "HINCRBY",
    dailyKey(dateKey),
    "sales",
    amount
  );

  await redisCommand(
    "HINCRBY",
    dailyKey(dateKey),
    "orders",
    orderCount
  );


  /*
    Monthly
  */
  await redisCommand(
    "HINCRBY",
    monthlyKey(monthKey),
    "sales",
    amount
  );

  await redisCommand(
    "HINCRBY",
    monthlyKey(monthKey),
    "orders",
    orderCount
  );


  /*
    Yearly
  */
  await redisCommand(
    "HINCRBY",
    yearlyKey(yearKey),
    "sales",
    amount
  );

  await redisCommand(
    "HINCRBY",
    yearlyKey(yearKey),
    "orders",
    orderCount
  );


  /*
    All time
  */
  await redisCommand(
    "HINCRBY",
    allTimeKey(),
    "sales",
    amount
  );

  await redisCommand(
    "HINCRBY",
    allTimeKey(),
    "orders",
    orderCount
  );


  /*
    Working day
  */
  await updateWorkingDay(
    monthKey,
    dateKey
  );


  const daily = await getDaily(dateKey);
  const monthly = await getMonthly(monthKey);

  const average =
    daily.orders > 0
      ? daily.sales / daily.orders
      : 0;

  const monthlyRate =
    MONTHLY_TARGET > 0
      ? (monthly.sales / MONTHLY_TARGET) * 100
      : 0;


  return [
    "✅ 売上を登録しました。",
    "",
    `📅 ${formatDateJapanese(dateKey)}`,
    `💰 売上：${yen(amount)}`,
    `📦 件数：${integer(orderCount)}件`,
    "",
    "【本日の累計】",
    `💰 ${yen(daily.sales)}`,
    `📦 ${integer(daily.orders)}件`,
    `💵 平均単価：${yen(average)}`,
    "",
    "【今月】",
    `💰 ${yen(monthly.sales)}`,
    `📦 ${integer(monthly.orders)}件`,
    `🎯 達成率：${percentage(monthlyRate)}`,
  ].join("\n");
}
/* =========================================================
   Cancel lock
========================================================= */

async function acquireCancelLock(chatId) {
  const key = cancelLockKey(chatId);

  /*
    SET NX EX
    30 seconds lock
  */
  const result = await redisCommand(
    "SET",
    key,
    "1",
    "NX",
    "EX",
    "30"
  );

  return result === "OK";
}


async function releaseCancelLock(chatId) {
  try {
    await redisCommand(
      "DEL",
      cancelLockKey(chatId)
    );
  } catch (error) {
    console.error(
      "Failed to release cancel lock:",
      error
    );
  }
}


/* =========================================================
   Legacy migration
========================================================= */

/*
  Existing old data migration.

  2026-10-04:
  17 orders / ¥17,014

  This is executed only once.
*/

const LEGACY_DATE_KEY = "2026-10-04";
const LEGACY_MONTH_KEY = "2026-10";
const LEGACY_YEAR_KEY = "2026";
const LEGACY_SALES = 17014;
const LEGACY_ORDERS = 17;


async function processLegacyCancel() {
  const flagKey = legacyMigrationFlagKey();

  const alreadyDone = await redisCommand(
    "GET",
    flagKey
  );

  if (alreadyDone) {
    return false;
  }

  /*
    Global migration lock.
  */
  const lockResult = await redisCommand(
    "SET",
    legacyMigrationLockKey(),
    "1",
    "NX",
    "EX",
    "60"
  );

  if (lockResult !== "OK") {
    return false;
  }

  try {
    const secondCheck = await redisCommand(
      "GET",
      flagKey
    );

    if (secondCheck) {
      return false;
    }

    const daily = await getDaily(
      LEGACY_DATE_KEY
    );

    const monthly = await getMonthly(
      LEGACY_MONTH_KEY
    );

    const yearly = await getYearly(
      LEGACY_YEAR_KEY
    );

    const allTime = await getAllTime();

    /*
      Protect against negative aggregates.
    */
    if (
      daily.sales < LEGACY_SALES ||
      daily.orders < LEGACY_ORDERS ||
      monthly.sales < LEGACY_SALES ||
      monthly.orders < LEGACY_ORDERS ||
      yearly.sales < LEGACY_SALES ||
      yearly.orders < LEGACY_ORDERS ||
      allTime.sales < LEGACY_SALES ||
      allTime.orders < LEGACY_ORDERS
    ) {
      throw new Error(
        "Legacy cancellation aborted: aggregate values are smaller than the legacy amount."
      );
    }


    await redisCommand(
      "HINCRBY",
      dailyKey(LEGACY_DATE_KEY),
      "sales",
      -LEGACY_SALES
    );

    await redisCommand(
      "HINCRBY",
      dailyKey(LEGACY_DATE_KEY),
      "orders",
      -LEGACY_ORDERS
    );


    await redisCommand(
      "HINCRBY",
      monthlyKey(LEGACY_MONTH_KEY),
      "sales",
      -LEGACY_SALES
    );

    await redisCommand(
      "HINCRBY",
      monthlyKey(LEGACY_MONTH_KEY),
      "orders",
      -LEGACY_ORDERS
    );


    await redisCommand(
      "HINCRBY",
      yearlyKey(LEGACY_YEAR_KEY),
      "sales",
      -LEGACY_SALES
    );

    await redisCommand(
      "HINCRBY",
      yearlyKey(LEGACY_YEAR_KEY),
      "orders",
      -LEGACY_ORDERS
    );


    await redisCommand(
      "HINCRBY",
      allTimeKey(),
      "sales",
      -LEGACY_SALES
    );

    await redisCommand(
      "HINCRBY",
      allTimeKey(),
      "orders",
      -LEGACY_ORDERS
    );


    await removeWorkingDayIfEmpty(
      LEGACY_MONTH_KEY,
      LEGACY_DATE_KEY
    );


    await redisCommand(
      "SET",
      flagKey,
      new Date().toISOString()
    );

    return true;

  } finally {
    try {
      await redisCommand(
        "DEL",
        legacyMigrationLockKey()
      );
    } catch (error) {
      console.error(
        "Legacy migration lock release failed:",
        error
      );
    }
  }
}


/* =========================================================
   Cancel process
========================================================= */

async function processCancel(chatId) {
  const locked = await acquireCancelLock(chatId);

  if (!locked) {
    throw new Error(
      "現在、別の取消処理を実行中です。少し待ってからもう一度お試しください。"
    );
  }

  try {
    /*
      First try the existing transaction record.
    */
    const record = await getLatestActiveRecord(chatId);

    if (!record) {
      /*
        Legacy migration support.
      */
      const migrated = await processLegacyCancel();

      if (migrated) {
        return [
          "↩️ 取消処理を実行しました。",
          "",
          `📅 ${formatDateJapanese(LEGACY_DATE_KEY)}`,
          `💰 -${yen(LEGACY_SALES)}`,
          `📦 -${integer(LEGACY_ORDERS)}件`,
          "",
          "※ 旧データの1回限りの移行処理です。",
        ].join("\n");
      }

      throw new Error(
        "取消できる売上記録がありません。"
      );
    }


    const sales = Math.floor(
      toNumber(record.sales)
    );

    const orders = Math.floor(
      toNumber(record.orders)
    );

    const dateKey = record.dateKey;
    const monthKey = record.monthKey;
    const yearKey = record.yearKey;


    /*
      Get aggregates before modifying.
      This prevents accidental negative values.
    */
    const daily = await getDaily(dateKey);
    const monthly = await getMonthly(monthKey);
    const yearly = await getYearly(yearKey);
    const allTime = await getAllTime();


    if (
      daily.sales < sales ||
      daily.orders < orders
    ) {
      throw new Error(
        "日別集計と取消対象データが一致しないため、安全のため取消を停止しました。"
      );
    }

    if (
      monthly.sales < sales ||
      monthly.orders < orders
    ) {
      throw new Error(
        "月別集計と取消対象データが一致しないため、安全のため取消を停止しました。"
      );
    }

    if (
      yearly.sales < sales ||
      yearly.orders < orders
    ) {
      throw new Error(
        "年別集計と取消対象データが一致しないため、安全のため取消を停止しました。"
      );
    }

    if (
      allTime.sales < sales ||
      allTime.orders < orders
    ) {
      throw new Error(
        "累計集計と取消対象データが一致しないため、安全のため取消を停止しました。"
      );
    }


    /*
      Daily
    */
    await redisCommand(
      "HINCRBY",
      dailyKey(dateKey),
      "sales",
      -sales
    );

    await redisCommand(
      "HINCRBY",
      dailyKey(dateKey),
      "orders",
      -orders
    );


    /*
      Monthly
    */
    await redisCommand(
      "HINCRBY",
      monthlyKey(monthKey),
      "sales",
      -sales
    );

    await redisCommand(
      "HINCRBY",
      monthlyKey(monthKey),
      "orders",
      -orders
    );


    /*
      Yearly
    */
    await redisCommand(
      "HINCRBY",
      yearlyKey(yearKey),
      "sales",
      -sales
    );

    await redisCommand(
      "HINCRBY",
      yearlyKey(yearKey),
      "orders",
      -orders
    );


    /*
      All time
    */
    await redisCommand(
      "HINCRBY",
      allTimeKey(),
      "sales",
      -sales
    );

    await redisCommand(
      "HINCRBY",
      allTimeKey(),
      "orders",
      -orders
    );


    /*
      Working day
    */
    await removeWorkingDayIfEmpty(
      monthKey,
      dateKey
    );


    /*
      Mark transaction cancelled
      only after aggregate changes succeed.
    */
    await markRecordCancelled(
      chatId,
      record.id
    );


    return [
      "↩️ 売上を取り消しました。",
      "",
      `📅 ${formatDateJapanese(dateKey)}`,
      `💰 -${yen(sales)}`,
      `📦 -${integer(orders)}件`,
      "",
      "取消対象の登録を無効化しました。",
    ].join("\n");

  } finally {
    await releaseCancelLock(chatId);
  }
}


/* =========================================================
   Progress circle
========================================================= */

function progressCircle(rate) {
  const normalized = Math.max(
    0,
    Math.min(100, toNumber(rate))
  );

  const filled = Math.round(
    normalized / 10
  );

  const empty = 10 - filled;

  return (
    "🟢".repeat(filled) +
    "⚪".repeat(empty)
  );
}


/* =========================================================
   Report
========================================================= */

async function buildReport() {
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
  ] = await Promise.all([
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

  const monthlyAverage =
    workingDays.length > 0
      ? monthly.sales / workingDays.length
      : 0;

  const monthlyOrderAverage =
    workingDays.length > 0
      ? monthly.orders / workingDays.length
      : 0;

  const averageOrderValue =
    monthly.orders > 0
      ? monthly.sales / monthly.orders
      : 0;

  const achievementRate =
    MONTHLY_TARGET > 0
      ? (monthly.sales / MONTHLY_TARGET) * 100
      : 0;

  const remaining = Math.max(
    0,
    MONTHLY_TARGET - monthly.sales
  );


  return [
    "📊 売上レポート",
    "",
    `📅 ${formatDateJapanese(dateKey)}`,
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
    `📈 1日平均売上：${yen(monthlyAverage)}`,
    `📦 1日平均件数：${monthlyOrderAverage.toFixed(1)}件`,
    `💵 平均単価：${yen(averageOrderValue)}`,
    "",
    `🎯 月間目標：${yen(MONTHLY_TARGET)}`,
    `📊 達成率：${percentage(achievementRate)}`,
    progressCircle(achievementRate),
    `🔥 残り：${yen(remaining)}`,
    "",
    "【今月最高】",
    `🏆 最高売上：${yen(best.sales)}`,
    best.salesDate
      ? `　${formatDateJapanese(best.salesDate)}`
      : "",
    `🏆 最高件数：${integer(best.orders)}件`,
    best.ordersDate
      ? `　${formatDateJapanese(best.ordersDate)}`
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
   /record
========================================================= */

async function processRecord() {
  const {
    year,
    month,
  } = getTokyoDateParts();


  const reports = [];


  /*
    Past 24 months
  */
  for (let offset = 0; offset < 24; offset++) {
    let y = year;
    let m = month - offset;

    while (m <= 0) {
      y--;
      m += 12;
    }

    const monthKey =
      `${y}-${String(m).padStart(2, "0")}`;


    const [
      monthly,
      workingDays,
      best,
    ] = await Promise.all([
      getMonthly(monthKey),
      getWorkingDays(monthKey),
      getMonthlyBest(monthKey),
    ]);


    const dailyAverage =
      workingDays.length > 0
        ? monthly.sales / workingDays.length
        : 0;


    reports.push(
      [
        `【${formatMonthJapanese(monthKey)}】`,
        `💰 売上：${yen(monthly.sales)}`,
        `📦 件数：${integer(monthly.orders)}件`,
        `🗓 稼働日：${integer(workingDays.length)}日`,
        `📈 1日平均：${yen(dailyAverage)}`,
        `🏆 最高売上：${yen(best.sales)}`,
        `🏆 最高件数：${integer(best.orders)}件`,
      ].join("\n")
    );
  }


  return [
    "📚 過去24か月 売上記録",
    "",
    ...reports,
  ].join("\n\n");
}


/* =========================================================
   Telegram update deduplication
========================================================= */

async function isUpdateProcessed(updateId) {
  if (
    updateId === undefined ||
    updateId === null
  ) {
    return false;
  }

  const result = await redisCommand(
    "GET",
    processedUpdateKey(updateId)
  );

  return Boolean(result);
}


async function markUpdateProcessed(updateId) {
  if (
    updateId === undefined ||
    updateId === null
  ) {
    return;
  }

  /*
    Keep update ID for 24 hours.
  */
  await redisCommand(
    "SET",
    processedUpdateKey(updateId),
    "1",
    "EX",
    "86400"
  );
}


/* =========================================================
   Command parsing
========================================================= */

function normalizeText(text) {
  return String(text || "")
    .trim();
}


function isSalesCommand(text) {
  return /^\/sales(?:@\w+)?\b/i.test(text);
}


function isCancelCommand(text) {
  return /^\/cancel(?:@\w+)?\b/i.test(text);
}


function isRecordCommand(text) {
  return /^\/record(?:@\w+)?\b/i.test(text);
}


function isHelpCommand(text) {
  return /^\/help(?:@\w+)?\b/i.test(text)
    || /^\/start(?:@\w+)?\b/i.test(text);
}


/* =========================================================
   /sales parser
========================================================= */

function parseSalesCommand(text) {
  const cleaned = text
    .replace(/^\/sales(?:@\w+)?/i, "")
    .trim();

  if (!cleaned) {
    return null;
  }


  /*
    Accept:
      /sales 10000 5
      /sales 10000 5件
  */
  const numbers = cleaned.match(
    /-?\d+(?:\.\d+)?/g
  );

  if (!numbers || numbers.length < 2) {
    return null;
  }


  const sales = Number(numbers[0]);
  const orders = Number(numbers[1]);


  if (
    !Number.isFinite(sales) ||
    !Number.isFinite(orders)
  ) {
    return null;
  }


  return {
    sales,
    orders,
  };
}


/* =========================================================
   Help
========================================================= */

function buildHelp() {
  return [
    "🤖 売上管理Bot",
    "",
    "【使い方】",
    "",
    "💰 売上登録",
    "/sales 売上 件数",
    "",
    "例：",
    "/sales 10000 5",
    "",
    "↩️ 最新の売上を取消",
    "/cancel",
    "",
    "📚 過去24か月を見る",
    "/record",
    "",
    "📊 現在の売上状況",
    "/report",
    "",
    "❓ ヘルプ",
    "/help",
  ].join("\n");
}
/* =========================================================
   Main handler
========================================================= */

export default async function handler(req, res) {
  /*
    Telegram webhook accepts POST only.
  */
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Telegram webhook is running.",
    });
  }


  let body = null;


  try {
    body = req.body;


    /*
      Ignore invalid Telegram updates.
    */
    if (!body) {
      return res.status(200).json({
        ok: true,
      });
    }


    const updateId = body.update_id;


    /*
      Ignore duplicate Telegram updates.
    */
    if (await isUpdateProcessed(updateId)) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
      });
    }


    /*
      Only process normal messages.
    */
    const message = body.message;


    if (!message) {
      await markUpdateProcessed(updateId);

      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }


    const chatId = message.chat?.id;


    if (!chatId) {
      await markUpdateProcessed(updateId);

      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }


    const text = normalizeText(
      message.text
    );


    if (!text) {
      await markUpdateProcessed(updateId);

      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }


    /* =====================================================
       /start /help
    ===================================================== */

    if (isHelpCommand(text)) {
      await sendTelegramPhoto(
        chatId,
        buildHelp()
      );

      await markUpdateProcessed(updateId);

      return res.status(200).json({
        ok: true,
        command: "help",
      });
    }


    /* =====================================================
       /sales
    ===================================================== */

    if (isSalesCommand(text)) {
      const parsed =
        parseSalesCommand(text);


      if (!parsed) {
        await sendTelegramMessage(
          chatId,
          [
            "❌ 入力形式が正しくありません。",
            "",
            "例：",
            "/sales 10000 5",
          ].join("\n")
        );

        await markUpdateProcessed(updateId);

        return res.status(200).json({
          ok: true,
          command: "sales",
          valid: false,
        });
      }


      const result =
        await processSales(
          chatId,
          parsed.sales,
          parsed.orders
        );


      await sendTelegramPhoto(
        chatId,
        result
      );


      /*
        IMPORTANT:
        Only mark update as processed after
        successful business processing.
      */
      await markUpdateProcessed(updateId);


      return res.status(200).json({
        ok: true,
        command: "sales",
      });
    }


    /* =====================================================
       /cancel
    ===================================================== */

    if (isCancelCommand(text)) {
      const result =
        await processCancel(chatId);


      await sendTelegramPhoto(
        chatId,
        result
      );


      await markUpdateProcessed(updateId);


      return res.status(200).json({
        ok: true,
        command: "cancel",
      });
    }


    /* =====================================================
       /record
    ===================================================== */

    if (isRecordCommand(text)) {
      const report =
        await processRecord();


      /*
        sendTelegramPhoto automatically checks
        Telegram's caption limit.

        If report is short:
          image + caption

        If report is long:
          image with short caption
          +
          full report as normal messages
      */
      await sendTelegramPhoto(
        chatId,
        report
      );


      await markUpdateProcessed(updateId);


      return res.status(200).json({
        ok: true,
        command: "record",
      });
    }


    /* =====================================================
       /report
    ===================================================== */

    if (
      /^\/report(?:@\w+)?\b/i.test(text)
    ) {
      const report =
        await buildReport();


      await sendTelegramPhoto(
        chatId,
        report
      );


      await markUpdateProcessed(updateId);


      return res.status(200).json({
        ok: true,
        command: "report",
      });
    }


    /* =====================================================
       Unknown command
    ===================================================== */

    if (text.startsWith("/")) {
      await sendTelegramMessage(
        chatId,
        [
          "❓ コマンドが分かりません。",
          "",
          buildHelp(),
        ].join("\n")
      );


      await markUpdateProcessed(updateId);


      return res.status(200).json({
        ok: true,
        command: "unknown",
      });
    }


    /*
      Normal text:
      Ignore it.
    */
    await markUpdateProcessed(updateId);


    return res.status(200).json({
      ok: true,
      ignored: true,
    });


  } catch (error) {
    console.error(
      "Telegram webhook error:",
      error
    );


    /*
      If Telegram sent a normal message and
      we have a chat ID, tell the user.
    */
    try {
      const chatId =
        body?.message?.chat?.id;


      if (chatId) {
        await sendTelegramMessage(
          chatId,
          [
            "⚠️ 処理中にエラーが発生しました。",
            "",
            error?.message ||
              "Unknown error",
          ].join("\n")
        );
      }

    } catch (notifyError) {
      console.error(
        "Failed to notify Telegram:",
        notifyError
      );
    }


    /*
      Return 200 to Telegram after handling the
      error notification, so the webhook does not
      repeatedly hammer the endpoint.
    */
    return res.status(200).json({
      ok: false,
      error: error?.message ||
        "Unknown error",
    });
  }
}
