// api/telegram.js

const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTHLY_TARGET = 500000;

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
 * Redis helpers
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

async function incrementHash(key, field, amount) {
  await redis(
    "HINCRBY",
    key,
    field,
    String(amount)
  );
}

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

/*
 * Redis SCAN
 *
 * 大量のKEYSを一気に取得しない。
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
 * Repair / reconciliation
 * ------------------------------------------------------------
 *
 * 重要：
 *
 * 1. daily の売上は変更しない
 * 2. month の sales / orders は変更しない
 * 3. year は month の合計から再構築
 * 4. alltime は year の合計から再構築
 * 5. monthly best は daily から再計算
 *
 * これにより、
 *
 * 今日 17,314 / 20
 * 今月 57,428 / 62
 * 年間 271,082 / 253
 *
 * の既存データを勝手に削除せず、
 * ロールアップだけを正しい状態へ戻す。
 */

async function repairRollups() {
  const monthKeys = await scanKeys(
    "moheji:delivery:month:*"
  );

  const yearlyTotals = {};
  const monthlyBest = {};

  for (const key of monthKeys) {
    const match = key.match(
      /^moheji:delivery:month:(\d{4})-(\d{2})$/
    );

    if (!match) {
      continue;
    }

    const year = match[1];
    const month = match[2];
    const monthValue = await getHash(key);

    const sales = number(monthValue.sales);
    const orders = number(monthValue.orders);

    if (!yearlyTotals[year]) {
      yearlyTotals[year] = {
        sales: 0,
        orders: 0,
      };
    }

    yearlyTotals[year].sales += sales;
    yearlyTotals[year].orders += orders;

    /*
     * 月間最高記録を日別データから探す。
     */
    const dailyKeys = await scanKeys(
      `moheji:delivery:daily:${year}-${month}-*`
    );

    let bestSales = number(
      monthValue.bestSales
    );

    let bestOrders = number(
      monthValue.bestOrders
    );

    for (const dailyRedisKey of dailyKeys) {
      const dailyValue =
        await getHash(dailyRedisKey);

      const dailySales =
        number(dailyValue.sales);

      const dailyOrders =
        number(dailyValue.orders);

      if (dailySales > bestSales) {
        bestSales = dailySales;
      }

      if (dailyOrders > bestOrders) {
        bestOrders = dailyOrders;
      }
    }

    monthlyBest[`${year}-${month}`] = {
      bestSales,
      bestOrders,
    };
  }

  /*
   * 既存値をバックアップ。
   *
   * daily sales / orders は変更しないので、
   * ここでは修正対象だけ保存する。
   */
  const backup = {
    createdAt: new Date().toISOString(),
    allTime: await getAllTime(),
    years: {},
    months: {},
  };

  const yearKeys = await scanKeys(
    "moheji:delivery:year:*"
  );

  for (const key of yearKeys) {
    const match = key.match(
      /^moheji:delivery:year:(\d{4})$/
    );

    if (!match) {
      continue;
    }

    backup.years[match[1]] =
      await getHash(key);
  }

  for (const [key, value] of Object.entries(
    monthlyBest
  )) {
    backup.months[key] =
      await getMonth(key);
  }

  const backupKey =
    `moheji:delivery:repair-backup:${Date.now()}`;

  await redis(
    "SET",
    backupKey,
    JSON.stringify(backup)
  );

  /*
   * 年次を月次から再構築
   */
  for (const [year, total] of Object.entries(
    yearlyTotals
  )) {
    await setHash(
      yearKey(year),
      {
        sales: total.sales,
        orders: total.orders,
      }
    );
  }

  /*
   * 月間最高値を修正
   */
  for (const [key, best] of Object.entries(
    monthlyBest
  )) {
    await setHash(
      monthKey(key),
      {
        bestSales: best.bestSales,
        bestOrders: best.bestOrders,
      }
    );
  }

  /*
   * 累計を年間合計から再構築
   */
  let allTimeSales = 0;
  let allTimeOrders = 0;

  for (const total of Object.values(
    yearlyTotals
  )) {
    allTimeSales += number(total.sales);
    allTimeOrders += number(total.orders);
  }

  await setHash(
    allTimeKey(),
    {
      sales: allTimeSales,
      orders: allTimeOrders,
    }
  );

  return {
    backupKey,
    yearlyTotals,
    allTime: {
      sales: allTimeSales,
      orders: allTimeOrders,
    },
  };
}

