module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const TELEGRAM_BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN;

  const KV_REST_API_URL =
    process.env.KV_REST_API_URL;

  const KV_REST_API_TOKEN =
    process.env.KV_REST_API_TOKEN;

  if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is missing");

    return res.status(500).send(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    console.error(
      "Redis environment variables are missing"
    );

    return res.status(500).send(
      "Redis environment variables are missing"
    );
  }

  // =========================================================
  // Redis
  // =========================================================

  async function redisCommand(command) {
    const response = await fetch(
      KV_REST_API_URL,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${KV_REST_API_TOKEN}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(command),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Redis error: ${response.status} ${text}`
      );
    }

    const data =
      await response.json();

    return data.result;
  }

  // =========================================================
  // Telegram message
  // =========================================================

  async function sendTelegramMessage(
    chatId,
    message
  ) {
    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Telegram sendMessage error: ${response.status} ${text}`
      );
    }
  }

  // =========================================================
  // Telegram photo
  // =========================================================

  async function sendTelegramPhoto(
    chatId,
    caption
  ) {
    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;

    const response = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          photo:
            "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png",
          caption,
        }),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Telegram sendPhoto error: ${response.status} ${text}`
      );
    }
  }

  // =========================================================
  // 数値を安全に取得
  // =========================================================

  function safeNumber(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      return 0;
    }

    return Math.max(0, n);
  }

  // =========================================================
  // ID生成
  // =========================================================

  function createRecordId() {
    return (
      Date.now().toString(36) +
      "-" +
      Math.random()
        .toString(36)
        .substring(2, 12)
    );
  }

  // =========================================================
  // 東京時間取得
  // =========================================================

  function getTokyoDateInfo(date = new Date()) {
    const tokyoParts =
      new Intl.DateTimeFormat(
        "ja-JP",
        {
          timeZone:
            "Asia/Tokyo",
          year:
            "numeric",
          month:
            "2-digit",
          day:
            "2-digit",
          hour:
            "2-digit",
          minute:
            "2-digit",
          hour12:
            false,
        }
      ).formatToParts(date);

    const getPart =
      (type) =>
        tokyoParts.find(
          (p) =>
            p.type === type
        )?.value;

    const year =
      getPart("year");

    const month =
      getPart("month");

    const day =
      getPart("day");

    const hour =
      getPart("hour");

    const minute =
      getPart("minute");

    return {
      year,
      month,
      day,
      hour,
      minute,

      dateKey:
        `${year}-${month}-${day}`,

      monthKey:
        `${year}-${month}`,

      yearKey:
        `${year}`,

      displayDate:
        `${year}/${month}/${day} ${hour}:${minute}`,
    };
  }

  // =========================================================
  // Redis key
  // =========================================================

  function getDailyKey(dateKey) {
    return (
      `moheji:delivery:daily:${dateKey}`
    );
  }

  function getMonthlyKey(monthKey) {
    return (
      `moheji:delivery:month:${monthKey}`
    );
  }

  function getYearlyKey(yearKey) {
    return (
      `moheji:delivery:year:${yearKey}`
    );
  }

  function getWorkingDaysKey(monthKey) {
    return (
      `moheji:delivery:workingdays:${monthKey}`
    );
  }

  function getRecordIndexKey(chatId) {
    return (
      `moheji:delivery:records:${chatId}`
    );
  }

  function getRecordKey(chatId, recordId) {
    return (
      `moheji:delivery:record:${chatId}:${recordId}`
    );
  }

  // =========================================================
  // 日次集計取得
  // =========================================================

  async function getDailyValues(dateKey) {
    const dailyKey =
      getDailyKey(dateKey);

    const salesRaw =
      await redisCommand([
        "HGET",
        dailyKey,
        "sales",
      ]);

    const ordersRaw =
      await redisCommand([
        "HGET",
        dailyKey,
        "orders",
      ]);

    return {
      sales:
        safeNumber(salesRaw),

      orders:
        safeNumber(ordersRaw),
    };
  }

  // =========================================================
  // 月間集計取得
  // =========================================================

  async function getMonthlyValues(monthKey) {
    const monthlyKey =
      getMonthlyKey(monthKey);

    const salesRaw =
      await redisCommand([
        "HGET",
        monthlyKey,
        "sales",
      ]);

    const ordersRaw =
      await redisCommand([
        "HGET",
        monthlyKey,
        "orders",
      ]);

    return {
      sales:
        safeNumber(salesRaw),

      orders:
        safeNumber(ordersRaw),
    };
  }

  // =========================================================
  // 年間集計取得
  // =========================================================

  async function getYearlyValues(yearKey) {
    const yearlyKey =
      getYearlyKey(yearKey);

    const salesRaw =
      await redisCommand([
        "HGET",
        yearlyKey,
        "sales",
      ]);

    const ordersRaw =
      await redisCommand([
        "HGET",
        yearlyKey,
        "orders",
      ]);

    return {
      sales:
        safeNumber(salesRaw),

      orders:
        safeNumber(ordersRaw),
    };
  }

  // =========================================================
  // 稼働日更新
  // =========================================================

  async function updateWorkingDay(
    dateKey
  ) {
    const tokyoDate =
      dateKey.split("-");

    const monthKey =
      `${tokyoDate[0]}-${tokyoDate[1]}`;

    const workingDaysKey =
      getWorkingDaysKey(monthKey);

    const daily =
      await getDailyValues(
        dateKey
      );

    if (
      daily.sales > 0 ||
      daily.orders > 0
    ) {
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
  // 月間最高値再計算
  // =========================================================

  async function getMonthlyBest(
    monthKey
  ) {
    const workingDaysKey =
      getWorkingDaysKey(monthKey);

    const workingDays =
      await redisCommand([
        "SMEMBERS",
        workingDaysKey,
      ]);

    let maxDailySales = 0;
    let maxDailyOrders = 0;

    if (
      Array.isArray(
        workingDays
      )
    ) {
      for (
        const workingDate
          of workingDays
      ) {
        const daily =
          await getDailyValues(
            workingDate
          );

        maxDailySales =
          Math.max(
            maxDailySales,
            daily.sales
          );

        maxDailyOrders =
          Math.max(
            maxDailyOrders,
            daily.orders
          );
      }
    }

    return {
      workingDayCount:
        Array.isArray(
          workingDays
        )
          ? workingDays.length
          : 0,

      maxDailySales,

      maxDailyOrders,
    };
  }
    // =========================================================
  // レポート生成
  // =========================================================

  async function buildReport(
    currentDateInfo
  ) {
    const {
      dateKey,
      monthKey,
      yearKey,
      displayDate,
    } = currentDateInfo;

    const daily =
      await getDailyValues(
        dateKey
      );

    const monthly =
      await getMonthlyValues(
        monthKey
      );

    const yearly =
      await getYearlyValues(
        yearKey
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

    const monthlyBest =
      await getMonthlyBest(
        monthKey
      );

    const perOrder =
      daily.orders > 0
        ? Math.round(
            daily.sales /
              daily.orders
          )
        : 0;

    const averageSalesPerDay =
      monthlyBest.workingDayCount > 0
        ? Math.round(
            monthly.sales /
              monthlyBest.workingDayCount
          )
        : 0;

    const monthlyTarget =
      500000;

    const achievementRate =
      monthlyTarget > 0
        ? (
            (monthly.sales /
              monthlyTarget) *
            100
          ).toFixed(1)
        : "0.0";

    const circleCount =
      Math.min(
        10,
        Math.floor(
          daily.sales / 1000
        )
      );

    const circles =
      "🟢".repeat(
        circleCount
      );

    const reportLines = [
      "🏍️ 配達売上",

      `💰 今日の売上 ${daily.sales.toLocaleString()}円`,
    ];

    if (circles) {
      reportLines.push(
        circles
      );
    }

    reportLines.push(
      `📦 今日の件数 ${daily.orders.toLocaleString()}件`,

      `💵 1件あたり ${perOrder.toLocaleString()}円`,

      `📅 今月売上 ${monthly.sales.toLocaleString()}円`,

      `📦 今月件数 ${monthly.orders.toLocaleString()}件`,

      `🗓️ 年間売上 ${yearly.sales.toLocaleString()}円`,

      `📦 年間件数 ${yearly.orders.toLocaleString()}件`,

      `📈 平均売上／日 ${averageSalesPerDay.toLocaleString()}円`,

      `🎯 月間目標 ${monthlyTarget.toLocaleString()}円`,

      `📊 目標達成率 ${achievementRate}%`,

      `🏆 月間最高売上 ${monthlyBest.maxDailySales.toLocaleString()}円`,

      `🏆 月間最高件数 ${monthlyBest.maxDailyOrders.toLocaleString()}件`,

      `📆 稼働日数 ${monthlyBest.workingDayCount}日`,

      `🛵 累計配達件数 ${allTimeOrders.toLocaleString()}件`,

      `🕐 ${displayDate}`,

      "🛵 今日も配達お疲れ様でした！"
    );

    return reportLines.join(
      "\n"
    );
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
    const recordId =
      createRecordId();

    const recordKey =
      getRecordKey(
        chatId,
        recordId
      );

    const recordIndexKey =
      getRecordIndexKey(
        chatId
      );

    const createdAt =
      Date.now();

    /*
     * 売上1件を独立したレコードとして保存
     *
     * これにより、
     *
     * 10/4 23:58
     * /sales 20000 10
     *
     * ↓
     *
     * 10/5 00:03
     * /cancel
     *
     * でも元の10/4を特定できる。
     */

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

    /*
     * ZSETで時系列管理
     *
     * score = 作成時刻
     *
     * ZREVRANGEで一番新しいものから取得できる。
     */

    await redisCommand([
      "ZADD",
      recordIndexKey,
      String(createdAt),
      recordId,
    ]);

    return {
      recordId,
      createdAt,
    };
  }

  // =========================================================
  // 直近の未キャンセル売上を取得
  // =========================================================

  async function findLatestActiveRecord(
    chatId
  ) {
    const recordIndexKey =
      getRecordIndexKey(
        chatId
      );

    /*
     * 新しい順に十分多く取得
     *
     * 通常は数件で足りるが、
     * キャンセル済みレコードが大量にあっても
     * 100件までは確認する。
     */

    const recordIds =
      await redisCommand([
        "ZREVRANGE",
        recordIndexKey,
        "0",
        "99",
      ]);

    if (
      !Array.isArray(
        recordIds
      )
    ) {
      return null;
    }

    for (
      const recordId
        of recordIds
    ) {
      const recordKey =
        getRecordKey(
          chatId,
          recordId
        );

      const record =
        await redisCommand([
          "HGETALL",
          recordKey,
        ]);

      if (
        !Array.isArray(
          record
        )
      ) {
        continue;
      }

      /*
       * Redis HGETALL は
       *
       * [
       *   key, value,
       *   key, value
       * ]
       *
       * 形式なのでオブジェクト化する。
       */

      const obj = {};

      for (
        let i = 0;
        i < record.length;
        i += 2
      ) {
        obj[
          record[i]
        ] =
          record[i + 1];
      }

      if (
        !obj.id
      ) {
        continue;
      }

      if (
        obj.cancelled === "1"
      ) {
        continue;
      }

      return {
        ...obj,
        recordKey,
      };
    }

    return null;
  }

  // =========================================================
  // 売上登録
  // =========================================================

  async function processSales({
    chatId,
    sales,
    orders,
    dateInfo,
  }) {
    const dailyKey =
      getDailyKey(
        dateInfo.dateKey
      );

    const monthlyKey =
      getMonthlyKey(
        dateInfo.monthKey
      );

    const yearlyKey =
      getYearlyKey(
        dateInfo.yearKey
      );

    const allTimeKey =
      "moheji:delivery:alltime";

    /*
     * まず売上1件を保存
     */

    const record =
      await saveSalesRecord({
        chatId,
        sales,
        orders,
        dateInfo,
      });

    /*
     * 日次
     */

    const daily =
      await getDailyValues(
        dateInfo.dateKey
      );

    const newDailySales =
      daily.sales +
      sales;

    const newDailyOrders =
      daily.orders +
      orders;

    await redisCommand([
      "HSET",
      dailyKey,

      "sales",
      String(newDailySales),

      "orders",
      String(newDailyOrders),
    ]);

    /*
     * 月間
     */

    const monthly =
      await getMonthlyValues(
        dateInfo.monthKey
      );

    const newMonthlySales =
      monthly.sales +
      sales;

    const newMonthlyOrders =
      monthly.orders +
      orders;

    await redisCommand([
      "HSET",
      monthlyKey,

      "sales",
      String(newMonthlySales),

      "orders",
      String(newMonthlyOrders),
    ]);

    /*
     * 年間
     */

    const yearly =
      await getYearlyValues(
        dateInfo.yearKey
      );

    const newYearlySales =
      yearly.sales +
      sales;

    const newYearlyOrders =
      yearly.orders +
      orders;

    await redisCommand([
      "HSET",
      yearlyKey,

      "sales",
      String(newYearlySales),

      "orders",
      String(newYearlyOrders),
    ]);

    /*
     * 累計配達件数
     */

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
      allTimeKey,

      "orders",
      String(
        allTimeOrders +
        orders
      ),
    ]);

    /*
     * 稼働日
     */

    await updateWorkingDay(
      dateInfo.dateKey
    );

    return {
      recordId:
        record.recordId,

      dailySales:
        newDailySales,

      dailyOrders:
        newDailyOrders,

      monthlySales:
        newMonthlySales,

      monthlyOrders:
        newMonthlyOrders,

      yearlySales:
        newYearlySales,

      yearlyOrders:
        newYearlyOrders,
    };
  }

  // =========================================================
  // 直近売上をキャンセル
  // =========================================================

  async function processCancel({
    chatId,
  }) {
      // =========================================================
  // 直近売上をキャンセル
  // =========================================================

  async function processCancel({
    chatId,
  }) {
    /*
     * =======================================================
     * ① 新方式の売上レコードを探す
     * =======================================================
     */

    const record =
      await findLatestActiveRecord(
        chatId
      );

    if (record) {
      const dateKey =
        record.dateKey;

      const monthKey =
        record.monthKey;

      const yearKey =
        record.yearKey;

      const sales =
        safeNumber(
          record.sales
        );

      const orders =
        safeNumber(
          record.orders
        );

      const dailyKey =
        getDailyKey(
          dateKey
        );

      const monthlyKey =
        getMonthlyKey(
          monthKey
        );

      const yearlyKey =
        getYearlyKey(
          yearKey
        );

      const allTimeKey =
        "moheji:delivery:alltime";

      /*
       * -------------------------------------------------------
       * 日次を減算
       * -------------------------------------------------------
       */

      const daily =
        await getDailyValues(
          dateKey
        );

      const newDailySales =
        Math.max(
          0,
          daily.sales -
            sales
        );

      const newDailyOrders =
        Math.max(
          0,
          daily.orders -
            orders
        );

      await redisCommand([
        "HSET",
        dailyKey,

        "sales",
        String(
          newDailySales
        ),

        "orders",
        String(
          newDailyOrders
        ),
      ]);

      /*
       * -------------------------------------------------------
       * 月間を減算
       * -------------------------------------------------------
       */

      const monthly =
        await getMonthlyValues(
          monthKey
        );

      const newMonthlySales =
        Math.max(
          0,
          monthly.sales -
            sales
        );

      const newMonthlyOrders =
        Math.max(
          0,
          monthly.orders -
            orders
        );

      await redisCommand([
        "HSET",
        monthlyKey,

        "sales",
        String(
          newMonthlySales
        ),

        "orders",
        String(
          newMonthlyOrders
        ),
      ]);

      /*
       * -------------------------------------------------------
       * 年間を減算
       * -------------------------------------------------------
       */

      const yearly =
        await getYearlyValues(
          yearKey
        );

      const newYearlySales =
        Math.max(
          0,
          yearly.sales -
            sales
        );

      const newYearlyOrders =
        Math.max(
          0,
          yearly.orders -
            orders
        );

      await redisCommand([
        "HSET",
        yearlyKey,

        "sales",
        String(
          newYearlySales
        ),

        "orders",
        String(
          newYearlyOrders
        ),
      ]);

      /*
       * -------------------------------------------------------
       * 累計を減算
       * -------------------------------------------------------
       */

      const allTimeSalesRaw =
        await redisCommand([
          "HGET",
          allTimeKey,
          "sales",
        ]);

      const allTimeOrdersRaw =
        await redisCommand([
          "HGET",
          allTimeKey,
          "orders",
        ]);

      const allTimeSales =
        safeNumber(
          allTimeSalesRaw
        );

      const allTimeOrders =
        safeNumber(
          allTimeOrdersRaw
        );

      await redisCommand([
        "HSET",
        allTimeKey,

        "sales",
        String(
          Math.max(
            0,
            allTimeSales -
              sales
          )
        ),

        "orders",
        String(
          Math.max(
            0,
            allTimeOrders -
              orders
          )
        ),
      ]);

      /*
       * -------------------------------------------------------
       * 稼働日を再計算
       * -------------------------------------------------------
       */

      await updateWorkingDay(
        dateKey
      );

      /*
       * -------------------------------------------------------
       * レコードをキャンセル済みにする
       * -------------------------------------------------------
       */

      await redisCommand([
        "HSET",
        record.recordKey,

        "cancelled",
        "1",
      ]);

      /*
       * -------------------------------------------------------
       * 完了メッセージ
       * -------------------------------------------------------
       */

      const message =
`❌ 売上をキャンセルしました。

