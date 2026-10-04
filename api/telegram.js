export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const KV_REST_API_URL = process.env.KV_REST_API_URL;
  const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is missing");
    return res.status(500).send("TELEGRAM_BOT_TOKEN is missing");
  }

  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    console.error("Redis environment variables are missing");
    return res.status(500).send("Redis environment variables are missing");
  }

  // =========================================================
  // Redis
  // =========================================================

  async function redisCommand(command) {
    const response = await fetch(KV_REST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Redis error: ${response.status} ${text}`);
    }

    const data = await response.json();
    return data.result;
  }

  // =========================================================
  // Telegram message
  // =========================================================

  async function sendTelegramMessage(chatId, message) {
    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Telegram sendMessage error: ${response.status} ${text}`
      );
    }
  }

  // =========================================================
  // Telegram photo
  // =========================================================

  async function sendTelegramPhoto(chatId, caption) {
    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo:
          "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png",
        caption,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Telegram sendPhoto error: ${response.status} ${text}`
      );
    }
  }

  // =========================================================
  // 数値
  // =========================================================

  function safeNumber(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      return 0;
    }

    return Math.max(0, n);
  }

  // =========================================================
  // ID
  // =========================================================

  function createRecordId() {
    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).substring(2, 12)
    );
  }

  // =========================================================
  // 東京時間
  // =========================================================

  function getTokyoDateInfo(date = new Date()) {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const get = (type) =>
      parts.find((p) => p.type === type)?.value;

    const year = get("year");
    const month = get("month");
    const day = get("day");
    const hour = get("hour");
    const minute = get("minute");

    return {
      year,
      month,
      day,
      hour,
      minute,

      dateKey: `${year}-${month}-${day}`,
      monthKey: `${year}-${month}`,
      yearKey: year,

      displayDate:
        `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}`,
    };
  }

  // =========================================================
  // Redis keys
  // =========================================================

  function getDailyKey(dateKey) {
    return `moheji:delivery:daily:${dateKey}`;
  }

  function getMonthlyKey(monthKey) {
    return `moheji:delivery:month:${monthKey}`;
  }

  function getYearlyKey(yearKey) {
    return `moheji:delivery:year:${yearKey}`;
  }

  function getWorkingDaysKey(monthKey) {
    return `moheji:delivery:workingdays:${monthKey}`;
  }

  function getRecordIndexKey(chatId) {
    return `moheji:delivery:records:${chatId}`;
  }

  function getRecordKey(chatId, recordId) {
    return `moheji:delivery:record:${chatId}:${recordId}`;
  }

  // =========================================================
  // Hash取得
  // =========================================================

  function hashToObject(value) {
    if (!value) {
      return {};
    }

    if (Array.isArray(value)) {
      const obj = {};

      for (let i = 0; i < value.length; i += 2) {
        obj[value[i]] = value[i + 1];
      }

      return obj;
    }

    if (typeof value === "object") {
      return { ...value };
    }

    return {};
  }

  // =========================================================
  // 日次
  // =========================================================

  async function getDailyValues(dateKey) {
    const key = getDailyKey(dateKey);

    const salesRaw = await redisCommand([
      "HGET",
      key,
      "sales",
    ]);

    const ordersRaw = await redisCommand([
      "HGET",
      key,
      "orders",
    ]);

    return {
      sales: safeNumber(salesRaw),
      orders: safeNumber(ordersRaw),
    };
  }

  // =========================================================
  // 月間
  // =========================================================

  async function getMonthlyValues(monthKey) {
    const key = getMonthlyKey(monthKey);

    const salesRaw = await redisCommand([
      "HGET",
      key,
      "sales",
    ]);

    const ordersRaw = await redisCommand([
      "HGET",
      key,
      "orders",
    ]);

    return {
      sales: safeNumber(salesRaw),
      orders: safeNumber(ordersRaw),
    };
  }

  // =========================================================
  // 年間
  // =========================================================

  async function getYearlyValues(yearKey) {
    const key = getYearlyKey(yearKey);

    const salesRaw = await redisCommand([
      "HGET",
      key,
      "sales",
    ]);

    const ordersRaw = await redisCommand([
      "HGET",
      key,
      "orders",
    ]);

    return {
      sales: safeNumber(salesRaw),
      orders: safeNumber(ordersRaw),
    };
  }

  // =========================================================
  // 稼働日
  // =========================================================

  async function updateWorkingDay(dateKey) {
    const [year, month] = dateKey.split("-");
    const monthKey = `${year}-${month}`;
    const key = getWorkingDaysKey(monthKey);

    const daily = await getDailyValues(dateKey);

    if (daily.sales > 0 || daily.orders > 0) {
      await redisCommand([
        "SADD",
        key,
        dateKey,
      ]);
    } else {
      await redisCommand([
        "SREM",
        key,
        dateKey,
      ]);
    }
  }

  // =========================================================
  // 月間最高
  // =========================================================

  async function getMonthlyBest(monthKey) {
    const key = getWorkingDaysKey(monthKey);

    const workingDays = await redisCommand([
      "SMEMBERS",
      key,
    ]);

    let maxDailySales = 0;
    let maxDailyOrders = 0;

    if (Array.isArray(workingDays)) {
      for (const dateKey of workingDays) {
        const daily = await getDailyValues(dateKey);

        maxDailySales = Math.max(
          maxDailySales,
          daily.sales
        );

        maxDailyOrders = Math.max(
          maxDailyOrders,
          daily.orders
        );
      }
    }

    return {
      workingDayCount: Array.isArray(workingDays)
        ? workingDays.length
        : 0,

      maxDailySales,
      maxDailyOrders,
    };
  }

  // =========================================================
  // 売上レコード保存
  // =========================================================

  async function saveSalesRecord({
    chatId,
    sales,
    orders,
    dateInfo,
  }) {
    const recordId = createRecordId();
    const recordKey = getRecordKey(chatId, recordId);
    const indexKey = getRecordIndexKey(chatId);
    const createdAt = Date.now();

    await redisCommand([
      "HSET",
      recordKey,

      "id",
      recordId,

      "chatId",
      String(chatId),

      "sales",
      String(sales),

      "orders",
      String(orders),

      "dateKey",
      dateInfo.dateKey,

      "monthKey",
      dateInfo.monthKey,

      "yearKey",
      dateInfo.yearKey,

      "createdAt",
      String(createdAt),

      "cancelled",
      "0",
    ]);

    await redisCommand([
      "ZADD",
      indexKey,
      String(createdAt),
      recordId,
    ]);

    return {
      recordId,
      createdAt,
    };
  }

  // =========================================================
  // 最新の未キャンセルレコード
  // =========================================================

  async function findLatestActiveRecord(chatId) {
    const indexKey = getRecordIndexKey(chatId);

    const recordIds = await redisCommand([
      "ZREVRANGE",
      indexKey,
      "0",
      "-1",
    ]);

    if (!Array.isArray(recordIds)) {
      return null;
    }

    for (const recordId of recordIds) {
      const recordKey = getRecordKey(
        chatId,
        recordId
      );

      const raw = await redisCommand([
        "HGETALL",
        recordKey,
      ]);

      const record = hashToObject(raw);

      if (!record.id) {
        continue;
      }

      if (record.cancelled === "1") {
        continue;
      }

      return {
        ...record,
        recordKey,
      };
    }

    return null;
  }

  // =========================================================
  // 現在の売上報告
  //
  // ★ このフォーマットは変更しない
  // =========================================================

  async function buildReport(dateInfo) {
    const {
      dateKey,
      monthKey,
      yearKey,
      displayDate,
    } = dateInfo;

    const daily =
      await getDailyValues(dateKey);

    const monthly =
      await getMonthlyValues(monthKey);

    const yearly =
      await getYearlyValues(yearKey);

    const allTimeKey =
      "moheji:delivery:alltime";

    const allTimeOrdersRaw =
      await redisCommand([
        "HGET",
        allTimeKey,
        "orders",
      ]);

    const allTimeOrders =
      safeNumber(allTimeOrdersRaw);

    const monthlyBest =
      await getMonthlyBest(monthKey);

    const perOrder =
      daily.orders > 0
        ? Math.round(
            daily.sales / daily.orders
          )
        : 0;

    const averageSalesPerDay =
      monthlyBest.workingDayCount > 0
        ? Math.round(
            monthly.sales /
              monthlyBest.workingDayCount
          )
        : 0;

    const monthlyTarget = 500000;

    const achievementRate =
      monthlyTarget > 0
        ? (
            (monthly.sales /
              monthlyTarget) *
            100
          ).toFixed(1)
        : "0.0";

    return [
      "🏍️ 配達売上",
      `💰 今日の売上　${daily.sales.toLocaleString()}円`,
      `📦 今日の件数　${daily.orders.toLocaleString()}件`,
      `💵 1件あたり　${perOrder.toLocaleString()}円`,
      `📅 今月売上　${monthly.sales.toLocaleString()}円`,
      `📦 今月件数　${monthly.orders.toLocaleString()}件`,
      `🗓️ 年間売上　${yearly.sales.toLocaleString()}円`,
      `📦 年間件数　${yearly.orders.toLocaleString()}件`,
      `📈 平均売上／日　${averageSalesPerDay.toLocaleString()}円`,
      `🎯 月間目標　${monthlyTarget.toLocaleString()}円`,
      `📊 目標達成率　${achievementRate}%`,
      `🏆 月間最高売上　${monthlyBest.maxDailySales.toLocaleString()}円`,
      `🏆 月間最高件数　${monthlyBest.maxDailyOrders.toLocaleString()}件`,
      `📆 稼働日数　${monthlyBest.workingDayCount}日`,
      `🛵 累計配達件数　${allTimeOrders.toLocaleString()}件`,
      `🕐 ${displayDate}`,
      "🛵 今日も配達お疲れ様でした！",
    ].join("\n");
  }

  // =========================================================
  // /sales
  // =========================================================

  async function processSales({
    chatId,
    sales,
    orders,
    dateInfo,
  }) {
    const record =
      await saveSalesRecord({
        chatId,
        sales,
        orders,
        dateInfo,
      });

    const dailyKey =
      getDailyKey(dateInfo.dateKey);

    const monthlyKey =
      getMonthlyKey(dateInfo.monthKey);

    const yearlyKey =
      getYearlyKey(dateInfo.yearKey);

    const allTimeKey =
      "moheji:delivery:alltime";

    // -------------------------
    // 日次
    // -------------------------

    const daily =
      await getDailyValues(
        dateInfo.dateKey
      );

    await redisCommand([
      "HSET",
      dailyKey,
      "sales",
      String(
        daily.sales + sales
      ),
      "orders",
      String(
        daily.orders + orders
      ),
    ]);

    // -------------------------
    // 月間
    // -------------------------

    const monthly =
      await getMonthlyValues(
        dateInfo.monthKey
      );

    await redisCommand([
      "HSET",
      monthlyKey,
      "sales",
      String(
        monthly.sales + sales
      ),
      "orders",
      String(
        monthly.orders + orders
      ),
    ]);

    // -------------------------
    // 年間
    // -------------------------

    const yearly =
      await getYearlyValues(
        dateInfo.yearKey
      );

    await redisCommand([
      "HSET",
      yearlyKey,
      "sales",
      String(
        yearly.sales + sales
      ),
      "orders",
      String(
        yearly.orders + orders
      ),
    ]);

    // -------------------------
    // 累計件数
    // -------------------------

    const allTimeOrdersRaw =
      await redisCommand([
        "HGET",
        allTimeKey,
        "orders",
      ]);

    const allTimeOrders =
      safeNumber(allTimeOrdersRaw);

    await redisCommand([
      "HSET",
      allTimeKey,
      "orders",
      String(
        allTimeOrders + orders
      ),
    ]);

    await updateWorkingDay(
      dateInfo.dateKey
    );

    return record;
  }

  // =========================================================
  // /cancel
  // =========================================================

  async function processCancel({ chatId }) {
    const record =
      await findLatestActiveRecord(
        chatId
      );

    // =======================================================
    // 旧売上救済
    // 2026-10-04 / 17,014円 / 17件
    // =======================================================

    if (!record) {
      const migrationDateKey =
        "2026-10-04";

      const migrationMonthKey =
        "2026-10";

      const migrationYearKey =
        "2026";

      const migrationSales = 17014;
      const migrationOrders = 17;

      const migrationKey =
        `moheji:delivery:migration:cancel:${chatId}:${migrationDateKey}:${migrationSales}:${migrationOrders}`;

      const done =
        await redisCommand([
          "GET",
          migrationKey,
        ]);

      if (done === "1") {
        return {
          success: false,
          message:
            "キャンセルできる売上がありません。",
        };
      }

      const daily =
        await getDailyValues(
          migrationDateKey
        );

      if (
        daily.sales < migrationSales ||
        daily.orders < migrationOrders
      ) {
        return {
          success: false,
          message:
            "キャンセルできる売上がありません。",
        };
      }

      const monthly =
        await getMonthlyValues(
          migrationMonthKey
        );

      const yearly =
        await getYearlyValues(
          migrationYearKey
        );

      const allTimeKey =
        "moheji:delivery:alltime";

      const allTimeOrdersRaw =
        await redisCommand([
          "HGET",
          allTimeKey,
          "orders",
        ]);

      const allTimeOrders =
        safeNumber(
          allTimeOrdersRaw
        );

      await redisCommand([
        "HSET",
        getDailyKey(
          migrationDateKey
        ),
        "sales",
        String(
          Math.max(
            0,
            daily.sales -
              migrationSales
          )
        ),
        "orders",
        String(
          Math.max(
            0,
            daily.orders -
              migrationOrders
          )
        ),
      ]);

      await redisCommand([
        "HSET",
        getMonthlyKey(
          migrationMonthKey
        ),
        "sales",
        String(
          Math.max(
            0,
            monthly.sales -
              migrationSales
          )
        ),
        "orders",
        String(
          Math.max(
            0,
            monthly.orders -
              migrationOrders
          )
        ),
      ]);

      await redisCommand([
        "HSET",
        getYearlyKey(
          migrationYearKey
        ),
        "sales",
        String(
          Math.max(
            0,
            yearly.sales -
              migrationSales
          )
        ),
        "orders",
        String(
          Math.max(
            0,
            yearly.orders -
              migrationOrders
          )
        ),
      ]);

      await redisCommand([
        "HSET",
        allTimeKey,
        "orders",
        String(
          Math.max(
            0,
            allTimeOrders -
              migrationOrders
          )
        ),
      ]);

      await updateWorkingDay(
        migrationDateKey
      );

      await redisCommand([
        "SET",
        migrationKey,
        "1",
      ]);

      return {
        success: true,
        migration: true,
        sales: migrationSales,
        orders: migrationOrders,
        dateKey: migrationDateKey,
        monthKey: migrationMonthKey,
      };
    }

    const sales =
      safeNumber(record.sales);

    const orders =
      safeNumber(record.orders);

    const recordDateKey =
      record.dateKey;

    const recordMonthKey =
      record.monthKey;

    const recordYearKey =
      record.yearKey;

    // =======================================================
    // 日次
    // =======================================================

    const daily =
      await getDailyValues(
        recordDateKey
      );

    const newDailySales =
      Math.max(
        0,
        daily.sales - sales
      );

    const newDailyOrders =
      Math.max(
        0,
        daily.orders - orders
      );

    await redisCommand([
      "HSET",
      getDailyKey(
        recordDateKey
      ),
      "sales",
      String(newDailySales),
      "orders",
      String(newDailyOrders),
    ]);

    // =======================================================
    // 月間
    // =======================================================

    const monthly =
      await getMonthlyValues(
        recordMonthKey
      );

    const newMonthlySales =
      Math.max(
        0,
        monthly.sales - sales
      );

    const newMonthlyOrders =
      Math.max(
        0,
        monthly.orders - orders
      );

    await redisCommand([
      "HSET",
      getMonthlyKey(
        recordMonthKey
      ),
      "sales",
      String(newMonthlySales),
      "orders",
      String(newMonthlyOrders),
    ]);

    // =======================================================
    // 年間
    // =======================================================

    const yearly =
      await getYearlyValues(
        recordYearKey
      );

    const newYearlySales =
      Math.max(
        0,
        yearly.sales - sales
      );

    const newYearlyOrders =
      Math.max(
        0,
        yearly.orders - orders
      );

    await redisCommand([
      "HSET",
      getYearlyKey(
        recordYearKey
      ),
      "sales",
      String(newYearlySales),
      "orders",
      String(newYearlyOrders),
    ]);

    // =======================================================
    // 累計
    // =======================================================

    const allTimeKey =
      "moheji:delivery:alltime";

    const allTimeOrdersRaw =
      await redisCommand([
        "HGET",
        allTimeKey,
        "orders",
      ]);

    const allTimeOrders =
      safeNumber(
        allTimeOrdersRaw
      );

    const newAllTimeOrders =
      Math.max(
        0,
        allTimeOrders - orders
      );

    await redisCommand([
      "HSET",
      allTimeKey,
      "orders",
      String(newAllTimeOrders),
    ]);

    // =======================================================
    // 元の日付の稼働日を再計算
    // =======================================================

    await updateWorkingDay(
      recordDateKey
    );

    // =======================================================
    // レコード自体は削除しない
    // =======================================================

    await redisCommand([
      "HSET",
      record.recordKey,
      "cancelled",
      "1",
      "cancelledAt",
      String(Date.now()),
    ]);

    return {
      success: true,
      migration: false,

      sales,
      orders,

      dateKey: recordDateKey,
      monthKey: recordMonthKey,
      yearKey: recordYearKey,

      recordId: record.id,

      newDailySales,
      newDailyOrders,

      newMonthlySales,
      newMonthlyOrders,

      newYearlySales,
      newYearlyOrders,

      newAllTimeOrders,
    };
  }

  // =========================================================
  // 個別レコード取得
  // =========================================================

  async function getIndividualRecords(
    chatId,
    limit = 30
  ) {
    const indexKey =
      getRecordIndexKey(chatId);

    const recordIds =
      await redisCommand([
        "ZREVRANGE",
        indexKey,
        "0",
        String(limit - 1),
      ]);

    if (!Array.isArray(recordIds)) {
      return [];
    }

    const records = [];

    for (const recordId of recordIds) {
      const recordKey =
        getRecordKey(
          chatId,
          recordId
        );

      const raw =
        await redisCommand([
          "HGETALL",
          recordKey,
        ]);

      const record =
        hashToObject(raw);

      if (!record.id) {
        continue;
      }

      records.push({
        ...record,
        recordKey,
      });
    }

    return records;
  }

  // =========================================================
  // 日時表示
  // =========================================================

  function formatRecordDate(
    createdAt
  ) {
    const timestamp =
      Number(createdAt);

    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      return "日時不明";
    }

    return new Intl.DateTimeFormat(
      "ja-JP",
      {
        timeZone:
          "Asia/Tokyo",
        year:
          "numeric",
        month:
          "numeric",
        day:
          "numeric",
        hour:
          "2-digit",
        minute:
          "2-digit",
        hour12:
          false,
      }
    ).format(
      new Date(timestamp)
    );
  }

  // =========================================================
  // /record
  //
  // 月間記録 ＋ 個別売上履歴
  // =========================================================

  async function processRecord(
    chatId,
    dateInfo
  ) {
    const monthKeys = [];

    let year =
      Number(dateInfo.year);

    let month =
      Number(dateInfo.month);

    // 過去24か月
    for (
      let i = 0;
      i < 24;
      i++
    ) {
      const mm =
        String(month).padStart(
          2,
          "0"
        );

      monthKeys.push(
        `${year}-${mm}`
      );

      month--;

      if (month === 0) {
        month = 12;
        year--;
      }
    }

    const monthlyRecords = [];

    for (
      const monthKey of monthKeys
    ) {
      const monthly =
        await getMonthlyValues(
          monthKey
        );

      if (
        monthly.sales === 0 &&
        monthly.orders === 0
      ) {
        continue;
      }

      const [
        recordYear,
        recordMonth,
      ] = monthKey.split("-");

      const best =
        await getMonthlyBest(
          monthKey
        );

      monthlyRecords.push(
        `${recordYear}年${Number(recordMonth)}月\n` +
        `📅 月間売上 ${monthly.sales.toLocaleString()}円\n` +
        `📦 月間件数 ${monthly.orders.toLocaleString()}件\n` +
        `🏆 月間最高売上 ${best.maxDailySales.toLocaleString()}円\n` +
        `🏆 月間最高件数 ${best.maxDailyOrders.toLocaleString()}件`
      );
    }

    const individualRecords =
      await getIndividualRecords(
        chatId,
        30
      );

    let message =
      "📊 月間記録\n\n";

    if (
      monthlyRecords.length === 0
    ) {
      message +=
        "まだ月間記録がありません。";
    } else {
      message +=
        monthlyRecords.join(
          "\n\n"
        );
    }

    message +=
      "\n\n━━━━━━━━━━━━━━\n" +
      "📋 個別売上履歴\n";

    if (
      individualRecords.length === 0
    ) {
      message +=
        "\n個別売上履歴はありません。";
    } else {
      for (
        const record
          of individualRecords
      ) {
        const sales =
          safeNumber(
            record.sales
          );

        const orders =
          safeNumber(
            record.orders
          );

        const date =
          formatRecordDate(
            record.createdAt
          );

        const status =
          record.cancelled === "1"
            ? "❌ キャンセル済み"
            : "✅ 有効";

        message +=
          `\n\n${date}\n` +
          `💰 売上 ${sales.toLocaleString()}円\n` +
          `📦 件数 ${orders.toLocaleString()}件\n` +
          `${status}`;
      }
    }

    message +=
      `\n\n🕐 ${dateInfo.displayDate}`;

    return message;
  }

  // =========================================================
  // Main
  // =========================================================

  try {
    const rawBody =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(
            req.body || {}
          );

    const body =
      JSON.parse(rawBody);

    // =======================================================
    // 二重処理防止
    // =======================================================

    const updateId =
      body.update_id;

    if (
      updateId !== undefined &&
      updateId !== null
    ) {
      const processedKey =
        `moheji:telegram:processed:${updateId}`;

      const result =
        await redisCommand([
          "SET",
          processedKey,
          "1",
          "NX",
          "EX",
          "86400",
        ]);

      if (result !== "OK") {
        console.log(
          `Duplicate update ignored: ${updateId}`
        );

        return res
          .status(200)
          .send("OK");
      }
    }

    // =======================================================
    // Message
    // =======================================================

    if (!body.message) {
      return res
        .status(200)
        .send("OK");
    }

    const message =
      body.message;

    const chatId =
      message.chat?.id;

    const text =
      (message.text || "").trim();

    if (!chatId || !text) {
      return res
        .status(200)
        .send("OK");
    }

    const dateInfo =
      getTokyoDateInfo();

    // =======================================================
    // /record
    // =======================================================

    if (
      text === "/record" ||
      text.startsWith("/record@")
    ) {
      const recordMessage =
        await processRecord(
          chatId,
          dateInfo
        );

      await sendTelegramMessage(
        chatId,
        recordMessage
      );

      return res
        .status(200)
        .send("OK");
    }

    // =======================================================
    // コマンド判定
    // =======================================================

    const parts =
      text.split(/\s+/);

    const commandText =
      parts[0];

    let command = "";

    if (
      commandText === "/sales" ||
      commandText.startsWith("/sales@")
    ) {
      command = "sales";
    } else if (
      commandText === "/cancel" ||
      commandText.startsWith("/cancel@")
    ) {
      command = "cancel";
    } else {
      // 3コマンド以外は何もしない
      return res
        .status(200)
        .send("OK");
    }

    // =======================================================
    // /cancel
    // =======================================================

    if (command === "cancel") {
      const result =
        await processCancel({
          chatId,
        });

      if (!result.success) {
        await sendTelegramMessage(
          chatId,
          result.message
        );

        return res
          .status(200)
          .send("OK");
      }

      const cancelledDate =
        result.dateKey.replace(
          /^(\d{4})-(\d{2})-(\d{2})$/,
          "$1/$2/$3"
        );

      const cancelMessage =
        (
          result.migration
            ? "↩️ 過去の売上をキャンセルしました"
            : "↩️ 直近の売上を取り消しました"
        ) +
        "\n\n" +
        `💰 売上 ${result.sales.toLocaleString()}円\n` +
        `📦 件数 ${result.orders.toLocaleString()}件\n` +
        `📅 対象日 ${cancelledDate}\n\n` +
        "※元の売上日を基準に日次・月間・年間集計を戻しました。";

      const report =
        await buildReport(
          dateInfo
        );

      await sendTelegramPhoto(
        chatId,
        cancelMessage +
          "\n\n" +
          report
      );

      return res
        .status(200)
        .send("OK");
    }

    // =======================================================
    // /sales
    // =======================================================

    if (parts.length < 3) {
      await sendTelegramMessage(
        chatId,
        "使い方：\n" +
        "/sales 売上 件数\n\n" +
        "例：\n" +
        "/sales 5000 12\n\n" +
        "取り消す場合：\n" +
        "/cancel"
      );

      return res
        .status(200)
        .send("OK");
    }

    let sales =
      Number(parts[1]);

    let orders =
      Number(parts[2]);

    if (
      !Number.isFinite(sales) ||
      !Number.isFinite(orders) ||
      sales < 0 ||
      orders < 0
    ) {
      await sendTelegramMessage(
        chatId,
        "売上と件数は0以上の数字で入力してください。"
      );

      return res
        .status(200)
        .send("OK");
    }

    sales =
      Math.floor(sales);

    orders =
      Math.floor(orders);

    // =======================================================
    // 売上登録
    // =======================================================

    await processSales({
      chatId,
      sales,
      orders,
      dateInfo,
    });

    // =======================================================
    // 売上報告
    // =======================================================

    const report =
      await buildReport(
        dateInfo
      );

    await sendTelegramPhoto(
      chatId,
      report
    );

    return res
      .status(200)
      .send("OK");

  } catch (error) {
    console.error(
      "Telegram handler error:",
      error
    );

    return res
      .status(500)
      .send(
        "Internal Server Error"
      );
  }
}
