// api/telegram.js

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

// GitHub等の画像URLではなく、Telegramから直接参照できる画像URLを使用
const PHOTO_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

// ============================================================
// Redis REST API
// ============================================================

async function redisCommand(command) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    throw new Error("Redis environment variables are missing.");
  }

  const response = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Redis request failed: ${response.status} ${text}`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Redis error: ${data.error}`);
  }

  return data;
}

// ============================================================
// Telegram API
// ============================================================

async function telegramRequest(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
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

  return data;
}

async function sendTelegramMessage(chatId, text) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
  });
}

async function sendTelegramPhoto(chatId, caption) {
  if (!PHOTO_URL) {
    return sendTelegramMessage(chatId, caption);
  }

  return telegramRequest("sendPhoto", {
    chat_id: chatId,
    photo: PHOTO_URL,
    caption,
  });
}

// ============================================================
// 東京時間
// ============================================================

function getTokyoDateInfo(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);

  const dateKey =
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const monthKey =
    `${year}-${String(month).padStart(2, "0")}`;

  const yearKey = String(year);

  return {
    year,
    month,
    day,
    dateKey,
    monthKey,
    yearKey,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

// ============================================================
// 数値処理
// ============================================================

function safeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function normalizeInteger(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.floor(number);
}

// ============================================================
// Redis Key
// ============================================================

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

function chatRecordsKey(chatId) {
  return `moheji:delivery:records:${chatId}`;
}

function recordKey(chatId, recordId) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}

function cancelLockKey(chatId) {
  return `moheji:delivery:cancel-lock:${chatId}`;
}

// ============================================================
// Record ID
// ============================================================

function createRecordId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return [
    Date.now(),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join("-");
}

// ============================================================
// 日次取得
// ============================================================

async function getDaily(dateKey) {
  const result = await redisCommand([
    "HGETALL",
    dailyKey(dateKey),
  ]);

  const data = result.result || {};

  return {
    sales: safeNumber(data.sales),
    orders: safeNumber(data.orders),
  };
}

// ============================================================
// 月次取得
// ============================================================

async function getMonthly(monthKey) {
  const result = await redisCommand([
    "HGETALL",
    monthlyKey(monthKey),
  ]);

  const data = result.result || {};

  return {
    sales: safeNumber(data.sales),
    orders: safeNumber(data.orders),
  };
}

// ============================================================
// 年次取得
// ============================================================

async function getYearly(yearKey) {
  const result = await redisCommand([
    "HGETALL",
    yearlyKey(yearKey),
  ]);

  const data = result.result || {};

  return {
    sales: safeNumber(data.sales),
    orders: safeNumber(data.orders),
  };
}

// ============================================================
// 累計取得
// ============================================================

async function getAllTime() {
  const result = await redisCommand([
    "HGETALL",
    allTimeKey(),
  ]);

  const data = result.result || {};

  return {
    sales: safeNumber(data.sales),
    orders: safeNumber(data.orders),
  };
}

// ============================================================
// 稼働日更新
// ============================================================

async function updateWorkingDay(dateKey, monthKey) {
  const daily = await getDaily(dateKey);

  const key = workingDaysKey(monthKey);

  if (daily.sales > 0 || daily.orders > 0) {
    await redisCommand([
      "SADD",
      key,
      dateKey,
    ]);
  } else {
    await redisCommand([
      "SREM",
      key,
      dateKey,
    ]);
  }
}

// ============================================================
// 稼働日数
// ============================================================

async function getWorkingDayCount(monthKey) {
  const result = await redisCommand([
    "SCARD",
    workingDaysKey(monthKey),
  ]);

  return safeNumber(result.result);
}

// ============================================================
// 月間最高記録
// ============================================================

