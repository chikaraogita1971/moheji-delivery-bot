// api/telegram.js

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const REPORT_IMAGE_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

const MONTHLY_TARGET = 500000;

// ============================================================
// Redis REST
// ============================================================

async function redis(command, ...args) {
  const response = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      command,
      ...args.map((v) => String(v)),
    ]),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      `Redis error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data.result;
}

// ============================================================
// Redis transaction
// Upstash REST /multi-exec
// ============================================================

async function redisMulti(commands) {
  const response = await fetch(
    `${KV_REST_API_URL}/multi-exec`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        commands.map((command) =>
          command.map((v) => String(v))
        )
      ),
    }
  );

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      `Redis transaction error ${response.status}: ${JSON.stringify(
        data
      )}`
    );
  }

  // 正常時:
  // [
  //   {"result":"OK"},
  //   {"result":1},
  //   ...
  // ]
  if (!Array.isArray(data)) {
    throw new Error(
      `Redis transaction invalid response: ${JSON.stringify(
        data
      )}`
    );
  }

  const failed = data.find(
    (item) => item && item.error
  );

  if (failed) {
    throw new Error(
      `Redis transaction command error: ${JSON.stringify(
        failed
      )}`
    );
  }

  return data;
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
      `Telegram error ${response.status}: ${JSON.stringify(
        data
      )}`
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
    photo: REPORT_IMAGE_URL,
    caption,
  });
}

// ============================================================
// Date / JST
// ============================================================

function getDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find(
    (x) => x.type === "year"
  )?.value;

  const month = parts.find(
    (x) => x.type === "month"
  )?.value;

  const day = parts.find(
    (x) => x.type === "day"
  )?.value;

  return `${year}-${month}-${day}`;
}

function getMonthKey(date = new Date()) {
  return getDateKey(date).slice(0, 7);
}

function getYearKey(date = new Date()) {
  return getDateKey(date).slice(0, 4);
}

function formatDateTimeJST(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) =>
    parts.find((x) => x.type === type)?.value || "";

  return `${get("year")}年${get("month")}月${get(
    "day"
  )}日 ${get("hour")}:${get("minute")}`;
}

// ============================================================
// Keys
// ============================================================

function dailyRedisKey(dateKey) {
  return `moheji:delivery:daily:${dateKey}`;
}

function monthlyRedisKey(monthKey) {
  return `moheji:delivery:month:${monthKey}`;
}

function yearlyRedisKey(yearKey) {
  return `moheji:delivery:year:${yearKey}`;
}

function alltimeRedisKey() {
  return `moheji:delivery:alltime`;
}

function recordsRedisKey(chatId) {
  return `moheji:delivery:records:${chatId}`;
}

function recordRedisKey(chatId, recordId) {
  return `moheji:delivery:record:${chatId}:${recordId}`;
}

// ============================================================
// Utility
// ============================================================

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatYen(value) {
  return Math.round(
    toNumber(value)
  ).toLocaleString("ja-JP");
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

// ============================================================
// Hash
// ============================================================

async function hgetNumber(key, field) {
  const value = await redis(
    "HGET",
    key,
    field
  );

  return toNumber(value);
}

// ============================================================
// Daily
// ============================================================

async function getDaily(dateKey) {
  const key = dailyRedisKey(dateKey);

  const values = await redis(
    "HMGET",
    key,
    "sales",
    "orders",
    "bestSales",
    "bestOrders"
  );

  return {
    sales: toNumber(values?.[0]),
    orders: toNumber(values?.[1]),
    bestSales: toNumber(values?.[2]),
    bestOrders: toNumber(values?.[3]),
  };
}

// ============================================================
// Monthly
// ============================================================

async function getMonth(monthKeyValue) {
  const key = monthlyRedisKey(monthKeyValue);

  const values = await redis(
    "HMGET",
    key,
    "sales",
    "orders",
    "bestSales",
    "bestOrders"
  );

  return {
    sales: toNumber(values?.[0]),
    orders: toNumber(values?.[1]),
    bestSales: toNumber(values?.[2]),
    bestOrders: toNumber(values?.[3]),
  };
}

// ============================================================
// Yearly
// ============================================================

async function getYear(yearKeyValue) {
  const key = yearlyRedisKey(yearKeyValue);

  const values = await redis(
    "HMGET",
    key,
    "sales",
    "orders"
  );

  return {
    sales: toNumber(values?.[0]),
    orders: toNumber(values?.[1]),
  };
}

// ============================================================
// All time
// ============================================================

async function getAlltime() {
  const key = alltimeRedisKey();

  const values = await redis(
    "HMGET",
    key,
    "sales",
    "orders"
  );

  return {
    sales: toNumber(values?.[0]),
    orders: toNumber(values?.[1]),
  };
}

// ============================================================
// 稼働日数
//
// workingdaysキーは使わない。
// 日別キーのorders > 0を稼働日として数える。
// ============================================================

async function getWorkingDays(month) {
  let cursor = "0";
  let count = 0;

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      `moheji:delivery:daily:${month}-*`,
      "COUNT",
      "100"
    );

    cursor = String(
      result?.[0] ?? "0"
    );

    const keys = result?.[1] || [];

    if (keys.length > 0) {
      const commands = keys.map((key) => [
        "HGET",
        key,
        "orders",
      ]);

      const results = await redisMulti(
        commands
      );

      for (const item of results) {
        const orders = toNumber(
          item?.result
        );

        if (orders > 0) {
          count++;
        }
      }
    }
  } while (cursor !== "0");

  return count;
}

// ============================================================
// Daily keys
// ============================================================

async function getDailyKeys(month) {
  let cursor = "0";
  const keys = [];

  do {
    const result = await redis(
      "SCAN",
      cursor,
      "MATCH",
      `moheji:delivery:daily:${month}-*`,
      "COUNT",
      "100"
    );

    cursor = String(
      result?.[0] ?? "0"
    );

    const found = result?.[1] || [];

    keys.push(...found);
  } while (cursor !== "0");

  return keys;
}

// ============================================================
// Monthly best
// ============================================================

async function getMonthlyBest(month) {
  const monthData = await getMonth(month);

  let bestSales = monthData.bestSales;
  let bestOrders = monthData.bestOrders;

  const keys = await getDailyKeys(month);

  if (keys.length === 0) {
    return {
      bestSales,
      bestOrders,
    };
  }

  const commands = keys.map((key) => [
    "HMGET",
    key,
    "sales",
    "orders",
  ]);

  const results = await redisMulti(
    commands
  );

  for (const item of results) {
    const sales = toNumber(
      item?.result?.[0]
    );

    const orders = toNumber(
      item?.result?.[1]
    );

    if (sales > bestSales) {
      bestSales = sales;
    }

    if (orders > bestOrders) {
      bestOrders = orders;
    }
  }

  return {
    bestSales,
    bestOrders,
  };
}

// ============================================================
// Record ID
// ============================================================

function makeRecordId() {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

// ============================================================
// SALES
//
// 重要:
// 1. recordを作る
// 2. 日別/月別/年別/alltimeを加算
// 3. record indexへ登録
//
// 全部同じ /multi-exec。
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

  const dKey = dailyRedisKey(dateKey);
  const mKey = monthlyRedisKey(month);
  const yKey = yearlyRedisKey(year);
  const aKey = alltimeRedisKey();

  const listKey = recordsRedisKey(chatId);

  const recordId = makeRecordId();
  const rKey = recordRedisKey(
    chatId,
    recordId
  );

  const record = {
    id: recordId,
    dateKey,
    sales,
    orders,
    cancelled: false,
    createdAt: now.toISOString(),
  };

  // 現在のbestを取得
  const [
    dailyBestSales,
    dailyBestOrders,
    monthBestSales,
    monthBestOrders,
  ] = await Promise.all([
    hgetNumber(dKey, "bestSales"),
    hgetNumber(dKey, "bestOrders"),
    hgetNumber(mKey, "bestSales"),
    hgetNumber(mKey, "bestOrders"),
  ]);

  const newDailyBestSales =
    Math.max(
      dailyBestSales,
      sales
    );

  const newDailyBestOrders =
    Math.max(
      dailyBestOrders,
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

  const commands = [
    // 日別
    [
      "HINCRBY",
      dKey,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      dKey,
      "orders",
      orders,
    ],
    [
      "HSET",
      dKey,
      "bestSales",
      newDailyBestSales,
      "bestOrders",
      newDailyBestOrders,
    ],

    // 月別
    [
      "HINCRBY",
      mKey,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      mKey,
      "orders",
      orders,
    ],
    [
      "HSET",
      mKey,
      "bestSales",
      newMonthBestSales,
      "bestOrders",
      newMonthBestOrders,
    ],

    // 年間
    [
      "HINCRBY",
      yKey,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      yKey,
      "orders",
      orders,
    ],

    // 累計
    [
      "HINCRBY",
      aKey,
      "sales",
      sales,
    ],
    [
      "HINCRBY",
      aKey,
      "orders",
      orders,
    ],

    // 個別record
    [
      "SET",
      rKey,
      JSON.stringify(record),
    ],

    // record index
    [
      "ZADD",
      listKey,
      Date.now(),
      recordId,
    ],
  ];

  await redisMulti(commands);

  return buildReport();
}

// ============================================================
// CANCEL
//
// 最新の未キャンセルrecordを取得。
// record.dateKeyを使用するので、
// 日付をまたいでも正しい日から減算する。
// ============================================================

async function getLatestActiveRecord(chatId) {
  const listKey = recordsRedisKey(
    chatId
  );

  const ids = await redis(
    "ZREVRANGE",
    listKey,
    "0",
    "200"
  );

  if (!ids || ids.length === 0) {
    return null;
  }

  const commands = ids.map((id) => [
    "GET",
    recordRedisKey(chatId, id),
  ]);

  const results = await redisMulti(
    commands
  );

  for (const item of results) {
    if (
      !item ||
      !item.result
    ) {
      continue;
    }

    try {
      const record =
        JSON.parse(item.result);

      if (
        record &&
        record.cancelled !== true
      ) {
        return record;
      }
    } catch {
      // 無効なrecordは無視
    }
  }

  return null;
}

async function processCancel(chatId) {
  const record =
    await getLatestActiveRecord(
      chatId
    );

  if (!record) {
    return "❌ キャンセルできる売上記録がありません。";
  }

  const dateKey = record.dateKey;
  const month = dateKey.slice(0, 7);
  const year = dateKey.slice(0, 4);

  const dKey =
    dailyRedisKey(dateKey);

  const mKey =
    monthlyRedisKey(month);

  const yKey =
    yearlyRedisKey(year);

  const aKey =
    alltimeRedisKey();

  const rKey =
    recordRedisKey(
      chatId,
      record.id
    );

  const [
    dailySales,
    dailyOrders,
    monthSales,
    monthOrders,
    yearSales,
    yearOrders,
    alltimeSales,
    alltimeOrders,
  ] = await Promise.all([
    hgetNumber(dKey, "sales"),
    hgetNumber(dKey, "orders"),
    hgetNumber(mKey, "sales"),
    hgetNumber(mKey, "orders"),
    hgetNumber(yKey, "sales"),
    hgetNumber(yKey, "orders"),
    hgetNumber(aKey, "sales"),
    hgetNumber(aKey, "orders"),
  ]);

  const newDailySales =
    Math.max(
      0,
      dailySales - record.sales
    );

  const newDailyOrders =
    Math.max(
      0,
      dailyOrders - record.orders
    );

  const newMonthSales =
    Math.max(
      0,
      monthSales - record.sales
    );

  const newMonthOrders =
    Math.max(
      0,
      monthOrders - record.orders
    );

  const newYearSales =
    Math.max(
      0,
      yearSales - record.sales
    );

  const newYearOrders =
    Math.max(
      0,
      yearOrders - record.orders
    );

  const newAlltimeSales =
    Math.max(
      0,
      alltimeSales - record.sales
    );

  const newAlltimeOrders =
    Math.max(
      0,
      alltimeOrders - record.orders
    );

  const cancelledRecord = {
    ...record,
    cancelled: true,
    cancelledAt:
      new Date().toISOString(),
  };

  await redisMulti([
    [
      "HSET",
      dKey,
      "sales",
      newDailySales,
      "orders",
      newDailyOrders,
    ],

    [
      "HSET",
      mKey,
      "sales",
      newMonthSales,
      "orders",
      newMonthOrders,
    ],

    [
      "HSET",
      yKey,
      "sales",
      newYearSales,
      "orders",
      newYearOrders,
    ],

    [
      "HSET",
      aKey,
      "sales",
      newAlltimeSales,
      "orders",
      newAlltimeOrders,
    ],

    [
      "SET",
      rKey,
      JSON.stringify(
        cancelledRecord
      ),
    ],
  ]);

  return [
    "↩️ 売上をキャンセルしました。",
    `💰 ${formatYen(
      record.sales
    )}円`,
    `📦 ${record.orders}件`,
    `📅 ${record.dateKey}`,
  ].join("\n");
}

// ============================================================
// SALES REPORT
// ============================================================

async function buildReport() {
  const now = new Date();

  const dateKey =
    getDateKey(now);

  const month =
    getMonthKey(now);

  const year =
    getYearKey(now);

  const [
    daily,
    monthly,
    yearly,
    alltime,
    workingDays,
    monthlyBest,
  ] = await Promise.all([
    getDaily(dateKey),
    getMonth(month),
    getYear(year),
    getAlltime(),
    getWorkingDays(month),
    getMonthlyBest(month),
  ]);

  const averagePerOrder =
    daily.orders > 0
      ? Math.round(
          daily.sales /
            daily.orders
        )
      : 0;

  const averagePerDay =
    workingDays > 0
      ? Math.round(
          monthly.sales /
            workingDays
        )
      : 0;

  const targetRate =
    MONTHLY_TARGET > 0
      ? Math.round(
          (monthly.sales /
            MONTHLY_TARGET) *
            100
        )
      : 0;

  return [
    "🏍️ 配達売上",
    `💰 今日の売上　${formatYen(
      daily.sales
    )}円`,
    `📦 今日の件数　${daily.orders}件`,
    `💵 1件あたり　${formatYen(
      averagePerOrder
    )}円`,
    `📅 今月売上　${formatYen(
      monthly.sales
    )}円`,
    `📦 今月件数　${monthly.orders}件`,
    `🗓️ 年間売上　${formatYen(
      yearly.sales
    )}円`,
    `📦 年間件数　${yearly.orders}件`,
    `📈 平均売上／日　${formatYen(
      averagePerDay
    )}円`,
    `🎯 月間目標　${formatYen(
      MONTHLY_TARGET
    )}円`,
    `📊 目標達成率　${formatPercent(
      targetRate
    )}`,
    `🏆 月間最高売上　${formatYen(
      monthlyBest.bestSales
    )}円`,
    `🏆 月間最高件数　${monthlyBest.bestOrders}件`,
    `📆 稼働日数　${workingDays}日`,
    `🛵 累計配達件数　${alltime.orders}件`,
    `🕐 ${formatDateTimeJST(now)}`,
    "🛵 今日も配達お疲れ様でした！",
  ].join("\n");
}

// ============================================================
// RECORD
// ============================================================

async function getMonthlyDailyRecords(
  month
) {
  const keys =
    await getDailyKeys(month);

  const rows = [];

  if (keys.length === 0) {
    return rows;
  }

  const commands = keys.map(
    (key) => [
      "HMGET",
      key,
      "sales",
      "orders",
    ]
  );

  const results =
    await redisMulti(commands);

  for (
    let i = 0;
    i < results.length;
    i++
  ) {
    const item =
      results[i];

    const sales =
      toNumber(
        item?.result?.[0]
      );

    const orders =
      toNumber(
        item?.result?.[1]
      );

    if (
      sales === 0 &&
      orders === 0
    ) {
      continue;
    }

    const dateKey =
      keys[i].replace(
        "moheji:delivery:daily:",
        ""
      );

    rows.push({
      dateKey,
      sales,
      orders,
    });
  }

  rows.sort((a, b) =>
    a.dateKey.localeCompare(
      b.dateKey
    )
  );

  return rows;
}

async function getRecordHistory(
  chatId
) {
  const listKey =
    recordsRedisKey(chatId);

  const ids = await redis(
    "ZREVRANGE",
    listKey,
    "0",
    "200"
  );

  if (
    !ids ||
    ids.length === 0
  ) {
    return [];
  }

  const commands = ids.map(
    (id) => [
      "GET",
      recordRedisKey(
        chatId,
        id
      ),
    ]
  );

  const results =
    await redisMulti(commands);

  const records = [];

  for (const item of results) {
    if (
      !item ||
      !item.result
    ) {
      continue;
    }

    try {
      records.push(
        JSON.parse(
          item.result
        )
      );
    } catch {
      // ignore
    }
  }

  return records;
}

async function buildRecordReport(
  chatId
) {
  const month =
    getMonthKey();

  const [
    monthly,
    history,
    dailyRecords,
  ] = await Promise.all([
    getMonth(month),
    getRecordHistory(chatId),
    getMonthlyDailyRecords(
      month
    ),
  ]);

  const activeRecords =
    history.filter(
      (record) =>
        record.cancelled !== true
    );

  const activeSales =
    activeRecords.reduce(
      (sum, record) =>
        sum +
        toNumber(
          record.sales
        ),
      0
    );

  const activeOrders =
    activeRecords.reduce(
      (sum, record) =>
        sum +
        toNumber(
          record.orders
        ),
      0
    );

  const diffSales =
    monthly.sales -
    activeSales;

  const diffOrders =
    monthly.orders -
    activeOrders;

  const lines = [];

  lines.push(
    "📋 配達売上記録"
  );

  lines.push("");

  lines.push(
    `📅 ${month}`
  );

  lines.push(
    `💰 月間Redis　${formatYen(
      monthly.sales
    )}円`
  );

  lines.push(
    `📦 月間Redis　${monthly.orders}件`
  );

  lines.push("");

  lines.push(
    "【日別売上】"
  );

  if (
    dailyRecords.length === 0
  ) {
    lines.push(
      "記録なし"
    );
  } else {
    for (const row of dailyRecords) {
      lines.push(
        `${row.dateKey}　${formatYen(
          row.sales
        )}円 / ${row.orders}件`
      );
    }
  }

  lines.push("");

  lines.push(
    "【個別記録】"
  );

  if (
    history.length === 0
  ) {
    lines.push(
      "記録なし"
    );
  } else {
    for (
      const record of
        history.slice(0, 50)
    ) {
      const status =
        record.cancelled === true
          ? "❌取消"
          : "✅有効";

      lines.push(
        `${status} ${record.dateKey} ${formatYen(
          record.sales
        )}円 / ${record.orders}件`
      );
    }
  }

  lines.push("");

  lines.push(
    "【照合】"
  );

  lines.push(
    `個別記録（有効）　${formatYen(
      activeSales
    )}円 / ${activeOrders}件`
  );

  lines.push(
    `Redis日別合計　　 ${formatYen(
      monthly.sales
    )}円 / ${monthly.orders}件`
  );

  lines.push(
    `差額　　　　　　 ${formatYen(
      diffSales
    )}円 / ${diffOrders}件`
  );

  if (
    diffSales === 0 &&
    diffOrders === 0
  ) {
    lines.push(
      "✅ 個別記録とRedisは一致しています。"
    );
  } else {
    lines.push(
      "⚠️ 個別記録とRedisに差があります。"
    );

    lines.push(
      "※ 既存の差額は推測で自動修正していません。"
    );
  }

  return lines.join("\n");
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

  return {
    command,
    args: parts.slice(1),
  };
}

// ============================================================
// /sales
// ============================================================

async function handleSales(
  chatId,
  args
) {
  if (args.length < 2) {
    await sendMessage(
      chatId,
      "使い方：\n/sales 売上 件数\n\n例：\n/sales 17014 17"
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
    orders < 0
  ) {
    await sendMessage(
      chatId,
      "❌ 売上と件数を正しく入力してください。\n\n例：\n/sales 17014 17"
    );

    return;
  }

  const report =
    await processSales(
      chatId,
      sales,
      orders
    );

  await sendPhoto(
    chatId,
    report
  );
}

// ============================================================
// /cancel
// ============================================================

async function handleCancel(
  chatId,
  args
) {
  if (
    args.length !== 0
  ) {
    await sendMessage(
      chatId,
      "❌ /cancel は引数なしで使用してください。"
    );

    return;
  }

  const message =
    await processCancel(
      chatId
    );

  await sendMessage(
    chatId,
    message
  );
}

// ============================================================
// /record
// ============================================================

async function handleRecord(
  chatId,
  args
) {
  if (
    args.length !== 0
  ) {
    await sendMessage(
      chatId,
      "❌ /record は引数なしで使用してください。"
    );

    return;
  }

  const report =
    await buildRecordReport(
      chatId
    );

  await sendMessage(
    chatId,
    report
  );
}

// ============================================================
// Telegram Update
// ============================================================

async function handleUpdate(
  update
) {
  const message =
    update?.message;

  if (!message) {
    return;
  }

  const chatId =
    message.chat?.id;

  if (!chatId) {
    return;
  }

  const text =
    message.text || "";

  const parsed =
    parseCommand(text);

  if (!parsed) {
    return;
  }

  switch (
    parsed.command
  ) {
    case "/sales":
      await handleSales(
        chatId,
        parsed.args
      );
      break;

    case "/cancel":
      await handleCancel(
        chatId,
        parsed.args
      );
      break;

    case "/record":
      await handleRecord(
        chatId,
        parsed.args
      );
      break;

    default:
      // /startなどには反応しない
      return;
  }
}

// ============================================================
// Vercel Handler
// ============================================================

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
    const update =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    await handleUpdate(
      update
    );

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "telegram handler error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: String(
        error?.message ||
          error
      ),
    });
  }
}
