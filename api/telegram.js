const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEBUG_KEY = process.env.DEBUG_KEY;

const TARGET_MONTHLY = 500000;

const SALES_IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";


// ============================================================
// Redis REST
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

  if (!response.ok) {
    throw new Error(
      `Redis HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (data && data.error) {
    throw new Error(String(data.error));
  }

  return data.result;
}


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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Redis transaction HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (data && data.error) {
    throw new Error(String(data.error));
  }

  if (!Array.isArray(data.result)) {
    throw new Error(
      `Unexpected transaction response: ${JSON.stringify(data)}`
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


// ============================================================
// Telegram
// ============================================================

async function telegram(method, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram ${method} error: ${JSON.stringify(data)}`
    );
  }

  return data.result;
}


// ============================================================
// Utility
// ============================================================

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
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


function formatYen(value) {
  return `${toInt(value).toLocaleString("ja-JP")}円`;
}


function createRecordId() {
  return (
    `${Date.now()}-` +
    Math.random().toString(36).slice(2, 10)
  );
}


// ============================================================
// Redis Keys
// ============================================================

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


// ============================================================
// SCAN
// ============================================================

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

    const nextCursor = result?.[0];
    const foundKeys = result?.[1] || [];

    cursor = String(nextCursor);

    if (Array.isArray(foundKeys)) {
      keys.push(...foundKeys);
    }
  } while (cursor !== "0");

  return keys;
}


// ============================================================
// Current individual records
// ============================================================

async function scanIndividualRecordKeys(chatId) {
  return await scanKeys(
    `moheji:delivery:record:${String(chatId)}:*`
  );
}


async function getRecordHistory(chatId) {
  const keys = await scanIndividualRecordKeys(chatId);

  const records = [];

  for (const key of keys) {
    try {
      const type = await redis("TYPE", key);

      if (String(type) !== "string") {
        continue;
      }

      const raw = await redis("GET", key);

      if (!raw) {
        continue;
      }

      const record =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;

      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record)
      ) {
        continue;
      }

      if (
        record.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(record.dateKey)
        )
      ) {
        const parts = String(record.dateKey).split("-");

        if (!record.monthKey) {
          record.monthKey =
            `${parts[0]}-${parts[1]}`;
        }

        if (!record.yearKey) {
          record.yearKey = parts[0];
        }
      }

      records.push(record);
    } catch (error) {
      console.error(
        "getRecordHistory error:",
        key,
        error
      );
    }
  }

  records.sort((a, b) => {
    const da =
      Date.parse(a.createdAt || "") || 0;

    const db =
      Date.parse(b.createdAt || "") || 0;

    return db - da;
  });

  return records;
}


// ============================================================
// Working days
// ============================================================

async function getWorkingDays(month) {
  const keys = await scanKeys(
    `moheji:delivery:daily:${month}-*`
  );

  let count = 0;

  for (const key of keys) {
    try {
      const data = await redis(
        "HGETALL",
        key
      );

      const sales = toInt(data?.sales);
      const orders = toInt(data?.orders);

      if (sales !== 0 || orders !== 0) {
        count++;
      }
    } catch (error) {
      console.error(
        "getWorkingDays error:",
        key,
        error
      );
    }
  }

  return count;
}


// ============================================================
// Best sales
// ============================================================

