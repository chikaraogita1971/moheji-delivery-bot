const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const DEBUG_KEY = process.env.DEBUG_KEY;

const IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTHLY_GOAL = 500000;

// ============================================================
// Redis
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

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
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

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

// ============================================================
// Redis HGETALL normalization
// ============================================================

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

    if (field !== undefined && field !== null) {
      result[String(field)] =
        fieldValue === undefined || fieldValue === null
          ? ""
          : String(fieldValue);
    }
  }

  return result;
}

async function redisHash(key) {
  const raw = await redis("HGETALL", key);
  return hashArrayToObject(raw);
}

// ============================================================
// Utility
// ============================================================

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function isCancelledRecord(record) {
  return (
    record.cancelled === true ||
    record.cancelled === 1 ||
    record.cancelled === "1" ||
    record.status === "cancelled"
  );
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const text = String(value);

  if (/^\d+$/.test(text)) {
    const n = Number(text);

    if (n > 0) {
      return n < 1000000000000 ? n * 1000 : n;
    }
  }

  const parsed = Date.parse(text);

  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value) {
  return toInt(value).toLocaleString("ja-JP");
}

function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function getMonthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");

  return `${y}-${m}`;
}

function getYearKey(date = new Date()) {
  return String(date.getFullYear());
}

function monthFromDateKey(dateKey) {
  if (!dateKey || typeof dateKey !== "string") {
    return "";
  }

  return dateKey.slice(0, 7);
}

function yearFromDateKey(dateKey) {
  if (!dateKey || typeof dateKey !== "string") {
    return "";
  }

  return dateKey.slice(0, 4);
}

// ============================================================
// Scan
// ============================================================

async function scanKeys(match) {
  const keys = [];
  let cursor = "0";

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      match,
      "COUNT",
      "200"
    );

    cursor = String(result?.[0] ?? "0");

    const batch = Array.isArray(result?.[1]) ? result[1] : [];

    keys.push(...batch);
  } while (cursor !== "0");

  return keys;
}

// ============================================================
// Record normalization
// ============================================================

function getRecordIdFromKey(key) {
  const parts = String(key).split(":");
  return parts[parts.length - 1] || "";
}

function getChatIdFromKey(key) {
  const match = String(key).match(
    /^moheji:delivery:record:(-?\d+):/
  );

  return match ? match[1] : "";
}

function normalizeRecord(raw, key) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const recordId =
    raw.recordId ||
    raw.id ||
    getRecordIdFromKey(key);

  const dateKey = raw.dateKey || "";

  const chatId =
    raw.chatId !== undefined && raw.chatId !== null
      ? String(raw.chatId)
      : getChatIdFromKey(key);

  const sales = toInt(
    raw.sales ??
    raw.amount ??
    raw.totalSales
  );

  const orders = toInt(
    raw.orders ??
    raw.count ??
    raw.totalOrders
  );

  const cancelled = isCancelledRecord(raw);

  const monthKey =
    raw.monthKey ||
    monthFromDateKey(dateKey);

  const yearKey =
    raw.yearKey ||
    yearFromDateKey(dateKey);

  return {
    key,
    recordId: String(recordId),
    chatId,
    dateKey,
    monthKey,
    yearKey,
    sales,
    orders,
    cancelled,
    createdAt: raw.createdAt ?? "",
    cancelledAt: raw.cancelledAt ?? "",
    status: cancelled ? "cancelled" : "active",
    raw,
  };
}

// ============================================================
// Read one record
// ============================================================

