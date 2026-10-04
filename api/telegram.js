const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const TELEGRAM_API =
  `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const RECORD_PREFIX = "moheji:delivery:record:";

const SALES_IMAGE =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTH_NAMES = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];

/* =========================================================
   Environment
========================================================= */

function assertEnv() {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  if (!KV_REST_API_URL) {
    throw new Error("KV_REST_API_URL is missing");
  }

  if (!KV_REST_API_TOKEN) {
    throw new Error("KV_REST_API_TOKEN is missing");
  }
}

/* =========================================================
   Redis
========================================================= */

async function redisCommand(command, ...args) {
  const response = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command, ...args]),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Redis HTTP ${response.status}: ${text}`
    );
  }

  const data = await response.json();

  if (data?.error) {
    throw new Error(`Redis error: ${data.error}`);
  }

  return data?.result;
}

async function redisGet(key) {
  return redisCommand("GET", key);
}

async function redisSet(key, value) {
  return redisCommand("SET", key, value);
}

async function redisDel(key) {
  return redisCommand("DEL", key);
}

async function redisType(key) {
  return redisCommand("TYPE", key);
}

async function redisHGetAll(key) {
  return redisCommand("HGETALL", key);
}

async function redisHSet(key, ...args) {
  return redisCommand("HSET", key, ...args);
}

async function redisScan(cursor, pattern, count = 200) {
  return redisCommand(
    "SCAN",
    cursor,
    "MATCH",
    pattern,
    "COUNT",
    String(count)
  );
}

/* =========================================================
   Telegram
========================================================= */

async function telegram(method, body) {
  const response = await fetch(
    `${TELEGRAM_API}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Telegram ${method} ${response.status}: ${text}`
    );
  }

  return response.json();
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

async function sendPhoto(chatId, photo, caption) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
  });
}

async function answerCallbackQuery(callbackQueryId) {
  return telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
  });
}

async function editMessageText(
  chatId,
  messageId,
  text,
  replyMarkup
) {
  return telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup,
  });
}

/* =========================================================
   Helpers
========================================================= */

function numberValue(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function hashArrayToObject(value) {
  if (!Array.isArray(value)) {
    if (
      value &&
      typeof value === "object"
    ) {
      return value;
    }

    return {};
  }

  const result = {};

  for (
    let i = 0;
    i < value.length;
    i += 2
  ) {
    const field = value[i];
    const fieldValue = value[i + 1];

    if (field !== undefined) {
      result[String(field)] =
        fieldValue === undefined
          ? ""
          : String(fieldValue);
    }
  }

  return result;
}

function parseTimestamp(value) {
  if (value == null) {
    return 0;
  }

  const text = String(value);

  if (/^\d+$/.test(text)) {
    const n = Number(text);

    if (n > 0) {
      return n < 1e12
        ? n * 1000
        : n;
    }
  }

  const parsed = Date.parse(text);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function isCancelled(record) {
  const cancelled =
    String(
      record.cancelled ?? ""
    ).toLowerCase();

  const status =
    String(
      record.status ?? ""
    ).toLowerCase();

  return (
    cancelled === "1" ||
    cancelled === "true" ||
    cancelled === "yes" ||
    status === "cancelled"
  );
}

/* =========================================================
   JST
========================================================= */

function jstParts(timestamp) {
  const date = new Date(timestamp);

  const formatter =
    new Intl.DateTimeFormat(
      "ja-JP",
      {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }
    );

  const parts =
    formatter.formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] =
        part.value;
    }
  }

  return result;
}

function dateKeyFromTimestamp(timestamp) {
  const p =
    jstParts(timestamp);

  return `${p.year}-${p.month}-${p.day}`;
}

function monthKeyFromTimestamp(timestamp) {
  const p =
    jstParts(timestamp);

  return `${p.year}-${p.month}`;
}

function yearKeyFromTimestamp(timestamp) {
  const p =
    jstParts(timestamp);

  return p.year;
}

