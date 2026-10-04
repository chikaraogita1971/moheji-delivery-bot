const {
  KV_REST_API_URL,
  KV_REST_API_TOKEN,
  TELEGRAM_BOT_TOKEN,
  DEBUG_KEY,
} = process.env;

const SALES_IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTHLY_TARGET = 500000;

if (!KV_REST_API_URL || !KV_REST_API_TOKEN || !TELEGRAM_BOT_TOKEN) {
  console.error("Missing required environment variables");
}

/* =========================================================
 * Redis REST
 * ======================================================= */

async function redis(...args) {
  const response = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || `Redis HTTP ${response.status}`);
  }

  return data.result;
}

/**
 * Upstash REST Pipeline
 *
 * IMPORTANT:
 * /pipeline のレスポンスは
 * [
 *   { result: ... },
 *   { result: ... }
 * ]
 * そのもの。
 */
async function redisPipeline(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return [];
  }

  const response = await fetch(`${KV_REST_API_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error || `Redis pipeline HTTP ${response.status}`
    );
  }

  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected Redis pipeline response: ${JSON.stringify(data)}`
    );
  }

  for (const item of data) {
    if (item && item.error) {
      throw new Error(`Redis pipeline command error: ${item.error}`);
    }
  }

  return data.map((item) =>
    item && Object.prototype.hasOwnProperty.call(item, "result")
      ? item.result
      : null
  );
}

/**
 * Upstash REST Transaction
 */
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error || `Redis transaction HTTP ${response.status}`
    );
  }

  if (!Array.isArray(data)) {
    if (data && data.error) {
      throw new Error(`Redis transaction error: ${data.error}`);
    }

    throw new Error(
      `Unexpected Redis transaction response: ${JSON.stringify(data)}`
    );
  }

  for (const item of data) {
    if (item && item.error) {
      throw new Error(`Redis transaction command error: ${item.error}`);
    }
  }

  return data.map((item) =>
    item && Object.prototype.hasOwnProperty.call(item, "result")
      ? item.result
      : null
  );
}

/* =========================================================
 * Basic helpers
 * ======================================================= */

