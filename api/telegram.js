const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const DEBUG_KEY = process.env.DEBUG_KEY;

const IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTHLY_GOAL = 500000;

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

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}

// 複数Redisコマンドを1 HTTPリクエストで実行
// 通常のpipelineなので高速化用。
// 原子性が必要な書き込みは multi-exec を使用。
async function redisPipeline(commands) {
  if (!commands.length) {
    return [];
  }

  const response = await fetch(
    `${KV_REST_API_URL}/pipeline`,
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

  if (!Array.isArray(data)) {
    if (data?.error) {
      throw new Error(data.error);
    }

    throw new Error(
      "Invalid Redis pipeline response"
    );
  }

  for (const item of data) {
    if (item?.error) {
      throw new Error(item.error);
    }
  }

  return data.map((item) => item?.result);
}

async function redisMulti(commands) {
  if (!commands.length) {
    return [];
  }

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

  if (data?.error) {
    throw new Error(data.error);
  }

  if (!Array.isArray(data)) {
    throw new Error(
      "Invalid Redis transaction response"
    );
  }

  for (const item of data) {
    if (item?.error) {
      throw new Error(item.error);
    }
  }

  return data.map((item) => item?.result);
}

// ============================================================
// HGETALL normalization
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

    if (
      field !== undefined &&
      field !== null
    ) {
      result[String(field)] =
        fieldValue === undefined ||
        fieldValue === null
          ? ""
          : String(fieldValue);
    }
  }

  return result;
}

// ============================================================
// Utility
// ============================================================

function toInt(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? Math.trunc(n)
    : 0;
}

function formatNumber(value) {
  return toInt(value).toLocaleString("ja-JP");
}

function parseTimestamp(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const text = String(value);

  if (/^\d+$/.test(text)) {
    const n = Number(text);

    if (n > 0) {
      return n < 1000000000000
        ? n * 1000
        : n;
    }
  }

  const parsed = Date.parse(text);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function isCancelledRecord(record) {
  return (
    record.cancelled === true ||
    record.cancelled === 1 ||
    record.cancelled === "1" ||
    record.status === "cancelled"
  );
}

function getDateKey(date = new Date()) {
  const y = date.getFullYear();

  const m = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const d = String(
    date.getDate()
  ).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function getMonthKey(date = new Date()) {
  const y = date.getFullYear();

  const m = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  return `${y}-${m}`;
}

function getYearKey(date = new Date()) {
  return String(date.getFullYear());
}

function monthFromDateKey(dateKey) {
  return typeof dateKey === "string"
    ? dateKey.slice(0, 7)
    : "";
}

function yearFromDateKey(dateKey) {
  return typeof dateKey === "string"
    ? dateKey.slice(0, 4)
    : "";
}

// ============================================================
// SCAN
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

    cursor = String(
      result?.[0] ?? "0"
    );

    const batch =
      Array.isArray(result?.[1])
        ? result[1]
        : [];

    keys.push(...batch);
  } while (cursor !== "0");

  return keys;
}

// ============================================================
// Record helpers
// ============================================================

function getRecordIdFromKey(key) {
  const parts = String(key).split(":");

  return (
    parts[parts.length - 1] || ""
  );
}

function getChatIdFromKey(key) {
  const match = String(key).match(
    /^moheji:delivery:record:(-?\d+):/
  );

  return match
    ? match[1]
    : "";
}

function normalizeRecord(raw, key) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const recordId =
    raw.recordId ||
    raw.id ||
    getRecordIdFromKey(key);

  const dateKey =
    raw.dateKey || "";

  const chatId =
    raw.chatId !== undefined &&
    raw.chatId !== null
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

  const cancelled =
    isCancelledRecord(raw);

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
    status: cancelled
      ? "cancelled"
      : "active",
    createdAt:
      raw.createdAt ?? "",
    cancelledAt:
      raw.cancelledAt ?? "",
    raw,
  };
}

