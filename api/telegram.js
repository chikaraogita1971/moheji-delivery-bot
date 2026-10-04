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

  if (
    !KV_REST_API_URL ||
    !KV_REST_API_TOKEN
  ) {
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

        body:
          JSON.stringify(command),
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

    const response =
      await fetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
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

    const response =
      await fetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
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
  // レコードID
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
  // 東京時間
  // =========================================================

  function getTokyoDateInfo(
    date = new Date()
  ) {
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

  function getDailyKey(
    dateKey
  ) {
    return (
      `moheji:delivery:daily:${dateKey}`
    );
  }

  function getMonthlyKey(
    monthKey
  ) {
    return (
      `moheji:delivery:month:${monthKey}`
    );
  }

  function getYearlyKey(
    yearKey
  ) {
    return (
      `moheji:delivery:year:${yearKey}`
    );
  }

  function getWorkingDaysKey(
    monthKey
  ) {
    return (
      `moheji:delivery:workingdays:${monthKey}`
    );
  }

  function getRecordIndexKey(
    chatId
  ) {
    return (
      `moheji:delivery:records:${chatId}`
    );
  }

  function getRecordKey(
    chatId,
    recordId
  ) {
    return (
      `moheji:delivery:record:${chatId}:${recordId}`
    );
  }

  function getCancelLockKey(
    chatId,
    recordId
  ) {
    return (
      `moheji:delivery:cancel-lock:${chatId}:${recordId}`
    );
  }

  function getMigrationLockKey(
    chatId
  ) {
    return (
      `moheji:delivery:migration-lock:${chatId}:2026-10-04`
    );
  }

  // =========================================================
  // 日次取得
  // =========================================================

  async function getDailyValues(
    dateKey
  ) {
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
        safeNumber(
          salesRaw
        ),

      orders:
        safeNumber(
          ordersRaw
        ),
    };
  }

  // =========================================================
  // 月間取得
  // =========================================================

  async function getMonthlyValues(
    monthKey
  ) {
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
        safeNumber(
          salesRaw
        ),

      orders:
        safeNumber(
          ordersRaw
        ),
    };
  }

  // =========================================================
  // 年間取得
  // =========================================================

  async function getYearlyValues(
    yearKey
  ) {
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
        safeNumber(
          salesRaw
        ),

      orders:
        safeNumber(
          ordersRaw
        ),
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
      getWorkingDaysKey(
        monthKey
      );

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
  // 月間最高値
  // =========================================================

  async function getMonthlyBest(
    monthKey
  ) {
    const workingDaysKey =
      getWorkingDaysKey(
        monthKey
      );

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
  // レポート
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
            (
              monthly.sales /
              monthlyTarget
            ) *
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
  // 直近の未キャンセル売上
  // =========================================================

  async function findLatestActiveRecord(
    chatId
  ) {
    const recordIndexKey =
      getRecordIndexKey(
        chatId
      );

    const recordIds =
      await redisCommand([
        "ZREVRANGE",
        recordIndexKey,
        "0",
        "-1",
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
  // 売上登録処理
  // =========================================================

  async function processSales({
    chatId,
    sales,
    orders,
    dateInfo,
  }) {
    // ---------------------------------------------
    // まず個別レコードを保存
    // ---------------------------------------------

    await saveSalesRecord({
      chatId,
      sales,
      orders,
      dateInfo,
    });

    // ---------------------------------------------
    // 日次
    // ---------------------------------------------

    const dailyKey =
      getDailyKey(
        dateInfo.dateKey
      );

    await redisCommand([
      "HINCRBY",
      dailyKey,
      "sales",
      String(sales),
    ]);

    await redisCommand([
      "HINCRBY",
      dailyKey,
      "orders",
      String(orders),
    ]);

    // ---------------------------------------------
    // 月間
    // ---------------------------------------------

    const monthlyKey =
      getMonthlyKey(
        dateInfo.monthKey
      );

    await redisCommand([
      "HINCRBY",
      monthlyKey,
      "sales",
      String(sales),
    ]);

    await redisCommand([
      "HINCRBY",
      monthlyKey,
      "orders",
      String(orders),
    ]);

    // ---------------------------------------------
    // 年間
    // ---------------------------------------------

    const yearlyKey =
      getYearlyKey(
        dateInfo.yearKey
      );

    await redisCommand([
      "HINCRBY",
      yearlyKey,
      "sales",
      String(sales),
    ]);

    await redisCommand([
      "HINCRBY",
      yearlyKey,
      "orders",
      String(orders),
    ]);

    // ---------------------------------------------
    // 累計
    // ---------------------------------------------

    const allTimeKey =
      "moheji:delivery:alltime";

    await redisCommand([
      "HINCRBY",
      allTimeKey,
      "sales",
      String(sales),
    ]);

    await redisCommand([
      "HINCRBY",
      allTimeKey,
      "orders",
      String(orders),
    ]);

    // ---------------------------------------------
    // 稼働日
    // ---------------------------------------------

    await updateWorkingDay(
      dateInfo.dateKey
    );

    return {
      success: true,
    };
  }

  // =========================================================
  // キャンセル処理
  // =========================================================

  async function processCancel({
    chatId,
  }) {
    // =======================================================
    // ① 新システムの個別レコードを探す
    //
    // 日付は見ない。
    // 24時をまたいでも、最後の未キャンセル売上を探す。
    // =======================================================

    const record =
      await findLatestActiveRecord(
        chatId
      );

    if (record) {
      const cancelLockKey =
        getCancelLockKey(
          chatId,
          record.id
        );

      // -----------------------------------------------------
      // 同じ売上に対する二重キャンセル防止
      // -----------------------------------------------------

      const cancelLock =
        await redisCommand([
          "SET",
          cancelLockKey,
          "1",
          "NX",
          "EX",
          "60",
        ]);

      if (
        cancelLock !== "OK"
      ) {
        return {
          success: false,

          message:
            "⚠️ この売上は現在キャンセル処理中です。",
        };
      }

      try {
        const sales =
          safeNumber(
            record.sales
          );

        const orders =
          safeNumber(
            record.orders
          );

        const dateKey =
          record.dateKey;

        const monthKey =
          record.monthKey;

        const yearKey =
          record.yearKey;

        // ---------------------------------------------------
        // キャンセル対象データの確認
        // ---------------------------------------------------

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

        // ---------------------------------------------------
        // データ不足なら安全のためキャンセルしない
        // ---------------------------------------------------

        if (
          daily.sales < sales ||
          daily.orders < orders
        ) {
          return {
            success: false,

            message:
              "❌ 日次売上データが不足しているため、キャンセルを実行できません。",
          };
        }

        if (
          monthly.sales < sales ||
          monthly.orders < orders
        ) {
          return {
            success: false,

            message:
              "❌ 月間売上データが不足しているため、キャンセルを実行できません。",
          };
        }

        if (
          yearly.sales < sales ||
          yearly.orders < orders
        ) {
          return {
            success: false,

            message:
              "❌ 年間売上データが不足しているため、キャンセルを実行できません。",
          };
        }

        if (
          allTimeOrders < orders
        ) {
          return {
            success: false,

            message:
              "❌ 累計件数データが不足しているため、キャンセルを実行できません。",
          };
        }

        // ---------------------------------------------------
        // 累計売上が存在する場合のみ確認
        //
        // 古いデータで alltime.sales が存在しない場合は、
        // 無理に作らず、そのまま扱う。
        // ---------------------------------------------------

        if (
          allTimeSalesRaw !== null &&
          allTimeSalesRaw !== undefined &&
          allTimeSales < sales
        ) {
          return {
            success: false,

            message:
              "❌ 累計売上データが不足しているため、キャンセルを実行できません。",
          };
        }

        // ===================================================
        // 日次から減算
        // ===================================================

        await redisCommand([
          "HINCRBY",
          getDailyKey(
            dateKey
          ),
          "sales",
          String(-sales),
        ]);

        await redisCommand([
          "HINCRBY",
          getDailyKey(
            dateKey
          ),
          "orders",
          String(-orders),
        ]);

        // ===================================================
        // 月間から減算
        // ===================================================

        await redisCommand([
          "HINCRBY",
          getMonthlyKey(
            monthKey
          ),
          "sales",
          String(-sales),
        ]);

        await redisCommand([
          "HINCRBY",
          getMonthlyKey(
            monthKey
          ),
          "orders",
          String(-orders),
        ]);

        // ===================================================
        // 年間から減算
        // ===================================================

        await redisCommand([
          "HINCRBY",
          getYearlyKey(
            yearKey
          ),
          "sales",
          String(-sales),
        ]);

        await redisCommand([
          "HINCRBY",
          getYearlyKey(
            yearKey
          ),
          "orders",
          String(-orders),
        ]);

        // ===================================================
        // 累計から減算
        // ===================================================

        if (
          allTimeSalesRaw !== null &&
          allTimeSalesRaw !== undefined
        ) {
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

        // ===================================================
        // 稼働日を再計算
        // ===================================================

        await updateWorkingDay(
          dateKey
        );

        // ===================================================
        // 個別レコードをキャンセル済みにする
        // ===================================================

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

          sales,

          orders,

          dateKey,

          message:
            `↩️ 売上をキャンセルしました\n` +
            `💰 -${sales.toLocaleString()}円\n` +
            `📦 -${orders.toLocaleString()}件\n` +
            `📅 対象日 ${dateKey}`,
        };
      } finally {
        // ---------------------------------------------------
        // ロック解除
        //
        // レコード自体は cancelled=1 なので、
        // ロックを消しても二重キャンセルにはならない。
        // ---------------------------------------------------

        try {
          await redisCommand([
            "DEL",
            cancelLockKey,
          ]);
        } catch (lockError) {
          console.error(
            "Cancel lock cleanup error:",
            lockError
          );
        }
      }
    }

    // =======================================================
    // ② 旧システムの売上用フォールバック
    //
    // 2026-10-04
    // 23:59ごろ
    //
    // /sales 17014 17
    //
    // を旧システムで登録していて、
    // 2026-10-05になってから /cancel された場合に対応。
    //
    // 個別レコードが存在しない旧データなので、
    // この条件の売上を1回だけキャンセルする。
    // =======================================================

    const migrationKey =
      `moheji:delivery:migrated-cancel:${chatId}:2026-10-04:17014:17`;

    const migrationLockKey =
      getMigrationLockKey(
        chatId
      );

    // -------------------------------------------------------
    // 旧データの二重キャンセル防止ロック
    // -------------------------------------------------------

    const migrationLock =
      await redisCommand([
        "SET",
        migrationLockKey,
        "1",
        "NX",
        "EX",
        "60",
      ]);

    if (
      migrationLock !== "OK"
    ) {
      return {
        success: false,

        message:
          "⚠️ この過去売上は現在キャンセル処理中です。",
      };
    }

    try {
      // -----------------------------------------------------
      // すでに旧売上をキャンセル済みか確認
      // -----------------------------------------------------

      const alreadyMigrated =
        await redisCommand([
          "GET",
          migrationKey,
        ]);

      if (alreadyMigrated) {
        return {
          success: false,

          message:
            "❌ キャンセルできる売上がありません。",
        };
      }

      // -----------------------------------------------------
      // 旧売上の固定値
      // -----------------------------------------------------

      const legacyDateKey =
        "2026-10-04";

      const legacyMonthKey =
        "2026-10";

      const legacyYearKey =
        "2026";

      const legacySales =
        17014;

      const legacyOrders =
        17;

      // -----------------------------------------------------
      // 現在の各集計値を取得
      // -----------------------------------------------------

      const daily =
        await getDailyValues(
          legacyDateKey
        );

      const monthly =
        await getMonthlyValues(
          legacyMonthKey
        );

      const yearly =
        await getYearlyValues(
          legacyYearKey
        );

      const allTimeKey =
        "moheji:delivery:alltime";

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

      // -----------------------------------------------------
      // 日次確認
      // -----------------------------------------------------

      if (
        daily.sales < legacySales ||
        daily.orders < legacyOrders
      ) {
        return {
          success: false,

          message:
            "❌ 2026/10/04のキャンセル対象売上が確認できません。",
        };
      }

      // -----------------------------------------------------
      // 月間確認
      // -----------------------------------------------------

      if (
        monthly.sales < legacySales ||
        monthly.orders < legacyOrders
      ) {
        return {
          success: false,

          message:
            "❌ 2026/10の集計データが不足しているため、キャンセルできません。",
        };
      }

      // -----------------------------------------------------
      // 年間確認
      // -----------------------------------------------------

      if (
        yearly.sales < legacySales ||
        yearly.orders < legacyOrders
      ) {
        return {
          success: false,

          message:
            "❌ 2026年の集計データが不足しているため、キャンセルできません。",
        };
      }

      // -----------------------------------------------------
      // 累計件数確認
      // -----------------------------------------------------

      if (
        allTimeOrders < legacyOrders
      ) {
        return {
          success: false,

          message:
            "❌ 累計件数データが不足しているため、キャンセルできません。",
        };
      }

      // -----------------------------------------------------
      // 累計売上が存在する場合は金額も確認
      // -----------------------------------------------------

      if (
        allTimeSalesRaw !== null &&
        allTimeSalesRaw !== undefined &&
        allTimeSales < legacySales
      ) {
        return {
          success: false,

          message:
            "❌ 累計売上データが不足しているため、キャンセルできません。",
        };
      }

      // =====================================================
      // 日次から減算
      // =====================================================

      await redisCommand([
        "HINCRBY",
        getDailyKey(
          legacyDateKey
        ),
        "sales",
        String(-legacySales),
      ]);

      await redisCommand([
        "HINCRBY",
        getDailyKey(
          legacyDateKey
        ),
        "orders",
        String(-legacyOrders),
      ]);

      // =====================================================
      // 月間から減算
      // =====================================================

      await redisCommand([
        "HINCRBY",
        getMonthlyKey(
          legacyMonthKey
        ),
        "sales",
        String(-legacySales),
      ]);

      await redisCommand([
        "HINCRBY",
        getMonthlyKey(
          legacyMonthKey
        ),
        "orders",
        String(-legacyOrders),
      ]);

      // =====================================================
      // 年間から減算
      // =====================================================

      await redisCommand([
        "HINCRBY",
        getYearlyKey(
          legacyYearKey
        ),
        "sales",
        String(-legacySales),
      ]);

      await redisCommand([
        "HINCRBY",
        getYearlyKey(
          legacyYearKey
        ),
        "orders",
        String(-legacyOrders),
      ]);

      // =====================================================
      // 累計から減算
      // =====================================================

      if (
        allTimeSalesRaw !== null &&
        allTimeSalesRaw !== undefined
      ) {
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

      // =====================================================
      // 稼働日更新
      // =====================================================

      await updateWorkingDay(
        legacyDateKey
      );

      // =====================================================
      // 旧売上のキャンセル済みフラグ
      // =====================================================

      await redisCommand([
        "SET",
        migrationKey,
        "1",
        "EX",
        "31536000",
      ]);

      return {
        success: true,

        sales:
          legacySales,

        orders:
          legacyOrders,

        dateKey:
          legacyDateKey,

        message:
          `↩️ 過去の売上をキャンセルしました\n` +
          `💰 -${legacySales.toLocaleString()}円\n` +
          `📦 -${legacyOrders.toLocaleString()}件\n` +
          `📅 対象日 ${legacyDateKey}`,
      };
    } finally {
      // -----------------------------------------------------
      // 旧データ用ロック解除
      // -----------------------------------------------------

      try {
        await redisCommand([
          "DEL",
          migrationLockKey,
        ]);
      } catch (lockError) {
        console.error(
          "Migration lock cleanup error:",
          lockError
        );
      }
    }
  }
    // =========================================================
  // 24か月分の記録
  // =========================================================

  async function processRecord() {
    const now = new Date();

    const currentYear =
      Number(
        new Intl.DateTimeFormat(
          "en-US",
          {
            timeZone: "Asia/Tokyo",
            year: "numeric",
          }
        ).format(now)
      );

    const currentMonth =
      Number(
        new Intl.DateTimeFormat(
          "en-US",
          {
            timeZone: "Asia/Tokyo",
            month: "numeric",
          }
        ).format(now)
      );

    const lines = [];

    lines.push(
      "📊 過去24か月の売上記録"
    );

    lines.push("");

    for (
      let i = 0;
      i < 24;
      i++
    ) {
      let year =
        currentYear;

      let month =
        currentMonth - i;

      while (month <= 0) {
        month += 12;
        year--;
      }

      const monthKey =
        `${year}-${String(month).padStart(2, "0")}`;

      const monthly =
        await getMonthlyValues(
          monthKey
        );

      const best =
        await getMonthlyBest(
          monthKey
        );

      const workingDaysKey =
        getWorkingDaysKey(
          monthKey
        );

      const workingDaysRaw =
        await redisCommand([
          "GET",
          workingDaysKey,
        ]);

      const workingDays =
        safeNumber(
          workingDaysRaw
        );

      lines.push(
        `【${year}/${String(month).padStart(2, "0")}】`
      );

      lines.push(
        `💰 売上 ${monthly.sales.toLocaleString()}円`
      );

      lines.push(
        `📦 件数 ${monthly.orders.toLocaleString()}件`
      );

      lines.push(
        `📅 稼働日 ${workingDays}日`
      );

      lines.push(
        `🔥 日次最高売上 ${best.sales.toLocaleString()}円`
      );

      lines.push(
        `🔥 日次最高件数 ${best.orders.toLocaleString()}件`
      );

      lines.push("");
    }

    return lines.join("\n");
  }

  // =========================================================
  // Telegram Update 本体
  // =========================================================

  module.exports = async function handler(
    req,
    res
  ) {
    // =======================================================
    // HTTP Method
    // =======================================================

    if (
      req.method !== "POST"
    ) {
      res.status(200).json({
        ok: true,
        message:
          "Telegram webhook is running.",
      });

      return;
    }

    // =======================================================
    // 環境変数確認
    // =======================================================

    if (
      !process.env.TELEGRAM_BOT_TOKEN ||
      !process.env.KV_REST_API_URL ||
      !process.env.KV_REST_API_TOKEN
    ) {
      console.error(
        "Required environment variables are missing."
      );

      res.status(500).json({
        ok: false,
        error:
          "Environment variables are missing.",
      });

      return;
    }

    try {
      // =====================================================
      // body
      // =====================================================

      const update =
        req.body || {};

      // =====================================================
      // Telegram update_id
      //
      // 同じWebhookが複数回届いた場合の二重処理防止
      // =====================================================

      const updateId =
        update.update_id;

      if (
        updateId !== undefined &&
        updateId !== null
      ) {
        const processedKey =
          `moheji:telegram:processed:${updateId}`;

        const processed =
          await redisCommand([
            "SET",
            processedKey,
            "1",
            "NX",
            "EX",
            "86400",
          ]);

        if (
          processed !== "OK"
        ) {
          res.status(200).json({
            ok: true,
            duplicate: true,
          });

          return;
        }
      }

      // =====================================================
      // Telegram message
      // =====================================================

      const message =
        update.message ||
        update.edited_message ||
        update.channel_post;

      if (!message) {
        res.status(200).json({
          ok: true,
          ignored: true,
        });

        return;
      }

      const chatId =
        message.chat &&
        message.chat.id;

      if (
        chatId === undefined ||
        chatId === null
      ) {
        res.status(200).json({
          ok: true,
          ignored: true,
        });

        return;
      }

      const text =
        typeof message.text === "string"
          ? message.text.trim()
          : "";

      if (!text) {
        res.status(200).json({
          ok: true,
          ignored: true,
        });

        return;
      }

      // =====================================================
      // /record
      // =====================================================

      if (
        /^\/record(?:@\w+)?$/i.test(
          text
        )
      ) {
        const recordText =
          await processRecord();

        await sendTelegramMessage(
          chatId,
          recordText
        );

        res.status(200).json({
          ok: true,
        });

        return;
      }

      // =====================================================
      // コマンド解析
      //
      // /sales
      // /sales@botname
      // /cancel
      // /cancel@botname
      // =====================================================

      const commandMatch =
        text.match(
          /^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/
        );

      if (!commandMatch) {
        res.status(200).json({
          ok: true,
          ignored: true,
        });

        return;
      }

      const command =
        commandMatch[1]
          .toLowerCase();

      const argumentText =
        (
          commandMatch[2] ||
          ""
        ).trim();

      // =====================================================
      // /cancel
      //
      // 引数は無視する。
      //
      // /cancel
      // /cancel test
      // /cancel 123
      //
      // いずれも「直近売上キャンセル」として処理。
      // =====================================================

      if (
        command === "cancel"
      ) {
        const result =
          await processCancel({
            chatId,
          });

        if (
          !result.success
        ) {
          await sendTelegramMessage(
            chatId,
            result.message ||
              "❌ キャンセルできる売上がありません。"
          );

          res.status(200).json({
            ok: true,
          });

          return;
        }

        // ---------------------------------------------------
        // キャンセル対象の売上日
        // ---------------------------------------------------

        const cancelledDate =
          result.dateKey
            ? result.dateKey.replace(
                /^(\d{4})-(\d{2})-(\d{2})$/,
                "$1/$2/$3"
              )
            : "";

        let messageText =
          "↩️ 直近の売上を取り消しました\n\n";

        messageText +=
          `💰 売上 ${result.sales.toLocaleString()}円\n`;

        messageText +=
          `📦 件数 ${result.orders.toLocaleString()}件\n`;

        if (
          cancelledDate
        ) {
          messageText +=
            `📅 対象日 ${cancelledDate}\n`;
        }

        messageText +=
          "\n※元の売上日を基準に日次・月間・年間・累計集計を戻しました。";

        await sendTelegramMessage(
          chatId,
          messageText
        );

        // ---------------------------------------------------
        // キャンセル後の現在日時点レポート
        //
        // 日付をまたいでキャンセルした場合でも、
        // レポートは「現在の日付」で表示。
        // ---------------------------------------------------

        const currentDateInfo =
          getTokyoDateInfo();

        const report =
          await buildReport(
            currentDateInfo
          );

        const photoUrl =
          "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

        await sendTelegramPhoto(
          chatId,
          photoUrl,
          report
        );

        res.status(200).json({
          ok: true,
        });

        return;
      }

      // =====================================================
      // /sales
      // =====================================================

      if (
        command === "sales"
      ) {
        // ---------------------------------------------------
        // 引数を空白で分割
        //
        // /sales 17014 17
        // ---------------------------------------------------

        const args =
          argumentText
            ? argumentText.split(/\s+/)
            : [];

        if (
          args.length !== 2
        ) {
          await sendTelegramMessage(
            chatId,
            "❌ 入力形式が違います。\n\n" +
              "例：\n" +
              "/sales 17014 17"
          );

          res.status(200).json({
            ok: true,
          });

          return;
        }

        const sales =
          Number(args[0]);

        const orders =
          Number(args[1]);

        // ---------------------------------------------------
        // 数値チェック
        // ---------------------------------------------------

        if (
          !Number.isFinite(sales) ||
          !Number.isFinite(orders)
        ) {
          await sendTelegramMessage(
            chatId,
            "❌ 売上と件数は数字で入力してください。\n\n" +
              "例：\n" +
              "/sales 17014 17"
          );

          res.status(200).json({
            ok: true,
          });

          return;
        }

        if (
          sales < 0 ||
          orders < 0
        ) {
          await sendTelegramMessage(
            chatId,
            "❌ 売上と件数には0以上の数字を入力してください。"
          );

          res.status(200).json({
            ok: true,
          });

          return;
        }

        // ---------------------------------------------------
        // 小数を切り捨て
        // ---------------------------------------------------

        const normalizedSales =
          Math.floor(sales);

        const normalizedOrders =
          Math.floor(orders);

        // ---------------------------------------------------
        // 東京時間
        // ---------------------------------------------------

        const dateInfo =
          getTokyoDateInfo();

        // ---------------------------------------------------
        // 売上登録
        // ---------------------------------------------------

        await processSales({
          chatId,
          sales:
            normalizedSales,
          orders:
            normalizedOrders,
          dateInfo,
        });

        // ---------------------------------------------------
        // 現在の日次レポート作成
        // ---------------------------------------------------

        const report =
          await buildReport(
            dateInfo
          );

        const photoUrl =
          "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

        await sendTelegramPhoto(
          chatId,
          photoUrl,
          report
        );

        res.status(200).json({
          ok: true,
        });

        return;
      }

      // =====================================================
      // 未対応コマンド
      // =====================================================

      res.status(200).json({
        ok: true,
        ignored: true,
      });
    } catch (error) {
      // =====================================================
      // エラー
      // =====================================================

      console.error(
        "Telegram webhook error:",
        error
      );

      // -----------------------------------------------------
      // Telegram側にもエラー通知
      // -----------------------------------------------------

      try {
        const update =
          req.body || {};

        const message =
          update.message ||
          update.edited_message ||
          update.channel_post;

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
            "❌ 処理中にエラーが発生しました。\n" +
              "しばらくしてからもう一度お試しください。"
          );
        }
      } catch (telegramError) {
        console.error(
          "Failed to send Telegram error message:",
          telegramError
        );
      }

      res.status(500).json({
        ok: false,
        error:
          "Internal server error.",
      });
    }
  };