function formatJstDate(timestamp) {
  const p =
    jstParts(timestamp);

  return `${p.year}年${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}

/* =========================================================
   Calendar date utilities
========================================================= */

function isValidDateKey(dateKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(dateKey)
  );
}

function parseDateKey(dateKey) {
  if (!isValidDateKey(dateKey)) {
    return null;
  }

  const [year, month, day] =
    dateKey.split("-").map(Number);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const test =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  if (
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() !== month - 1 ||
    test.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
  };
}

function dateKeyFromParts(
  year,
  month,
  day
) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function addMonths(
  year,
  month,
  delta
) {
  const d =
    new Date(
      Date.UTC(
        year,
        month - 1 + delta,
        1
      )
    );

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
  };
}

/*
 * JSTの日付キーをミリ秒へ変換。
 *
 * 00:00 JST = 前日15:00 UTC
 */
function dateKeyToTimestamp(dateKey) {
  const parsed =
    parseDateKey(dateKey);

  if (!parsed) {
    return 0;
  }

  return Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    0,
    0,
    0
  ) - 9 * 60 * 60 * 1000;
}

function formatDateKeyJapanese(
  dateKey
) {
  const parsed =
    parseDateKey(dateKey);

  if (!parsed) {
    return dateKey;
  }

  return `${parsed.year}年${parsed.month}月${parsed.day}日`;
}

/* =========================================================
   Calendar keyboard
========================================================= */

function buildCalendarKeyboard(
  year,
  month
) {
  const daysInMonth =
    new Date(
      Date.UTC(
        year,
        month,
        0
      )
    ).getUTCDate();

  const firstDay =
    new Date(
      Date.UTC(
        year,
        month - 1,
        1
      )
    ).getUTCDay();

  const rows = [];

  /*
   * 月移動
   */
  const previous =
    addMonths(
      year,
      month,
      -1
    );

  const next =
    addMonths(
      year,
      month,
      1
    );

  rows.push([
    {
      text: "‹ 前月",
      callback_data:
        `cal:${previous.year}-${String(previous.month).padStart(2, "0")}-01`,
    },
    {
      text:
        `${year}年 ${MONTH_NAMES[month - 1]}`,
      callback_data: "cal:none",
    },
    {
      text: "次月 ›",
      callback_data:
        `cal:${next.year}-${String(next.month).padStart(2, "0")}-01`,
    },
  ]);

  /*
   * 曜日
   */
  rows.push([
    { text: "日", callback_data: "cal:none" },
    { text: "月", callback_data: "cal:none" },
    { text: "火", callback_data: "cal:none" },
    { text: "水", callback_data: "cal:none" },
    { text: "木", callback_data: "cal:none" },
    { text: "金", callback_data: "cal:none" },
    { text: "土", callback_data: "cal:none" },
  ]);

  let row = [];

  /*
   * 月初まで空白
   */
  for (
    let i = 0;
    i < firstDay;
    i++
  ) {
    row.push({
      text: " ",
      callback_data: "cal:none",
    });
  }

  /*
   * 日付
   */
  for (
    let day = 1;
    day <= daysInMonth;
    day++
  ) {
    const dateKey =
      dateKeyFromParts(
        year,
        month,
        day
      );

    row.push({
      text: String(day),
      callback_data:
        `date:${dateKey}`,
    });

    if (
      row.length === 7
    ) {
      rows.push(row);
      row = [];
    }
  }

  /*
   * 最終行
   */
  if (row.length > 0) {
    while (
      row.length < 7
    ) {
      row.push({
        text: " ",
        callback_data: "cal:none",
      });
    }

    rows.push(row);
  }

  /*
   * 今日ボタン
   */
  const today =
    jstParts(Date.now());

  const todayKey =
    `${today.year}-${today.month}-${today.day}`;

  rows.push([
    {
      text: "📅 今日",
      callback_data:
        `date:${todayKey}`,
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

/* =========================================================
   Record key
========================================================= */

function makeRecordKey(
  chatId,
  recordId
) {
  return `${RECORD_PREFIX}${chatId}:${recordId}`;
}

function getChatIdFromKey(key) {
  const prefix =
    RECORD_PREFIX;

  if (
    !String(key).startsWith(prefix)
  ) {
    return "";
  }

  const rest =
    String(key).slice(
      prefix.length
    );

  const separator =
    rest.indexOf(":");

  if (separator === -1) {
    return "";
  }

  return rest.slice(
    0,
    separator
  );
}

/* =========================================================
   Record normalize
========================================================= */

function normalizeRecord(
  key,
  raw
) {
  const record = {
    ...raw,
  };

  const keyChatId =
    getChatIdFromKey(key);

  if (
    !record.chatId &&
    keyChatId
  ) {
    record.chatId =
      keyChatId;
  }

  record.key = key;

  record.recordId =
    record.recordId ??
    record.id ??
    "";

  record.sales =
    numberValue(
      record.sales ??
        record.amount ??
        record.totalSales ??
        record.total ??
        0
    );

  record.orders =
    numberValue(
      record.orders ??
        record.count ??
        record.quantity ??
        record.deliveryCount ??
        0
    );

  record.createdAt =
    record.createdAt ??
    record.timestamp ??
    "";

  record.timestamp =
    parseTimestamp(
      record.createdAt
    );

  /*
   * 過去日入力では
   * dateKeyが必ず保存される。
   */
  if (
    !record.dateKey &&
    record.timestamp
  ) {
    record.dateKey =
      dateKeyFromTimestamp(
        record.timestamp
      );
  }

  if (
    !record.monthKey &&
    record.dateKey
  ) {
    record.monthKey =
      String(
        record.dateKey
      ).slice(0, 7);
  }

  if (
    !record.yearKey &&
    record.dateKey
  ) {
    record.yearKey =
      String(
        record.dateKey
      ).slice(0, 4);
  }

  return record;
}

/* =========================================================
   Records
========================================================= */

async function getAllRecordKeys() {
  let cursor = "0";

  const keys = [];

  do {
    const result =
      await redisScan(
        cursor,
        `${RECORD_PREFIX}*`,
        200
      );

    if (
      !Array.isArray(result)
    ) {
      break;
    }

    cursor =
      String(
        result[0] ?? "0"
      );

    const batch =
      Array.isArray(result[1])
        ? result[1]
        : [];

    for (
      const key of batch
    ) {
      keys.push(
        String(key)
      );
    }
  } while (
    cursor !== "0"
  );

  return keys;
}

async function getRecord(key) {
  const type =
    await redisType(key);

  if (type === "hash") {
    const raw =
      await redisHGetAll(key);

    return normalizeRecord(
      key,
      hashArrayToObject(raw)
    );
  }

  if (type === "string") {
    const value =
      await redisGet(key);

    if (!value) {
      return null;
    }

    try {
      const parsed =
        JSON.parse(value);

      if (
        parsed &&
        typeof parsed === "object"
      ) {
        return normalizeRecord(
          key,
          parsed
        );
      }

      return null;
    } catch {
      return null;
    }
  }

  return null;
}

async function getAllRecords() {
  const keys =
    await getAllRecordKeys();

  const records = [];

  for (
    const key of keys
  ) {
    try {
      const record =
        await getRecord(key);

      if (record) {
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

/* =========================================================
   Create record
========================================================= */

async function createSalesRecord(
  chatId,
  sales,
  orders,
  dateKey
) {
  const now =
    Date.now();

  const recordId =
    `${now}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const key =
    makeRecordKey(
      chatId,
      recordId
    );

  const parsedDate =
    parseDateKey(dateKey);

  if (!parsedDate) {
    throw new Error(
      "Invalid date"
    );
  }

  const record = {
    id: recordId,
    recordId,

    chatId:
      String(chatId),

    sales:
      String(sales),

    orders:
      String(orders),

    cancelled: "0",
    status: "active",

    /*
     * createdAtは登録した時刻。
     */
    createdAt:
      String(now),

    /*
     * 集計日は指定した配達日。
     */
    dateKey,

    monthKey:
      `${parsedDate.year}-${String(
        parsedDate.month
      ).padStart(2, "0")}`,

    yearKey:
      String(
        parsedDate.year
      ),
  };

  await redisCommand(
    "HSET",
    key,
    "id",
    record.id,
    "recordId",
    record.recordId,
    "chatId",
    record.chatId,
    "sales",
    record.sales,
    "orders",
    record.orders,
    "cancelled",
    record.cancelled,
    "status",
    record.status,
    "createdAt",
    record.createdAt,
    "dateKey",
    record.dateKey,
    "monthKey",
    record.monthKey,
    "yearKey",
    record.yearKey
  );

  return normalizeRecord(
    key,
    record
  );
}