// ============================================================
// 高速：record:* をpipelineで一括取得
//
// 今回は既存recordの型がHASH/STRING混在しているため、
// TYPE → GET/HGETALL を1 HTTPリクエストにまとめる。
// ============================================================

async function getAllRecordHistory() {
  const keys = await scanKeys(
    "moheji:delivery:record:*"
  );

  if (!keys.length) {
    return [];
  }

  // TYPEを一括取得
  const typeCommands = keys.map(
    (key) => ["TYPE", key]
  );

  const types =
    await redisPipeline(
      typeCommands
    );

  const valueCommands = [];

  const valueMeta = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const type = types[i];

    if (type === "string") {
      valueCommands.push([
        "GET",
        key,
      ]);

      valueMeta.push({
        key,
        type: "string",
      });
    } else if (type === "hash") {
      valueCommands.push([
        "HGETALL",
        key,
      ]);

      valueMeta.push({
        key,
        type: "hash",
      });
    }
  }

  if (!valueCommands.length) {
    return [];
  }

  const values =
    await redisPipeline(
      valueCommands
    );

  const records = [];

  for (
    let i = 0;
    i < values.length;
    i++
  ) {
    const meta = valueMeta[i];
    const value = values[i];

    if (
      meta.type === "string"
    ) {
      if (!value) {
        continue;
      }

      try {
        const parsed =
          typeof value === "string"
            ? JSON.parse(value)
            : value;

        const record =
          normalizeRecord(
            parsed,
            meta.key
          );

        if (record) {
          records.push(record);
        }
      } catch {
        // 壊れたSTRINGは無視
      }
    }

    if (
      meta.type === "hash"
    ) {
      const hash =
        hashArrayToObject(
          value
        );

      if (
        Object.keys(hash).length
      ) {
        const record =
          normalizeRecord(
            hash,
            meta.key
          );

        if (record) {
          records.push(record);
        }
      }
    }
  }

  records.sort(
    (a, b) =>
      parseTimestamp(
        b.createdAt
      ) -
      parseTimestamp(
        a.createdAt
      )
  );

  return records;
}

async function getRecordHistory(
  chatId,
  allRecords = null
) {
  const records =
    allRecords ||
    await getAllRecordHistory();

  const target =
    String(chatId);

  return records.filter(
    (record) =>
      String(record.chatId) ===
      target
  );
}

// ============================================================
// HASH一括取得
// ============================================================

async function getHashes(keys) {
  if (!keys.length) {
    return [];
  }

  const commands = keys.map(
    (key) => [
      "HGETALL",
      key,
    ]
  );

  const values =
    await redisPipeline(
      commands
    );

  return values.map(
    (value) =>
      hashArrayToObject(value)
  );
}

// ============================================================
// Working days
// ============================================================

async function getWorkingDays(
  monthKey
) {
  const keys = await scanKeys(
    `moheji:delivery:daily:${monthKey}-*`
  );

  if (!keys.length) {
    return 0;
  }

  const hashes =
    await getHashes(keys);

  let count = 0;

  for (const data of hashes) {
    const sales =
      toInt(data.sales);

    const orders =
      toInt(data.orders);

    if (
      sales > 0 ||
      orders > 0
    ) {
      count++;
    }
  }

  return count;
}

// ============================================================
// Best calculation
// ============================================================