async function getMonthlyBest(monthKey) {
  const result = await redisCommand([
    "SMEMBERS",
    workingDaysKey(monthKey),
  ]);

  const dates = result.result || [];

  let bestSales = 0;
  let bestOrders = 0;

  for (const dateKey of dates) {
    const daily = await getDaily(dateKey);

    if (daily.sales > bestSales) {
      bestSales = daily.sales;
    }

    if (daily.orders > bestOrders) {
      bestOrders = daily.orders;
    }
  }

  return {
    sales: bestSales,
    orders: bestOrders,
  };
}

// ============================================================
// レコード保存
// ============================================================

async function saveRecord({
  chatId,
  recordId,
  dateKey,
  monthKey,
  yearKey,
  sales,
  orders,
}) {
  const key = recordKey(chatId, recordId);

  await redisCommand([
    "HSET",
    key,
    "recordId",
    recordId,
    "chatId",
    String(chatId),
    "dateKey",
    dateKey,
    "monthKey",
    monthKey,
    "yearKey",
    yearKey,
    "sales",
    String(sales),
    "orders",
    String(orders),
    "status",
    "active",
    "createdAt",
    new Date().toISOString(),
  ]);

  await redisCommand([
    "ZADD",
    chatRecordsKey(chatId),
    Date.now(),
    recordId,
  ]);
}

// ============================================================
// レコード取得
// ============================================================

async function getRecord(chatId, recordId) {
  const result = await redisCommand([
    "HGETALL",
    recordKey(chatId, recordId),
  ]);

  const data = result.result || {};

  if (!data.recordId) {
    return null;
  }

  return data;
}

// ============================================================
// 最新有効レコード
// ============================================================

async function getLatestActiveRecord(chatId) {
  const result = await redisCommand([
    "ZREVRANGE",
    chatRecordsKey(chatId),
    "0",
    "-1",
  ]);

  const recordIds = result.result || [];

  for (const recordId of recordIds) {
    const record = await getRecord(chatId, recordId);

    if (record && record.status === "active") {
      return record;
    }
  }

  return null;
}

// ============================================================
// レコード取消済み
// ============================================================

async function markRecordCancelled(chatId, recordId) {
  await redisCommand([
    "HSET",
    recordKey(chatId, recordId),
    "status",
    "cancelled",
    "cancelledAt",
    new Date().toISOString(),
  ]);
}

// ============================================================
// Part 1 END
// ============================================================
// ============================================================
// 売上登録
// ============================================================

async function processSales({
  chatId,
  sales,
  orders,
}) {
  const dateInfo = getTokyoDateInfo();

  const {
    dateKey,
    monthKey,
    yearKey,
  } = dateInfo;

  const recordId = createRecordId();

  // ----------------------------------------------------------
  // レコード保存
  // ----------------------------------------------------------

  await saveRecord({
    chatId,
    recordId,
    dateKey,
    monthKey,
    yearKey,
    sales,
    orders,
  });

  // ----------------------------------------------------------
  // 日次
  // ----------------------------------------------------------

  await redisCommand([
    "HINCRBY",
    dailyKey(dateKey),
    "sales",
    sales,
  ]);

  await redisCommand([
    "HINCRBY",
    dailyKey(dateKey),
    "orders",
    orders,
  ]);

  // ----------------------------------------------------------
  // 月次
  // ----------------------------------------------------------

  await redisCommand([
    "HINCRBY",
    monthlyKey(monthKey),
    "sales",
    sales,
  ]);

  await redisCommand([
    "HINCRBY",
    monthlyKey(monthKey),
    "orders",
    orders,
  ]);

  // ----------------------------------------------------------
  // 年次
  // ----------------------------------------------------------

  await redisCommand([
    "HINCRBY",
    yearlyKey(yearKey),
    "sales",
    sales,
  ]);

  await redisCommand([
    "HINCRBY",
    yearlyKey(yearKey),
    "orders",
    orders,
  ]);

  // ----------------------------------------------------------
  // 累計
  // ----------------------------------------------------------

  await redisCommand([
    "HINCRBY",
    allTimeKey(),
    "sales",
    sales,
  ]);

  await redisCommand([
    "HINCRBY",
    allTimeKey(),
    "orders",
    orders,
  ]);

  // ----------------------------------------------------------
  // 稼働日
  // ----------------------------------------------------------

  await updateWorkingDay(
    dateKey,
    monthKey
  );

  return {
    recordId,
    dateKey,
    monthKey,
    yearKey,
    sales,
    orders,
  };
}