/* =========================================================
   Calculate statistics
========================================================= */

function calculateStats(
  records,
  chatId,
  now
) {
  const targetChatId =
    String(chatId);

  const ownRecords =
    records.filter(
      (record) =>
        String(
          record.chatId ?? ""
        ) === targetChatId
    );

  const activeRecords =
    ownRecords.filter(
      (record) =>
        !isCancelled(record)
    );

  const todayKey =
    dateKeyFromTimestamp(
      now
    );

  const monthKey =
    monthKeyFromTimestamp(
      now
    );

  const yearKey =
    yearKeyFromTimestamp(
      now
    );

  const todayRecords =
    activeRecords.filter(
      (record) =>
        String(
          record.dateKey ?? ""
        ) === todayKey
    );

  const monthRecords =
    activeRecords.filter(
      (record) =>
        String(
          record.monthKey ?? ""
        ) === monthKey
    );

  const yearRecords =
    activeRecords.filter(
      (record) =>
        String(
          record.yearKey ?? ""
        ) === yearKey
    );

  const todaySales =
    todayRecords.reduce(
      (sum, record) =>
        sum + record.sales,
      0
    );

  const todayOrders =
    todayRecords.reduce(
      (sum, record) =>
        sum + record.orders,
      0
    );

  const monthSales =
    monthRecords.reduce(
      (sum, record) =>
        sum + record.sales,
      0
    );

  const monthOrders =
    monthRecords.reduce(
      (sum, record) =>
        sum + record.orders,
      0
    );

  const yearSales =
    yearRecords.reduce(
      (sum, record) =>
        sum + record.sales,
      0
    );

  const yearOrders =
    yearRecords.reduce(
      (sum, record) =>
        sum + record.orders,
      0
    );

  const dailyMap = {};

  for (
    const record of monthRecords
  ) {
    const dateKey =
      record.dateKey;

    if (!dateKey) {
      continue;
    }

    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = {
        sales: 0,
        orders: 0,
      };
    }

    dailyMap[dateKey].sales +=
      record.sales;

    dailyMap[dateKey].orders +=
      record.orders;
  }

  const workingDays =
    Object.keys(
      dailyMap
    ).length;

  let monthlyHighestSales = 0;
  let monthlyHighestOrders = 0;

  for (
    const day of Object.values(
      dailyMap
    )
  ) {
    if (
      day.sales >
      monthlyHighestSales
    ) {
      monthlyHighestSales =
        day.sales;
    }

    if (
      day.orders >
      monthlyHighestOrders
    ) {
      monthlyHighestOrders =
        day.orders;
    }
  }

  const averagePerOrder =
    monthOrders > 0
      ? Math.round(
          monthSales /
            monthOrders
        )
      : 0;

  const averagePerDay =
    workingDays > 0
      ? Math.round(
          monthSales /
            workingDays
        )
      : 0;

  const achievementRate =
    Math.floor(
      (monthSales / 500000) *
        100
    );

  return {
    todaySales,
    todayOrders,

    monthSales,
    monthOrders,

    yearSales,
    yearOrders,

    averagePerOrder,
    averagePerDay,

    achievementRate,

    monthlyHighestSales,
    monthlyHighestOrders,

    workingDays,

    cumulativeOrders:
      yearOrders,
  };
}