/*
 * ------------------------------------------------------------
 * Working days
 * ------------------------------------------------------------
 */

async function incrementWorkingDayIfNeeded(
  dateKey,
  monthKeyValue
) {
  const daily = await getDaily(dateKey);

  const alreadyCounted =
    number(daily.workingDayCounted);

  if (alreadyCounted === 1) {
    return;
  }

  await setHash(
    dailyKey(dateKey),
    {
      workingDayCounted: 1,
    }
  );

  await redis(
    "INCR",
    workingDaysKey(monthKeyValue)
  );
}

/*
 * ------------------------------------------------------------
 * Sale records
 * ------------------------------------------------------------
 */

async function saveSaleRecord({
  chatId,
  sales,
  orders,
  dateKey,
  monthKeyValue,
  yearKeyValue,
}) {
  const recordId = makeRecordId();
  const createdAt = Date.now();

  const record = {
    id: recordId,
    chatId: String(chatId),
    sales: String(sales),
    orders: String(orders),
    dateKey,
    monthKey: monthKeyValue,
    yearKey: yearKeyValue,
    createdAt: String(createdAt),
    cancelled: "0",
  };

  await setHash(
    recordKey(chatId, recordId),
    record
  );

  await redis(
    "ZADD",
    recordsIndexKey(chatId),
    String(createdAt),
    recordId
  );

  return record;
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
 * Report helpers
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

/*
 * 月間最高記録は Redis の best フィールドを使う。
 *
 * repairRollups() によって日別データから
 * 既存値が復元される。
 */
async function getMonthlyBest(monthKeyValue) {
  const month =
    await getMonth(monthKeyValue);

  return {
    bestSales: number(month.bestSales),
    bestOrders: number(month.bestOrders),
  };
}

async function updateDailyBest(
  dateKey,
  sales,
  orders
) {
  const daily =
    await getDaily(dateKey);

  const currentSales =
    number(daily.sales);

  const currentOrders =
    number(daily.orders);

  const bestSales = Math.max(
    number(daily.bestSales),
    currentSales
  );

  const bestOrders = Math.max(
    number(daily.bestOrders),
    currentOrders
  );

  await setHash(
    dailyKey(dateKey),
    {
      sales: currentSales,
      orders: currentOrders,
      bestSales,
      bestOrders,
    }
  );

  return {
    bestSales,
    bestOrders,
  };
}

async function updateMonthlyBest(
  monthKeyValue,
  sales,
  orders
) {
  const month =
    await getMonth(monthKeyValue);

  const bestSales = Math.max(
    number(month.bestSales),
    sales
  );

  const bestOrders = Math.max(
    number(month.bestOrders),
    orders
  );

  await setHash(
    monthKey(monthKeyValue),
    {
      bestSales,
      bestOrders,
    }
  );
}

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

  /*
   * 個別レコード
   */
  await saveSaleRecord({
    chatId,
    sales,
    orders,
    dateKey: now.dateKey,
    monthKeyValue: now.monthKey,
    yearKeyValue: now.yearKey,
  });

  /*
   * 日次
   */
  await incrementHash(
    dailyKey(now.dateKey),
    "sales",
    sales
  );

  await incrementHash(
    dailyKey(now.dateKey),
    "orders",
    orders
  );

  /*
   * 月次
   */
  await incrementHash(
    monthKey(now.monthKey),
    "sales",
    sales
  );

  await incrementHash(
    monthKey(now.monthKey),
    "orders",
    orders
  );

  /*
   * 年次
   */
  await incrementHash(
    yearKey(now.yearKey),
    "sales",
    sales
  );

  await incrementHash(
    yearKey(now.yearKey),
    "orders",
    orders
  );

  /*
   * 累計
   */
  await incrementHash(
    allTimeKey(),
    "sales",
    sales
  );

  await incrementHash(
    allTimeKey(),
    "orders",
    orders
  );

  /*
   * 稼働日
   */
  await incrementWorkingDayIfNeeded(
    now.dateKey,
    now.monthKey
  );

  /*
   * ベスト
   */
  const daily =
    await getDaily(now.dateKey);

  await updateDailyBest(
    now.dateKey,
    number(daily.sales),
    number(daily.orders)
  );

  await updateMonthlyBest(
    now.monthKey,
    number(daily.sales),
    number(daily.orders)
  );

  return await buildReport(now);
}