// ============================================================
// 取消ロック
// ============================================================

async function acquireCancelLock(chatId) {
  const result = await redisCommand([
    "SET",
    cancelLockKey(chatId),
    String(Date.now()),
    "NX",
    "EX",
    "60",
  ]);

  return result.result === "OK";
}

async function releaseCancelLock(chatId) {
  await redisCommand([
    "DEL",
    cancelLockKey(chatId),
  ]);
}

// ============================================================
// 旧データ移行設定
// ============================================================

// 2026-10-04に旧システムで登録されていたデータ
const LEGACY_DATE = "2026-10-04";
const LEGACY_SALES = 17014;
const LEGACY_ORDERS = 17;

const LEGACY_MIGRATION_FLAG =
  `moheji:delivery:legacy-migration:${LEGACY_DATE}`;

const LEGACY_MIGRATION_LOCK =
  `moheji:delivery:legacy-migration-lock:${LEGACY_DATE}`;

// ============================================================
// 旧データ取消
// ============================================================

async function processLegacyCancel(chatId) {
  // ----------------------------------------------------------
  // すでに移行済みなら何もしない
  // ----------------------------------------------------------

  const flagResult = await redisCommand([
    "EXISTS",
    LEGACY_MIGRATION_FLAG,
  ]);

  if (safeNumber(flagResult.result) === 1) {
    return {
      success: false,
      reason: "already_migrated",
    };
  }

  // ----------------------------------------------------------
  // 二重取消防止ロック
  // ----------------------------------------------------------

  const lockResult = await redisCommand([
    "SET",
    LEGACY_MIGRATION_LOCK,
    String(chatId),
    "NX",
    "EX",
    "60",
  ]);

  if (lockResult.result !== "OK") {
    return {
      success: false,
      reason: "locked",
    };
  }

  try {
    // --------------------------------------------------------
    // ロック取得後に再確認
    // --------------------------------------------------------

    const flagCheck = await redisCommand([
      "EXISTS",
      LEGACY_MIGRATION_FLAG,
    ]);

    if (safeNumber(flagCheck.result) === 1) {
      return {
        success: false,
        reason: "already_migrated",
      };
    }

    // --------------------------------------------------------
    // 旧データが本当に存在するか確認
    // --------------------------------------------------------

    const daily = await getDaily(LEGACY_DATE);

    if (
      daily.sales < LEGACY_SALES ||
      daily.orders < LEGACY_ORDERS
    ) {
      return {
        success: false,
        reason: "legacy_data_not_found",
      };
    }

    const legacyMonthKey = LEGACY_DATE.slice(0, 7);
    const legacyYearKey = LEGACY_DATE.slice(0, 4);

    const monthly = await getMonthly(
      legacyMonthKey
    );

    const yearly = await getYearly(
      legacyYearKey
    );

    const allTime = await getAllTime();

    if (
      monthly.sales < LEGACY_SALES ||
      monthly.orders < LEGACY_ORDERS ||
      yearly.sales < LEGACY_SALES ||
      yearly.orders < LEGACY_ORDERS ||
      allTime.sales < LEGACY_SALES ||
      allTime.orders < LEGACY_ORDERS
    ) {
      return {
        success: false,
        reason: "aggregate_data_insufficient",
      };
    }

    // --------------------------------------------------------
    // 日次から減算
    // --------------------------------------------------------

    await redisCommand([
      "HINCRBY",
      dailyKey(LEGACY_DATE),
      "sales",
      -LEGACY_SALES,
    ]);

    await redisCommand([
      "HINCRBY",
      dailyKey(LEGACY_DATE),
      "orders",
      -LEGACY_ORDERS,
    ]);

    // --------------------------------------------------------
    // 月次から減算
    // --------------------------------------------------------

    await redisCommand([
      "HINCRBY",
      monthlyKey(legacyMonthKey),
      "sales",
      -LEGACY_SALES,
    ]);

    await redisCommand([
      "HINCRBY",
      monthlyKey(legacyMonthKey),
      "orders",
      -LEGACY_ORDERS,
    ]);

    // --------------------------------------------------------
    // 年次から減算
    // --------------------------------------------------------

    await redisCommand([
      "HINCRBY",
      yearlyKey(legacyYearKey),
      "sales",
      -LEGACY_SALES,
    ]);

    await redisCommand([
      "HINCRBY",
      yearlyKey(legacyYearKey),
      "orders",
      -LEGACY_ORDERS,
    ]);

    // --------------------------------------------------------
    // 累計から減算
    // --------------------------------------------------------

    await redisCommand([
      "HINCRBY",
      allTimeKey(),
      "sales",
      -LEGACY_SALES,
    ]);

    await redisCommand([
      "HINCRBY",
      allTimeKey(),
      "orders",
      -LEGACY_ORDERS,
    ]);

    // --------------------------------------------------------
    // 稼働日を再計算
    // --------------------------------------------------------

    await updateWorkingDay(
      LEGACY_DATE,
      legacyMonthKey
    );

    // --------------------------------------------------------
    // 移行済みフラグ
    // --------------------------------------------------------

    await redisCommand([
      "SET",
      LEGACY_MIGRATION_FLAG,
      JSON.stringify({
        chatId: String(chatId),
        date: LEGACY_DATE,
        sales: LEGACY_SALES,
        orders: LEGACY_ORDERS,
        cancelledAt: new Date().toISOString(),
      }),
      "EX",
      "31536000",
    ]);

    return {
      success: true,
      sales: LEGACY_SALES,
      orders: LEGACY_ORDERS,
      dateKey: LEGACY_DATE,
      legacy: true,
    };
  } finally {
    await redisCommand([
      "DEL",
      LEGACY_MIGRATION_LOCK,
    ]);
  }
}