💰 ${sales.toLocaleString()}円
📦 ${orders}件

対象日：${dateKey}`;

      await sendTelegramMessage(
        chatId,
        message
      );

      return {
        ...record,

        sales,
        orders,

        cancelled:
          true,
      };
    }

    /*
     * =======================================================
     * ② 旧方式で登録された売上の救済
     * =======================================================
     *
     * 旧コードでは個別レコードを保存していなかったため、
     *
     * 2026-10-04
     * 17,014円
     * 17件
     *
     * の売上を個別レコードとして特定できない。
     *
     * 今回はユーザーが明示したこの1件だけを
     * 一度だけ救済する。
     */

    const migrationDateKey =
      "2026-10-04";

    const migrationMonthKey =
      "2026-10";

    const migrationYearKey =
      "2026";

    const migrationSales =
      17014;

    const migrationOrders =
      17;

    /*
     * 同じ救済処理を二度実行しないためのキー
     */

    const migrationKey =
      `moheji:delivery:migration:cancel:${chatId}:2026-10-04:17014:17`;

    const alreadyMigrated =
      await redisCommand([
        "GET",
        migrationKey,
      ]);

    if (alreadyMigrated) {
      await sendTelegramMessage(
        chatId,
        "❌ キャンセルできる売上がありません。"
      );

      return null;
    }

    /*
     * 10/4の日次集計を確認
     */

    const migrationDaily =
      await getDailyValues(
        migrationDateKey
      );

    /*
     * 日次集計が対象金額・件数を
     * 下回っている場合は減算しない。
     */

    if (
      migrationDaily.sales <
        migrationSales ||
      migrationDaily.orders <
        migrationOrders
    ) {
      await sendTelegramMessage(
        chatId,
        "⚠️ キャンセル対象の過去売上を確認できませんでした。"
      );

      return null;
    }

    const migrationDailyKey =
      getDailyKey(
        migrationDateKey
      );

    const migrationMonthlyKey =
      getMonthlyKey(
        migrationMonthKey
      );

    const migrationYearlyKey =
      getYearlyKey(
        migrationYearKey
      );

    const migrationAllTimeKey =
      "moheji:delivery:alltime";

    /*
     * =======================================================
     * 日次から減算
     * =======================================================
     */

    const newMigrationDailySales =
      Math.max(
        0,
        migrationDaily.sales -
          migrationSales
      );

    const newMigrationDailyOrders =
      Math.max(
        0,
        migrationDaily.orders -
          migrationOrders
      );

    await redisCommand([
      "HSET",
      migrationDailyKey,

      "sales",
      String(
        newMigrationDailySales
      ),

      "orders",
      String(
        newMigrationDailyOrders
      ),
    ]);

    /*
     * =======================================================
     * 月間から減算
     * =======================================================
     */

    const migrationMonthly =
      await getMonthlyValues(
        migrationMonthKey
      );

    const newMigrationMonthlySales =
      Math.max(
        0,
        migrationMonthly.sales -
          migrationSales
      );

    const newMigrationMonthlyOrders =
      Math.max(
        0,
        migrationMonthly.orders -
          migrationOrders
      );

    await redisCommand([
      "HSET",
      migrationMonthlyKey,

      "sales",
      String(
        newMigrationMonthlySales
      ),

      "orders",
      String(
        newMigrationMonthlyOrders
      ),
    ]);

    /*
     * =======================================================
     * 年間から減算
     * =======================================================
     */

    const migrationYearly =
      await getYearlyValues(
        migrationYearKey
      );

    const newMigrationYearlySales =
      Math.max(
        0,
        migrationYearly.sales -
          migrationSales
      );

    const newMigrationYearlyOrders =
      Math.max(
        0,
        migrationYearly.orders -
          migrationOrders
      );

    await redisCommand([
      "HSET",
      migrationYearlyKey,

      "sales",
      String(
        newMigrationYearlySales
      ),

      "orders",
      String(
        newMigrationYearlyOrders
      ),
    ]);

    /*
     * =======================================================
     * 累計から減算
     * =======================================================
     */

    const migrationAllTimeSalesRaw =
      await redisCommand([
        "HGET",
        migrationAllTimeKey,
        "sales",
      ]);

    const migrationAllTimeOrdersRaw =
      await redisCommand([
        "HGET",
        migrationAllTimeKey,
        "orders",
      ]);

    const migrationAllTimeSales =
      safeNumber(
        migrationAllTimeSalesRaw
      );

    const migrationAllTimeOrders =
      safeNumber(
        migrationAllTimeOrdersRaw
      );

    await redisCommand([
      "HSET",
      migrationAllTimeKey,

      "sales",
      String(
        Math.max(
          0,
          migrationAllTimeSales -
            migrationSales
        )
      ),

      "orders",
      String(
        Math.max(
          0,
          migrationAllTimeOrders -
            migrationOrders
        )
      ),
    ]);

    /*
     * =======================================================
     * 10/4の稼働日を再計算
     * =======================================================
     */

    await updateWorkingDay(
      migrationDateKey
    );

    /*
     * =======================================================
     * 救済済みフラグ
     * =======================================================
     *
     * SETすることで、次回の /cancel で
     * 同じ17,014円・17件をもう一度引かない。
     */

    await redisCommand([
      "SET",
      migrationKey,
      "1",
    ]);

    /*
     * =======================================================
     * 完了メッセージ
     * =======================================================
     */

    const migrationMessage =
`❌ 過去の売上をキャンセルしました。

