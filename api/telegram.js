const {
  KV_REST_API_URL,
  KV_REST_API_TOKEN,
  TELEGRAM_BOT_TOKEN,
} = process.env;

const SALES_IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTHLY_TARGET = 500000;

/* =========================================================
 * Redis
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
    throw new Error(
      data?.error || `Redis HTTP ${response.status}`
    );
  }

  return data.result;
}

/* =========================================================
 * Date / number
 * ======================================================= */

function jstDate(value = new Date()) {
  const d = new Date(value);

  return new Date(
    d.toLocaleString("en-US", {
      timeZone: "Asia/Tokyo",
    })
  );
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKeyFromDate(value = new Date()) {
  const d = jstDate(value);

  return (
    `${d.getFullYear()}-` +
    `${pad2(d.getMonth() + 1)}-` +
    `${pad2(d.getDate())}`
  );
}

function monthKeyFromDate(value = new Date()) {
  const d = jstDate(value);

  return (
    `${d.getFullYear()}-` +
    `${pad2(d.getMonth() + 1)}`
  );
}

function yearKeyFromDate(value = new Date()) {
  const d = jstDate(value);

  return String(d.getFullYear());
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function yen(value) {
  return Math.round(toNumber(value)).toLocaleString("ja-JP");
}

function parseTimestamp(value) {
  if (value == null || value === "") {
    return 0;
  }

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

/* =========================================================
 * HGETALL
 * ======================================================= */

function hgetallToObject(value) {
  if (Array.isArray(value)) {
    const result = {};

    for (let i = 0; i < value.length; i += 2) {
      const key = value[i];
      const val = value[i + 1];

      if (key !== undefined) {
        result[String(key)] =
          val === undefined ? "" : String(val);
      }
    }

    return result;
  }

  if (value && typeof value === "object") {
    return value;
  }

  return {};
}

/* =========================================================
 * Redis SCAN
 * ======================================================= */

async function scan(pattern) {
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

    if (Array.isArray(result?.[1])) {
      keys.push(...result[1]);
    }
  } while (cursor !== "0");

  return keys;
}

/* =========================================================
 * Read individual records
 *
 * record:* は HASH / STRING 混在に対応
 * ======================================================= */

function normalizeRecord(raw, key) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const parts = String(key).split(":");

  let chatId =
    raw.chatId ??
    raw.chat_id ??
    "";

  /*
   * moheji:delivery:record:<chatId>:<recordId>
   */
  if (!chatId && parts.length >= 5) {
    chatId = parts[3];
  }

  let recordId =
    raw.recordId ??
    raw.id ??
    raw.saleId ??
    "";

  if (!recordId && parts.length >= 5) {
    recordId = parts.slice(4).join(":");
  }

  const sales = toNumber(
    raw.sales ??
    raw.amount ??
    raw.totalSales ??
    raw.price ??
    0
  );

  const orders = toNumber(
    raw.orders ??
    raw.orderCount ??
    raw.count ??
    0
  );

  const createdAt =
    raw.createdAt ??
    raw.timestamp ??
    raw.time ??
    "";

  const timestamp = parseTimestamp(createdAt);

  let dateKey =
    raw.dateKey ??
    "";

  if (!dateKey && timestamp) {
    dateKey = dateKeyFromDate(timestamp);
  }

  let monthKey =
    raw.monthKey ??
    "";

  if (!monthKey && dateKey) {
    monthKey = String(dateKey).slice(0, 7);
  }

  let yearKey =
    raw.yearKey ??
    "";

  if (!yearKey && dateKey) {
    yearKey = String(dateKey).slice(0, 4);
  }

  const cancelled =
    raw.cancelled === true ||
    raw.cancelled === "true" ||
    raw.cancelled === "1" ||
    raw.status === "cancelled";

  return {
    key,
    recordId: String(recordId),
    chatId: String(chatId),
    sales,
    orders,
    createdAt,
    timestamp,
    dateKey: String(dateKey || ""),
    monthKey: String(monthKey || ""),
    yearKey: String(yearKey || ""),
    cancelled,
  };
}

async function getAllRecords() {
  const keys = await scan(
    "moheji:delivery:record:*"
  );

  if (!keys.length) {
    return [];
  }

  /*
   * TYPEを順番に取得。
   *
   * ここではPipelineを使わない。
   * 今回は「確実に動くこと」を優先する。
   */
  const records = [];

  for (const key of keys) {
    try {
      const type = await redis("TYPE", key);

      let raw = null;

      if (type === "hash") {
        const value = await redis(
          "HGETALL",
          key
        );

        raw = hgetallToObject(value);
      } else if (type === "string") {
        const value = await redis(
          "GET",
          key
        );

        if (!value) {
          continue;
        }

        try {
          raw = JSON.parse(value);
        } catch {
          continue;
        }
      } else {
        continue;
      }

      const record =
        normalizeRecord(raw, key);

      if (!record) {
        continue;
      }

      if (!record.recordId) {
        continue;
      }

      records.push(record);
    } catch (error) {
      console.error(
        "RECORD READ ERROR:",
        key,
        error?.message || error
      );
    }
  }

  return records;
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
      data?.description ||
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

async function sendSalesReport(
  chatId,
  text
) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo: SALES_IMAGE_URL,
    caption: text,
  });
}