async function readRecordKey(key) {
  try {
    const type = await redis("TYPE", key);

    if (type === "string") {
      const value = await redis("GET", key);

      if (!value) {
        return null;
      }

      try {
        const parsed =
          typeof value === "string"
            ? JSON.parse(value)
            : value;

        return normalizeRecord(parsed, key);
      } catch {
        return null;
      }
    }

    if (type === "hash") {
      const hash = await redisHash(key);

      if (!Object.keys(hash).length) {
        return null;
      }

      return normalizeRecord(hash, key);
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// Read all individual records
// ============================================================

async function getAllRecordHistory() {
  const keys = await scanKeys("moheji:delivery:record:*");

  const records = [];

  for (const key of keys) {
    const record = await readRecordKey(key);

    if (record) {
      records.push(record);
    }
  }

  records.sort(
    (a, b) =>
      parseTimestamp(b.createdAt) -
      parseTimestamp(a.createdAt)
  );

  return records;
}

// ============================================================
// Read records for chat
// ============================================================

async function getRecordHistory(chatId) {
  const all = await getAllRecordHistory();

  const target = String(chatId);

  return all.filter(
    (record) => String(record.chatId) === target
  );
}

// ============================================================
// Daily / monthly working days
// ============================================================

async function getWorkingDays(monthKey) {
  const keys = await scanKeys(
    `moheji:delivery:daily:${monthKey}-*`
  );

  let count = 0;

  for (const key of keys) {
    const data = await redisHash(key);

    const sales = toInt(data.sales);
    const orders = toInt(data.orders);

    if (sales > 0 || orders > 0) {
      count++;
    }
  }

  return count;
}

// ============================================================
// Recalculate best sales from active records
// ============================================================

async function recalculateDailyBestFromRecords(
  chatId,
  dateKey
) {
  const records = await getRecordHistory(chatId);

  const active = records.filter(
    (r) =>
      r.dateKey === dateKey &&
      !r.cancelled
  );

  const bestSales = active.reduce(
    (max, r) => Math.max(max, r.sales),
    0
  );

  const bestOrders = active.reduce(
    (max, r) => Math.max(max, r.orders),
    0
  );

  await redis(
    "HSET",
    `moheji:delivery:daily:${dateKey}`,
    "bestSales",
    bestSales,
    "bestOrders",
    bestOrders
  );
}

async function recalculateMonthlyBestFromRecords(
  chatId,
  monthKey
) {
  const records = await getRecordHistory(chatId);

  const active = records.filter(
    (r) =>
      r.monthKey === monthKey &&
      !r.cancelled
  );

  const bestSales = active.reduce(
    (max, r) => Math.max(max, r.sales),
    0
  );

  const bestOrders = active.reduce(
    (max, r) => Math.max(max, r.orders),
    0
  );

  await redis(
    "HSET",
    `moheji:delivery:month:${monthKey}`,
    "bestSales",
    bestSales,
    "bestOrders",
    bestOrders
  );
}

// ============================================================
// Process /sales
// ============================================================

async function processSales(chatId, sales, orders) {
  const now = new Date();

  const dateKey = getDateKey(now);
  const monthKey = getMonthKey(now);
  const yearKey = getYearKey(now);

  const recordId =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

  const recordKey =
    `moheji:delivery:record:${chatId}:${recordId}`;

  const record = {
    id: recordId,
    recordId,
    chatId: String(chatId),
    dateKey,
    monthKey,
    yearKey,
    sales,
    orders,
    cancelled: false,
    status: "active",
    createdAt: now.toISOString(),
  };

  const commands = [
    [
      "HINCRBY",
      `moheji:delivery:daily:${dateKey}`,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      `moheji:delivery:daily:${dateKey}`,
      "orders",
      orders,
    ],
    [
      "HINCRBY",
      `moheji:delivery:month:${monthKey}`,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      `moheji:delivery:month:${monthKey}`,
      "orders",
      orders,
    ],
    [
      "HINCRBY",
      `moheji:delivery:year:${yearKey}`,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      `moheji:delivery:year:${yearKey}`,
      "orders",
      orders,
    ],
    [
      "HINCRBY",
      "moheji:delivery:alltime",
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      "moheji:delivery:alltime",
      "orders",
      orders,
    ],
    [
      "SET",
      recordKey,
      JSON.stringify(record),
    ],
    [
      "ZADD",
      `moheji:delivery:records:${chatId}`,
      Date.now(),
      recordId,
    ],
  ];

  await redisMulti(commands);

  await recalculateDailyBestFromRecords(
    chatId,
    dateKey
  );

  await recalculateMonthlyBestFromRecords(
    chatId,
    monthKey
  );

  return record;
}

// ============================================================
// Cancel latest active sale
// ============================================================

async function cancelLatestSale(chatId) {
  const records = await getRecordHistory(chatId);

  const active = records
    .filter((r) => !r.cancelled)
    .sort(
      (a, b) =>
        parseTimestamp(b.createdAt) -
        parseTimestamp(a.createdAt)
    );

  if (!active.length) {
    return {
      ok: false,
      message: "キャンセルできる売上がありません。",
    };
  }

  const target = active[0];

  const dateKey = target.dateKey;
  const monthKey =
    target.monthKey ||
    monthFromDateKey(dateKey);

  const yearKey =
    target.yearKey ||
    yearFromDateKey(dateKey);

  const now = new Date();

  const updatedRaw = {
    ...target.raw,
    cancelled: true,
    status: "cancelled",
    cancelledAt: now.toISOString(),
  };

  const commands = [
    [
      "HINCRBY",
      `moheji:delivery:daily:${dateKey}`,
      "sales",
      -target.sales,
    ],
    [
      "HINCRBY",
      `moheji:delivery:daily:${dateKey}`,
      "orders",
      -target.orders,
    ],
    [
      "HINCRBY",
      `moheji:delivery:month:${monthKey}`,
      "sales",
      -target.sales,
    ],
    [
      "HINCRBY",
      `moheji:delivery:month:${monthKey}`,
      "orders",
      -target.orders,
    ],
    [
      "HINCRBY",
      `moheji:delivery:year:${yearKey}`,
      "sales",
      -target.sales,
    ],
    [
      "HINCRBY",
      `moheji:delivery:year:${yearKey}`,
      "orders",
      -target.orders,
    ],
    [
      "HINCRBY",
      "moheji:delivery:alltime",
      "sales",
      -target.sales,
    ],
    [
      "HINCRBY",
      "moheji:delivery:alltime",
      "orders",
      -target.orders,
    ],
  ];

  if (
    target.raw &&
    typeof target.raw === "object" &&
    !Array.isArray(target.raw)
  ) {
    const fields = Object.entries(updatedRaw);

    const hsetArgs = [
      "HSET",
      target.key,
    ];

    for (const [field, value] of fields) {
      hsetArgs.push(field, value);
    }

    commands.push(hsetArgs);
  } else {
    commands.push([
      "SET",
      target.key,
      JSON.stringify(updatedRaw),
    ]);
  }

  await redisMulti(commands);

  await recalculateDailyBestFromRecords(
    chatId,
    dateKey
  );

  await recalculateMonthlyBestFromRecords(
    chatId,
    monthKey
  );

  return {
    ok: true,
    record: {
      ...target,
      cancelled: true,
      status: "cancelled",
    },
  };
}

// ============================================================
// Sales report
// ============================================================

async function buildSalesReport(chatId) {
  const now = new Date();

  const dateKey = getDateKey(now);
  const monthKey = getMonthKey(now);
  const yearKey = getYearKey(now);

  const daily = await redisHash(
    `moheji:delivery:daily:${dateKey}`
  );

  const monthly = await redisHash(
    `moheji:delivery:month:${monthKey}`
  );

  const yearly = await redisHash(
    `moheji:delivery:year:${yearKey}`
  );

  const alltime = await redisHash(
    "moheji:delivery:alltime"
  );

  const todaySales = toInt(daily.sales);
  const todayOrders = toInt(daily.orders);

  const monthSales = toInt(monthly.sales);
  const monthOrders = toInt(monthly.orders);

  const yearSales = toInt(yearly.sales);
  const yearOrders = toInt(yearly.orders);

  const alltimeOrders = toInt(alltime.orders);

  const bestSales = toInt(
    monthly.bestSales
  );

  const bestOrders = toInt(
    monthly.bestOrders
  );

  const workingDays =
    await getWorkingDays(monthKey);

  const averagePerDay =
    workingDays > 0
      ? Math.round(monthSales / workingDays)
      : 0;

  const achievement =
    MONTHLY_GOAL > 0
      ? Math.floor(
          (monthSales / MONTHLY_GOAL) * 100
        )
      : 0;

  const perOrder =
    todayOrders > 0
      ? Math.round(todaySales / todayOrders)
      : 0;

  const timeText =
    `${now.getFullYear()}年` +
    `${now.getMonth() + 1}月` +
    `${now.getDate()}日 ` +
    `${String(now.getHours()).padStart(2, "0")}:` +
    `${String(now.getMinutes()).padStart(2, "0")}`;

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
    `🎯 月間目標　${formatNumber(MONTHLY_GOAL)}円\n` +
    `📊 目標達成率　${achievement}%\n` +
    `🏆 月間最高売上　${formatNumber(bestSales)}円\n` +
    `🏆 月間最高件数　${formatNumber(bestOrders)}件\n` +
    `📆 稼働日数　${formatNumber(workingDays)}日\n` +
    `🛵 累計配達件数　${formatNumber(alltimeOrders)}件\n` +
    `🕐 ${timeText}\n` +
    `🛵 今日も配達お疲れ様でした！`
  );
}

// ============================================================
// Record report
// ============================================================

async function buildRecordReport(chatId) {
  const now = new Date();

  const monthKey = getMonthKey(now);

  const records = await getRecordHistory(chatId);

  const monthRecords = records
    .filter(
      (r) =>
        r.monthKey === monthKey
    )
    .sort(
      (a, b) =>
        parseTimestamp(b.createdAt) -
        parseTimestamp(a.createdAt)
    );

  const monthData = await redisHash(
    `moheji:delivery:month:${monthKey}`
  );

  const monthlySales = toInt(
    monthData.sales
  );

  const monthlyOrders = toInt(
    monthData.orders
  );

  const activeRecords =
    monthRecords.filter(
      (r) => !r.cancelled
    );

  const recordSales = activeRecords.reduce(
    (sum, r) => sum + r.sales,
    0
  );

  const recordOrders = activeRecords.reduce(
    (sum, r) => sum + r.orders,
    0
  );

  const lines = [];

  lines.push("📋 配達売上記録");
  lines.push("");
  lines.push(`📅 ${monthKey}`);
  lines.push(
    `💰 月間集計　${formatNumber(monthlySales)}円`
  );
  lines.push(
    `📦 月間件数　${formatNumber(monthlyOrders)}件`
  );
  lines.push("");
  lines.push("【個別記録】");

  if (!monthRecords.length) {
    lines.push("記録なし");
  } else {
    for (const record of monthRecords) {
      const status =
        record.cancelled
          ? "❌取消"
          : "✅有効";

      const created =
        record.createdAt
          ? new Date(
              parseTimestamp(record.createdAt)
            ).toLocaleString(
              "ja-JP",
              {
                timeZone: "Asia/Tokyo",
              }
            )
          : "-";

      lines.push(
        `${status} ${record.dateKey} ${created}`
      );

      lines.push(
        `　${formatNumber(record.sales)}円 / ${formatNumber(record.orders)}件`
      );

      lines.push(
        `　ID: ${record.recordId}`
      );
    }
  }

  lines.push("");
  lines.push("【監査比較】");
  lines.push(
    `個別記録合計　${formatNumber(recordSales)}円 / ${formatNumber(recordOrders)}件`
  );
  lines.push(
    `月間HASH　　 ${formatNumber(monthlySales)}円 / ${formatNumber(monthlyOrders)}件`
  );

  if (
    recordSales === monthlySales &&
    recordOrders === monthlyOrders
  ) {
    lines.push("✅ 一致しています");
  } else {
    lines.push("⚠️ 差異があります");
  }

  return lines.join("\n");
}

// ============================================================
// Debug report
// READ ONLY
// ============================================================

async function buildDebugReport() {
  const keys = await scanKeys(
    "moheji:delivery:*"
  );

  keys.sort();

  const typeCounts = {};

  const recordKeys = keys.filter(
    (key) =>
      key.startsWith(
        "moheji:delivery:record:"
      )
  );

  const records = [];

  for (const key of recordKeys) {
    const record = await readRecordKey(key);

    if (record) {
      records.push(record);
    }
  }

  records.sort(
    (a, b) =>
      parseTimestamp(b.createdAt) -
      parseTimestamp(a.createdAt)
  );

  const lines = [];

  lines.push("🔎 Redis詳細調査レポート");
  lines.push("※この処理は読み取り専用です");
  lines.push("※Redisのデータは変更していません");
  lines.push("");

  lines.push("【キー種別】");

  for (const key of keys) {
    try {
      const type = await redis(
        "TYPE",
        key
      );

      typeCounts[type] =
        (typeCounts[type] || 0) + 1;
    } catch {
      typeCounts.error =
        (typeCounts.error || 0) + 1;
    }
  }

  for (const [type, count] of Object.entries(
    typeCounts
  )) {
    lines.push(
      `${type.padEnd(8)} ${count}件`
    );
  }

  lines.push("");
  lines.push(
    `全キー数　${keys.length}件`
  );

  lines.push("");
  lines.push(
    `【個別レコード】`
  );

  lines.push(
    `record:* キー　${recordKeys.length}件`
  );

  lines.push(
    `読み取り成功　${records.length}件`
  );

  const active = records.filter(
    (r) => !r.cancelled
  );

  const cancelled = records.filter(
    (r) => r.cancelled
  );

  lines.push(
    `有効　　　　　${active.length}件`
  );

  lines.push(
    `取消　　　　　${cancelled.length}件`
  );

  const recordSales = active.reduce(
    (sum, r) => sum + r.sales,
    0
  );

  const recordOrders = active.reduce(
    (sum, r) => sum + r.orders,
    0
  );

  lines.push(
    `有効売上　　　${formatNumber(recordSales)}円`
  );

  lines.push(
    `有効件数　　　${formatNumber(recordOrders)}件`
  );

  lines.push("");
  lines.push("【現在の集計HASH】");

  const now = new Date();

  const dateKey = getDateKey(now);
  const monthKey = getMonthKey(now);
  const yearKey = getYearKey(now);

  const daily = await redisHash(
    `moheji:delivery:daily:${dateKey}`
  );

  const monthly = await redisHash(
    `moheji:delivery:month:${monthKey}`
  );

  const yearly = await redisHash(
    `moheji:delivery:year:${yearKey}`
  );

  const alltime = await redisHash(
    "moheji:delivery:alltime"
  );

  lines.push(
    `今日 ${dateKey}　${formatNumber(
      daily.sales
    )}円 / ${formatNumber(
      daily.orders
    )}件`
  );

  lines.push(
    `今月 ${monthKey}　${formatNumber(
      monthly.sales
    )}円 / ${formatNumber(
      monthly.orders
    )}件`
  );

  lines.push(
    `今年 ${yearKey}　${formatNumber(
      yearly.sales
    )}円 / ${formatNumber(
      yearly.orders
    )}件`
  );

  lines.push(
    `累計　　　　 ${formatNumber(
      alltime.sales
    )}円 / ${formatNumber(
      alltime.orders
    )}件`
  );

  lines.push("");
  lines.push("【個別記録 最新20件】");

  if (!records.length) {
    lines.push("なし");
  } else {
    for (const r of records.slice(0, 20)) {
      lines.push(
        `${r.cancelled ? "❌" : "✅"} ` +
        `${r.dateKey || "-"} ` +
        `${formatNumber(r.sales)}円 / ` +
        `${formatNumber(r.orders)}件 ` +
        `${r.recordId}`
      );
    }
  }

  lines.push("");
  lines.push("【レコード集計 vs HASH】");

  const monthRecords = records.filter(
    (r) =>
      r.monthKey === monthKey &&
      !r.cancelled
  );

  const monthRecordSales =
    monthRecords.reduce(
      (sum, r) => sum + r.sales,
      0
    );

  const monthRecordOrders =
    monthRecords.reduce(
      (sum, r) => sum + r.orders,
      0
    );

  const hashMonthSales =
    toInt(monthly.sales);

  const hashMonthOrders =
    toInt(monthly.orders);

  lines.push(
    `個別記録　${formatNumber(
      monthRecordSales
    )}円 / ${formatNumber(
      monthRecordOrders
    )}件`
  );

  lines.push(
    `月間HASH　${formatNumber(
      hashMonthSales
    )}円 / ${formatNumber(
      hashMonthOrders
    )}件`
  );

  if (
    monthRecordSales === hashMonthSales &&
    monthRecordOrders === hashMonthOrders
  ) {
    lines.push("✅ 一致");
  } else {
    lines.push("⚠️ 不一致");
  }

  return lines.join("\n");
}

// ============================================================
// Telegram
// ============================================================

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

  if (!data.ok) {
    throw new Error(
      data.description || "Telegram API error"
    );
  }

  return data;
}

async function sendMessage(
  chatId,
  text
) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
  });
}