// ============================================================
// 通常の取消
// ============================================================

async function processCancel(chatId) {
  const locked = await acquireCancelLock(chatId);

  if (!locked) {
    return {
      success: false,
      reason: "locked",
    };
  }

  try {
    // --------------------------------------------------------
    // 最新の有効レコードを取得
    // --------------------------------------------------------

    let record = await getLatestActiveRecord(chatId);

    // --------------------------------------------------------
    // 通常レコードがない場合
    // 旧17,014円データの取消を試す
    // --------------------------------------------------------

    if (!record) {
      return await processLegacyCancel(chatId);
    }

    // --------------------------------------------------------
    // レコードを再確認
    // --------------------------------------------------------

    record = await getRecord(
      chatId,
      record.recordId
    );

    if (
      !record ||
      record.status !== "active"
    ) {
      return {
        success: false,
        reason: "already_cancelled",
      };
    }

    const sales = normalizeInteger(record.sales);
    const orders = normalizeInteger(record.orders);

    if (
      sales === null ||
      orders === null
    ) {
      throw new Error(
        "Invalid record data."
      );
    }

    const dateKey = record.dateKey;
    const monthKey = record.monthKey;
    const yearKey = record.yearKey;

    // --------------------------------------------------------
    // 現在の集計値を確認
    // --------------------------------------------------------

    const daily = await getDaily(dateKey);
    const monthly = await getMonthly(monthKey);
    const yearly = await getYearly(yearKey);
    const allTime = await getAllTime();

    if (
      daily.sales < sales ||
      daily.orders < orders
    ) {
      throw new Error(
        "Daily aggregate is smaller than cancellation amount."
      );
    }

    if (
      monthly.sales < sales ||
      monthly.orders < orders
    ) {
      throw new Error(
        "Monthly aggregate is smaller than cancellation amount."
      );
    }

    if (
      yearly.sales < sales ||
      yearly.orders < orders
    ) {
      throw new Error(
        "Yearly aggregate is smaller than cancellation amount."
      );
    }

    if (
      allTime.sales < sales ||
      allTime.orders < orders
    ) {
      throw new Error(
        "All-time aggregate is smaller than cancellation amount."
      );
    }

    // --------------------------------------------------------
    // 日次から減算
    // --------------------------------------------------------

    await redisCommand([
      "HINCRBY",
      dailyKey(dateKey),
      "sales",
      -sales,
    ]);

    await redisCommand([
      "HINCRBY",
      dailyKey(dateKey),
      "orders",
      -orders,
    ]);

    // --------------------------------------------------------
    // 月次から減算
    // --------------------------------------------------------

    await redisCommand([
      "HINCRBY",
      monthlyKey(monthKey),
      "sales",
      -sales,
    ]);

    await redisCommand([
      "HINCRBY",
      monthlyKey(monthKey),
      "orders",
      -orders,
    ]);

    // --------------------------------------------------------
    // 年次から減算
    // --------------------------------------------------------

    await redisCommand([
      "HINCRBY",
      yearlyKey(yearKey),
      "sales",
      -sales,
    ]);

    await redisCommand([
      "HINCRBY",
      yearlyKey(yearKey),
      "orders",
      -orders,
    ]);

    // --------------------------------------------------------
    // 累計から減算
    // --------------------------------------------------------

    await redisCommand([
      "HINCRBY",
      allTimeKey(),
      "sales",
      -sales,
    ]);

    await redisCommand([
      "HINCRBY",
      allTimeKey(),
      "orders",
      -orders,
    ]);

    // --------------------------------------------------------
    // 稼働日更新
    // --------------------------------------------------------

    await updateWorkingDay(
      dateKey,
      monthKey
    );

    // --------------------------------------------------------
    // レコードを取消済みにする
    // --------------------------------------------------------

    await markRecordCancelled(
      chatId,
      record.recordId
    );

    return {
      success: true,
      sales,
      orders,
      dateKey,
      monthKey,
      yearKey,
      recordId: record.recordId,
      legacy: false,
    };
  } finally {
    await releaseCancelLock(chatId);
  }
}