💰 ${migrationSales.toLocaleString()}円
📦 ${migrationOrders}件

対象日：${migrationDateKey}`;

    await sendTelegramMessage(
      chatId,
      migrationMessage
    );

    return {
      id:
        "migration-2026-10-04-17014-17",

      chatId,

      sales:
        migrationSales,

      orders:
        migrationOrders,

      dateKey:
        migrationDateKey,

      monthKey:
        migrationMonthKey,

      yearKey:
        migrationYearKey,

      cancelled:
        true,

      migration:
        true,
    };
  }
  // =========================================================
  // /record
  // =========================================================

  async function processRecord(
    dateInfo
  ) {
    const monthKeys = [];

    let currentYear =
      Number(
        dateInfo.year
      );

    let currentMonth =
      Number(
        dateInfo.month
      );

    /*
     * 過去24か月
     */

    for (
      let i = 0;
      i < 24;
      i++
    ) {
      const mm =
        String(
          currentMonth
        ).padStart(
          2,
          "0"
        );

      monthKeys.push(
        `${currentYear}-${mm}`
      );

      currentMonth--;

      if (
        currentMonth === 0
      ) {
        currentMonth = 12;
        currentYear--;
      }
    }

    const records = [];

    for (
      const ym
        of monthKeys
    ) {
      const [
        recordYear,
        recordMonth,
      ] =
        ym.split("-");

      const monthly =
        await getMonthlyValues(
          ym
        );

      if (
        monthly.sales === 0 &&
        monthly.orders === 0
      ) {
        continue;
      }

      const monthlyBest =
        await getMonthlyBest(
          ym
        );

      records.push(
        `${recordYear}年${Number(recordMonth)}月\n` +

        `📅 月間売上 ${monthly.sales.toLocaleString()}円\n` +

        `📦 月間件数 ${monthly.orders.toLocaleString()}件\n` +

        `🏆 月間最高売上 ${monthlyBest.maxDailySales.toLocaleString()}円\n` +

        `🏆 月間最高件数 ${monthlyBest.maxDailyOrders.toLocaleString()}件`
      );
    }

    let recordMessage =
      "📊 月間記録\n\n";

    if (
      records.length === 0
    ) {
      recordMessage +=
        "まだ月間記録がありません。";
    } else {
      recordMessage +=
        records.join(
          "\n\n"
        );
    }

    recordMessage +=
      `\n\n🕐 ${dateInfo.displayDate}`;

    return recordMessage;
  }

  // =========================================================
  // Main
  // =========================================================

  try {
    // =======================================================
    // Telegram update
    // =======================================================

    const rawBody =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(
            req.body || {}
          );

    const body =
      JSON.parse(
        rawBody
      );

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

      if (
        result !== "OK"
      ) {
        console.log(
          `Duplicate update ignored: ${updateId}`
        );

        return res
          .status(200)
          .send("OK");
      }
    }

    // =======================================================
    // Message check
    // =======================================================

    if (
      !body.message
    ) {
      return res
        .status(200)
        .send("OK");
    }

    const message =
      body.message;

    const chatId =
      message.chat?.id;

    const text =
      (
        message.text ||
        ""
      ).trim();

    if (
      !chatId ||
      !text
    ) {
      return res
        .status(200)
        .send("OK");
    }

    // =======================================================
    // 東京時間
    // =======================================================

    const dateInfo =
      getTokyoDateInfo();

    // =======================================================
    // /record
    // =======================================================

    if (
      text === "/record" ||
      text.startsWith(
        "/record@"
      )
    ) {
      const recordMessage =
        await processRecord(
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

    let command = "";

    if (
      parts[0] === "/sales" ||
      parts[0].startsWith(
        "/sales@"
      )
    ) {
      command = "sales";
    } else if (
      parts[0] === "/cancel" ||
      parts[0].startsWith(
        "/cancel@"
      )
    ) {
      command = "cancel";
    } else {
      return res
        .status(200)
        .send("OK");
    }

    // =======================================================
    // /cancel
    //
    // 今回から
    //
    // /cancel
    //
    // だけでOK。
    //
    // /cancel 20000 10
    //
    // は使用しない。
    // =======================================================

    if (
      command === "cancel"
    ) {
      /*
       * 間違って
       *
       * /cancel 20000 10
       *
       * と入力しても、金額を使って取消しない。
       *
       * 常に「直近の1件」を取り消す。
       */

      const result =
        await processCancel({
          chatId,
        });

      if (
        !result.success
      ) {
        await sendTelegramMessage(
          chatId,
          result.message
        );

        return res
          .status(200)
          .send("OK");
      }

      /*
       * キャンセルした売上の日時を表示
       */

      const cancelledDate =
        result.dateKey
          .replace(
            /^(\d{4})-(\d{2})-(\d{2})$/,
            "$1/$2/$3"
          );

      const cancelMessage =
        "↩️ 直近の売上を取り消しました\n\n" +

        `💰 売上 ${result.sales.toLocaleString()}円\n` +

        `📦 件数 ${result.orders.toLocaleString()}件\n` +

        `📅 対象日 ${cancelledDate}\n\n` +

        "※元の売上日を基準に日次・月間・年間集計を戻しました。";

      /*
       * キャンセルした後の現在状態も送る
       */

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

    if (
      parts.length < 3
    ) {
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
      Number(
        parts[1]
      );

    let orders =
      Number(
        parts[2]
      );

    if (
      !Number.isFinite(
        sales
      ) ||
      !Number.isFinite(
        orders
      ) ||
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
      Math.floor(
        sales
      );

    orders =
      Math.floor(
        orders
      );

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
    // レポート
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
};