function calculateBest(
  records,
  dateKey = null,
  monthKey = null
) {
  const active =
    records.filter((r) => {
      if (r.cancelled) {
        return false;
      }

      if (
        dateKey &&
        r.dateKey !== dateKey
      ) {
        return false;
      }

      if (
        monthKey &&
        r.monthKey !== monthKey
      ) {
        return false;
      }

      return true;
    });

  return {
    bestSales:
      active.reduce(
        (max, r) =>
          Math.max(
            max,
            r.sales
          ),
        0
      ),

    bestOrders:
      active.reduce(
        (max, r) =>
          Math.max(
            max,
            r.orders
          ),
        0
      ),
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
  const now =
    new Date();

  const dateKey =
    getDateKey(now);

  const monthKey =
    getMonthKey(now);

  const yearKey =
    getYearKey(now);

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
    createdAt:
      now.toISOString(),
  };

  // すべて1回のtransaction
  await redisMulti([
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
  ]);

  // /salesでは全recordを再スキャンしない。
  // 今回追加したrecordがその日の最高かだけを既存HASHと比較。
  const [daily, monthly] =
    await getHashes([
      `moheji:delivery:daily:${dateKey}`,
      `moheji:delivery:month:${monthKey}`,
    ]);

  const currentBestSales =
    toInt(daily.bestSales);

  const currentBestOrders =
    toInt(daily.bestOrders);

  const monthBestSales =
    toInt(monthly.bestSales);

  const monthBestOrders =
    toInt(monthly.bestOrders);

  const newDailyBestSales =
    Math.max(
      currentBestSales,
      sales
    );

  const newDailyBestOrders =
    Math.max(
      currentBestOrders,
      orders
    );

  const newMonthBestSales =
    Math.max(
      monthBestSales,
      sales
    );

  const newMonthBestOrders =
    Math.max(
      monthBestOrders,
      orders
    );

  await redisPipeline([
    [
      "HSET",
      `moheji:delivery:daily:${dateKey}`,
      "bestSales",
      newDailyBestSales,
      "bestOrders",
      newDailyBestOrders,
    ],
    [
      "HSET",
      `moheji:delivery:month:${monthKey}`,
      "bestSales",
      newMonthBestSales,
      "bestOrders",
      newMonthBestOrders,
    ],
  ]);

  return record;
}

// ============================================================
// /cancel
// ============================================================