/* =========================================================
   Fixed sales template
========================================================= */

function buildSalesCaption(
  stats,
  now
) {
  return `🏍️ 配達売上
💰 今日の売上　${stats.todaySales.toLocaleString("ja-JP")}円
📦 今日の件数　${stats.todayOrders.toLocaleString("ja-JP")}件
💵 1件あたり　${stats.averagePerOrder.toLocaleString("ja-JP")}円
📅 今月売上　${stats.monthSales.toLocaleString("ja-JP")}円
📦 今月件数　${stats.monthOrders.toLocaleString("ja-JP")}件
🗓️ 年間売上　${stats.yearSales.toLocaleString("ja-JP")}円
📦 年間件数　${stats.yearOrders.toLocaleString("ja-JP")}件
📈 平均売上／日　${stats.averagePerDay.toLocaleString("ja-JP")}円
🎯 月間目標　500,000円
📊 目標達成率　${stats.achievementRate.toLocaleString("ja-JP")}%
🏆 月間最高売上　${stats.monthlyHighestSales.toLocaleString("ja-JP")}円
🏆 月間最高件数　${stats.monthlyHighestOrders.toLocaleString("ja-JP")}件
📆 稼働日数　${stats.workingDays.toLocaleString("ja-JP")}日
🛵 累計配達件数　${stats.cumulativeOrders.toLocaleString("ja-JP")}件
🕐 ${formatJstDate(now)}
🛵 今日も配達お疲れ様でした！`;
}

