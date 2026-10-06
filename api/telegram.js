const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const PHOTO_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const TIME_ZONE = "Asia/Tokyo";
const MONTHLY_TARGET = 500000;

function redisReady() {
  return !!(REDIS_URL && REDIS_TOKEN);
}

async function redisCommand(command, ...args) {
  if (!redisReady()) {
    throw new Error("Redis environment variables are missing.");
  }

  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command, ...args]),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Redis HTTP ${response.status}: ${text}`);
  }

  const json = await response.json();
  return json.result;
}

/* =========================
   Redis helpers
========================= */

async function redisGet(key) {
  return await redisCommand("GET", key);
}

async function redisSet(key, value) {
  return await redisCommand("SET", key, String(value));
}

async function redisDel(key) {
  return await redisCommand("DEL", key);
}

async function redisType(key) {
  return await redisCommand("TYPE", key);
}

async function redisHGetAll(key) {
  return await redisCommand("HGETALL", key);
}

async function redisHSet(key, data) {
  const args = [];

  for (const [field, value] of Object.entries(data)) {
    args.push(field, String(value));
  }

  return await redisCommand("HSET", key, ...args);
}

async function redisScan(cursor, match) {
  return await redisCommand(
    "SCAN",
    String(cursor),
    "MATCH",
    match,
    "COUNT",
    "200"
  );
}

/* =========================
   HGETALL normalization
========================= */

function hashArrayToObject(value) {
  if (!Array.isArray(value)) {
    if (value && typeof value === "object") {
      return value;
    }

    return {};
  }

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

/* =========================
   Timestamp helpers
========================= */

function parseTimestamp(value) {
  if (value == null) {
    return 0;
  }

  const text = String(value);

  if (/^\d+$/.test(text)) {
    const number = Number(text);

    if (number > 0) {
      return number < 1e12 ? number * 1000 : number;
    }
  }

  const parsed = Date.parse(text);

  return Number.isFinite(parsed) ? parsed : 0;
}

/* =========================
   JST helpers
========================= */

function getJstParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function makeDateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function getTodayDateKey(date = new Date()) {
  const p = getJstParts(date);

  return makeDateKey(p.year, p.month, p.day);
}

function getMonthKey(dateKey) {
  return String(dateKey).slice(0, 7);
}

function getYearKey(dateKey) {
  return String(dateKey).slice(0, 4);
}

function formatDateJapanese(dateKey) {
  const [year, month, day] = String(dateKey)
    .split("-")
    .map(Number);

  return `${year}年${month}月${day}日`;
}

/*
  過去日のレポート用

  2026-10-06
  ↓
  10/6
*/

function formatDateShort(dateKey) {
  const [, month, day] = String(dateKey)
    .split("-")
    .map(Number);

  return `${month}/${day}`;
}

function formatNowJapanese(date = new Date()) {
  const p = getJstParts(date);

  return `${p.year}年${p.month}月${p.day}日 ${pad2(
    p.hour
  )}:${pad2(p.minute)}`;
}

/* =========================
   Date utilities
========================= */

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    String(dateKey)
  );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year < 2000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const check = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
  };
}

function daysInMonth(year, month) {
  return new Date(
    Date.UTC(year, month, 0)
  ).getUTCDate();
}

/* =========================
   Telegram helpers
========================= */

async function telegram(method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const json = await response.json();

  if (!json.ok) {
    throw new Error(
      `Telegram ${method} failed: ${JSON.stringify(json)}`
    );
  }

  return json.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return await telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

async function sendPhoto(chatId, photo, caption) {
  return await telegram("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
  });
}

async function answerCallbackQuery(
  callbackQueryId,
  text = ""
) {
  return await telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

async function editMessageText(
  chatId,
  messageId,
  text,
  extra = {}
) {
  return await telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...extra,
  });
}

/* =========================
   Record keys
========================= */

function recordKey(chatId, recordId) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}

function pendingKey(chatId) {
  return `moheji:delivery:pending:${chatId}`;
}

/* =========================
   Record normalization
========================= */

function normalizeRecord(raw, key = "") {
  const data =
    raw && typeof raw === "object" ? raw : {};

  const keyParts = key.split(":");

  let chatId = data.chatId;

  if (!chatId && keyParts.length >= 5) {
    chatId = keyParts[3];
  }

  const recordId =
    data.recordId ||
    data.id ||
    (keyParts.length >= 5 ? keyParts[4] : "");

  const sales = Number(data.sales || 0);
  const orders = Number(
    data.orders || data.count || 0
  );

  const deliveryDate =
    data.deliveryDate ||
    data.date ||
    data.dateKey ||
    "";

  const createdAt =
    data.createdAt ||
    data.timestamp ||
    data.created ||
    "";

  const cancelled =
    String(data.cancelled).toLowerCase() ===
      "true" ||
    String(data.cancelled) === "1" ||
    String(data.status).toLowerCase() ===
      "cancelled";

  return {
    key,
    chatId: String(chatId || ""),
    recordId: String(recordId || ""),
    sales: Number.isFinite(sales) ? sales : 0,
    orders: Number.isFinite(orders) ? orders : 0,
    deliveryDate: String(deliveryDate),
    createdAt: String(createdAt),
    timestamp: parseTimestamp(createdAt),
    cancelled,
  };
}

/* =========================
   Get current user's records
========================= */

async function getUserRecordKeys(chatId) {
  const pattern =
    `moheji:delivery:record:${chatId}:*`;

  let cursor = "0";
  const keys = [];

  do {
    const result = await redisScan(
      cursor,
      pattern
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

async function getUserRecords(chatId) {
  const keys = await getUserRecordKeys(chatId);
  const records = [];

  for (const key of keys) {
    try {
      const type = await redisType(key);

      let raw;

      if (type === "hash") {
        raw = hashArrayToObject(
          await redisHGetAll(key)
        );
      } else if (type === "string") {
        const value = await redisGet(key);

        try {
          raw = JSON.parse(value);
        } catch {
          raw = {};
        }
      } else {
        continue;
      }

      const record = normalizeRecord(raw, key);

      if (record.deliveryDate) {
        records.push(record);
      }
    } catch (error) {
      console.error(
        "Failed to read record:",
        key,
        error
      );
    }
  }

  return records;
}

/* =========================
   Create record
========================= */

async function createSalesRecord(
  chatId,
  sales,
  orders,
  deliveryDate
) {
  const recordId =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const key = recordKey(
    chatId,
    recordId
  );

  const now = new Date().toISOString();

  await redisHSet(key, {
    id: recordId,
    recordId,
    chatId,
    deliveryDate,
    sales,
    orders,
    createdAt: now,
    cancelled: 0,
    status: "active",
  });

  return {
    key,
    id: recordId,
    chatId: String(chatId),
    deliveryDate,
    sales,
    orders,
    createdAt: now,
    timestamp: Date.now(),
    cancelled: false,
  };
}

/* =========================
   Daily aggregation
========================= */

function aggregateByDay(records) {
  const daily = {};

  for (const record of records) {
    if (record.cancelled) {
      continue;
    }

    const dateKey = record.deliveryDate;

    if (!parseDateKey(dateKey)) {
      continue;
    }

    if (!daily[dateKey]) {
      daily[dateKey] = {
        dateKey,
        sales: 0,
        orders: 0,
      };
    }

    daily[dateKey].sales +=
      Number(record.sales || 0);

    daily[dateKey].orders +=
      Number(record.orders || 0);
  }

  return daily;
}

function getDailyList(records) {
  const daily = aggregateByDay(records);

  return Object.values(daily).sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey)
  );
}

/* =========================
   Stats
========================= */

function calculateStats(
  records,
  now = new Date()
) {
  const todayKey = getTodayDateKey(now);
  const todayMonthKey =
    getMonthKey(todayKey);
  const todayYearKey =
    getYearKey(todayKey);

  const daily = aggregateByDay(records);

  /* 今日 */

  const today = daily[todayKey] || {
    sales: 0,
    orders: 0,
  };

  /* 今月 */

  let monthSales = 0;
  let monthOrders = 0;

  const monthDays = [];

  for (const day of Object.values(daily)) {
    if (
      getMonthKey(day.dateKey) !==
      todayMonthKey
    ) {
      continue;
    }

    monthSales += day.sales;
    monthOrders += day.orders;

    monthDays.push(day);
  }

  /*
    稼働日数
  */

  const workingDays =
    monthDays.filter(
      (day) =>
        day.sales > 0 ||
        day.orders > 0
    );

  const workingDayCount =
    workingDays.length;

  /*
    平均売上／日
  */

  const averageSalesPerDay =
    workingDayCount > 0
      ? Math.round(
          monthSales /
            workingDayCount
        )
      : 0;

  /*
    月間最高売上
  */

  let monthlyBestSales = 0;

  for (const day of monthDays) {
    if (
      day.sales >
      monthlyBestSales
    ) {
      monthlyBestSales =
        day.sales;
    }
  }

  /*
    月間最高件数
  */

  let monthlyBestOrders = 0;

  for (const day of monthDays) {
    if (
      day.orders >
      monthlyBestOrders
    ) {
      monthlyBestOrders =
        day.orders;
    }
  }

  /* 年間 */

  let yearSales = 0;
  let yearOrders = 0;

  for (const day of Object.values(daily)) {
    if (
      getYearKey(day.dateKey) !==
      todayYearKey
    ) {
      continue;
    }

    yearSales += day.sales;
    yearOrders += day.orders;
  }

  /* 累計 */

  let totalOrders = 0;

  for (const day of Object.values(daily)) {
    totalOrders += day.orders;
  }

  return {
    todaySales: today.sales,
    todayOrders: today.orders,

    monthSales,
    monthOrders,

    yearSales,
    yearOrders,

    averageSalesPerDay,

    monthlyBestSales,
    monthlyBestOrders,

    workingDayCount,

    totalOrders,
  };
}

/* =========================
   Sales report
========================= */

function buildSalesReport(
  stats,
  now = new Date()
) {
  const todaySales =
    stats.todaySales;

  const todayOrders =
    stats.todayOrders;

  const oneOrderAverage =
    todayOrders > 0
      ? Math.round(
          todaySales /
            todayOrders
        )
      : 0;

  const achievement =
    MONTHLY_TARGET > 0
      ? Math.round(
          (stats.monthSales /
            MONTHLY_TARGET) *
            100
        )
      : 0;

  return [
    "🏍️ 配達売上",
    `💰 今日の売上　${todaySales.toLocaleString(
      "ja-JP"
    )}円`,
    `📦 今日の件数　${todayOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `💵 1件あたり　${oneOrderAverage.toLocaleString(
      "ja-JP"
    )}円`,
    `📅 今月売上　${stats.monthSales.toLocaleString(
      "ja-JP"
    )}円`,
    `📦 今月件数　${stats.monthOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `🗓️ 年間売上　${stats.yearSales.toLocaleString(
      "ja-JP"
    )}円`,
    `📦 年間件数　${stats.yearOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `📈 平均売上／日　${stats.averageSalesPerDay.toLocaleString(
      "ja-JP"
    )}円`,
    `🎯 月間目標　${MONTHLY_TARGET.toLocaleString(
      "ja-JP"
    )}円`,
    `📊 目標達成率　${achievement}%`,
    `🏆 月間最高売上　${stats.monthlyBestSales.toLocaleString(
      "ja-JP"
    )}円`,
    `🏆 月間最高件数　${stats.monthlyBestOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `📆 稼働日数　${stats.workingDayCount.toLocaleString(
      "ja-JP"
    )}日`,
    `🛵 累計配達件数　${stats.totalOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `🕐 ${formatNowJapanese(now)}`,
    "🟢 今日も配達お疲れ様でした！",
  ].join("\n");
}

async function sendSalesReport(chatId) {
  const records =
    await getUserRecords(chatId);

  const stats =
    calculateStats(records);

  const report =
    buildSalesReport(stats);

  if (PHOTO_URL) {
    try {
      await sendPhoto(
        chatId,
        PHOTO_URL,
        report
      );
      return;
    } catch (error) {
      console.error(
        "sendPhoto failed:",
        error
      );
    }
  }

  await sendMessage(
    chatId,
    report
  );
}

/* =========================
   Historical sales report
========================= */

/*
  過去の日付を登録した場合専用。

  例：

  🏍️ 配達売上
  💰 10/6の売上　11,447円
  📦 10/6の件数　17件
  💵 1件あたり　674円
  📅 今月売上　67,204円
  📦 今月件数　83件
  🗓️ 年間売上　XXX円
  ...
*/

function buildHistoricalSalesReport(
  dateKey,
  day,
  stats,
  now = new Date()
) {
  const label =
    formatDateShort(dateKey);

  const oneOrderAverage =
    day.orders > 0
      ? Math.round(
          day.sales /
            day.orders
        )
      : 0;

  const achievement =
    MONTHLY_TARGET > 0
      ? Math.round(
          (stats.monthSales /
            MONTHLY_TARGET) *
            100
        )
      : 0;

  return [
    "🏍️ 配達売上",
    `💰 ${label}の売上　${day.sales.toLocaleString(
      "ja-JP"
    )}円`,
    `📦 ${label}の件数　${day.orders.toLocaleString(
      "ja-JP"
    )}件`,
    `💵 1件あたり　${oneOrderAverage.toLocaleString(
      "ja-JP"
    )}円`,
    `📅 今月売上　${stats.monthSales.toLocaleString(
      "ja-JP"
    )}円`,
    `📦 今月件数　${stats.monthOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `🗓️ 年間売上　${stats.yearSales.toLocaleString(
      "ja-JP"
    )}円`,
    `📦 年間件数　${stats.yearOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `📈 平均売上／日　${stats.averageSalesPerDay.toLocaleString(
      "ja-JP"
    )}円`,
    `🎯 月間目標　${MONTHLY_TARGET.toLocaleString(
      "ja-JP"
    )}円`,
    `📊 目標達成率　${achievement}%`,
    `🏆 月間最高売上　${stats.monthlyBestSales.toLocaleString(
      "ja-JP"
    )}円`,
    `🏆 月間最高件数　${stats.monthlyBestOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `📆 稼働日数　${stats.workingDayCount.toLocaleString(
      "ja-JP"
    )}日`,
    `🛵 累計配達件数　${stats.totalOrders.toLocaleString(
      "ja-JP"
    )}件`,
    `🕐 ${formatNowJapanese(now)}`,
    "🟢 今日も配達お疲れ様でした！",
  ].join("\n");
}

async function sendHistoricalSalesReport(
  chatId,
  dateKey
) {
  const records =
    await getUserRecords(chatId);

  /*
    同じ日に複数回登録されていても、
    その日の合計を表示する。
  */

  const daily =
    aggregateByDay(records);

  const day =
    daily[dateKey] || {
      dateKey,
      sales: 0,
      orders: 0,
    };

  /*
    今月・年間・最高売上などは
    既存の計算ロジックをそのまま使用。
  */

  const stats =
    calculateStats(records);

  const report =
    buildHistoricalSalesReport(
      dateKey,
      day,
      stats
    );

  if (PHOTO_URL) {
    try {
      await sendPhoto(
        chatId,
        PHOTO_URL,
        report
      );
      return;
    } catch (error) {
      console.error(
        "sendPhoto failed:",
        error
      );
    }
  }

  await sendMessage(
    chatId,
    report
  );
}

/* =========================
   Calendar
========================= */

function shiftMonth(
  year,
  month,
  diff
) {
  const date = new Date(
    Date.UTC(
      year,
      month - 1 + diff,
      1
    )
  );

  return {
    year:
      date.getUTCFullYear(),
    month:
      date.getUTCMonth() + 1,
  };
}

function buildCalendar(
  year,
  month
) {
  const todayKey =
    getTodayDateKey();

  const todayParts =
    parseDateKey(todayKey);

  const firstDay =
    new Date(
      Date.UTC(
        year,
        month - 1,
        1
      )
    );

  const startWeekday =
    firstDay.getUTCDay();

  const totalDays =
    daysInMonth(
      year,
      month
    );

  const keyboard = [];

  const previous =
    shiftMonth(
      year,
      month,
      -1
    );

  const next =
    shiftMonth(
      year,
      month,
      1
    );

  keyboard.push([
    {
      text: "‹",
      callback_data:
        `cal:${previous.year}-${pad2(
          previous.month
        )}-01`,
    },
    {
      text:
        `${year}年${month}月`,
      callback_data:
        "cal:none",
    },
    {
      text: "›",
      callback_data:
        `cal:${next.year}-${pad2(
          next.month
        )}-01`,
    },
  ]);

  keyboard.push([
    {
      text: "日",
      callback_data:
        "cal:none",
    },
    {
      text: "月",
      callback_data:
        "cal:none",
    },
    {
      text: "火",
      callback_data:
        "cal:none",
    },
    {
      text: "水",
      callback_data:
        "cal:none",
    },
    {
      text: "木",
      callback_data:
        "cal:none",
    },
    {
      text: "金",
      callback_data:
        "cal:none",
    },
    {
      text: "土",
      callback_data:
        "cal:none",
    },
  ]);

  let week = [];

  for (
    let i = 0;
    i < startWeekday;
    i++
  ) {
    week.push({
      text: " ",
      callback_data:
        "cal:none",
    });
  }

  for (
    let day = 1;
    day <= totalDays;
    day++
  ) {
    const dateKey =
      makeDateKey(
        year,
        month,
        day
      );

    let label =
      String(day);

    if (
      todayParts &&
      todayParts.year === year &&
      todayParts.month === month &&
      todayParts.day === day
    ) {
      label = `●${day}`;
    }

    week.push({
      text: label,
      callback_data:
        `date:${dateKey}`,
    });

    if (week.length === 7) {
      keyboard.push(week);
      week = [];
    }
  }

  if (week.length > 0) {
    while (week.length < 7) {
      week.push({
        text: " ",
        callback_data:
          "cal:none",
      });
    }

    keyboard.push(week);
  }

  keyboard.push([
    {
      text: "今日",
      callback_data:
        `date:${todayKey}`,
    },
  ]);

  return keyboard;
}

async function showCalendar(
  chatId,
  messageId = null,
  year = null,
  month = null
) {
  const today =
    getJstParts();

  const targetYear =
    year || today.year;

  const targetMonth =
    month || today.month;

  const keyboard =
    buildCalendar(
      targetYear,
      targetMonth
    );

  const text =
    "📅 配達日を選択してください\n\n" +
    "売上を登録する日をカレンダーから選んでください。";

  if (messageId) {
    await editMessageText(
      chatId,
      messageId,
      text,
      {
        reply_markup: {
          inline_keyboard:
            keyboard,
        },
      }
    );
  } else {
    await sendMessage(
      chatId,
      text,
      {
        reply_markup: {
          inline_keyboard:
            keyboard,
        },
      }
    );
  }
}

/* =========================
   Pending date
========================= */

async function setPendingDate(
  chatId,
  dateKey
) {
  await redisSet(
    pendingKey(chatId),
    dateKey
  );
}

async function getPendingDate(
  chatId
) {
  return await redisGet(
    pendingKey(chatId)
  );
}

async function clearPendingDate(
  chatId
) {
  await redisDel(
    pendingKey(chatId)
  );
}

/* =========================
   Sales input
========================= */

function parseSalesInput(text) {
  const parts =
    String(text)
      .trim()
      .split(/\s+/);

  if (parts.length !== 2) {
    return null;
  }

  const sales =
    Number(
      String(parts[0])
        .replace(/,/g, "")
    );

  const orders =
    Number(
      String(parts[1])
        .replace(/,/g, "")
    );

  if (
    !Number.isFinite(sales) ||
    !Number.isFinite(orders)
  ) {
    return null;
  }

  if (
    sales < 0 ||
    orders < 0
  ) {
    return null;
  }

  if (
    !Number.isInteger(sales) ||
    !Number.isInteger(orders)
  ) {
    return null;
  }

  return {
    sales,
    orders,
  };
}
/* =========================
   /sales
========================= */

async function handleSales(
  chatId,
  args
) {
  /*
    /sales
    → カレンダー
  */

  if (args.length === 0) {
    await showCalendar(chatId);
    return;
  }

  /*
    /sales 17014 17
    → 今日の日付で登録
  */

  if (args.length === 2) {
    const sales =
      Number(
        String(args[0])
          .replace(/,/g, "")
      );

    const orders =
      Number(
        String(args[1])
          .replace(/,/g, "")
      );

    if (
      !Number.isInteger(sales) ||
      !Number.isInteger(orders) ||
      sales < 0 ||
      orders < 0
    ) {
      await sendMessage(
        chatId,
        "❌ 入力形式が正しくありません。\n\n例：\n/sales 17014 17"
      );
      return;
    }

    const deliveryDate =
      getTodayDateKey();

    await createSalesRecord(
      chatId,
      sales,
      orders,
      deliveryDate
    );

    await sendMessage(
      chatId,
      `✅ 配達実績を登録しました。\n\n📅 ${formatDateJapanese(
        deliveryDate
      )}\n💰 売上　${sales.toLocaleString(
        "ja-JP"
      )}円\n📦 件数　${orders.toLocaleString(
        "ja-JP"
      )}件`
    );

    /*
      直接 /sales で登録した場合は
      今日の通常レポートのまま。
    */

    await sendSalesReport(
      chatId
    );

    return;
  }

  await sendMessage(
    chatId,
    "❌ 入力形式が正しくありません。\n\n" +
      "今日の売上を直接登録する場合：\n" +
      "/sales 17014 17\n\n" +
      "過去の日付を登録する場合：\n" +
      "/sales"
  );
}

/* =========================
   Calendar date selection
========================= */

async function handleCalendarCallback(
  callbackQuery
) {
  const callbackId =
    callbackQuery.id;

  const data =
    callbackQuery.data || "";

  const message =
    callbackQuery.message;

  if (!message) {
    await answerCallbackQuery(
      callbackId
    );
    return;
  }

  const chatId =
    message.chat.id;

  const messageId =
    message.message_id;

  if (data === "cal:none") {
    await answerCallbackQuery(
      callbackId
    );
    return;
  }

  /*
    月移動
  */

  if (data.startsWith("cal:")) {
    const dateKey =
      data.slice(4);

    const parsed =
      parseDateKey(dateKey);

    if (!parsed) {
      await answerCallbackQuery(
        callbackId,
        "日付を確認してください"
      );
      return;
    }

    await answerCallbackQuery(
      callbackId
    );

    await showCalendar(
      chatId,
      messageId,
      parsed.year,
      parsed.month
    );

    return;
  }

  /*
    日付選択
  */

  if (data.startsWith("date:")) {
    const dateKey =
      data.slice(5);

    if (
      !parseDateKey(dateKey)
    ) {
      await answerCallbackQuery(
        callbackId,
        "日付が正しくありません"
      );
      return;
    }

    await setPendingDate(
      chatId,
      dateKey
    );

    await answerCallbackQuery(
      callbackId,
      `${formatDateJapanese(
        dateKey
      )}を選択しました`
    );

    await editMessageText(
      chatId,
      messageId,
      `📅 ${formatDateJapanese(
        dateKey
      )} を選択しました。\n\n💰 売上と件数を入力してください。\n\n例：\n17014 17`
    );

    return;
  }

  await answerCallbackQuery(
    callbackId
  );
}

/* =========================
   Pending sales input
========================= */

async function handlePendingSalesInput(
  chatId,
  text
) {
  const dateKey =
    await getPendingDate(
      chatId
    );

  if (!dateKey) {
    return false;
  }

  const parsed =
    parseSalesInput(text);

  if (!parsed) {
    await sendMessage(
      chatId,
      "❌ 入力形式が正しくありません。\n\n" +
        "「売上 件数」の順で入力してください。\n\n" +
        "例：\n17014 17"
    );

    return true;
  }

  await createSalesRecord(
    chatId,
    parsed.sales,
    parsed.orders,
    dateKey
  );

  await clearPendingDate(
    chatId
  );

  await sendMessage(
    chatId,
    `✅ 配達実績を登録しました。\n\n📅 ${formatDateJapanese(
      dateKey
    )}\n💰 売上　${parsed.sales.toLocaleString(
      "ja-JP"
    )}円\n📦 件数　${parsed.orders.toLocaleString(
      "ja-JP"
    )}件`
  );

  /*
    今回の変更点。

    今日を選択した場合
    → 今まで通り sendSalesReport()

    過去日を選択した場合
    → 選択した日付のレポートを表示

    これにより、

    過去日を登録したのに
    「今日の売上 0円」

    と表示される問題を解消。
  */

  const todayKey =
    getTodayDateKey();

  if (dateKey === todayKey) {
    await sendSalesReport(
      chatId
    );
  } else {
    await sendHistoricalSalesReport(
      chatId,
      dateKey
    );
  }

  return true;
}

/* =========================
   /cancel
========================= */

async function handleCancel(
  chatId,
  args
) {
  if (args.length !== 0) {
    await sendMessage(
      chatId,
      "❌ /cancel は引数なしで使用してください。"
    );
    return;
  }

  const records =
    await getUserRecords(
      chatId
    );

  const activeRecords =
    records.filter(
      (record) =>
        !record.cancelled
    );

  if (
    activeRecords.length === 0
  ) {
    await sendMessage(
      chatId,
      "↩️ 取消できる配達実績がありません。"
    );
    return;
  }

  activeRecords.sort(
    (a, b) =>
      b.timestamp -
      a.timestamp
  );

  const target =
    activeRecords[0];

  await redisHSet(
    target.key,
    {
      cancelled: 1,
      status: "cancelled",
      cancelledAt:
        new Date().toISOString(),
    }
  );

  await clearPendingDate(
    chatId
  );

  await sendMessage(
    chatId,
    "↩️ 配達実績を取消しました。\n\n" +
      `📅 ${formatDateJapanese(
        target.deliveryDate
      )}\n` +
      `💰 売上　${target.sales.toLocaleString(
        "ja-JP"
      )}円\n` +
      `📦 件数　${target.orders.toLocaleString(
        "ja-JP"
      )}件`
  );

  /*
    取消後も全レコードから再計算
  */

  await sendSalesReport(
    chatId
  );
}

/* =========================
   /reset
========================= */

async function handleReset(
  chatId,
  args
) {
  if (args.length !== 0) {
    await sendMessage(
      chatId,
      "❌ /reset は引数なしで使用してください。"
    );
    return;
  }

  const keys =
    await getUserRecordKeys(
      chatId
    );

  let deleted = 0;

  for (const key of keys) {
    await redisDel(key);
    deleted++;
  }

  await clearPendingDate(
    chatId
  );

  await sendMessage(
    chatId,
    `🗑️ このチャットの配達記録をリセットしました。\n\n削除件数：${deleted}件`
  );
}

/* =========================
   Command parser
========================= */

function parseCommand(text) {
  const trimmed =
    String(text || "").trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts =
    trimmed.split(/\s+/);

  let command =
    parts[0];

  /*
    /sales@botname
    → /sales
  */

  command =
    command
      .split("@")[0]
      .toLowerCase();

  return {
    command,
    args: parts.slice(1),
  };
}

/* =========================
   Main webhook
========================= */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    res.status(200).json({
      ok: true,
    });

    return;
  }

  try {
    if (!redisReady()) {
      console.error(
        "Redis environment variables are missing."
      );

      res.status(500).json({
        ok: false,
        error:
          "Redis environment variables are missing.",
      });

      return;
    }

    const update = req.body;

    /*
      Telegram callback query
    */

    if (
      update &&
      update.callback_query
    ) {
      await handleCalendarCallback(
        update.callback_query
      );

      res.status(200).json({
        ok: true,
      });

      return;
    }

    /*
      Telegram message
    */

    const message =
      update &&
      update.message;

    if (
      !message ||
      !message.chat
    ) {
      res.status(200).json({
        ok: true,
      });

      return;
    }

    const chatId =
      message.chat.id;

    const text =
      typeof message.text ===
      "string"
        ? message.text.trim()
        : "";

    if (!text) {
      res.status(200).json({
        ok: true,
      });

      return;
    }

    /*
      コマンド
    */

    const parsedCommand =
      parseCommand(text);

    if (parsedCommand) {
      switch (
        parsedCommand.command
      ) {
        case "/sales":
          await handleSales(
            chatId,
            parsedCommand.args
          );
          break;

        case "/cancel":
          await handleCancel(
            chatId,
            parsedCommand.args
          );
          break;

        case "/reset":
          await handleReset(
            chatId,
            parsedCommand.args
          );
          break;

        default:
          await sendMessage(
            chatId,
            "❓ 使用できるコマンド\n\n" +
              "/sales\n" +
              "/cancel\n" +
              "/reset"
          );
      }

      res.status(200).json({
        ok: true,
      });

      return;
    }

    /*
      カレンダーで日付を選択した後の
      「17014 17」入力
    */

    const handledPending =
      await handlePendingSalesInput(
        chatId,
        text
      );

    if (handledPending) {
      res.status(200).json({
        ok: true,
      });

      return;
    }

    /*
      その他の通常メッセージ
    */

    await sendMessage(
      chatId,
      "📌 配達売上を登録する場合は\n\n/sales\n\nを入力してください。"
    );

    res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    /*
      Telegramには200を返して、
      同じWebhookが何度も再送されるのを防ぐ
    */

    res.status(200).json({
      ok: false,
    });
  }
}