async function cancelLatestSale(
  chatId
) {
  // ここだけ全recordを1回読む。
  // 以前はこの後に何度も読み直していた。
  const allRecords =
    await getAllRecordHistory();

  const records =
    getRecordHistory(
      chatId,
      allRecords
    );

  const active =
    records
      .filter(
        (r) => !r.cancelled
      )
      .sort(
        (a, b) =>
          parseTimestamp(
            b.createdAt
          ) -
          parseTimestamp(
            a.createdAt
          )
      );

  if (!active.length) {
    return {
      ok: false,
      message:
        "キャンセルできる売上がありません。",
    };
  }

  const target =
    active[0];

  const dateKey =
    target.dateKey;

  const monthKey =
    target.monthKey ||
    monthFromDateKey(
      dateKey
    );

  const yearKey =
    target.yearKey ||
    yearFromDateKey(
      dateKey
    );

  const now =
    new Date();

  const updatedRaw = {
    ...target.raw,
    cancelled: true,
    status: "cancelled",
    cancelledAt:
      now.toISOString(),
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

  // HASH / STRING の形式を維持
  if (
    target.raw &&
    typeof target.raw === "object" &&
    !Array.isArray(target.raw)
  ) {
    const hset = [
      "HSET",
      target.key,
    ];

    for (
      const [field, value]
      of Object.entries(updatedRaw)
    ) {
      hset.push(
        field,
        value
      );
    }

    commands.push(hset);
  } else {
    commands.push([
      "SET",
      target.key,
      JSON.stringify(
        updatedRaw
      ),
    ]);
  }

  await redisMulti(
    commands
  );

  // 重要：
  // ここでは全recordを再取得しない。
  // 既存bestを必要に応じて確認するだけ。
  //
  // キャンセル対象がbestだった場合だけ再計算する。
  const [daily, monthly] =
    await getHashes([
      `moheji:delivery:daily:${dateKey}`,
      `moheji:delivery:month:${monthKey}`,
    ]);

  const wasDailyBest =
    target.sales ===
      toInt(daily.bestSales) ||
    target.orders ===
      toInt(daily.bestOrders);

  const wasMonthlyBest =
    target.sales ===
      toInt(monthly.bestSales) ||
    target.orders ===
      toInt(monthly.bestOrders);

  if (
    wasDailyBest ||
    wasMonthlyBest
  ) {
    const remaining =
      records.filter(
        (r) =>
          r.recordId !==
            target.recordId &&
          !r.cancelled
      );

    const pipeline = [];

    if (wasDailyBest) {
      const best =
        calculateBest(
          remaining,
          dateKey,
          null
        );

      pipeline.push([
        "HSET",
        `moheji:delivery:daily:${dateKey}`,
        "bestSales",
        best.bestSales,
        "bestOrders",
        best.bestOrders,
      ]);
    }

    if (wasMonthlyBest) {
      const best =
        calculateBest(
          remaining,
          null,
          monthKey
        );

      pipeline.push([
        "HSET",
        `moheji:delivery:month:${monthKey}`,
        "bestSales",
        best.bestSales,
        "bestOrders",
        best.bestOrders,
      ]);
    }

    if (pipeline.length) {
      await redisPipeline(
        pipeline
      );
    }
  }

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
// /sales report
// ============================================================

async function buildSalesReport() {
  const now =
    new Date();

  const dateKey =
    getDateKey(now);

  const monthKey =
    getMonthKey(now);

  const yearKey =
    getYearKey(now);

  // 5つのHGETALLを1 HTTP request
  const [
    daily,
    monthly,
    yearly,
    alltime,
  ] = await getHashes([
    `moheji:delivery:daily:${dateKey}`,
    `moheji:delivery:month:${monthKey}`,
    `moheji:delivery:year:${yearKey}`,
    "moheji:delivery:alltime",
  ]);

  const todaySales =
    toInt(daily.sales);

  const todayOrders =
    toInt(daily.orders);

  const monthSales =
    toInt(monthly.sales);

  const monthOrders =
    toInt(monthly.orders);

  const yearSales =
    toInt(yearly.sales);

  const yearOrders =
    toInt(yearly.orders);

  const alltimeOrders =
    toInt(alltime.orders);

  const bestSales =
    toInt(monthly.bestSales);

  const bestOrders =
    toInt(monthly.bestOrders);

  const workingDays =
    await getWorkingDays(
      monthKey
    );

  const averagePerDay =
    workingDays > 0
      ? Math.round(
          monthSales /
          workingDays
        )
      : 0;

  const achievement =
    MONTHLY_GOAL > 0
      ? Math.floor(
          (monthSales /
            MONTHLY_GOAL) *
            100
        )
      : 0;

  const perOrder =
    todayOrders > 0
      ? Math.round(
          todaySales /
          todayOrders
        )
      : 0;

  const timeText =
    `${now.getFullYear()}年` +
    `${now.getMonth() + 1}月` +
    `${now.getDate()}日 ` +
    `${String(
      now.getHours()
    ).padStart(2, "0")}:` +
    `${String(
      now.getMinutes()
    ).padStart(2, "0")}`;

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
// /record
// ============================================================

async function buildRecordReport(
  chatId
) {
  const now =
    new Date();

  const monthKey =
    getMonthKey(now);

  // record取得は1回だけ
  const allRecords =
    await getAllRecordHistory();

  const records =
    getRecordHistory(
      chatId,
      allRecords
    );

  const monthRecords =
    records
      .filter(
        (r) =>
          r.monthKey ===
          monthKey
      )
      .sort(
        (a, b) =>
          parseTimestamp(
            b.createdAt
          ) -
          parseTimestamp(
            a.createdAt
          )
      );

  // HASHは別の1 HTTP request
  const [monthData] =
    await getHashes([
      `moheji:delivery:month:${monthKey}`,
    ]);

  const monthlySales =
    toInt(monthData.sales);

  const monthlyOrders =
    toInt(monthData.orders);

  const activeRecords =
    monthRecords.filter(
      (r) => !r.cancelled
    );

  const recordSales =
    activeRecords.reduce(
      (sum, r) =>
        sum + r.sales,
      0
    );

  const recordOrders =
    activeRecords.reduce(
      (sum, r) =>
        sum + r.orders,
      0
    );

  const lines = [];

  lines.push(
    "📋 配達売上記録"
  );

  lines.push("");

  lines.push(
    `📅 ${monthKey}`
  );

  lines.push(
    `💰 月間集計　${formatNumber(
      monthlySales
    )}円`
  );

  lines.push(
    `📦 月間件数　${formatNumber(
      monthlyOrders
    )}件`
  );

  lines.push("");

  lines.push(
    "【個別記録】"
  );

  if (!monthRecords.length) {
    lines.push(
      "記録なし"
    );
  } else {
    for (
      const record
      of monthRecords
    ) {
      const status =
        record.cancelled
          ? "❌取消"
          : "✅有効";

      const timestamp =
        parseTimestamp(
          record.createdAt
        );

      const created =
        timestamp
          ? new Date(
              timestamp
            ).toLocaleString(
              "ja-JP",
              {
                timeZone:
                  "Asia/Tokyo",
              }
            )
          : "-";

      lines.push(
        `${status} ${record.dateKey} ${created}`
      );

      lines.push(
        `　${formatNumber(
          record.sales
        )}円 / ${formatNumber(
          record.orders
        )}件`
      );

      lines.push(
        `　ID: ${record.recordId}`
      );
    }
  }

  lines.push("");

  lines.push(
    "【監査比較】"
  );

  lines.push(
    `個別記録合計　${formatNumber(
      recordSales
    )}円 / ${formatNumber(
      recordOrders
    )}件`
  );

  lines.push(
    `月間HASH　　 ${formatNumber(
      monthlySales
    )}円 / ${formatNumber(
      monthlyOrders
    )}件`
  );

  if (
    recordSales ===
      monthlySales &&
    recordOrders ===
      monthlyOrders
  ) {
    lines.push(
      "✅ 一致しています"
    );
  } else {
    lines.push(
      "⚠️ 差異があります"
    );
  }

  return lines.join(
    "\n"
  );
}

// ============================================================
// DEBUG
// ============================================================

async function buildDebugReport() {
  const keys =
    await scanKeys(
      "moheji:delivery:*"
    );

  keys.sort();

  const typeCommands =
    keys.map(
      (key) => [
        "TYPE",
        key,
      ]
    );

  const types =
    await redisPipeline(
      typeCommands
    );

  const typeCounts = {};

  for (
    const type
    of types
  ) {
    typeCounts[type] =
      (typeCounts[type] || 0) +
      1;
  }

  const records =
    await getAllRecordHistory();

  const active =
    records.filter(
      (r) => !r.cancelled
    );

  const cancelled =
    records.filter(
      (r) => r.cancelled
    );

  const recordSales =
    active.reduce(
      (sum, r) =>
        sum + r.sales,
      0
    );

  const recordOrders =
    active.reduce(
      (sum, r) =>
        sum + r.orders,
      0
    );

  const now =
    new Date();

  const dateKey =
    getDateKey(now);

  const monthKey =
    getMonthKey(now);

  const yearKey =
    getYearKey(now);

  const [
    daily,
    monthly,
    yearly,
    alltime,
  ] = await getHashes([
    `moheji:delivery:daily:${dateKey}`,
    `moheji:delivery:month:${monthKey}`,
    `moheji:delivery:year:${yearKey}`,
    "moheji:delivery:alltime",
  ]);

  const monthRecords =
    records.filter(
      (r) =>
        r.monthKey ===
          monthKey &&
        !r.cancelled
    );

  const monthRecordSales =
    monthRecords.reduce(
      (sum, r) =>
        sum + r.sales,
      0
    );

  const monthRecordOrders =
    monthRecords.reduce(
      (sum, r) =>
        sum + r.orders,
      0
    );

  const latestActive =
    active[0];

  const lines = [];

  lines.push(
    "🔎 Redis詳細調査レポート"
  );

  lines.push(
    "※この処理は読み取り専用です"
  );

  lines.push(
    "※Redisのデータは変更していません"
  );

  lines.push("");

  lines.push(
    "【キー種別】"
  );

  for (
    const [type, count]
    of Object.entries(
      typeCounts
    )
  ) {
    lines.push(
      `${type.padEnd(
        8
      )} ${count}件`
    );
  }

  lines.push("");

  lines.push(
    `全キー数　${keys.length}件`
  );

  lines.push("");

  lines.push(
    "【個別レコード】"
  );

  lines.push(
    `record:* キー　${
      keys.filter((key) =>
        key.startsWith(
          "moheji:delivery:record:"
        )
      ).length
    }件`
  );

  lines.push(
    `読み取り成功　${records.length}件`
  );

  lines.push(
    `有効　　　　　${active.length}件`
  );

  lines.push(
    `取消　　　　　${cancelled.length}件`
  );

  lines.push(
    `有効売上　　　${formatNumber(
      recordSales
    )}円`
  );

  lines.push(
    `有効件数　　　${formatNumber(
      recordOrders
    )}件`
  );

  lines.push("");

  lines.push(
    "【現在の集計HASH】"
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

  lines.push(
    "【個別記録 最新20件】"
  );

  if (!records.length) {
    lines.push(
      "なし"
    );
  } else {
    for (
      const r
      of records.slice(0, 20)
    ) {
      lines.push(
        `${r.cancelled ? "❌" : "✅"} ` +
        `${r.dateKey || "-"} ` +
        `${formatNumber(
          r.sales
        )}円 / ` +
        `${formatNumber(
          r.orders
        )}件 ` +
        `${r.recordId}`
      );
    }
  }

  lines.push("");

  lines.push(
    "【レコード集計 vs HASH】"
  );

  lines.push(
    `個別記録　${formatNumber(
      monthRecordSales
    )}円 / ${formatNumber(
      monthRecordOrders
    )}件`
  );

  lines.push(
    `月間HASH　${formatNumber(
      toInt(monthly.sales)
    )}円 / ${formatNumber(
      toInt(monthly.orders)
    )}件`
  );

  if (
    monthRecordSales ===
      toInt(monthly.sales) &&
    monthRecordOrders ===
      toInt(monthly.orders)
  ) {
    lines.push(
      "✅ 一致"
    );
  } else {
    lines.push(
      `⚠️ 不一致　差額 ${formatNumber(
        toInt(monthly.sales) -
          monthRecordSales
      )}円 / ${formatNumber(
        toInt(monthly.orders) -
          monthRecordOrders
      )}件`
    );
  }

  lines.push("");

  lines.push(
    "【/cancel 対象確認】"
  );

  if (!latestActive) {
    lines.push(
      "キャンセル対象なし"
    );
  } else {
    lines.push(
      `対象ID　${latestActive.recordId}`
    );

    lines.push(
      `日付　　${latestActive.dateKey}`
    );

    lines.push(
      `売上　　${formatNumber(
        latestActive.sales
      )}円`
    );

    lines.push(
      `件数　　${formatNumber(
        latestActive.orders
      )}件`
    );

    lines.push(
      `キー　　${latestActive.key}`
    );
  }

  return lines.join(
    "\n"
  );
}

// ============================================================
// Telegram
// ============================================================

async function telegram(
  method,
  body
) {
  const response =
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(body),
      }
    );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
        "Telegram API error"
    );
  }

  return data;
}