/* =========================================================
   Calendar
========================================================= */

async function showCalendar(
  chatId,
  messageId = null,
  year = null,
  month = null
) {
  const now =
    jstParts(Date.now());

  const targetYear =
    year ??
    Number(now.year);

  const targetMonth =
    month ??
    Number(now.month);

  const keyboard =
    buildCalendarKeyboard(
      targetYear,
      targetMonth
    );

  const text =
    "📅 配達日を選択してください\n\n" +
    "過去の日付も選択できます。";

  if (messageId) {
    await editMessageText(
      chatId,
      messageId,
      text,
      keyboard
    );
  } else {
    await sendMessage(
      chatId,
      text,
      {
        reply_markup:
          keyboard,
      }
    );
  }
}

/* =========================================================
   Pending date
========================================================= */

function pendingDateKey(
  chatId
) {
  return `moheji:delivery:pending:${chatId}`;
}

async function setPendingDate(
  chatId,
  dateKey
) {
  await redisSet(
    pendingDateKey(chatId),
    dateKey
  );
}

async function getPendingDate(
  chatId
) {
  return redisGet(
    pendingDateKey(chatId)
  );
}

async function clearPendingDate(
  chatId
) {
  await redisDel(
    pendingDateKey(chatId)
  );
}

/* =========================================================
   /sales
========================================================= */

async function handleSales(
  chatId,
  args
) {
  /*
   * /sales
   *
   * カレンダーを表示
   */
  if (
    args.length === 0
  ) {
    await showCalendar(
      chatId
    );

    return;
  }

  /*
   * /sales 17014 17
   *
   * 今日として登録
   */
  if (
    args.length === 2
  ) {
    const sales =
      numberValue(
        String(args[0]).replace(
          /,/g,
          ""
        )
      );

    const orders =
      numberValue(
        String(args[1]).replace(
          /,/g,
          ""
        )
      );

    if (
      sales <= 0 ||
      orders <= 0
    ) {
      await sendMessage(
        chatId,
        "⚠️ 売上と件数は1以上の数字で入力してください。\n\n例：\n/sales 17014 17"
      );

      return;
    }

    const now =
      Date.now();

    const todayKey =
      dateKeyFromTimestamp(
        now
      );

    await createSalesRecord(
      chatId,
      sales,
      orders,
      todayKey
    );

    await clearPendingDate(
      chatId
    );

    /*
     * 登録後に必ず再取得。
     */
    const records =
      await getAllRecords();

    const stats =
      calculateStats(
        records,
        chatId,
        now
      );

    await sendPhoto(
      chatId,
      SALES_IMAGE,
      buildSalesCaption(
        stats,
        now
      )
    );

    return;
  }

  /*
   * それ以外
   */
  await sendMessage(
    chatId,
    "⚠️ 入力形式が違います。\n\n今日の実績：\n/sales 17014 17\n\n過去の実績：\n/sales\n→ カレンダーから日付を選択"
  );
}

