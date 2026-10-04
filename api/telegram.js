const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const RECORD_PREFIX = "moheji:delivery:record:";

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

/* =========================
   Redis REST
========================= */

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
    throw new Error(`Redis HTTP ${response.status}: ${text}`);
  }

  const data = await response.json();

  if (data && data.error) {
    throw new Error(`Redis error: ${data.error}`);
  }

  return data ? data.result : null;
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

async function redisHSet(key, field, value) {
  return redisCommand("HSET", key, field, value);
}

async function redisScan(cursor, pattern, count = 100) {
  return redisCommand(
    "SCAN",
    cursor,
    "MATCH",
    pattern,
    "COUNT",
    String(count)
  );
}

/* =========================
   Telegram
========================= */

async function telegram(method, body) {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram ${method} ${response.status}: ${text}`);
  }

  return response.json();
}

async function sendMessage(chatId, text) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
  });
}

async function sendPhoto(chatId, photo, caption) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
  });
}

/* =========================
   Utility
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

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isCancelled(record) {
  const cancelled = String(record.cancelled ?? "").toLowerCase();
  const status = String(record.status ?? "").toLowerCase();

  return (
    cancelled === "1" ||
    cancelled === "true" ||
    cancelled === "yes" ||
    status === "cancelled"
  );
}

function getRecordId(record, key) {
  if (record.recordId) {
    return String(record.recordId);
  }

  if (record.id) {
    return String(record.id);
  }

  const parts = String(key).split(":");

  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function getChatIdFromKey(key) {
  const prefix = RECORD_PREFIX;

  if (!String(key).startsWith(prefix)) {
    return "";
  }

  const rest = String(key).slice(prefix.length);

  const separator = rest.indexOf(":");

  if (separator === -1) {
    return "";
  }

  return rest.slice(0, separator);
}

/* =========================
   JST
========================= */

function jstParts(timestamp) {
  const date = new Date(timestamp);

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  return result;
}

function dateKeyFromTimestamp(timestamp) {
  const p = jstParts(timestamp);

  return `${p.year}-${p.month}-${p.day}`;
}

function monthKeyFromTimestamp(timestamp) {
  const p = jstParts(timestamp);

  return `${p.year}-${p.month}`;
}

function yearKeyFromTimestamp(timestamp) {
  const p = jstParts(timestamp);

  return p.year;
}

function formatJstDate(timestamp) {
  const p = jstParts(timestamp);

  return `${p.year}年${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}

/* =========================
   Record normalization
========================= */

function normalizeRecord(key, raw) {
  const record = {
    ...raw,
  };

  const keyChatId = getChatIdFromKey(key);

  if (!record.chatId && keyChatId) {
    record.chatId = keyChatId;
  }

  record.key = key;

  record.recordId = getRecordId(record, key);

  record.sales = numberValue(
    record.sales ??
      record.amount ??
      record.totalSales ??
      record.total ??
      0
  );

  record.orders = numberValue(
    record.orders ??
      record.count ??
      record.quantity ??
      record.deliveryCount ??
      0
  );

  record.createdAt =
    record.createdAt ??
    record.timestamp ??
    record.created_at ??
    "";

  record.timestamp = parseTimestamp(record.createdAt);

  if (!record.timestamp && record.date) {
    const parsedDate = Date.parse(String(record.date));

    if (Number.isFinite(parsedDate)) {
      record.timestamp = parsedDate;
    }
  }

  if (!record.dateKey && record.timestamp) {
    record.dateKey = dateKeyFromTimestamp(record.timestamp);
  }

  if (!record.monthKey && record.timestamp) {
    record.monthKey = monthKeyFromTimestamp(record.timestamp);
  }

  if (!record.yearKey && record.timestamp) {
    record.yearKey = yearKeyFromTimestamp(record.timestamp);
  }

  return record;
}

/* =========================
   Record loading
========================= */

async function getAllRecordKeys() {
  let cursor = "0";
  const keys = [];

  do {
    const result = await redisScan(cursor, `${RECORD_PREFIX}*`, 200);

    if (!Array.isArray(result)) {
      break;
    }

    cursor = String(result[0] ?? "0");

    const batch = Array.isArray(result[1]) ? result[1] : [];

    for (const key of batch) {
      keys.push(String(key));
    }
  } while (cursor !== "0");

  return keys;
}

async function getRecord(key) {
  const type = await redisType(key);

  if (type === "hash") {
    const hash = await redisHGetAll(key);
    return normalizeRecord(key, hashArrayToObject(hash));
  }

  if (type === "string") {
    const value = await redisGet(key);

    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value);

      if (parsed && typeof parsed === "object") {
        return normalizeRecord(key, parsed);
      }

      return null;
    } catch {
      return null;
    }
  }

  return null;
}

async function getAllRecords() {
  const keys = await getAllRecordKeys();

  const records = [];

  for (const key of keys) {
    try {
      const record = await getRecord(key);

      if (record) {
        records.push(record);
      }
    } catch (error) {
      console.error("Failed to read record:", key, error);
    }
  }

  return records;
}

/* =========================
   Sales calculation
========================= */