function jstDate(date = new Date()) {
  return new Date(
    date.toLocaleString("en-US", {
      timeZone: "Asia/Tokyo",
    })
  );
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getDateKey(date = new Date()) {
  const d = jstDate(date);

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )}`;
}

function getMonthKey(date = new Date()) {
  const d = jstDate(date);

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function getYearKey(date = new Date()) {
  const d = jstDate(date);

  return String(d.getFullYear());
}

function formatYen(value) {
  return Math.round(Number(value) || 0).toLocaleString("ja-JP");
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseTimestamp(value) {
  if (value == null) return 0;

  const text = String(value);

  if (/^\d+$/.test(text)) {
    const n = Number(text);

    if (n > 0) {
      return n < 1e12 ? n * 1000 : n;
    }
  }

  const parsed = Date.parse(text);

  return Number.isFinite(parsed) ? parsed : 0;
}

function makeRecordId() {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================
 * HGETALL normalization
 * ======================================================= */

/**
 * Upstash REST の HGETALL は
 *
 * [
 *   "sales", "100",
 *   "orders", "1",
 *   "createdAt", "...",
 * ]
 *
 * のような配列で返る。
 *
 * 古い処理では data.sales としていたため
 * HASH が読めない問題が発生していた。
 */
function hashArrayToObject(value) {
  if (Array.isArray(value)) {
    const result = {};

    for (let i = 0; i < value.length; i += 2) {
      const field = value[i];
      const fieldValue = value[i + 1];

      if (field !== undefined) {
        result[String(field)] =
          fieldValue === undefined ? "" : String(fieldValue);
      }
    }

    return result;
  }

  if (value && typeof value === "object") {
    return value;
  }

  return {};
}

function isEmptyObject(value) {
  return (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length === 0
  );
}

/* =========================================================
 * Redis scan
 * ======================================================= */

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
      200
    );

    cursor = String(result?.[0] ?? "0");

    const batch = Array.isArray(result?.[1]) ? result[1] : [];

    keys.push(...batch);
  } while (cursor !== "0");

  return keys;
}

/* =========================================================
 * Record normalization
 * ======================================================= */

function normalizeRecord(raw, key) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = { ...raw };

  const keyParts = String(key).split(":");

  let chatId = record.chatId || record.chat_id || "";

  if (!chatId && keyParts.length >= 5) {
    chatId = keyParts[3];
  }

  let recordId =
    record.recordId ||
    record.id ||
    record.saleId ||
    "";

  if (!recordId && keyParts.length >= 5) {
    recordId = keyParts.slice(4).join(":");
  }

  const sales = toNumber(
    record.sales ??
      record.amount ??
      record.totalSales ??
      record.price ??
      0
  );

  const orders = toNumber(
    record.orders ??
      record.orderCount ??
      record.count ??
      0
  );

  const createdAt =
    record.createdAt ||
    record.timestamp ||
    record.time ||
    "";

  const createdTimestamp = parseTimestamp(createdAt);

  let dateKey = record.dateKey || "";

  if (!dateKey && createdTimestamp) {
    dateKey = getDateKey(new Date(createdTimestamp));
  }

  let monthKey = record.monthKey || "";

  if (!monthKey && dateKey) {
    monthKey = String(dateKey).slice(0, 7);
  }

  let yearKey = record.yearKey || "";

  if (!yearKey && dateKey) {
    yearKey = String(dateKey).slice(0, 4);
  }

  const cancelled =
    record.cancelled === true ||
    record.cancelled === "true" ||
    record.cancelled === "1" ||
    record.status === "cancelled";

  return {
    ...record,

    key,
    chatId: String(chatId || ""),
    recordId: String(recordId || ""),
    sales,
    orders,
    createdAt,
    createdTimestamp,
    dateKey: String(dateKey || ""),
    monthKey: String(monthKey || ""),
    yearKey: String(yearKey || ""),
    cancelled,
  };
}

/* =========================================================
 * Record history
 * ======================================================= */

/**
 * 個別売上レコードをまとめて取得する。
 *
 * 1. SCAN
 * 2. TYPE を Pipeline
 * 3. HASH -> HGETALL
 *    STRING -> GET
 *
 * これで旧データの混在にも対応。
 */
async function getAllRecordHistory() {
  const keys = await scanKeys("moheji:delivery:record:*");

  if (!keys.length) {
    return [];
  }

  /* -------------------------
   * TYPE
   * ----------------------- */

  const typeCommands = keys.map((key) => [
    "TYPE",
    key,
  ]);

  const types = await redisPipeline(typeCommands);

  const readCommands = [];
  const readMeta = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const type = String(types[i] || "");

    if (type === "hash") {
      readCommands.push(["HGETALL", key]);
      readMeta.push({
        key,
        type: "hash",
      });
    } else if (type === "string") {
      readCommands.push(["GET", key]);
      readMeta.push({
        key,
        type: "string",
      });
    }
  }

  if (!readCommands.length) {
    return [];
  }

  const values = await redisPipeline(readCommands);

  const records = [];

  for (let i = 0; i < values.length; i++) {
    const meta = readMeta[i];
    const value = values[i];

    if (!meta) continue;

    let raw = null;

    if (meta.type === "hash") {
      raw = hashArrayToObject(value);
    } else if (meta.type === "string") {
      if (!value) continue;

      try {
        raw = JSON.parse(value);
      } catch {
        continue;
      }
    }

    if (!raw || isEmptyObject(raw)) {
      continue;
    }

    const record = normalizeRecord(raw, meta.key);

    if (!record) continue;

    if (!record.recordId) continue;

    records.push(record);
  }

  return records;
}

/* =========================================================
 * Hash reader
 * ======================================================= */

async function getHash(key) {
  const result = await redis("HGETALL", key);

  return hashArrayToObject(result);
}

async function getHashes(keys) {
  if (!keys.length) return [];

  const commands = keys.map((key) => [
    "HGETALL",
    key,
  ]);

  const results = await redisPipeline(commands);

  return results.map(hashArrayToObject);
}

/* =========================================================
 * Telegram
 * ======================================================= */

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

  const data = await response.json();

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.description ||
        `Telegram HTTP ${response.status}`
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

/* =========================================================
 * Working days
 * ======================================================= */

async function getWorkingDays(monthKey) {
  const pattern =
    `moheji:delivery:day:${monthKey}-*`;

  const keys = await scanKeys(pattern);

  if (!keys.length) {
    return 0;
  }

  const commands = keys.map((key) => [
    "HGETALL",
    key,
  ]);

  const values = await redisPipeline(commands);

  let days = 0;

  for (const value of values) {
    const hash = hashArrayToObject(value);

    const sales = toNumber(hash.sales);
    const orders = toNumber(hash.orders);

    if (sales > 0 || orders > 0) {
      days++;
    }
  }

  return days;
}

/* =========================================================
 * Sales report
 * ======================================================= */

function buildSalesReport({
  daily,
  monthly,
  yearly,
  workingDays,
}) {
  const todaySales = toNumber(daily.sales);
  const todayOrders = toNumber(daily.orders);

  const monthSales = toNumber(monthly.sales);
  const monthOrders = toNumber(monthly.orders);

  const yearSales = toNumber(yearly.sales);
  const yearOrders = toNumber(yearly.orders);

  const averagePerOrder =
    monthOrders > 0
      ? Math.round(monthSales / monthOrders)
      : 0;

  const averagePerDay =
    workingDays > 0
      ? Math.round(monthSales / workingDays)
      : 0;

  const targetRate =
    MONTHLY_TARGET > 0
      ? Math.floor(
          (monthSales / MONTHLY_TARGET) * 100
        )
      : 0;

  const maxSales = toNumber(
    monthly.maxSales ??
      monthly.monthlyMaxSales ??
      monthly.max_sales
  );

  const maxOrders = toNumber(
    monthly.maxOrders ??
      monthly.monthlyMaxOrders ??
      monthly.max_orders
  );

  const now = jstDate();

  const nowText =
    `${now.getFullYear()}年` +
    `${now.getMonth() + 1}月` +
    `${now.getDate()}日 ` +
    `${pad2(now.getHours())}:` +
    `${pad2(now.getMinutes())}`;

  return [
    "🏍️ 配達売上",
    `💰 今日の売上　${formatYen(todaySales)}円`,
    `📦 今日の件数　${formatYen(todayOrders)}件`,
    `💵 1件あたり　${formatYen(averagePerOrder)}円`,
    `📅 今月売上　${formatYen(monthSales)}円`,
    `📦 今月件数　${formatYen(monthOrders)}件`,
    `🗓️ 年間売上　${formatYen(yearSales)}円`,
    `📦 年間件数　${formatYen(yearOrders)}件`,
    `📈 平均売上／日　${formatYen(averagePerDay)}円`,
    `🎯 月間目標　${formatYen(MONTHLY_TARGET)}円`,
    `📊 目標達成率　${targetRate}%`,
    `🏆 月間最高売上　${formatYen(maxSales)}円`,
    `🏆 月間最高件数　${formatYen(maxOrders)}件`,
    `📆 稼働日数　${formatYen(workingDays)}日`,
    `🛵 累計配達件数　${formatYen(yearOrders)}件`,
    `🕐 ${nowText}`,
    "🛵 今日も配達お疲れ様でした！",
  ].join("\n");
}

/* =========================================================
 * /sales
 * ======================================================= */

async function recordSale(chatId, sales, orders) {
  const now = new Date();

  const dateKey = getDateKey(now);
  const monthKey = getMonthKey(now);
  const yearKey = getYearKey(now);

  const dailyKey =
    `moheji:delivery:day:${dateKey}`;

  const monthlyKey =
    `moheji:delivery:month:${monthKey}`;

  const yearlyKey =
    `moheji:delivery:year:${yearKey}`;

  const alltimeKey =
    "moheji:delivery:alltime";

  const recordId = makeRecordId();

  const recordKey =
    `moheji:delivery:record:${chatId}:${recordId}`;

  const createdAt = now.toISOString();

  const commands = [
    [
      "HINCRBY",
      dailyKey,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      dailyKey,
      "orders",
      orders,
    ],

    [
      "HINCRBY",
      monthlyKey,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      monthlyKey,
      "orders",
      orders,
    ],

    [
      "HINCRBY",
      yearlyKey,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      yearlyKey,
      "orders",
      orders,
    ],

    [
      "HINCRBY",
      alltimeKey,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      alltimeKey,
      "orders",
      orders,
    ],

    [
      "HSET",
      recordKey,
      "recordId",
      recordId,
      "chatId",
      String(chatId),
      "sales",
      sales,
      "orders",
      orders,
      "dateKey",
      dateKey,
      "monthKey",
      monthKey,
      "yearKey",
      yearKey,
      "createdAt",
      createdAt,
      "cancelled",
      "0",
      "status",
      "active",
    ],

    [
      "ZADD",
      `moheji:delivery:records:${chatId}`,
      Date.now(),
      recordId,
    ],
  ];

  await redisMulti(commands);

  /* -------------------------
   * 今日の最高売上・最高件数
   * ----------------------- */

  const [daily, monthly, yearly] =
    await getHashes([
      dailyKey,
      monthlyKey,
      yearlyKey,
    ]);

  const currentDailySales = toNumber(
    daily.sales
  );

  const currentDailyOrders = toNumber(
    daily.orders
  );

  const currentMaxSales = toNumber(
    monthly.maxSales
  );

  const currentMaxOrders = toNumber(
    monthly.maxOrders
  );

  const updateCommands = [];

  if (currentDailySales > currentMaxSales) {
    updateCommands.push([
      "HSET",
      monthlyKey,
      "maxSales",
      currentDailySales,
    ]);
  }

  if (currentDailyOrders > currentMaxOrders) {
    updateCommands.push([
      "HSET",
      monthlyKey,
      "maxOrders",
      currentDailyOrders,
    ]);
  }

  if (updateCommands.length) {
    await redisPipeline(updateCommands);
  }

  return {
    recordId,
    daily,
    monthly,
    yearly,
  };
}

/* =========================================================
 * /cancel
 * ======================================================= */

async function cancelLatestSale(chatId) {
  /*
   * ここが今回の修正ポイント。
   *
   * getAllRecordHistory() は必ず配列を返す。
   */
  const records = await getAllRecordHistory();

  if (!Array.isArray(records)) {
    throw new Error(
      "getAllRecordHistory() did not return an array"
    );
  }

  const activeRecords = records.filter(
    (record) =>
      String(record.chatId) === String(chatId) &&
      !record.cancelled
  );

  if (!activeRecords.length) {
    await sendMessage(
      chatId,
      "⚠️ 取消できる未取消の売上がありません。"
    );
    return;
  }

  activeRecords.sort(
    (a, b) =>
      (b.createdTimestamp || 0) -
      (a.createdTimestamp || 0)
  );

  const target = activeRecords[0];

  if (!target) {
    await sendMessage(
      chatId,
      "⚠️ 取消対象の売上が見つかりません。"
    );
    return;
  }

  const sales = toNumber(target.sales);
  const orders = toNumber(target.orders);

  if (sales <= 0 && orders <= 0) {
    await sendMessage(
      chatId,
      "⚠️ 取消対象の売上データが不正です。"
    );
    return;
  }

  const dateKey =
    target.dateKey ||
    getDateKey(
      new Date(target.createdTimestamp)
    );

  const monthKey =
    target.monthKey ||
    String(dateKey).slice(0, 7);

  const yearKey =
    target.yearKey ||
    String(dateKey).slice(0, 4);

  const dailyKey =
    `moheji:delivery:day:${dateKey}`;

  const monthlyKey =
    `moheji:delivery:month:${monthKey}`;

  const yearlyKey =
    `moheji:delivery:year:${yearKey}`;

  const alltimeKey =
    "moheji:delivery:alltime";

  const recordKey = target.key;

  /*
   * 取消処理は transaction。
   *
   * pipeline と違い、複数更新を
   * atomic にまとめる。
   */
  const commands = [
    [
      "HINCRBY",
      dailyKey,
      "sales",
      -sales,
    ],
    [
      "HINCRBY",
      dailyKey,
      "orders",
      -orders,
    ],

    [
      "HINCRBY",
      monthlyKey,
      "sales",
      -sales,
    ],
    [
      "HINCRBY",
      monthlyKey,
      "orders",
      -orders,
    ],

    [
      "HINCRBY",
      yearlyKey,
      "sales",
      -sales,
    ],
    [
      "HINCRBY",
      yearlyKey,
      "orders",
      -orders,
    ],

    [
      "HINCRBY",
      alltimeKey,
      "sales",
      -sales,
    ],
    [
      "HINCRBY",
      alltimeKey,
      "orders",
      -orders,
    ],

    [
      "HSET",
      recordKey,
      "cancelled",
      "1",
      "status",
      "cancelled",
      "cancelledAt",
      new Date().toISOString(),
    ],
  ];

  await redisMulti(commands);

  /*
   * 月間最高値については、
   * 取消後の履歴から再計算する。
   *
   * ただし既存の aggregate を
   * 個別レコード合計に勝手に修復することはしない。
   */
  const remaining = records.filter(
    (record) =>
      String(record.chatId) === String(chatId) &&
      !record.cancelled &&
      record.recordId !== target.recordId
  );

  let maxDailySales = 0;
  let maxDailyOrders = 0;

  const dayTotals = new Map();

  for (const record of remaining) {
    const key = record.dateKey || "";

    if (!key) continue;

    const current = dayTotals.get(key) || {
      sales: 0,
      orders: 0,
    };

    current.sales += toNumber(record.sales);
    current.orders += toNumber(record.orders);

    dayTotals.set(key, current);
  }

  for (const value of dayTotals.values()) {
    if (value.sales > maxDailySales) {
      maxDailySales = value.sales;
    }

    if (value.orders > maxDailyOrders) {
      maxDailyOrders = value.orders;
    }
  }

  /*
   * 現在の月間最高値より履歴側が小さい場合は、
   * 最高値を無理に0へ戻さない。
   *
   * これは過去のlegacyデータを壊さないため。
   */
  const monthly = await getHash(monthlyKey);

  const storedMaxSales = toNumber(
    monthly.maxSales
  );

  const storedMaxOrders = toNumber(
    monthly.maxOrders
  );

  const bestCommands = [];

  if (
    storedMaxSales > 0 &&
    target.dateKey === monthKey &&
    maxDailySales >= 0 &&
    maxDailySales < storedMaxSales
  ) {
    /*
     * 同一月の履歴から再計算できる場合のみ更新。
     */
    bestCommands.push([
      "HSET",
      monthlyKey,
      "maxSales",
      maxDailySales,
    ]);
  }

  if (
    storedMaxOrders > 0 &&
    target.dateKey === monthKey &&
    maxDailyOrders >= 0 &&
    maxDailyOrders < storedMaxOrders
  ) {
    bestCommands.push([
      "HSET",
      monthlyKey,
      "maxOrders",
      maxDailyOrders,
    ]);
  }

  if (bestCommands.length) {
    await redisPipeline(bestCommands);
  }

  const targetDate = target.createdTimestamp
    ? jstDate(new Date(target.createdTimestamp))
    : null;

  const timeText = targetDate
    ? `${targetDate.getFullYear()}年` +
      `${targetDate.getMonth() + 1}月` +
      `${targetDate.getDate()}日 ` +
      `${pad2(targetDate.getHours())}:` +
      `${pad2(targetDate.getMinutes())}`
    : "";

  await sendMessage(
    chatId,
    [
      "↩️ 売上を取り消しました。",
      "",
      `💰 売上　${formatYen(sales)}円`,
      `📦 件数　${formatYen(orders)}件`,
      timeText ? `🕐 ${timeText}` : "",
      "",
      "※ 元の売上日を基準に集計から減算しました。",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

/* =========================================================
 * /sales command
 * ======================================================= */

async function handleSales(chatId) {
  /*
   * /sales 自体は今まで通り、
   * 引数を持たず現在の日次集計を表示。
   */
  const now = new Date();

  const dateKey = getDateKey(now);
  const monthKey = getMonthKey(now);
  const yearKey = getYearKey(now);

  const dailyKey =
    `moheji:delivery:day:${dateKey}`;

  const monthlyKey =
    `moheji:delivery:month:${monthKey}`;

  const yearlyKey =
    `moheji:delivery:year:${yearKey}`;

  const [daily, monthly, yearly] =
    await getHashes([
      dailyKey,
      monthlyKey,
      yearlyKey,
    ]);

  const workingDays =
    await getWorkingDays(monthKey);

  const report = buildSalesReport({
    daily,
    monthly,
    yearly,
    workingDays,
  });

  await sendPhoto(chatId, report);
}

/* =========================================================
 * /record
 * ======================================================= */

function formatRecordDate(timestamp) {
  if (!timestamp) return "";

  const d = jstDate(new Date(timestamp));

  return (
    `${d.getMonth() + 1}/${d.getDate()} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