async function sendMessage(
  chatId,
  text
) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text,
    }
  );
}

async function sendPhoto(
  chatId,
  photo,
  caption
) {
  return telegram(
    "sendPhoto",
    {
      chat_id: chatId,
      photo,
      caption,
    }
  );
}

// ============================================================
// Command parser
// ============================================================

function parseCommand(text) {
  if (!text) {
    return null;
  }

  const trimmed =
    text.trim();

  if (
    !trimmed.startsWith("/")
  ) {
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
// /sales arguments
// ============================================================

function parseSalesArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length < 2
  ) {
    return null;
  }

  const sales =
    Number(args[0]);

  const orders =
    Number(args[1]);

  if (
    !Number.isFinite(sales) ||
    !Number.isFinite(orders) ||
    sales <= 0 ||
    orders <= 0
  ) {
    return null;
  }

  return {
    sales: Math.trunc(
      sales
    ),
    orders: Math.trunc(
      orders
    ),
  };
}

// ============================================================
// HTTP Handler
// ============================================================

export default async function handler(
  req,
  res
) {
  try {
    // --------------------------------------------------------
    // DEBUG
    // --------------------------------------------------------

    if (
      req.method === "GET"
    ) {
      const url =
        new URL(
          req.url,
          `https://${req.headers.host}`
        );

      const debug =
        url.searchParams.get(
          "debug"
        );

      const key =
        url.searchParams.get(
          "key"
        );

      if (
        debug === "1" &&
        DEBUG_KEY &&
        key === DEBUG_KEY
      ) {
        const report =
          await buildDebugReport();

        return res
          .status(200)
          .send(report);
      }

      return res
        .status(200)
        .send("OK");
    }

    // --------------------------------------------------------
    // POST
    // --------------------------------------------------------

    if (
      req.method !== "POST"
    ) {
      return res
        .status(200)
        .send("OK");
    }

    const update =
      req.body;

    const message =
      update?.message;

    if (!message) {
      return res
        .status(200)
        .send("OK");
    }

    const chatId =
      message.chat?.id;

    const text =
      message.text || "";

    if (
      !chatId ||
      !text
    ) {
      return res
        .status(200)
        .send("OK");
    }

    const parsed =
      parseCommand(text);

    if (!parsed) {
      return res
        .status(200)
        .send("OK");
    }

    // ========================================================
    // /sales
    // ========================================================

    if (
      parsed.command ===
      "/sales"
    ) {
      const input =
        parseSalesArgs(
          parsed.args
        );

      if (!input) {
        await sendMessage(
          chatId,
          "使い方：\n/sales 売上 件数\n\n例：\n/sales 17014 17"
        );

        return res
          .status(200)
          .send("OK");
      }

      await processSales(
        chatId,
        input.sales,
        input.orders
      );

      const report =
        await buildSalesReport();

      await sendPhoto(
        chatId,
        IMAGE_URL,
        report
      );

      return res
        .status(200)
        .send("OK");
    }

    // ========================================================
    // /cancel
    // ========================================================

    if (
      parsed.command ===
      "/cancel"
    ) {
      const result =
        await cancelLatestSale(
          chatId
        );

      if (!result.ok) {
        await sendMessage(
          chatId,
          result.message
        );

        return res
          .status(200)
          .send("OK");
      }

      const r =
        result.record;

      await sendMessage(
        chatId,
        `❌ 売上をキャンセルしました\n\n` +
        `📅 ${r.dateKey}\n` +
        `💰 ${formatNumber(
          r.sales
        )}円\n` +
        `📦 ${formatNumber(
          r.orders
        )}件\n` +
        `🆔 ${r.recordId}`
      );

      return res
        .status(200)
        .send("OK");
    }

    // ========================================================
    // /record
    // ========================================================

    if (
      parsed.command ===
      "/record"
    ) {
      const report =
        await buildRecordReport(
          chatId
        );

      await sendMessage(
        chatId,
        report
      );

      return res
        .status(200)
        .send("OK");
    }

    return res
      .status(200)
      .send("OK");
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

    return res
      .status(200)
      .send("OK");
  }
}