// ============================================================
// Part 2 END
// ============================================================
// ============================================================
// レポート用フォーマット
// ============================================================

function formatYen(value) {
  return `¥${Math.floor(safeNumber(value)).toLocaleString("ja-JP")}`;
}

function formatNumber(value) {
  return Math.floor(safeNumber(value)).toLocaleString("ja-JP");
}

function formatPercent(value) {
  return `${safeNumber(value).toFixed(1)}%`;
}

// ============================================================
// 月名
// ============================================================

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");

  return `${year}年${Number(month)}月`;
}

// ============================================================
// 月次レポート
// ============================================================

async function buildReport() {
  const dateInfo = getTokyoDateInfo();

  const {
    dateKey,
    monthKey,
    yearKey,
  } = dateInfo;

  // ----------------------------------------------------------
  // 各集計取得
  // ----------------------------------------------------------

  const [
    today,
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
    getWorkingDayCount(monthKey),
    getMonthlyBest(monthKey),
  ]);

  // ----------------------------------------------------------
  // 月平均
  // ----------------------------------------------------------

  const averageSales =
    workingDays > 0
      ? monthly.sales / workingDays
      : 0;

  const averageOrders =
    workingDays > 0
      ? monthly.orders / workingDays
      : 0;

  // ----------------------------------------------------------
  // 客単価
  // ----------------------------------------------------------

  const averageOrderValue =
    monthly.orders > 0
      ? monthly.sales / monthly.orders
      : 0;

  // ----------------------------------------------------------
  // 月間目標
  // ----------------------------------------------------------

  const achievementRate =
    MONTHLY_TARGET > 0
      ? (monthly.sales / MONTHLY_TARGET) * 100
      : 0;

  const remaining =
    Math.max(
      0,
      MONTHLY_TARGET - monthly.sales
    );

  // ----------------------------------------------------------
  // 10万円ごとの丸
  // ----------------------------------------------------------

  const circleCount = Math.min(
    10,
    Math.floor(
      monthly.sales / 100000
    )
  );

  const circles =
    "🟢".repeat(circleCount) +
    "⚪".repeat(10 - circleCount);

  // ----------------------------------------------------------
  // レポート
  // ----------------------------------------------------------

  return [
    "📊 モヘジ宅配 売上レポート",
    "",
    `📅 ${dateKey}`,
    "",
    "【本日】",
    `売上：${formatYen(today.sales)}`,
    `件数：${formatNumber(today.orders)}件`,
    "",
    `【${getMonthLabel(monthKey)}】`,
    `売上：${formatYen(monthly.sales)}`,
    `件数：${formatNumber(monthly.orders)}件`,
    `稼働日：${formatNumber(workingDays)}日`,
    `1日平均：${formatYen(averageSales)}`,
    `1日平均件数：${formatNumber(averageOrders)}件`,
    `平均客単価：${formatYen(averageOrderValue)}`,
    "",
    `目標：${formatYen(MONTHLY_TARGET)}`,
    `達成率：${formatPercent(achievementRate)}`,
    `残り：${formatYen(remaining)}`,
    "",
    `進捗：${circles}`,
    "",
    "【今月最高】",
    `最高売上：${formatYen(best.sales)}`,
    `最高件数：${formatNumber(best.orders)}件`,
    "",
    `【${yearKey}年】`,
    `売上：${formatYen(yearly.sales)}`,
    `件数：${formatNumber(yearly.orders)}件`,
    "",
    "【累計】",
    `売上：${formatYen(allTime.sales)}`,
    `件数：${formatNumber(allTime.orders)}件`,
  ].join("\n");
}