async function handleRecord(chatId) {
  const monthKey = getMonthKey();

  const monthlyKey =
    `moheji:delivery:month:${monthKey}`;

  const [records, monthly] =
    await Promise.all([
      getAllRecordHistory(),
      getHash(monthlyKey),
    ]);

  if (!Array.isArray(records)) {
    throw new Error(
      "getAllRecordHistory() did not return array"
    );
  }

  const monthRecords = records
    .filter(
      (record) =>
        String(record.chatId) === String(chatId) &&
        record.monthKey === monthKey
    )
    .sort(
      (a, b) =>
        (b.createdTimestamp || 0) -
        (a.createdTimestamp || 0)
    );

  const activeRecords = monthRecords.filter(
    (record) => !record.cancelled
  );

  const cancelledRecords = monthRecords.filter(
    (record) => record.cancelled
  );

  const activeSales = activeRecords.reduce(
    (sum, record) => sum + toNumber(record.sales),
    0
  );

  const activeOrders = activeRecords.reduce(
    (sum, record) => sum + toNumber(record.orders),
    0
  );

  const monthlySales = toNumber(
    monthly.sales
  );

  const monthlyOrders = toNumber(
    monthly.orders
  );

  const lines = [];

  lines.push("📋 月間売上記録");
  lines.push(`📅 ${monthKey}`);
  lines.push("");

  lines.push(
    `📊 月間集計　${formatYen(monthlySales)}円 / ${formatYen(monthlyOrders)}件`
  );

  lines.push(
    `🧾 個別記録　${formatYen(activeSales)}円 / ${formatYen(activeOrders)}件`
  );

  lines.push(
    `↩️ 取消件数　${cancelledRecords.length}件`
  );

  lines.push("");

  const salesDiff =
    monthlySales - activeSales;

  const ordersDiff =
    monthlyOrders - activeOrders;

  if (salesDiff === 0 && ordersDiff === 0) {
    lines.push("✅ 集計と個別記録は一致しています。");
  } else {
    lines.push("⚠️ 集計と個別記録に差があります。");
    lines.push(
      `差額　${formatYen(salesDiff)}円 / ${formatYen(ordersDiff)}件`
    );
  }

  lines.push("");
  lines.push("──── 個別売上履歴 ────");

  if (!monthRecords.length) {
    lines.push("記録なし");
  } else {
    monthRecords.slice(0, 100).forEach((record, index) => {
      const mark = record.cancelled
        ? "↩️"
        : "✅";

      lines.push(
        `${index + 1}. ${mark} ` +
          `${formatYen(record.sales)}円 / ` +
          `${formatYen(record.orders)}件 ` +
          `${formatRecordDate(record.createdTimestamp)}`
      );
    });
  }

  await sendMessage(chatId, lines.join("\n"));
}