function calculateStats(records, chatId, now) {
  const targetChatId = String(chatId);

  const ownRecords = records.filter(
    (record) =>
      String(record.chatId ?? "") === targetChatId
  );

  const activeRecords = ownRecords.filter(
    (record) => !isCancelled(record)
  );

  const todayKey = dateKeyFromTimestamp(now);
  const monthKey = monthKeyFromTimestamp(now);
  const yearKey = yearKeyFromTimestamp(now);

  const todayRecords = activeRecords.filter(
    (record) => String(record.dateKey ?? "") === todayKey
  );

  const monthRecords = activeRecords.filter(
    (record) => String(record.monthKey ?? "") === monthKey
  );

  const yearRecords = activeRecords.filter(
    (record) => String(record.yearKey ?? "") === yearKey
  );

  const todaySales = todayRecords.reduce(
    (sum, record) => sum + record.sales,
    0
  );

  const todayOrders = todayRecords.reduce(
    (sum, record) => sum + record.orders,
    0
  );

  const monthSales = monthRecords.reduce(
    (sum, record) => sum + record.sales,
    0
  );

  const monthOrders = monthRecords.reduce(
    (sum, record) => sum + record.orders,
    0
  );

  const yearSales = yearRecords.reduce(
    (sum, record) => sum + record.sales,
    0
  );

  const yearOrders = yearRecords.reduce(
    (sum, record) => sum + record.orders,
    0
  );

  const dailyMap = {};

  for (const record of monthRecords) {
    const dateKey =
      record.dateKey ||
      (record.timestamp
        ? dateKeyFromTimestamp(record.timestamp)
        : "");

    if (!dateKey) {
      continue;
    }

    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = {
        sales: 0,
        orders: 0,
      };
    }

    dailyMap[dateKey].sales += record.sales;
    dailyMap[dateKey].orders += record.orders;
  }

  const workingDays = Object.keys(dailyMap).length;

  let monthlyHighestSales = 0;
  let monthlyHighestOrders = 0;

  for (const day of Object.values(dailyMap)) {
    if (day.sales > monthlyHighestSales) {
      monthlyHighestSales = day.sales;
    }

    if (day.orders > monthlyHighestOrders) {
      monthlyHighestOrders = day.orders;
    }
  }

  const averagePerOrder =
    monthOrders > 0
      ? Math.round(monthSales / monthOrders)
      : 0;

  const averagePerDay =
    workingDays > 0
      ? Math.round(monthSales / workingDays)
      : 0;

  const achievementRate = Math.floor(
    (monthSales / 500000) * 100
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
    cumulativeOrders: yearOrders,
  };
}

/* =========================
   /sales
========================= */

async function handleSales(chatId) {
  const records = await getAllRecords();

  const now = Date.now();

  const stats = calculateStats(records, chatId, now);

  const caption =
`🏍️ 配達売上
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

  await sendPhoto(
    chatId,
    "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png",
    caption
  );
}

/* =========================
   /cancel
========================= */

async function cancelRecord(record) {
  const key = record.key;

  const type = await redisType(key);

  if (type === "hash") {
    await redisHSet(key, "cancelled", "1");
    await redisHSet(key, "status", "cancelled");
    return;
  }

  if (type === "string") {
    const value = await redisGet(key);

    if (!value) {
      throw new Error("Record not found");
    }

    let parsed;

    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Invalid record JSON");
    }

    parsed.cancelled = true;
    parsed.status = "cancelled";

    await redisSet(key, JSON.stringify(parsed));
    return;
  }

  throw new Error("Unsupported record type");
}

async function handleCancel(chatId) {
  const records = await getAllRecords();

  const candidates = records
    .filter(
      (record) =>
        String(record.chatId ?? "") === String(chatId)
    )
    .filter((record) => !isCancelled(record))
    .sort((a, b) => {
      return (
        (b.timestamp || 0) -
        (a.timestamp || 0)
      );
    });

  if (candidates.length === 0) {
    await sendMessage(
      chatId,
      "⚠️ 取消できる実績がありません。"
    );

    return;
  }

  const target = candidates[0];

  await cancelRecord(target);

  await sendMessage(
    chatId,
    `↩️ 最新の配達実績を取消しました。\n💰 ${target.sales.toLocaleString("ja-JP")}円\n📦 ${target.orders.toLocaleString("ja-JP")}件`
  );
}

/* =========================
   /reset
========================= */

async function handleReset(chatId) {
  const records = await getAllRecords();

  const ownRecords = records.filter(
    (record) =>
      String(record.chatId ?? "") === String(chatId)
  );

  let deleted = 0;

  for (const record of ownRecords) {
    try {
      await redisDel(record.key);
      deleted++;
    } catch (error) {
      console.error(
        "Failed to delete record:",
        record.key,
        error
      );
    }
  }

  await sendMessage(
    chatId,
    `🗑️ 実績を初期化しました。\n\n削除件数　${deleted.toLocaleString("ja-JP")}件\n\nこれで自分の実績は0から再スタートです。`
  );
}

/* =========================
   Command parser
========================= */

function getCommand(text) {
  if (!text) {
    return "";
  }

  const firstLine = String(text)
    .trim()
    .split(/\s+/)[0];

  const command = firstLine
    .split("@")[0]
    .toLowerCase();

  return command;
}

/* =========================
   Main handler
========================= */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
    });
  }

  try {
    assertEnv();

    const update = req.body;

    const message = update?.message;

    if (!message) {
      return res.status(200).json({
        ok: true,
      });
    }

    const chatId = message.chat?.id;

    if (!chatId) {
      return res.status(200).json({
        ok: true,
      });
    }

    const text = message.text || "";

    const command = getCommand(text);

    if (command === "/sales") {
      await handleSales(chatId);
    } else if (command === "/cancel") {
      await handleCancel(chatId);
    } else if (command === "/reset") {
      await handleReset(chatId);
    }

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error("Telegram handler error:", error);

    try {
      const chatId = req.body?.message?.chat?.id;

      if (chatId) {
        await sendMessage(
          chatId,
          "⚠️ エラーが発生しました。\nしばらくしてからもう一度お試しください。"
        );
      }
    } catch (telegramError) {
      console.error(
        "Failed to send error message:",
        telegramError
      );
    }

    return res.status(200).json({
      ok: true,
    });
  }
}