// ============================================================
// 過去24か月レポート
// ============================================================

async function processRecord() {
  const current = getTokyoDateInfo();

  const results = [];

  let year = current.year;
  let month = current.month;

  for (let i = 0; i < 24; i++) {
    const monthKey =
      `${year}-${String(month).padStart(2, "0")}`;

    const [
      monthly,
      workingDays,
      best,
    ] = await Promise.all([
      getMonthly(monthKey),
      getWorkingDayCount(monthKey),
      getMonthlyBest(monthKey),
    ]);

    results.push({
      monthKey,
      monthly,
      workingDays,
      best,
    });

    month--;

    if (month === 0) {
      month = 12;
      year--;
    }
  }

  const lines = [
    "📈 モヘジ宅配 過去24か月",
    "",
  ];

  for (const item of results) {
    const average =
      item.workingDays > 0
        ? item.monthly.sales / item.workingDays
        : 0;

    lines.push(
      `【${getMonthLabel(item.monthKey)}】`,
      `売上：${formatYen(item.monthly.sales)}`,
      `件数：${formatNumber(item.monthly.orders)}件`,
      `稼働日：${formatNumber(item.workingDays)}日`,
      `1日平均：${formatYen(average)}`,
      `最高売上：${formatYen(item.best.sales)}`,
      `最高件数：${formatNumber(item.best.orders)}件`,
      ""
    );
  }

  return lines.join("\n");
}

// ============================================================
// Telegram Update の重複チェック
// ============================================================

async function isUpdateProcessed(updateId) {
  if (
    updateId === undefined ||
    updateId === null
  ) {
    return false;
  }

  const key =
    `moheji:delivery:update:${updateId}`;

  const result = await redisCommand([
    "EXISTS",
    key,
  ]);

  return safeNumber(result.result) === 1;
}

// ============================================================
// Telegram Update を処理済みにする
// ============================================================