/* =========================================================
 * Debug
 * ======================================================= */

async function buildDebug() {
  const keys = await scanKeys(
    "moheji:delivery:*"
  );

  const typeCommands = keys.map((key) => [
    "TYPE",
    key,
  ]);

  const types = keys.length
    ? await redisPipeline(typeCommands)
    : [];

  const typeCounts = {};

  for (const type of types) {
    const name = String(type || "unknown");

    typeCounts[name] =
      (typeCounts[name] || 0) + 1;
  }

  const records =
    await getAllRecordHistory();

  const active = records.filter(
    (record) => !record.cancelled
  );

  const cancelled = records.filter(
    (record) => record.cancelled
  );

  const activeSales = active.reduce(
    (sum, record) =>
      sum + toNumber(record.sales),
    0
  );

  const activeOrders = active.reduce(
    (sum, record) =>
      sum + toNumber(record.orders),
    0
  );

  const cancelledSales = cancelled.reduce(
    (sum, record) =>
      sum + toNumber(record.sales),
    0
  );

  const cancelledOrders = cancelled.reduce(
    (sum, record) =>
      sum + toNumber(record.orders),
    0
  );

  const monthKey = getMonthKey();

  const monthly = await getHash(
    `moheji:delivery:month:${monthKey}`
  );

  return {
    keyCount: keys.length,
    typeCounts,
    recordCount: records.length,
    activeCount: active.length,
    cancelledCount: cancelled.length,
    activeSales,
    activeOrders,
    cancelledSales,
    cancelledOrders,
    monthlySales: toNumber(monthly.sales),
    monthlyOrders: toNumber(monthly.orders),
    monthKey,
  };
}