/*
 * ------------------------------------------------------------
 * Report
 * ------------------------------------------------------------
 */

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

  const sales =
    number(record.sales);

  const orders =
    number(record.orders);

  const dateKey =
    record.dateKey;

  const monthKeyValue =
    record.monthKey;

  const yearKeyValue =
    record.yearKey;

  /*
   * 元レコードの日付を使用。
   *
   * 23:59に売上登録
   * ↓
   * 00:01に/cancel
   *
   * でも前日のdailyから減算される。
   */

  await setHash(
    recordKey(chatId, record.id),
    {
      cancelled: "1",
      cancelledAt: String(
        Date.now()
      ),
    }
  );

  await incrementHash(
    dailyKey(dateKey),
    "sales",
    -sales
  );

  await incrementHash(
    dailyKey(dateKey),
    "orders",
    -orders
  );

  await incrementHash(
    monthKey(monthKeyValue),
    "sales",
    -sales
  );

  await incrementHash(
    monthKey(monthKeyValue),
    "orders",
    -orders
  );

  await incrementHash(
    yearKey(yearKeyValue),
    "sales",
    -sales
  );

  await incrementHash(
    yearKey(yearKeyValue),
    "orders",
    -orders
  );

  await incrementHash(
    allTimeKey(),
    "sales",
    -sales
  );

  await incrementHash(
    allTimeKey(),
    "orders",
    -orders
  );

  /*
   * 負数防止
   */
  const daily =
    await getDaily(dateKey);

  const month =
    await getMonth(monthKeyValue);

  const year =
    await getYear(yearKeyValue);

  const allTime =
    await getAllTime();

  await setHash(
    dailyKey(dateKey),
    {
      sales: Math.max(
        0,
        number(daily.sales)
      ),
      orders: Math.max(
        0,
        number(daily.orders)
      ),
    }
  );

  await setHash(
    monthKey(monthKeyValue),
    {
      sales: Math.max(
        0,
        number(month.sales)
      ),
      orders: Math.max(
        0,
        number(month.orders)
      ),
    }
  );

  await setHash(
    yearKey(yearKeyValue),
    {
      sales: Math.max(
        0,
        number(year.sales)
      ),
      orders: Math.max(
        0,
        number(year.orders)
      ),
    }
  );

  await setHash(
    allTimeKey(),
    {
      sales: Math.max(
        0,
        number(allTime.sales)
      ),
      orders: Math.max(
        0,
        number(allTime.orders)
      ),
    }
  );

  /*
   * キャンセル後にロールアップを再同期。
   *
   * ただし daily / month の売上そのものは
   * 再計算して上書きしない。
   */
  await repairRollups();

  const now =
    getTokyoDateInfo();

  const report =
    await buildReport(now);

  await sendTelegramMessage(
    chatId,
`❌ 売上をキャンセルしました。

💰 ${formatYen(sales)}円
📦 ${formatNumber(orders)}件
📅 売上日 ${dateKey}

${report}`
  );
}

/*
 * ------------------------------------------------------------
 * /record
 * ------------------------------------------------------------
 */

async function processRecord(chatId) {
  const now =
    getTokyoDateInfo();

  /*
   * まず現在のロールアップを修正。
   *
   * daily / month の sales / orders は触らず、
   * year / alltime / monthly best のみ再構築。
   */
  await repairRollups();

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
   * 有効個別履歴の合計
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
 * Vercel handler
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