async function markUpdateProcessed(updateId) {
  if (
    updateId === undefined ||
    updateId === null
  ) {
    return;
  }

  const key =
    `moheji:delivery:update:${updateId}`;

  await redisCommand([
    "SET",
    key,
    "1",
    "EX",
    "86400",
  ]);
}

// ============================================================
// コマンド解析
// ============================================================

function parseSalesCommand(text) {
  if (typeof text !== "string") {
    return null;
  }

  const match = text.trim().match(
    /^\/sales(?:@\S+)?\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)$/i
  );

  if (!match) {
    return null;
  }

  const sales = normalizeInteger(match[1]);
  const orders = normalizeInteger(match[2]);

  if (
    sales === null ||
    orders === null
  ) {
    return null;
  }

  if (
    sales < 0 ||
    orders < 0
  ) {
    return null;
  }

  return {
    sales,
    orders,
  };
}

// ============================================================
// /cancel 判定
// ============================================================

function isCancelCommand(text) {
  if (typeof text !== "string") {
    return false;
  }

  return /^\/cancel(?:@\S+)?(?:\s+.*)?$/i.test(
    text.trim()
  );
}

// ============================================================
// /record 判定
// ============================================================

function isRecordCommand(text) {
  if (typeof text !== "string") {
    return false;
  }

  return /^\/record(?:@\S+)?$/i.test(
    text.trim()
  );
}

// ============================================================
// /start /help
// ============================================================

function isHelpCommand(text) {
  if (typeof text !== "string") {
    return false;
  }

  return /^\/(?:start|help)(?:@\S+)?$/i.test(
    text.trim()
  );
}

// ============================================================
// ヘルプ
// ============================================================

function buildHelpMessage() {
  return [
    "📦 モヘジ宅配 売上管理Bot",
    "",
    "使い方",
    "",
    "売上登録",
    "/sales 売上 件数",
    "",
    "例",
    "/sales 25000 8",
    "",
    "最新の売上を取消",
    "/cancel",
    "",
    "現在のレポート",
    "/record",
  ].join("\n");
}

// ============================================================
// エラー通知
// ============================================================

async function notifyError(chatId, error) {
  if (!chatId) {
    return;
  }

  const message =
    error instanceof Error
      ? error.message
      : String(error);

  try {
    await sendTelegramMessage(
      chatId,
      [
        "⚠️ 処理中にエラーが発生しました。",
        "",
        message,
      ].join("\n")
    );
  } catch {
    // エラー通知自体の失敗は無視
  }
}

// ============================================================
// メイン handler
// ============================================================