/* =========================================================
 * Telegram command parser
 * ======================================================= */

function getCommand(text) {
  if (!text) return null;

  const first = String(text)
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();

  /*
   * Telegram group の @botname 付きにも対応
   */
  const command = first.split("@")[0];

  if (
    command === "/sales" ||
    command === "/cancel" ||
    command === "/record"
  ) {
    return command;
  }

  return null;
}

/* =========================================================
 * Main handler
 * ======================================================= */

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: true,
      });
    }

    const update = req.body;

    const message = update?.message;

    if (!message) {
      return res.status(200).json({
        ok: true,
      });
    }

    const chatId = message?.chat?.id;

    if (!chatId) {
      return res.status(200).json({
        ok: true,
      });
    }

    const text = message?.text || "";

    const command = getCommand(text);

    /*
     * /sales /cancel /record 以外は完全無視。
     */
    if (!command) {
      return res.status(200).json({
        ok: true,
      });
    }

    if (command === "/sales") {
      await handleSales(chatId);

      return res.status(200).json({
        ok: true,
      });
    }

    if (command === "/cancel") {
      await cancelLatestSale(chatId);

      return res.status(200).json({
        ok: true,
      });
    }

    if (command === "/record") {
      await handleRecord(chatId);

      return res.status(200).json({
        ok: true,
      });
    }

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "HANDLER ERROR:",
      error?.stack || error
    );

    /*
     * Telegramには内部エラー詳細を出さない。
     */
    try {
      const chatId = req?.body?.message?.chat?.id;

      if (chatId) {
        await sendMessage(
          chatId,
          "⚠️ エラーが発生しました。\nしばらくしてからもう一度お試しください。"
        );
      }
    } catch (telegramError) {
      console.error(
        "TELEGRAM ERROR:",
        telegramError?.stack || telegramError
      );
    }

    /*
     * Telegram webhook は200を返して終了。
     * これにより無限再送を避ける。
     */
    return res.status(200).json({
      ok: false,
    });
  }
}