/* =========================================================
 * Calculate from individual records
 *
 * ★ここが今回の重要部分
 *
 * 日次/月次/年次の壊れたHASHは使わない。
 * 個別record:*から直接計算する。
 * ======================================================= */

function calculateStats(records, now) {
  const today = dateKeyFromDate(now);
  const month = monthKeyFromDate(now);
  const year = yearKeyFromDate(now);

  const active = records.filter(
    (record) => !record.cancelled
  );

  const todayRecords = active.filter(
    (record) =>
      record.dateKey === today
  );

  const monthRecords = active.filter(
    (record) =>
      record.monthKey === month
  );

  const yearRecords = active.filter(
    (record) =>
      record.yearKey === year
  );

  const todaySales = todayRecords.reduce(
    (sum, record) =>
      sum + record.sales,
    0
  );

  const todayOrders = todayRecords.reduce(
    (sum, record) =>
      sum + record.orders,
    0
  );

  const monthSales = monthRecords.reduce(
    (sum, record) =>
      sum + record.sales,
    0
  );

  const monthOrders = monthRecords.reduce(
    (sum, record) =>
      sum + record.orders,
    0
  );

  const yearSales = yearRecords.reduce(
    (sum, record) =>
      sum + record.sales,
    0
  );

  const yearOrders = yearRecords.reduce(
    (sum, record) =>
      sum + record.orders,
    0
  );

  /*
   * 日別集計
   */
  const dailyTotals = new Map();

  for (const record of monthRecords) {
    const key = record.dateKey;

    if (!key) {
      continue;
    }

    const current =
      dailyTotals.get(key) || {
        sales: 0,
        orders: 0,
      };

    current.sales += record.sales;
    current.orders += record.orders;

    dailyTotals.set(key, current);
  }

  let maxDailySales = 0;
  let maxDailyOrders = 0;

  for (const total of dailyTotals.values()) {
    if (total.sales > maxDailySales) {
      maxDailySales = total.sales;
    }

    if (total.orders > maxDailyOrders) {
      maxDailyOrders = total.orders;
    }
  }

  /*
   * 稼働日数
   */
  let workingDays = 0;

  for (const total of dailyTotals.values()) {
    if (
      total.sales > 0 ||
      total.orders > 0
    ) {
      workingDays++;
    }
  }

  const averagePerOrder =
    monthOrders > 0
      ? Math.round(
          monthSales / monthOrders
        )
      : 0;

  const averagePerDay =
    workingDays > 0
      ? Math.round(
          monthSales / workingDays
        )
      : 0;

  const achievementRate =
    MONTHLY_TARGET > 0
      ? Math.floor(
          (monthSales /
            MONTHLY_TARGET) *
            100
        )
      : 0;

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

    maxDailySales,
    maxDailyOrders,

    workingDays,
  };
}

/* =========================================================
 * /sales
 *
 * ★テンプレート固定
 * ======================================================= */

async function handleSales(chatId) {
  const now = new Date();

  const records =
    await getAllRecords();

  const stats =
    calculateStats(records, now);

  const d = jstDate(now);

  const nowText =
    `${d.getFullYear()}年` +
    `${d.getMonth() + 1}月` +
    `${d.getDate()}日 ` +
    `${pad2(d.getHours())}:` +
    `${pad2(d.getMinutes())}`;

  /*
   * ★★★ 売上報告テンプレート固定 ★★★
   */
  const report = [
    "🏍️ 配達売上",
    `💰 今日の売上　${yen(stats.todaySales)}円`,
    `📦 今日の件数　${yen(stats.todayOrders)}件`,
    `💵 1件あたり　${yen(stats.averagePerOrder)}円`,
    `📅 今月売上　${yen(stats.monthSales)}円`,
    `📦 今月件数　${yen(stats.monthOrders)}件`,
    `🗓️ 年間売上　${yen(stats.yearSales)}円`,
    `📦 年間件数　${yen(stats.yearOrders)}件`,
    `📈 平均売上／日　${yen(stats.averagePerDay)}円`,
    `🎯 月間目標　500,000円`,
    `📊 目標達成率　${stats.achievementRate}%`,
    `🏆 月間最高売上　${yen(stats.maxDailySales)}円`,
    `🏆 月間最高件数　${yen(stats.maxDailyOrders)}件`,
    `📆 稼働日数　${yen(stats.workingDays)}日`,
    `🛵 累計配達件数　${yen(stats.yearOrders)}件`,
    `🕐 ${nowText}`,
    "🛵 今日も配達お疲れ様でした！",
  ].join("\n");

  await sendSalesReport(
    chatId,
    report
  );
}

