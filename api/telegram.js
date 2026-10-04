const PHOTO_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

module.exports = async function handler(req, res) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const KV_REST_API_URL = process.env.KV_REST_API_URL;
  const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!BOT_TOKEN || !KV_REST_API_URL || !KV_REST_API_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "Environment variables are not configured",
    });
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
      throw new Error(`Redis HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();

    if (data && data.error) {
      throw new Error(`Redis error: ${data.error}`);
    }

    return data.result;
  }

  // =========================================================
  // Telegram
  // =========================================================

  async function sendTelegramMessage(chatId, message) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

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
      throw new Error(`Telegram sendMessage failed: ${text}`);
    }

    return response.json();
  }

  async function sendTelegramPhoto(chatId, caption) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo: PHOTO_URL,
        caption,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram sendPhoto failed: ${text}`);
    }

    return response.json();
  }

  // =========================================================
  // Utility
  // =========================================================

  function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function createRecordId() {
    return `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  function getTokyoDateInfo(date = new Date()) {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(date);

    const map = {};

    for (const part of parts) {
      if (part.type !== "literal") {
        map[part.type] = part.value;
      }
    }

    const year = Number(map.year);
    const month = Number(map.month);
    const day = Number(map.day);
    const hour = Number(map.hour);
    const minute = Number(map.minute);

    const dateKey =
      `${year}-${String(month).padStart(2, "0")}-` +
      `${String(day).padStart(2, "0")}`;

    const monthKey =
      `${year}-${String(month).padStart(2, "0")}`;

    const yearKey = String(year);

    const displayDate =
      `${year}/${String(month).padStart(2, "0")}/` +
      `${String(day).padStart(2, "0")}`;

    return {
      year,
      month,
      day,
      hour,
      minute,
      dateKey,
      monthKey,
      yearKey,
      displayDate,
    };
  }

  // =========================================================
  // Redis Keys
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

  function getAllTimeKey() {
    return `moheji:delivery:alltime`;
  }

  function getRecordIndexKey(chatId) {
    return `moheji:delivery:records:${chatId}`;
  }

  function getRecordKey(chatId, recordId) {
    return `moheji:delivery:record:${chatId}:${recordId}`;
  }

  function getCancelLockKey(chatId, recordId) {
    return `moheji:delivery:cancel-lock:${chatId}:${recordId}`;
  }

  function getMigrationLockKey(chatId) {
    return `moheji:delivery:migration-lock:${chatId}:2026-10-04`;
  }

  function getMigrationFlagKey(chatId) {
    return `moheji:delivery:migration:${chatId}:2026-10-04`;
  }

  // =========================================================
  // Aggregate Values
  // =========================================================

  async function getDailyValues(dateKey) {
    const key = getDailyKey(dateKey);

    const result = await redisCommand([
      "HGETALL",
      key,
    ]);

    const values = {};

    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i += 2) {
        values[result[i]] = result[i + 1];
      }
    }

    return {
      sales: safeNumber(values.sales),
      orders: safeNumber(values.orders),
    };
  }

  async function getMonthlyValues(monthKey) {
    const key = getMonthlyKey(monthKey);

    const result = await redisCommand([
      "HGETALL",
      key,
    ]);

    const values = {};

    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i += 2) {
        values[result[i]] = result[i + 1];
      }
    }

    return {
      sales: safeNumber(values.sales),
      orders: safeNumber(values.orders),
    };
  }

  async function getYearlyValues(yearKey) {
    const key = getYearlyKey(yearKey);

    const result = await redisCommand([
      "HGETALL",
      key,
    ]);

    const values = {};

    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i += 2) {
        values[result[i]] = result[i + 1];
      }
    }

    return {
      sales: safeNumber(values.sales),
      orders: safeNumber(values.orders),
    };
  }

  async function getAllTimeValues() {
    const key = getAllTimeKey();

    const result = await redisCommand([
      "HGETALL",
      key,
    ]);

    const values = {};

    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i += 2) {
        values[result[i]] = result[i + 1];
      }
    }

    return {
      sales: safeNumber(values.sales),
      orders: safeNumber(values.orders),
    };
  }

  // =========================================================
  // Working Days
  // =========================================================

  async function updateWorkingDay(dateKey) {
    const monthKey = dateKey.slice(0, 7);
    const workingDaysKey = getWorkingDaysKey(monthKey);

    const daily = await getDailyValues(dateKey);

    if (daily.sales > 0 || daily.orders > 0) {
      await redisCommand([
        "SADD",
        workingDaysKey,
        dateKey,
      ]);
    } else {
      await redisCommand([
        "SREM",
        workingDaysKey,
        dateKey,
      ]);
    }
  }

  // =========================================================
  // Monthly Best
  // =========================================================

  async function getMonthlyBest(monthKey) {
    const workingDaysKey = getWorkingDaysKey(monthKey);

    const workingDays =
      (await redisCommand([
        "SMEMBERS",
        workingDaysKey,
      ])) || [];

    let maxDailySales = 0;
    let maxDailyOrders = 0;

    for (const dateKey of workingDays) {
      const daily = await getDailyValues(dateKey);

      if (daily.sales > maxDailySales) {
        maxDailySales = daily.sales;
      }

      if (daily.orders > maxDailyOrders) {
        maxDailyOrders = daily.orders;
      }
    }

    return {
      workingDayCount: workingDays.length,
      maxDailySales,
      maxDailyOrders,
    };
  }

  // =========================================================
  // Sales Record
  // =========================================================

  async function saveSalesRecord({
    chatId,
    sales,
    orders,
    dateInfo,
  }) {
    const recordId = createRecordId();

    const recordKey = getRecordKey(chatId, recordId);
    const recordIndexKey = getRecordIndexKey(chatId);

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
      new Date().toISOString(),
      "cancelled",
      "0",
    ]);

    await redisCommand([
      "ZADD",
      recordIndexKey,
      String(Date.now()),
      recordId,
    ]);

    return recordId;
  }

  // =========================================================
  // Latest Active Record
  // =========================================================

  async function findLatestActiveRecord(chatId) {
    const recordIndexKey = getRecordIndexKey(chatId);

    // 最新100件ではなく、全件を新しい順に確認する
    const recordIds =
      (await redisCommand([
        "ZREVRANGE",
        recordIndexKey,
        "0",
        "-1",
      ])) || [];

    for (const recordId of recordIds) {
      const recordKey = getRecordKey(chatId, recordId);

      const result = await redisCommand([
        "HGETALL",
        recordKey,
      ]);

      if (!Array.isArray(result) || result.length === 0) {
        continue;
      }

      const record = {};

      for (let i = 0; i < result.length; i += 2) {
        record[result[i]] = result[i + 1];
      }

      if (record.cancelled === "1") {
        continue;
      }

      return {
        ...record,
        id: record.id || recordId,
        sales: safeNumber(record.sales),
        orders: safeNumber(record.orders),
      };
    }

    return null;
  }

  // =========================================================
  // End of Part 1
  // =========================================================
    // =========================================================
  // Process Sales
  // =========================================================

  async function processSales(chatId, sales, orders) {
    const dateInfo = getTokyoDateInfo();

    // 先に個別レコードを保存
    const recordId = await saveSalesRecord({
      chatId,
      sales,
      orders,
      dateInfo,
    });

    // -------------------------
    // Daily
    // -------------------------

    await redisCommand([
      "HINCRBY",
      getDailyKey(dateInfo.dateKey),
      "sales",
      String(sales),
    ]);

    await redisCommand([
      "HINCRBY",
      getDailyKey(dateInfo.dateKey),
      "orders",
      String(orders),
    ]);

    // -------------------------
    // Monthly
    // -------------------------

    await redisCommand([
      "HINCRBY",
      getMonthlyKey(dateInfo.monthKey),
      "sales",
      String(sales),
    ]);

    await redisCommand([
      "HINCRBY",
      getMonthlyKey(dateInfo.monthKey),
      "orders",
      String(orders),
    ]);

    // -------------------------
    // Yearly
    // -------------------------

    await redisCommand([
      "HINCRBY",
      getYearlyKey(dateInfo.yearKey),
      "sales",
      String(sales),
    ]);

    await redisCommand([
      "HINCRBY",
      getYearlyKey(dateInfo.yearKey),
      "orders",
      String(orders),
    ]);

    // -------------------------
    // All Time
    // -------------------------

    await redisCommand([
      "HINCRBY",
      getAllTimeKey(),
      "sales",
      String(sales),
    ]);

    await redisCommand([
      "HINCRBY",
      getAllTimeKey(),
      "orders",
      String(orders),
    ]);

    // -------------------------
    // Working Day
    // -------------------------

    await updateWorkingDay(dateInfo.dateKey);

    return {
      recordId,
      dateInfo,
    };
  }

  // =========================================================
  // Process Cancel
  // =========================================================

  async function processCancel(chatId) {
    // -------------------------------------------------------
    // まず、新システムの個別レコードを探す
    // -------------------------------------------------------

    const record = await findLatestActiveRecord(chatId);

    if (record) {
      const recordId = record.id;
      const recordKey = getRecordKey(chatId, recordId);
      const cancelLockKey = getCancelLockKey(chatId, recordId);

      // 二重キャンセル防止
      const lockResult = await redisCommand([
        "SET",
        cancelLockKey,
        "1",
        "NX",
        "EX",
        "60",
      ]);

      if (lockResult !== "OK") {
        return {
          ok: false,
          message:
            "⚠️ この売上は現在キャンセル処理中です。",
        };
      }

      try {
        // ロック取得後、もう一度状態を確認
        const latestResult = await redisCommand([
          "HGETALL",
          recordKey,
        ]);

        const latest = {};

        if (Array.isArray(latestResult)) {
          for (let i = 0; i < latestResult.length; i += 2) {
            latest[latestResult[i]] = latestResult[i + 1];
          }
        }

        if (!latest.id || latest.cancelled === "1") {
          return {
            ok: false,
            message:
              "⚠️ キャンセル対象の売上が見つかりません。",
          };
        }

        const sales = safeNumber(latest.sales);
        const orders = safeNumber(latest.orders);
        const dateKey = latest.dateKey;
        const monthKey = latest.monthKey;
        const yearKey = latest.yearKey;

        // ---------------------------------------------------
        // 現在の集計値を確認
        // ---------------------------------------------------

        const daily = await getDailyValues(dateKey);
        const monthly = await getMonthlyValues(monthKey);
        const yearly = await getYearlyValues(yearKey);

        if (
          daily.sales < sales ||
          daily.orders < orders ||
          monthly.sales < sales ||
          monthly.orders < orders ||
          yearly.sales < sales ||
          yearly.orders < orders
        ) {
          return {
            ok: false,
            message:
              "⚠️ 集計データと売上記録が一致しないため、キャンセルを中止しました。",
          };
        }

        // ---------------------------------------------------
        // Dailyから減算
        // ---------------------------------------------------

        await redisCommand([
          "HINCRBY",
          getDailyKey(dateKey),
          "sales",
          String(-sales),
        ]);

        await redisCommand([
          "HINCRBY",
          getDailyKey(dateKey),
          "orders",
          String(-orders),
        ]);

        // ---------------------------------------------------
        // Monthlyから減算
        // ---------------------------------------------------

        await redisCommand([
          "HINCRBY",
          getMonthlyKey(monthKey),
          "sales",
          String(-sales),
        ]);

        await redisCommand([
          "HINCRBY",
          getMonthlyKey(monthKey),
          "orders",
          String(-orders),
        ]);

        // ---------------------------------------------------
        // Yearlyから減算
        // ---------------------------------------------------

        await redisCommand([
          "HINCRBY",
          getYearlyKey(yearKey),
          "sales",
          String(-sales),
        ]);

        await redisCommand([
          "HINCRBY",
          getYearlyKey(yearKey),
          "orders",
          String(-orders),
        ]);

        // ---------------------------------------------------
        // All Timeから減算
        //
        // salesフィールドが存在しない旧データにも対応。
        // ordersは必ず減算。
        // ---------------------------------------------------

        const allTimeKey = getAllTimeKey();

        const allTimeSalesExists =
          await redisCommand([
            "HEXISTS",
            allTimeKey,
            "sales",
          ]);

        if (safeNumber(allTimeSalesExists) === 1) {
          await redisCommand([
            "HINCRBY",
            allTimeKey,
            "sales",
            String(-sales),
          ]);
        }

        await redisCommand([
          "HINCRBY",
          allTimeKey,
          "orders",
          String(-orders),
        ]);

        // ---------------------------------------------------
        // Working Dayを再計算
        // ---------------------------------------------------

        await updateWorkingDay(dateKey);

        // ---------------------------------------------------
        // 個別レコードをキャンセル済みにする
        // ---------------------------------------------------

        await redisCommand([
          "HSET",
          recordKey,
          "cancelled",
          "1",
          "cancelledAt",
          new Date().toISOString(),
        ]);

        return {
          ok: true,
          type: "record",
          sales,
          orders,
          dateKey,
          recordId,
        };
      } finally {
        await redisCommand([
          "DEL",
          cancelLockKey,
        ]);
      }
    }

    // =======================================================
    // 新システムのレコードがない場合
    //
    // 旧システムで
    // 2026-10-04 23:59
    // /sales 17014 17
    //
    // が登録されていたケースへの一回限りの救済処理
    // =======================================================

    const migrationLockKey =
      getMigrationLockKey(chatId);

    const migrationFlagKey =
      getMigrationFlagKey(chatId);

    // -------------------------------------------------------
    // 二重実行防止
    // -------------------------------------------------------

    const migrationLockResult =
      await redisCommand([
        "SET",
        migrationLockKey,
        "1",
        "NX",
        "EX",
        "60",
      ]);

    if (migrationLockResult !== "OK") {
      return {
        ok: false,
        message:
          "⚠️ この過去売上は現在キャンセル処理中です。",
      };
    }

    try {
      // -----------------------------------------------------
      // すでに移行キャンセル済みか確認
      // -----------------------------------------------------

      const alreadyMigrated =
        await redisCommand([
          "GET",
          migrationFlagKey,
        ]);

      if (alreadyMigrated) {
        return {
          ok: false,
          message:
            "⚠️ この過去売上はすでにキャンセル済みです。",
        };
      }

      // -----------------------------------------------------
      // 旧売上の固定値
      // -----------------------------------------------------

      const legacySales = 17014;
      const legacyOrders = 17;

      const legacyDateKey = "2026-10-04";
      const legacyMonthKey = "2026-10";
      const legacyYearKey = "2026";

      // -----------------------------------------------------
      // 10/4の集計を確認
      //
      // 旧システムには個別レコードがないため、
      // 少なくともこの金額・件数が存在する場合だけ
      // 一度限りで減算する。
      // -----------------------------------------------------

      const daily =
        await getDailyValues(legacyDateKey);

      const monthly =
        await getMonthlyValues(legacyMonthKey);

      const yearly =
        await getYearlyValues(legacyYearKey);

      if (
        daily.sales < legacySales ||
        daily.orders < legacyOrders ||
        monthly.sales < legacySales ||
        monthly.orders < legacyOrders ||
        yearly.sales < legacySales ||
        yearly.orders < legacyOrders
      ) {
        return {
          ok: false,
          message:
            "⚠️ 2026/10/04の旧売上データが確認できないため、キャンセルを中止しました。",
        };
      }

      // -----------------------------------------------------
      // Daily
      // -----------------------------------------------------

      await redisCommand([
        "HINCRBY",
        getDailyKey(legacyDateKey),
        "sales",
        String(-legacySales),
      ]);

      await redisCommand([
        "HINCRBY",
        getDailyKey(legacyDateKey),
        "orders",
        String(-legacyOrders),
      ]);

      // -----------------------------------------------------
      // Monthly
      // -----------------------------------------------------

      await redisCommand([
        "HINCRBY",
        getMonthlyKey(legacyMonthKey),
        "sales",
        String(-legacySales),
      ]);

      await redisCommand([
        "HINCRBY",
        getMonthlyKey(legacyMonthKey),
        "orders",
        String(-legacyOrders),
      ]);

      // -----------------------------------------------------
      // Yearly
      // -----------------------------------------------------

      await redisCommand([
        "HINCRBY",
        getYearlyKey(legacyYearKey),
        "sales",
        String(-legacySales),
      ]);

      await redisCommand([
        "HINCRBY",
        getYearlyKey(legacyYearKey),
        "orders",
        String(-legacyOrders),
      ]);

      // -----------------------------------------------------
      // All Time
      // -----------------------------------------------------

      const allTimeKey = getAllTimeKey();

      const allTimeSalesExists =
        await redisCommand([
          "HEXISTS",
          allTimeKey,
          "sales",
        ]);

      if (safeNumber(allTimeSalesExists) === 1) {
        await redisCommand([
          "HINCRBY",
          allTimeKey,
          "sales",
          String(-legacySales),
        ]);
      }

      await redisCommand([
        "HINCRBY",
        allTimeKey,
        "orders",
        String(-legacyOrders),
      ]);

      // -----------------------------------------------------
      // Working Day
      // -----------------------------------------------------

      await updateWorkingDay(legacyDateKey);

      // -----------------------------------------------------
      // 一年間の移行済みフラグ
      // -----------------------------------------------------

      await redisCommand([
        "SET",
        migrationFlagKey,
        "1",
        "EX",
        "31536000",
      ]);

      return {
        ok: true,
        type: "legacy",
        sales: legacySales,
        orders: legacyOrders,
        dateKey: legacyDateKey,
      };
    } finally {
      await redisCommand([
        "DEL",
        migrationLockKey,
      ]);
    }
  }

  // =========================================================
  // End of Part 2
  // =========================================================
    // =========================================================
  // Report
  // =========================================================

  async function buildReport() {
    const today = getTokyoDateInfo();

    const daily = await getDailyValues(today.dateKey);
    const monthly = await getMonthlyValues(today.monthKey);
    const yearly = await getYearlyValues(today.yearKey);
    const allTime = await getAllTimeValues();

    const monthlyBest = await getMonthlyBest(
      today.monthKey
    );

    const workingDayCount =
      monthlyBest.workingDayCount;

    const monthlyAverageSales =
      workingDayCount > 0
        ? monthly.sales / workingDayCount
        : 0;

    const monthlyAverageOrders =
      workingDayCount > 0
        ? monthly.orders / workingDayCount
        : 0;

    const monthlyTarget = 500000;

    const achievementRate =
      monthlyTarget > 0
        ? (monthly.sales / monthlyTarget) * 100
        : 0;

    const monthlyRemaining =
      Math.max(monthlyTarget - monthly.sales, 0);

    const perOrder =
      monthly.orders > 0
        ? monthly.sales / monthly.orders
        : 0;

    const greenCircles =
      Math.floor(monthly.sales / 100000);

    const greenCircleText =
      greenCircles > 0
        ? "🟢".repeat(Math.min(greenCircles, 10))
        : "なし";

    const todaySales =
      daily.sales.toLocaleString("ja-JP");

    const todayOrders =
      daily.orders.toLocaleString("ja-JP");

    const monthSales =
      monthly.sales.toLocaleString("ja-JP");

    const monthOrders =
      monthly.orders.toLocaleString("ja-JP");

    const yearSales =
      yearly.sales.toLocaleString("ja-JP");

    const yearOrders =
      yearly.orders.toLocaleString("ja-JP");

    const allTimeSales =
      allTime.sales.toLocaleString("ja-JP");

    const allTimeOrders =
      allTime.orders.toLocaleString("ja-JP");

    const bestDailySales =
      monthlyBest.maxDailySales.toLocaleString("ja-JP");

    const bestDailyOrders =
      monthlyBest.maxDailyOrders.toLocaleString("ja-JP");

    const averageSalesText =
      Math.round(monthlyAverageSales)
        .toLocaleString("ja-JP");

    const averageOrdersText =
      Math.round(monthlyAverageOrders)
        .toLocaleString("ja-JP");

    const perOrderText =
      Math.round(perOrder)
        .toLocaleString("ja-JP");

    const achievementText =
      achievementRate.toFixed(1);

    const remainingText =
      monthlyRemaining.toLocaleString("ja-JP");

    return [
      "📊 もへじ配送売上レポート",
      "",
      `📅 ${today.displayDate}`,
      "",
      "【本日】",
      `売上：¥${todaySales}`,
      `件数：${todayOrders}件`,
      "",
      "【今月】",
      `売上：¥${monthSales}`,
      `件数：${monthOrders}件`,
      `稼働日：${workingDayCount}日`,
      `1日平均売上：¥${averageSalesText}`,
      `1日平均件数：${averageOrdersText}件`,
      `平均客単価：¥${perOrderText}`,
      "",
      "【今月の最高】",
      `最高日商：¥${bestDailySales}`,
      `最高日件数：${bestDailyOrders}件`,
      "",
      "【月間目標】",
      `目標：¥${monthlyTarget.toLocaleString("ja-JP")}`,
      `達成率：${achievementText}%`,
      `残り：¥${remainingText}`,
      "",
      "【今年】",
      `売上：¥${yearSales}`,
      `件数：${yearOrders}件`,
      "",
      "【累計】",
      `売上：¥${allTimeSales}`,
      `件数：${allTimeOrders}件`,
      "",
      "【10万円達成】",
      greenCircleText,
    ].join("\n");
  }

  // =========================================================
  // /record
  // =========================================================

  async function processRecord() {
    const today = getTokyoDateInfo();

    const lines = [];

    lines.push("📈 過去24ヶ月 売上記録");
    lines.push("");

    for (let i = 0; i < 24; i++) {
      const date = new Date(
        Date.UTC(
          today.year,
          today.month - 1 - i,
          1
        )
      );

      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;

      const monthKey =
        `${year}-${String(month).padStart(2, "0")}`;

      const monthly =
        await getMonthlyValues(monthKey);

      const best =
        await getMonthlyBest(monthKey);

      // workingdaysはRedis Setなので、
      // GETではなくbest.workingDayCountを使う
      const workingDayCount =
        best.workingDayCount;

      lines.push(
        `${monthKey}`,
        `売上：¥${monthly.sales.toLocaleString("ja-JP")}`,
        `件数：${monthly.orders.toLocaleString("ja-JP")}件`,
        `稼働日：${workingDayCount}日`,
        `最高日商：¥${best.maxDailySales.toLocaleString("ja-JP")}`,
        `最高日件数：${best.maxDailyOrders.toLocaleString("ja-JP")}件`,
        ""
      );
    }

    return lines.join("\n");
  }

  // =========================================================
  // Parse Telegram Update
  // =========================================================

  function getMessageFromUpdate(update) {
    if (!update || !update.message) {
      return null;
    }

    return update.message;
  }

  // =========================================================
  // Main Handler
  // =========================================================

  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method Not Allowed",
      });
    }

    // -------------------------------------------------------
    // Request Body
    // -------------------------------------------------------

    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error: "Invalid JSON",
        });
      }
    }

    if (!body || typeof body !== "object") {
      return res.status(400).json({
        ok: false,
        error: "Invalid request body",
      });
    }

    // -------------------------------------------------------
    // Telegram Update ID
    // -------------------------------------------------------

    const updateId = body.update_id;

    if (updateId !== undefined && updateId !== null) {
      const processedKey =
        `moheji:telegram:processed:${updateId}`;

      const processedResult =
        await redisCommand([
          "SET",
          processedKey,
          "1",
          "NX",
          "EX",
          "86400",
        ]);

      // 同じTelegram updateを二重処理しない
      if (processedResult !== "OK") {
        return res.status(200).json({
          ok: true,
          duplicate: true,
        });
      }
    }

    // -------------------------------------------------------
    // Message
    // -------------------------------------------------------

    const message =
      getMessageFromUpdate(body);

    if (!message) {
      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }

    const chatId =
      message.chat &&
      message.chat.id;

    if (
      chatId === undefined ||
      chatId === null
    ) {
      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }

    const text =
      typeof message.text === "string"
        ? message.text.trim()
        : "";

    if (!text) {
      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }

    // =======================================================
    // /record
    // =======================================================

    if (/^\/record(?:@\w+)?$/i.test(text)) {
      const report = await processRecord();

      await sendTelegramPhoto(
        chatId,
        report
      );

      return res.status(200).json({
        ok: true,
      });
    }

    // =======================================================
    // /cancel
    //
    // 引数は無視する。
    //
    // 例：
    // /cancel
    // /cancel abc
    //
    // どちらも「最新の未キャンセル売上」を対象にする。
    // =======================================================

    if (/^\/cancel(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
      const result =
        await processCancel(chatId);

      if (!result.ok) {
        await sendTelegramMessage(
          chatId,
          result.message
        );

        return res.status(200).json({
          ok: true,
        });
      }

      const report =
        await buildReport();

      const cancelMessage = [
        "✅ 売上をキャンセルしました。",
        "",
        `売上：¥${result.sales.toLocaleString("ja-JP")}`,
        `件数：${result.orders.toLocaleString("ja-JP")}件`,
        `対象日：${result.dateKey}`,
        "",
        report,
      ].join("\n");

      await sendTelegramPhoto(
        chatId,
        cancelMessage
      );

      return res.status(200).json({
        ok: true,
      });
    }

    // =======================================================
    // /sales
    //
    // 例：
    // /sales 17014 17
    // /sales@botname 17014 17
    // =======================================================

    const salesMatch =
      text.match(
        /^\/sales(?:@\w+)?(?:\s+([0-9]+(?:\.[0-9]+)?))?(?:\s+([0-9]+(?:\.[0-9]+)?))?\s*$/i
      );

    if (salesMatch) {
      const salesArg = salesMatch[1];
      const ordersArg = salesMatch[2];

      if (
        salesArg === undefined ||
        ordersArg === undefined
      ) {
        await sendTelegramMessage(
          chatId,
          [
            "⚠️ 入力形式が正しくありません。",
            "",
            "/sales 売上 件数",
            "",
            "例：",
            "/sales 17014 17",
          ].join("\n")
        );

        return res.status(200).json({
          ok: true,
        });
      }

      const sales =
        Math.floor(
          Number(salesArg)
        );

      const orders =
        Math.floor(
          Number(ordersArg)
        );

      if (
        !Number.isFinite(sales) ||
        !Number.isFinite(orders) ||
        sales < 0 ||
        orders < 0
      ) {
        await sendTelegramMessage(
          chatId,
          "⚠️ 売上と件数には0以上の数字を入力してください。"
        );

        return res.status(200).json({
          ok: true,
        });
      }

      const result =
        await processSales(
          chatId,
          sales,
          orders
        );

      const report =
        await buildReport();

      const salesMessage = [
        "✅ 売上を登録しました。",
        "",
        `売上：¥${sales.toLocaleString("ja-JP")}`,
        `件数：${orders.toLocaleString("ja-JP")}件`,
        `対象日：${result.dateInfo.dateKey}`,
        "",
        report,
      ].join("\n");

      await sendTelegramPhoto(
        chatId,
        salesMessage
      );

      return res.status(200).json({
        ok: true,
      });
    }

    // =======================================================
    // その他のメッセージ
    // =======================================================

    return res.status(200).json({
      ok: true,
      ignored: true,
    });
  } catch (error) {
    console.error("Handler error:", error);

    try {
      const message =
        body &&
        body.message;

      const chatId =
        message &&
        message.chat &&
        message.chat.id;

      if (
        chatId !== undefined &&
        chatId !== null
      ) {
        await sendTelegramMessage(
          chatId,
          "⚠️ 処理中にエラーが発生しました。もう一度お試しください。"
        );
      }
    } catch (telegramError) {
      console.error(
        "Telegram error message failed:",
        telegramError
      );
    }

    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
    });
  }
};