async function sendPhoto(
  chatId,
  photo,
  caption
) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
  });
}

// ============================================================
// Command parser
// ============================================================

function parseCommand(text) {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);

  const command =
    parts[0]
      .split("@")[0]
      .toLowerCase();

  if (
    command !== "/sales" &&
    command !== "/cancel" &&
    command !== "/record"
  ) {
    return null;
  }

  return {
    command,
    args: parts.slice(1),
  };
}

// ============================================================
// /sales args
// ============================================================

function parseSalesArgs(args) {
  if (!Array.isArray(args) || args.length < 2) {
    return null;
  }

  const sales = Number(args[0]);
  const orders = Number(args[1]);

  if (
    !Number.isFinite(sales) ||
    !Number.isFinite(orders) ||
    sales <= 0 ||
    orders <= 0
  ) {
    return null;
  }

  return {
    sales: Math.trunc(sales),
    orders: Math.trunc(orders),
  };
}

// ============================================================
// HTTP handler
// ============================================================

export default async function handler(
  req,
  res
) {
  try {
    // --------------------------------------------------------
    // GET DEBUG
    // --------------------------------------------------------

    if (req.method === "GET") {
      const url = new URL(
        req.url,
        `https://${req.headers.host}`
      );

      const debug =
        url.searchParams.get("debug");

      const key =
        url.searchParams.get("key");

      if (
        debug === "1" &&
        DEBUG_KEY &&
        key === DEBUG_KEY
      ) {
        const report =
          await buildDebugReport();

        return res.status(200).send(
          report
        );
      }

      return res.status(200).send("OK");
    }

    // --------------------------------------------------------
    // Telegram webhook
    // --------------------------------------------------------

    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    const update = req.body;

    const message =
      update?.message;

    if (!message) {
      return res.status(200).send("OK");
    }

    const chatId =
      message.chat?.id;

    const text =
      message.text || "";

    if (!chatId || !text) {
      return res.status(200).send("OK");
    }

    const parsed =
      parseCommand(text);

    if (!parsed) {
      return res.status(200).send("OK");
    }

    // --------------------------------------------------------
    // /sales
    // --------------------------------------------------------

    if (parsed.command === "/sales") {
      const input =
        parseSalesArgs(parsed.args);

      if (!input) {
        await sendMessage(
          chatId,
          "使い方：\n/sales 売上 件数\n\n例：\n/sales 17014 17"
        );

        return res.status(200).send("OK");
      }

      await processSales(
        chatId,
        input.sales,
        input.orders
      );

      const report =
        await buildSalesReport(
          chatId
        );

      await sendPhoto(
        chatId,
        IMAGE_URL,
        report
      );

      return res.status(200).send("OK");
    }

    // --------------------------------------------------------
    // /cancel
    // --------------------------------------------------------

    if (parsed.command === "/cancel") {
      const result =
        await cancelLatestSale(
          chatId
        );

      if (!result.ok) {
        await sendMessage(
          chatId,
          result.message
        );

        return res.status(200).send("OK");
      }

      const r = result.record;

      await sendMessage(
        chatId,
        `❌ 売上をキャンセルしました\n\n` +
        `📅 ${r.dateKey}\n` +
        `💰 ${formatNumber(r.sales)}円\n` +
        `📦 ${formatNumber(r.orders)}件\n` +
        `🆔 ${r.recordId}`
      );

      return res.status(200).send("OK");
    }

    // --------------------------------------------------------
    // /record
    // --------------------------------------------------------

    if (parsed.command === "/record") {
      const report =
        await buildRecordReport(
          chatId
        );

      await sendMessage(
        chatId,
        report
      );

      return res.status(200).send("OK");
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error(
      "HANDLER ERROR:",
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
    } catch {}

    return res.status(200).send("OK");
  }
}