/* =========================================================
 * /cancel
 *
 * 最新の未取消recordを1件だけ取消
 *
 * Redisの集計HASHは触らない。
 * 次回 /sales がrecord:*から再計算する。
 * ======================================================= */

async function handleCancel(chatId) {
  const records =
    await getAllRecords();

  if (!Array.isArray(records)) {
    throw new Error(
      "Record list is not an array"
    );
  }

  const active = records.filter(
    (record) =>
      String(record.chatId) ===
        String(chatId) &&
      !record.cancelled
  );

  if (!active.length) {
    await sendMessage(
      chatId,
      "⚠️ 取消できる未取消の売上がありません。"
    );

    return;
  }

  active.sort(
    (a, b) =>
      (b.timestamp || 0) -
      (a.timestamp || 0)
  );

  const target = active[0];

  if (!target?.key) {
    throw new Error(
      "Cancel target not found"
    );
  }

  /*
   * HASHの場合
   */
  const type =
    await redis(
      "TYPE",
      target.key
    );

  if (type === "hash") {
    await redis(
      "HSET",
      target.key,
      "cancelled",
      "1",
      "status",
      "cancelled",
      "cancelledAt",
      new Date().toISOString()
    );
  } else if (type === "string") {
    /*
     * STRING recordの場合
     */
    const current =
      await redis(
        "GET",
        target.key
      );

    if (!current) {
      throw new Error(
        "Cancel record disappeared"
      );
    }

    let data;

    try {
      data = JSON.parse(current);
    } catch {
      throw new Error(
        "Cancel record JSON is invalid"
      );
    }

    data.cancelled = true;
    data.status = "cancelled";
    data.cancelledAt =
      new Date().toISOString();

    await redis(
      "SET",
      target.key,
      JSON.stringify(data)
    );
  } else {
    throw new Error(
      `Unsupported record type: ${type}`
    );
  }

  const d = target.timestamp
    ? jstDate(
        new Date(target.timestamp)
      )
    : null;

  const timeText = d
    ? (
        `${d.getFullYear()}年` +
        `${d.getMonth() + 1}月` +
        `${d.getDate()}日 ` +
        `${pad2(d.getHours())}:` +
        `${pad2(d.getMinutes())}`
      )
    : "";

  await sendMessage(
    chatId,
    [
      "↩️ 売上を取り消しました。",
      "",
      `💰 売上　${yen(target.sales)}円`,
      `📦 件数　${yen(target.orders)}件`,
      timeText
        ? `🕐 ${timeText}`
        : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

/* =========================================================
 * Command parser
 *
 * /sales
 * /cancel
 *
 * それ以外は無視
 * ======================================================= */

function getCommand(text) {
  if (!text) {
    return null;
  }

  const first =
    String(text)
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();

  const command =
    first.split("@")[0];

  if (command === "/sales") {
    return "/sales";
  }

  if (command === "/cancel") {
    return "/cancel";
  }

  return null;
}

/* =========================================================
 * Handler
 * ======================================================= */

export default async function handler(
  req,
  res
) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: true,
      });
    }

    const update = req.body;

    const message =
      update?.message;

    if (!message) {
      return res.status(200).json({
        ok: true,
      });
    }

    const chatId =
      message?.chat?.id;

    if (!chatId) {
      return res.status(200).json({
        ok: true,
      });
    }

    const command =
      getCommand(
        message?.text || ""
      );

    /*
     * /sales /cancel 以外は完全無視。
     */
    if (!command) {
      return res.status(200).json({
        ok: true,
      });
    }

    if (command === "/sales") {
      await handleSales(chatId);
    }

    if (command === "/cancel") {
      await handleCancel(chatId);
    }

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "HANDLER ERROR:",
      error?.stack || error
    );

    try {
      const chatId =
        req?.body?.message?.chat?.id;

      if (chatId) {
        await sendMessage(
          chatId,
          "⚠️ エラーが発生しました。\nしばらくしてからもう一度お試しください。"
        );
      }
    } catch (telegramError) {
      console.error(
        "TELEGRAM ERROR:",
        telegramError?.stack ||
          telegramError
      );
    }

    return res.status(200).json({
      ok: false,
    });
  }
}