export default async function handler(req, res) {
  // ----------------------------------------------------------
  // body は catch でも参照できるよう外で宣言
  // ----------------------------------------------------------

  let body = null;

  try {
    // --------------------------------------------------------
    // POSTのみ
    // --------------------------------------------------------

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method Not Allowed",
      });
    }

    // --------------------------------------------------------
    // Request body
    // --------------------------------------------------------

    body = req.body;

    if (
      typeof body === "string"
    ) {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          ok: false,
          error: "Invalid JSON",
        });
      }
    }

    if (!body || typeof body !== "object") {
      return res.status(400).json({
        ok: false,
        error: "Invalid request body",
      });
    }

    // --------------------------------------------------------
    // Telegram update_id
    // --------------------------------------------------------

    const updateId = body.update_id;

    // --------------------------------------------------------
    // 重複Update
    // --------------------------------------------------------

    if (
      updateId !== undefined &&
      updateId !== null
    ) {
      const processed =
        await isUpdateProcessed(updateId);

      if (processed) {
        return res.status(200).json({
          ok: true,
          duplicate: true,
        });
      }
    }

    // --------------------------------------------------------
    // Message
    // --------------------------------------------------------

    const message = body.message;

    if (!message) {
      if (
        updateId !== undefined &&
        updateId !== null
      ) {
        await markUpdateProcessed(updateId);
      }

      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }

    const chatId =
      message.chat?.id;

    const text =
      typeof message.text === "string"
        ? message.text.trim()
        : "";

    if (!chatId) {
      if (
        updateId !== undefined &&
        updateId !== null
      ) {
        await markUpdateProcessed(updateId);
      }

      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }

    // --------------------------------------------------------
    // /record
    // --------------------------------------------------------

    if (isRecordCommand(text)) {
      const report =
        await processRecord();

      await sendTelegramPhoto(
        chatId,
        report
      );

      // 成功後に処理済み
      await markUpdateProcessed(updateId);

      return res.status(200).json({
        ok: true,
        command: "record",
      });
    }

    // --------------------------------------------------------
    // /cancel
    // --------------------------------------------------------

    if (isCancelCommand(text)) {
      const result =
        await processCancel(chatId);

      if (!result.success) {
        let messageText;

        switch (result.reason) {
          case "locked":
            messageText =
              "⏳ 取消処理中です。少し待ってからもう一度お試しください。";
            break;

          case "already_migrated":
            messageText =
              "⚠️ 取消できる売上がありません。";
            break;

          case "legacy_data_not_found":
            messageText =
              "⚠️ 取消できる売上がありません。";
            break;

          case "aggregate_data_insufficient":
            messageText =
              "⚠️ 集計データを確認できないため、取消を中止しました。";
            break;

          case "already_cancelled":
            messageText =
              "⚠️ この売上はすでに取消されています。";
            break;

          default:
            messageText =
              "⚠️ 取消できる売上がありません。";
        }

        await sendTelegramMessage(
          chatId,
          messageText
        );

        await markUpdateProcessed(updateId);

        return res.status(200).json({
          ok: true,
          command: "cancel",
          success: false,
          reason: result.reason,
        });
      }

      const report =
        await buildReport();

      const cancelMessage = [
        "↩️ 売上を取消しました。",
        "",
        `売上：${formatYen(result.sales)}`,
        `件数：${formatNumber(result.orders)}件`,
        `対象日：${result.dateKey}`,
        "",
        report,
      ].join("\n");

      await sendTelegramPhoto(
        chatId,
        cancelMessage
      );

      await markUpdateProcessed(updateId);

      return res.status(200).json({
        ok: true,
        command: "cancel",
        success: true,
      });
    }

    // --------------------------------------------------------
    // /sales
    // --------------------------------------------------------

    const salesCommand =
      parseSalesCommand(text);

    if (salesCommand) {
      const {
        sales,
        orders,
      } = salesCommand;

      const result =
        await processSales({
          chatId,
          sales,
          orders,
        });

      const report =
        await buildReport();

      const messageText = [
        "✅ 売上を登録しました。",
        "",
        `売上：${formatYen(sales)}`,
        `件数：${formatNumber(orders)}件`,
        "",
        report,
      ].join("\n");

      await sendTelegramPhoto(
        chatId,
        messageText
      );

      await markUpdateProcessed(updateId);

      return res.status(200).json({
        ok: true,
        command: "sales",
        success: true,
        recordId: result.recordId,
      });
    }

    // --------------------------------------------------------
    // /start /help
    // --------------------------------------------------------

    if (isHelpCommand(text)) {
      await sendTelegramMessage(
        chatId,
        buildHelpMessage()
      );

      await markUpdateProcessed(updateId);

      return res.status(200).json({
        ok: true,
        command: "help",
      });
    }

    // --------------------------------------------------------
    // その他のメッセージは無視
    // --------------------------------------------------------

    await markUpdateProcessed(updateId);

    return res.status(200).json({
      ok: true,
      ignored: true,
    });
  } catch (error) {
    console.error(
      "Telegram handler error:",
      error
    );

    // --------------------------------------------------------
    // エラー発生時のTelegram通知
    // --------------------------------------------------------

    try {
      const chatId =
        body?.message?.chat?.id;

      if (chatId) {
        await notifyError(
          chatId,
          error
        );
      }
    } catch (notifyError) {
      console.error(
        "Error notification failed:",
        notifyError
      );
    }

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}

// ============================================================
// 完成
// ============================================================