/* =========================================================
   Calendar callback
========================================================= */

async function handleCallbackQuery(
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
    message.chat?.id;

  const messageId =
    message.message_id;

  if (!chatId) {
    await answerCallbackQuery(
      callbackId
    );

    return;
  }

  /*
   * 無効ボタン
   */
  if (
    data === "cal:none"
  ) {
    await answerCallbackQuery(
      callbackId
    );

    return;
  }

  /*
   * 月移動
   */
  if (
    data.startsWith("cal:")
  ) {
    const value =
      data.slice(4);

    const parsed =
      parseDateKey(value);

    if (!parsed) {
      await answerCallbackQuery(
        callbackId
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
   * 日付選択
   */
  if (
    data.startsWith("date:")
  ) {
    const dateKey =
      data.slice(5);

    const parsed =
      parseDateKey(dateKey);

    if (!parsed) {
      await answerCallbackQuery(
        callbackId
      );

      return;
    }

    await setPendingDate(
      chatId,
      dateKey
    );

    await answerCallbackQuery(
      callbackId
    );

    await editMessageText(
      chatId,
      messageId,
      `📅 ${formatDateKeyJapanese(dateKey)}を選択しました。\n\n売上と件数を入力してください。\n\n例：\n17014 17`
    );

    return;
  }

  await answerCallbackQuery(
    callbackId
  );
}

/* =========================================================
   Pending sales input
========================================================= */

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

  const parts =
    String(text)
      .trim()
      .split(/\s+/);

  if (
    parts.length !== 2
  ) {
    await sendMessage(
      chatId,
      `⚠️ 入力形式が違います。\n\n📅 ${formatDateKeyJapanese(dateKey)}\n\n例：\n17014 17`
    );

    return true;
  }

  const sales =
    numberValue(
      String(parts[0]).replace(
        /,/g,
        ""
      )
    );

  const orders =
    numberValue(
      String(parts[1]).replace(
        /,/g,
        ""
      )
    );

  if (
    sales <= 0 ||
    orders <= 0
  ) {
    await sendMessage(
      chatId,
      "⚠️ 売上と件数は1以上の数字で入力してください。"
    );

    return true;
  }

  await createSalesRecord(
    chatId,
    sales,
    orders,
    dateKey
  );

  await clearPendingDate(
    chatId
  );

  /*
   * 登録後に最新データを再取得
   */
  const records =
    await getAllRecords();

  const now =
    Date.now();

  const stats =
    calculateStats(
      records,
      chatId,
      now
    );

  await sendMessage(
    chatId,
    `✅ 実績を登録しました。\n\n📅 ${formatDateKeyJapanese(dateKey)}\n💰 ${sales.toLocaleString("ja-JP")}円\n📦 ${orders.toLocaleString("ja-JP")}件`
  );

  await sendPhoto(
    chatId,
    SALES_IMAGE,
    buildSalesCaption(
      stats,
      now
    )
  );

  return true;
}

/* =========================================================
   /cancel
========================================================= */

async function cancelRecord(
  record
) {
  const key =
    record.key;

  const type =
    await redisType(key);

  if (
    type === "hash"
  ) {
    await redisHSet(
      key,
      "cancelled",
      "1",
      "status",
      "cancelled"
    );

    return;
  }

  if (
    type === "string"
  ) {
    const value =
      await redisGet(key);

    if (!value) {
      throw new Error(
        "Record not found"
      );
    }

    let parsed;

    try {
      parsed =
        JSON.parse(value);
    } catch {
      throw new Error(
        "Invalid record JSON"
      );
    }

    parsed.cancelled = true;
    parsed.status =
      "cancelled";

    await redisSet(
      key,
      JSON.stringify(parsed)
    );

    return;
  }

  throw new Error(
    "Unsupported record type"
  );
}

async function handleCancel(
  chatId
) {
  const records =
    await getAllRecords();

  const candidates =
    records
      .filter(
        (record) =>
          String(
            record.chatId ?? ""
          ) === String(chatId)
      )
      .filter(
        (record) =>
          !isCancelled(record)
      )
      .sort(
        (a, b) =>
          (b.timestamp || 0) -
          (a.timestamp || 0)
      );

  if (
    candidates.length === 0
  ) {
    await sendMessage(
      chatId,
      "⚠️ 取消できる実績がありません。"
    );

    return;
  }

  const target =
    candidates[0];

  await cancelRecord(
    target
  );

  const dateText =
    target.dateKey
      ? formatDateKeyJapanese(
          target.dateKey
        )
      : "日付不明";

  await sendMessage(
    chatId,
    `↩️ 配達実績を取消しました。\n\n📅 ${dateText}\n💰 売上　${target.sales.toLocaleString("ja-JP")}円\n📦 件数　${target.orders.toLocaleString("ja-JP") }件`
  );
}

/* =========================================================
   /reset
========================================================= */

async function handleReset(
  chatId
) {
  const records =
    await getAllRecords();

  const ownRecords =
    records.filter(
      (record) =>
        String(
          record.chatId ?? ""
        ) === String(chatId)
    );

  let deleted = 0;

  for (
    const record of ownRecords
  ) {
    try {
      await redisDel(
        record.key
      );

      deleted++;
    } catch (error) {
      console.error(
        "Failed to delete:",
        record.key,
        error
      );
    }
  }

  await clearPendingDate(
    chatId
  );

  await sendMessage(
    chatId,
    `🗑️ 実績を初期化しました。\n\n削除件数　${deleted.toLocaleString("ja-JP")}件\n\nこれで自分の実績は0から再スタートです。`
  );
}

/* =========================================================
   Command parser
========================================================= */

function parseCommand(text) {
  const trimmed =
    String(text || "")
      .trim();

  if (!trimmed) {
    return {
      command: "",
      args: [],
    };
  }

  const parts =
    trimmed.split(/\s+/);

  const command =
    String(parts[0])
      .split("@")[0]
      .toLowerCase();

  return {
    command,
    args: parts.slice(1),
  };
}

/* =========================================================
   Main handler
========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST"
  ) {
    return res.status(200).json({
      ok: true,
    });
  }

  try {
    assertEnv();

    const update =
      req.body;

    /*
     * Telegram callback
     */
    if (
      update?.callback_query
    ) {
      await handleCallbackQuery(
        update.callback_query
      );

      return res.status(200).json({
        ok: true,
      });
    }

    const message =
      update?.message;

    if (!message) {
      return res.status(200).json({
        ok: true,
      });
    }

    const chatId =
      message.chat?.id;

    if (!chatId) {
      return res.status(200).json({
        ok: true,
      });
    }

    const text =
      message.text || "";

    /*
     * コマンド
     */
    if (
      text.startsWith("/")
    ) {
      const {
        command,
        args,
      } = parseCommand(text);

      if (
        command === "/sales"
      ) {
        await handleSales(
          chatId,
          args
        );
      }

      else if (
        command === "/cancel"
      ) {
        await handleCancel(
          chatId
        );
      }

      else if (
        command === "/reset"
      ) {
        await handleReset(
          chatId
        );
      }

      /*
       * /record は存在しない
       */

      return res.status(200).json({
        ok: true,
      });
    }

    /*
     * カレンダーで日付を選んだ後の
     *
     * 17014 17
     *
     * を処理
     */
    const handled =
      await handlePendingSalesInput(
        chatId,
        text
      );

    if (handled) {
      return res.status(200).json({
        ok: true,
      });
    }

    return res.status(200).json({
      ok: true,
    });
  }

  catch (error) {
    console.error(
      "Telegram handler error:",
      error
    );

    try {
      const chatId =
        req.body?.message?.chat?.id;

      if (chatId) {
        await sendMessage(
          chatId,
          "⚠️ エラーが発生しました。\nしばらくしてからもう一度お試しください。"
        );
      }
    } catch (telegramError) {
      console.error(
        "Failed to send error:",
        telegramError
      );
    }

    return res.status(200).json({
      ok: true,
    });
  }
}