async function recalculateDailyBestFromRecords(
  chatId,
  dateKey
) {
  const records =
    await getRecordHistory(chatId);

  let bestSales = 0;
  let bestOrders = 0;

  for (const record of records) {
    if (record.cancelled) {
      continue;
    }

    if (record.dateKey !== dateKey) {
      continue;
    }

    bestSales = Math.max(
      bestSales,
      toInt(record.sales)
    );

    bestOrders = Math.max(
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


async function recalculateMonthlyBestFromRecords(
  chatId,
  month
) {
  const records =
    await getRecordHistory(chatId);

  let bestSales = 0;
  let bestOrders = 0;

  for (const record of records) {
    if (record.cancelled) {
      continue;
    }

    const recordMonth =
      record.monthKey ||
      (
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(record.dateKey || "")
        )
          ? String(record.dateKey).slice(0, 7)
          : ""
      );

    if (recordMonth !== month) {
      continue;
    }

    bestSales = Math.max(
      bestSales,
      toInt(record.sales)
    );

    bestOrders = Math.max(
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


// ============================================================
// /sales
// ============================================================

async function processSales(
  chatId,
  sales,
  orders
) {
  const now = new Date();

  const dateKey = getDateKey(now);
  const month = getMonthKey(now);
  const year = getYearKey(now);

  const recordId = createRecordId();

  const record = {
    recordId,
    chatId: String(chatId),
    dateKey,
    monthKey: month,
    yearKey: year,
    sales,
    orders,
    cancelled: false,
    createdAt: now.toISOString(),
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


// ============================================================
// /cancel
// ============================================================

async function cancelLatestSale(chatId) {
  const records =
    await getRecordHistory(chatId);

  const latest = records.find(
    (record) => !record.cancelled
  );

  if (!latest) {
    return null;
  }

  const dateKey = latest.dateKey;

  const month =
    latest.monthKey ||
    (
      /^\d{4}-\d{2}-\d{2}$/.test(
        String(latest.dateKey || "")
      )
        ? String(latest.dateKey).slice(0, 7)
        : getMonthKey()
    );

  const year =
    latest.yearKey ||
    (
      /^\d{4}-\d{2}-\d{2}$/.test(
        String(latest.dateKey || "")
      )
        ? String(latest.dateKey).slice(0, 4)
        : getYearKey()
    );

  const sales = toInt(latest.sales);
  const orders = toInt(latest.orders);

  await redisMulti([
    [
      "HINCRBY",
      dailyKey(dateKey),
      "sales",
      String(-sales),
    ],

    [
      "HINCRBY",
      dailyKey(dateKey),
      "orders",
      String(-orders),
    ],

    [
      "HINCRBY",
      monthRedisKey(month),
      "sales",
      String(-sales),
    ],

    [
      "HINCRBY",
      monthRedisKey(month),
      "orders",
      String(-orders),
    ],

    [
      "HINCRBY",
      yearRedisKey(year),
      "sales",
      String(-sales),
    ],

    [
      "HINCRBY",
      yearRedisKey(year),
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
      individualRecordKey(
        chatId,
        latest.recordId
      ),
      JSON.stringify({
        ...latest,
        cancelled: true,
        cancelledAt:
          new Date().toISOString(),
      }),
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

  return {
    ...latest,
    cancelled: true,
  };
}


// ============================================================
// /sales report
// ============================================================

async function buildSalesReport() {
  const now = new Date();

  const dateKey = getDateKey(now);
  const month = getMonthKey(now);
  const year = getYearKey(now);

  const daily = await redis(
    "HGETALL",
    dailyKey(dateKey)
  );

  const monthly = await redis(
    "HGETALL",
    monthRedisKey(month)
  );

  const yearly = await redis(
    "HGETALL",
    yearRedisKey(year)
  );

  const alltime = await redis(
    "HGETALL",
    alltimeKey()
  );

  const workingDays =
    await getWorkingDays(month);

  const todaySales =
    toInt(daily?.sales);

  const todayOrders =
    toInt(daily?.orders);

  const monthSales =
    toInt(monthly?.sales);

  const monthOrders =
    toInt(monthly?.orders);

  const yearSales =
    toInt(yearly?.sales);

  const yearOrders =
    toInt(yearly?.orders);

  const alltimeOrders =
    toInt(alltime?.orders);

  const averagePerDay =
    workingDays > 0
      ? Math.round(monthSales / workingDays)
      : 0;

  const perOrder =
    monthOrders > 0
      ? Math.round(monthSales / monthOrders)
      : 0;

  const achievementRate =
    TARGET_MONTHLY > 0
      ? Math.floor(
          (monthSales / TARGET_MONTHLY) * 100
        )
      : 0;

  const bestSales =
    toInt(monthly?.bestSales);

  const bestOrders =
    toInt(monthly?.bestOrders);

  const timestamp =
    `${now.getFullYear()}年` +
    `${now.getMonth() + 1}月` +
    `${now.getDate()}日 ` +
    `${String(now.getHours()).padStart(2, "0")}:` +
    `${String(now.getMinutes()).padStart(2, "0")}`;

  return [
    "🏍️ 配達売上",
    `💰 今日の売上　${todaySales.toLocaleString()}円`,
    `📦 今日の件数　${todayOrders}件`,
    `💵 1件あたり　${perOrder.toLocaleString()}円`,
    `📅 今月売上　${monthSales.toLocaleString()}円`,
    `📦 今月件数　${monthOrders}件`,
    `🗓️ 年間売上　${yearSales.toLocaleString()}円`,
    `📦 年間件数　${yearOrders}件`,
    `📈 平均売上／日　${averagePerDay.toLocaleString()}円`,
    `🎯 月間目標　${TARGET_MONTHLY.toLocaleString()}円`,
    `📊 目標達成率　${achievementRate}%`,
    `🏆 月間最高売上　${bestSales.toLocaleString()}円`,
    `🏆 月間最高件数　${bestOrders}件`,
    `📆 稼働日数　${workingDays}日`,
    `🛵 累計配達件数　${alltimeOrders}件`,
    `🕐 ${timestamp}`,
    "🛵 今日も配達お疲れ様でした！",
  ].join("\n");
}


// ============================================================
// /record
// ============================================================

async function buildRecordReport(chatId) {
  const now = new Date();

  const month = getMonthKey(now);

  const records =
    await getRecordHistory(chatId);

  const activeRecords =
    records.filter(
      (record) => !record.cancelled
    );

  const cancelledRecords =
    records.filter(
      (record) => record.cancelled
    );

  let activeSales = 0;
  let activeOrders = 0;

  let cancelledSales = 0;
  let cancelledOrders = 0;

  for (const record of activeRecords) {
    activeSales += toInt(record.sales);
    activeOrders += toInt(record.orders);
  }

  for (const record of cancelledRecords) {
    cancelledSales += toInt(record.sales);
    cancelledOrders += toInt(record.orders);
  }

  let monthIndividualSales = 0;
  let monthIndividualOrders = 0;

  for (const record of activeRecords) {
    const recordMonth =
      record.monthKey ||
      (
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(record.dateKey || "")
        )
          ? String(record.dateKey).slice(0, 7)
          : ""
      );

    if (recordMonth !== month) {
      continue;
    }

    monthIndividualSales +=
      toInt(record.sales);

    monthIndividualOrders +=
      toInt(record.orders);
  }

  const monthRedis = await redis(
    "HGETALL",
    monthRedisKey(month)
  );

  const redisMonthSales =
    toInt(monthRedis?.sales);

  const redisMonthOrders =
    toInt(monthRedis?.orders);

  const diffSales =
    redisMonthSales -
    monthIndividualSales;

  const diffOrders =
    redisMonthOrders -
    monthIndividualOrders;

  const lines = [];

  lines.push("📋 配達記録");
  lines.push("");

  lines.push("【今月】");
  lines.push(
    `個別記録　${monthIndividualSales.toLocaleString()}円 / ${monthIndividualOrders}件`
  );
  lines.push(
    `Redis　　 ${redisMonthSales.toLocaleString()}円 / ${redisMonthOrders}件`
  );
  lines.push(
    `差額　　　${diffSales.toLocaleString()}円 / ${diffOrders}件`
  );

  lines.push("");

  lines.push("【全個別記録】");
  lines.push(
    `有効　${activeSales.toLocaleString()}円 / ${activeOrders}件`
  );
  lines.push(
    `取消　${cancelledSales.toLocaleString()}円 / ${cancelledOrders}件`
  );

  lines.push("");

  if (records.length === 0) {
    lines.push("個別記録はありません。");
  } else {
    lines.push("【履歴】");

    for (const record of records) {
      const status =
        record.cancelled
          ? "取消"
          : "有効";

      lines.push(
        `${record.dateKey || "-"} ` +
        `${toInt(record.sales).toLocaleString()}円 / ` +
        `${toInt(record.orders)}件 ` +
        `［${status}］`
      );
    }
  }

  return lines.join("\n");
}


// ============================================================
// DEBUG
// 完全読み取り専用
// ============================================================

async function buildDebugReport(chatId) {
  const month = getMonthKey(new Date());
  const year = getYearKey(new Date());

  const lines = [];

  lines.push("🔎 Redis詳細調査レポート");
  lines.push("※この処理は読み取り専用です");
  lines.push("※Redisのデータは変更していません");
  lines.push("");

  // ----------------------------------------------------------
  // 全 delivery キー
  // ----------------------------------------------------------

  const allDeliveryKeys =
    await scanKeys("moheji:delivery:*");

  allDeliveryKeys.sort();

  lines.push("【moheji:delivery:* 全キー】");
  lines.push(
    `キー数　${allDeliveryKeys.length}件`
  );
  lines.push("");

  const keyDetails = [];

  for (const key of allDeliveryKeys) {
    try {
      const type =
        await redis("TYPE", key);

      keyDetails.push({
        key,
        type: String(type || ""),
      });
    } catch (error) {
      keyDetails.push({
        key,
        type:
          `TYPE ERROR: ${error.message}`,
      });
    }
  }

  for (const item of keyDetails) {
    lines.push(
      `${item.type.padEnd(8)} ${item.key}`
    );
  }

  lines.push("");

  // ----------------------------------------------------------
  // 個別記録候補
  // ----------------------------------------------------------

  const recordCandidateKeys =
    allDeliveryKeys.filter((key) => {
      return (
        key.startsWith(
          "moheji:delivery:record:"
        ) ||
        key.startsWith(
          "moheji:delivery:records:"
        )
      );
    });

  lines.push("【個別記録候補】");
  lines.push(
    `候補キー　${recordCandidateKeys.length}件`
  );
  lines.push("");

  const detectedRecords = [];
  const legacyRecordKeys = [];

  for (const key of recordCandidateKeys) {
    let type = "";

    try {
      type = String(
        await redis("TYPE", key)
      );
    } catch (error) {
      lines.push(
        `TYPE取得失敗 ${key}`
      );
      lines.push(
        String(error.message)
      );
      lines.push("");
      continue;
    }

    lines.push(`KEY  ${key}`);
    lines.push(`TYPE ${type}`);

    // --------------------------------------------------------
    // String
    // --------------------------------------------------------

    if (type === "string") {
      try {
        const raw =
          await redis("GET", key);

        lines.push(
          `VALUE ${String(raw).slice(0, 1500)}`
        );

        if (raw) {
          try {
            const parsed =
              typeof raw === "string"
                ? JSON.parse(raw)
                : raw;

            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              detectedRecords.push({
                sourceKey: key,
                sourceType: type,
                record: parsed,
              });
            }
          } catch (_) {
            // JSONではない
          }
        }
      } catch (error) {
        lines.push(
          `GET ERROR ${error.message}`
        );
      }
    }

    // --------------------------------------------------------
    // Hash
    // --------------------------------------------------------

    else if (type === "hash") {
      try {
        const hash =
          await redis(
            "HGETALL",
            key
          );

        lines.push(
          `HASH ${JSON.stringify(hash).slice(0, 2000)}`
        );

        if (
          hash &&
          typeof hash === "object"
        ) {
          if (
            hash.sales !== undefined ||
            hash.orders !== undefined ||
            hash.dateKey !== undefined
          ) {
            detectedRecords.push({
              sourceKey: key,
              sourceType: type,
              record: {
                ...hash,
              },
            });
          }
        }
      } catch (error) {
        lines.push(
          `HGETALL ERROR ${error.message}`
        );
      }
    }

    // --------------------------------------------------------
    // ZSET
    // --------------------------------------------------------

    else if (type === "zset") {
      try {
        const values =
          await redis(
            "ZRANGE",
            key,
            "0",
            "-1",
            "WITHSCORES"
          );

        lines.push(
          `ZSET ${JSON.stringify(values).slice(0, 5000)}`
        );

        legacyRecordKeys.push({
          key,
          type,
          values,
        });
      } catch (error) {
        lines.push(
          `ZRANGE ERROR ${error.message}`
        );
      }
    }

    // --------------------------------------------------------
    // List
    // --------------------------------------------------------

    else if (type === "list") {
      try {
        const values =
          await redis(
            "LRANGE",
            key,
            "0",
            "-1"
          );

        lines.push(
          `LIST ${JSON.stringify(values).slice(0, 5000)}`
        );
      } catch (error) {
        lines.push(
          `LRANGE ERROR ${error.message}`
        );
      }
    }

    // --------------------------------------------------------
    // Set
    // --------------------------------------------------------

    else if (type === "set") {
      try {
        const values =
          await redis(
            "SMEMBERS",
            key
          );

        lines.push(
          `SET ${JSON.stringify(values).slice(0, 5000)}`
        );
      } catch (error) {
        lines.push(
          `SMEMBERS ERROR ${error.message}`
        );
      }
    }

    else {
      lines.push(
        "※この型は個別記録調査対象外"
      );
    }

    lines.push("");
  }

  // ----------------------------------------------------------
  // 検出された個別記録
  // ----------------------------------------------------------

  lines.push("【検出された個別記録】");

  if (detectedRecords.length === 0) {
    lines.push("検出なし");
  } else {
    lines.push(
      `${detectedRecords.length}件`
    );
    lines.push("");

    detectedRecords.sort((a, b) => {
      const da =
        Date.parse(
          a.record?.createdAt || ""
        ) || 0;

      const db =
        Date.parse(
          b.record?.createdAt || ""
        ) || 0;

      return db - da;
    });

    for (const item of detectedRecords) {
      const r =
        item.record || {};

      lines.push(
        [
          `KEY=${item.sourceKey}`,
          `date=${r.dateKey || "-"}`,
          `month=${r.monthKey || "-"}`,
          `sales=${toInt(r.sales)}`,
          `orders=${toInt(r.orders)}`,
          `cancelled=${
            r.cancelled === true
              ? "true"
              : "false"
          }`,
          `createdAt=${
            r.createdAt || "-"
          }`,
        ].join(" | ")
      );
    }
  }

  lines.push("");

  // ----------------------------------------------------------
  // 現在のchatIdの新形式
  // ----------------------------------------------------------

  const currentRecordKeys =
    allDeliveryKeys.filter((key) =>
      key.startsWith(
        `moheji:delivery:record:${String(chatId)}:`
      )
    );

  let currentActiveSales = 0;
  let currentActiveOrders = 0;
  let currentCancelledSales = 0;
  let currentCancelledOrders = 0;

  for (const item of detectedRecords) {
    const r =
      item.record || {};

    if (
      !item.sourceKey.startsWith(
        `moheji:delivery:record:${String(chatId)}:`
      )
    ) {
      continue;
    }

    const sales =
      toInt(r.sales);

    const orders =
      toInt(r.orders);

    if (r.cancelled) {
      currentCancelledSales += sales;
      currentCancelledOrders += orders;
    } else {
      currentActiveSales += sales;
      currentActiveOrders += orders;
    }
  }

  lines.push(
    "【現在の新形式個別記録】"
  );

  lines.push(
    `キー数　${currentRecordKeys.length}件`
  );

  lines.push(
    `有効売上　${currentActiveSales.toLocaleString()}円`
  );

  lines.push(
    `有効件数　${currentActiveOrders}件`
  );

  lines.push(
    `取消売上　${currentCancelledSales.toLocaleString()}円`
  );

  lines.push(
    `取消件数　${currentCancelledOrders}件`
  );

  lines.push("");

  // ----------------------------------------------------------
  // 現在月Redis
  // ----------------------------------------------------------

  const currentMonthRedis =
    await redis(
      "HGETALL",
      monthRedisKey(month)
    );

  const currentYearRedis =
    await redis(
      "HGETALL",
      yearRedisKey(year)
    );

  const currentAlltimeRedis =
    await redis(
      "HGETALL",
      alltimeKey()
    );

  lines.push("【現在月 Redis】");

  lines.push(
    `売上　${toInt(
      currentMonthRedis?.sales
    ).toLocaleString()}円`
  );

  lines.push(
    `件数　${toInt(
      currentMonthRedis?.orders
    )}件`
  );

  lines.push(
    `最高売上　${toInt(
      currentMonthRedis?.bestSales
    ).toLocaleString()}円`
  );

  lines.push(
    `最高件数　${toInt(
      currentMonthRedis?.bestOrders
    )}件`
  );

  lines.push("");

  lines.push("【現在年 Redis】");

  lines.push(
    `売上　${toInt(
      currentYearRedis?.sales
    ).toLocaleString()}円`
  );

  lines.push(
    `件数　${toInt(
      currentYearRedis?.orders
    )}件`
  );

  lines.push("");

  lines.push("【全期間 Redis】");

  lines.push(
    `売上　${toInt(
      currentAlltimeRedis?.sales
    ).toLocaleString()}円`
  );

  lines.push(
    `件数　${toInt(
      currentAlltimeRedis?.orders
    )}件`
  );

  lines.push("");

  // ----------------------------------------------------------
  // 日別Redis
  // ----------------------------------------------------------

  const dailyKeys =
    await scanKeys(
      "moheji:delivery:daily:*"
    );

  const dailyRows = [];

  let dailyTotalSales = 0;
  let dailyTotalOrders = 0;

  for (const key of dailyKeys) {
    try {
      const data =
        await redis(
          "HGETALL",
          key
        );

      const dateKey =
        key.replace(
          "moheji:delivery:daily:",
          ""
        );

      const sales =
        toInt(data?.sales);

      const orders =
        toInt(data?.orders);

      dailyTotalSales += sales;
      dailyTotalOrders += orders;

      dailyRows.push({
        dateKey,
        sales,
        orders,
      });
    } catch (error) {
      dailyRows.push({
        dateKey:
          key.replace(
            "moheji:delivery:daily:",
            ""
          ),
        sales: 0,
        orders: 0,
        error: error.message,
      });
    }
  }

  dailyRows.sort((a, b) =>
    a.dateKey.localeCompare(
      b.dateKey
    )
  );

  lines.push("【日別Redis】");

  lines.push(
    `合計　${dailyTotalSales.toLocaleString()}円 / ${dailyTotalOrders}件`
  );

  lines.push("");

  for (const row of dailyRows) {
    lines.push(
      `${row.dateKey} ${row.sales.toLocaleString()}円 / ${row.orders}件`
    );
  }

  lines.push("");

  // ----------------------------------------------------------
  // 月別Redis
  // ----------------------------------------------------------

  const monthKeys =
    await scanKeys(
      "moheji:delivery:month:*"
    );

  const monthRows = [];

  for (const key of monthKeys) {
    try {
      const data =
        await redis(
          "HGETALL",
          key
        );

      const monthKey =
        key.replace(
          "moheji:delivery:month:",
          ""
        );

      monthRows.push({
        monthKey,
        sales:
          toInt(data?.sales),
        orders:
          toInt(data?.orders),
        bestSales:
          toInt(data?.bestSales),
        bestOrders:
          toInt(data?.bestOrders),
      });
    } catch (error) {
      monthRows.push({
        monthKey:
          key.replace(
            "moheji:delivery:month:",
            ""
          ),
        sales: 0,
        orders: 0,
        bestSales: 0,
        bestOrders: 0,
        error: error.message,
      });
    }
  }

  monthRows.sort((a, b) =>
    a.monthKey.localeCompare(
      b.monthKey
    )
  );

  lines.push("【月別Redis】");

  for (const row of monthRows) {
    lines.push(
      `${row.monthKey} ` +
      `${row.sales.toLocaleString()}円 / ` +
      `${row.orders}件 / ` +
      `bestSales=${row.bestSales.toLocaleString()} / ` +
      `bestOrders=${row.bestOrders}`
    );
  }

  lines.push("");

  // ----------------------------------------------------------
  // 年別Redis
  // ----------------------------------------------------------

  const yearKeys =
    await scanKeys(
      "moheji:delivery:year:*"
    );

  lines.push("【年別Redis】");

  for (const key of yearKeys) {
    try {
      const data =
        await redis(
          "HGETALL",
          key
        );

      const yearKey =
        key.replace(
          "moheji:delivery:year:",
          ""
        );

      lines.push(
        `${yearKey} ` +
        `${toInt(data?.sales).toLocaleString()}円 / ` +
        `${toInt(data?.orders)}件`
      );
    } catch (error) {
      lines.push(
        `${key} READ ERROR ${error.message}`
      );
    }
  }

  lines.push("");

  // ----------------------------------------------------------
  // 現在月 個別 vs Redis
  // ----------------------------------------------------------

  let detectedCurrentMonthSales = 0;
  let detectedCurrentMonthOrders = 0;

  for (const item of detectedRecords) {
    const r =
      item.record || {};

    if (r.cancelled) {
      continue;
    }

    const recordMonth =
      r.monthKey ||
      (
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(r.dateKey || "")
        )
          ? String(r.dateKey).slice(0, 7)
          : ""
      );

    if (recordMonth !== month) {
      continue;
    }

    detectedCurrentMonthSales +=
      toInt(r.sales);

    detectedCurrentMonthOrders +=
      toInt(r.orders);
  }

  const redisMonthSales =
    toInt(currentMonthRedis?.sales);

  const redisMonthOrders =
    toInt(currentMonthRedis?.orders);

  lines.push(
    "【現在月：検出個別記録 vs Redis】"
  );

  lines.push(
    `個別　${detectedCurrentMonthSales.toLocaleString()}円 / ${detectedCurrentMonthOrders}件`
  );

  lines.push(
    `Redis　${redisMonthSales.toLocaleString()}円 / ${redisMonthOrders}件`
  );

  lines.push(
    `差額　${(
      redisMonthSales -
      detectedCurrentMonthSales
    ).toLocaleString()}円 / ${
      redisMonthOrders -
      detectedCurrentMonthOrders
    }件`
  );

  lines.push("");

  // ----------------------------------------------------------
  // 旧records
  // ----------------------------------------------------------

  lines.push("【旧形式 records キー】");

  if (legacyRecordKeys.length === 0) {
    lines.push("検出なし");
  } else {
    for (const item of legacyRecordKeys) {
      lines.push(
        `KEY=${item.key}`
      );

      lines.push(
        `TYPE=${item.type}`
      );

      lines.push(
        `DATA=${JSON.stringify(
          item.values
        ).slice(0, 5000)}`
      );

      lines.push("");
    }
  }

  // ----------------------------------------------------------
  // 最終サマリー
  // ----------------------------------------------------------

  lines.push("");

  lines.push("【調査サマリー】");

  lines.push(
    `全 delivery キー　${allDeliveryKeys.length}件`
  );

  lines.push(
    `個別記録候補　${recordCandidateKeys.length}件`
  );

  lines.push(
    `JSON個別記録　${detectedRecords.length}件`
  );

  lines.push(
    `現在chatIdの新形式　${currentRecordKeys.length}件`
  );

  lines.push(
    `旧 records キー　${legacyRecordKeys.length}件`
  );

  lines.push("");

  lines.push(
    "※DEBUGではRedisへの書き込みを行っていません。"
  );

  return lines.join("\n");
}


// ============================================================
// Telegram command parser
// ============================================================

function parseCommand(text) {
  if (!text) {
    return null;
  }

  const trimmed =
    String(text).trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts =
    trimmed.split(/\s+/);

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
// Telegram webhook
// ============================================================

export default async function handler(req, res) {
  // ----------------------------------------------------------
  // DEBUG GET
  // ----------------------------------------------------------

  if (req.method === "GET") {
    const url =
      new URL(
        req.url,
        "http://localhost"
      );

    const debug =
      url.searchParams.get("debug");

    const key =
      url.searchParams.get("key");

    const chatId =
      url.searchParams.get("chat_id");

    if (debug === "1") {
      if (
        !DEBUG_KEY ||
        key !== DEBUG_KEY
      ) {
        res.status(403).json({
          ok: false,
          error: "forbidden",
        });
        return;
      }

      if (!chatId) {
        res.status(400).json({
          ok: false,
          error: "chat_id required",
        });
        return;
      }

      try {
        const report =
          await buildDebugReport(
            chatId
          );

        res.status(200).json({
          ok: true,
          report,
        });

        return;
      } catch (error) {
        console.error(
          "debug error:",
          error
        );

        res.status(500).json({
          ok: false,
          error:
            String(
              error.message ||
              error
            ),
        });

        return;
      }
    }

    res.status(200).json({
      ok: true,
    });

    return;
  }


  // ----------------------------------------------------------
  // Telegram POST only
  // ----------------------------------------------------------

  if (req.method !== "POST") {
    res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
    return;
  }

  try {
    const update = req.body;

    const message =
      update?.message;

    if (!message) {
      res.status(200).json({
        ok: true,
      });
      return;
    }

    const chatId =
      message?.chat?.id;

    const text =
      message?.text;

    if (!chatId || !text) {
      res.status(200).json({
        ok: true,
      });
      return;
    }

    const parsed =
      parseCommand(text);

    if (!parsed) {
      res.status(200).json({
        ok: true,
      });
      return;
    }


    // ========================================================
    // /sales
    // ========================================================

    if (parsed.command === "/sales") {
      if (parsed.args.length !== 2) {
        await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
              "使い方：\n/sales 売上 件数\n例：/sales 17014 17",
          }
        );

        res.status(200).json({
          ok: true,
        });

        return;
      }

      const sales =
        Number(parsed.args[0]);

      const orders =
        Number(parsed.args[1]);

      if (
        !Number.isInteger(sales) ||
        sales < 0 ||
        !Number.isInteger(orders) ||
        orders < 0
      ) {
        await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
              "売上と件数は0以上の整数で入力してください。",
          }
        );

        res.status(200).json({
          ok: true,
        });

        return;
      }

      await processSales(
        chatId,
        sales,
        orders
      );

      const report =
        await buildSalesReport();

      await telegram(
        "sendPhoto",
        {
          chat_id: chatId,
          photo: SALES_IMAGE_URL,
          caption: report,
        }
      );

      res.status(200).json({
        ok: true,
      });

      return;
    }


    // ========================================================
    // /cancel
    // ========================================================

    if (parsed.command === "/cancel") {
      if (parsed.args.length !== 0) {
        await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
              "/cancel は引数なしで使用してください。",
          }
        );

        res.status(200).json({
          ok: true,
        });

        return;
      }

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
              "取消できる売上記録がありません。",
          }
        );

        res.status(200).json({
          ok: true,
        });

        return;
      }

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
            [
              "↩️ 最新の配達売上を取消しました。",
              "",
              `📅 ${cancelled.dateKey}`,
              `💰 ${toInt(cancelled.sales).toLocaleString()}円`,
              `📦 ${toInt(cancelled.orders)}件`,
            ].join("\n"),
        }
      );

      res.status(200).json({
        ok: true,
      });

      return;
    }


    // ========================================================
    // /record
    // ========================================================

    if (parsed.command === "/record") {
      if (parsed.args.length !== 0) {
        await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
              "/record は引数なしで使用してください。",
          }
        );

        res.status(200).json({
          ok: true,
        });

        return;
      }

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

      res.status(200).json({
        ok: true,
      });

      return;
    }

    // --------------------------------------------------------
    // 念のため
    // --------------------------------------------------------

    res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "telegram handler error:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        String(
          error.message ||
          error
        ),
    });
  }
}
