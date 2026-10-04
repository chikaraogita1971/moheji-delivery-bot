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

  // =========================================================
  // 環境変数チェック
  // =========================================================

  if (!TELEGRAM_BOT_TOKEN) {
    console.error(
      "TELEGRAM_BOT_TOKEN is missing"
    );

    return res
      .status(500)
      .send("TELEGRAM_BOT_TOKEN is missing");
  }

  if (
    !KV_REST_API_URL ||
    !KV_REST_API_TOKEN
  ) {
    console.error(
      "Redis environment variables are missing"
    );

    return res
      .status(500)
      .send(
        "Redis environment variables are missing"
      );
  }

  // =========================================================
  // 売上報告画像
  // =========================================================

  const SALES_IMAGE_URL =
    "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/refs/heads/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";

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
  // Telegram メッセージ
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
  // Telegram 画像 + キャプション
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
            SALES_IMAGE_URL,

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
  // 東京時間
  // =========================================================

  function getTokyoDateInfo(
    date = new Date()
  ) {
    const parts =
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
        parts.find(
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
        `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}`,
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

  // =========================================================
  // 日次集計
  // =========================================================

  async function getDailyValues(
    dateKey
  ) {
    const key =
      getDailyKey(dateKey);

    const sales =
      await redisCommand([
        "HGET",
        key,
        "sales",
      ]);

    const orders =
      await redisCommand([
        "HGET",
        key,
        "orders",
      ]);

    return {
      sales:
        safeNumber(sales),

      orders:
        safeNumber(orders),
    };
  }

  // =========================================================
  // 月間集計
  // =========================================================

  async function getMonthlyValues(
    monthKey
  ) {
    const key =
      getMonthlyKey(monthKey);

    const sales =
      await redisCommand([
        "HGET",
        key,
        "sales",
      ]);

    const orders =
      await redisCommand([
        "HGET",
        key,
        "orders",
      ]);

    return {
      sales:
        safeNumber(sales),

      orders:
        safeNumber(orders),
    };
  }

  // =========================================================
  // 年間集計
  // =========================================================

  async function getYearlyValues(
    yearKey
  ) {
    const key =
      getYearlyKey(yearKey);

    const sales =
      await redisCommand([
        "HGET",
        key,
        "sales",
      ]);

    const orders =
      await redisCommand([
        "HGET",
        key,
        "orders",
      ]);

    return {
      sales:
        safeNumber(sales),

      orders:
        safeNumber(orders),
    };
  }

  // =========================================================
  // 稼働日更新
  // =========================================================

  async function updateWorkingDay(
    dateKey
  ) {
    const parts =
      dateKey.split("-");

    const monthKey =
      `${parts[0]}-${parts[1]}`;

    const key =
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
  // 月間最高値
  // =========================================================

  async function getMonthlyBest(
    monthKey
  ) {
    const key =
      getWorkingDaysKey(
        monthKey
      );

    const workingDays =
      await redisCommand([
        "SMEMBERS",
        key,
      ]);

    let maxDailySales = 0;
    let maxDailyOrders = 0;

    if (
      Array.isArray(
        workingDays
      )
    ) {
      for (
        const dateKey
          of workingDays
      ) {
        const daily =
          await getDailyValues(
            dateKey
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

    const indexKey =
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
  // 最新の未キャンセル売上
  // =========================================================

  async function findLatestActiveRecord(
    chatId
  ) {
    const indexKey =
      getRecordIndexKey(
        chatId
      );

    const recordIds =
      await redisCommand([
        "ZREVRANGE",
        indexKey,
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
        !record ||
        (
          !Array.isArray(record) &&
          typeof record !== "object"
        )
      ) {
        continue;
      }

      const obj = {};

      if (
        Array.isArray(record)
      ) {
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
      } else {
        Object.assign(
          obj,
          record
        );
      }

      if (!obj.id) {
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

    // ---------------------------------------------
    // レコード保存
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
      String(
        newDailySales
      ),

      "orders",
      String(
        newDailyOrders
      ),
    ]);

    // ---------------------------------------------
    // 月間
    // ---------------------------------------------

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
      String(
        newMonthlySales
      ),

      "orders",
      String(
        newMonthlyOrders
      ),
    ]);

    // ---------------------------------------------
    // 年間
    // ---------------------------------------------

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
      String(
        newYearlySales
      ),

      "orders",
      String(
        newYearlyOrders
      ),
    ]);

    // ---------------------------------------------
    // 累計件数
    // ---------------------------------------------

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

    // ---------------------------------------------
    // 稼働日
    // ---------------------------------------------

    await updateWorkingDay(
      dateInfo.dateKey
    );
  }

  // =========================================================
  // 旧データ救済
  //
  // 2026/10/04 23:59
  // /sales 17014 17
  //
  // 旧コードではレコードが保存されていないため、
  // 今回だけ明示的に取り消す。
  // =========================================================

  async function processLegacyMigrationCancel(
    chatId
  ) {
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

    const migrationKey =
      `moheji:delivery:migration:cancel:${chatId}:2026-10-04:17014:17`;

    // ---------------------------------------------
    // すでに救済済みか確認
    // ---------------------------------------------

    const alreadyDone =
      await redisCommand([
        "GET",
        migrationKey,
      ]);

    if (
      alreadyDone
    ) {
      return null;
    }

    // ---------------------------------------------
    // 10/4の日次データ確認
    // ---------------------------------------------

    const daily =
      await getDailyValues(
        migrationDateKey
      );

    if (
      daily.sales <
        migrationSales ||
      daily.orders <
        migrationOrders
    ) {
      return null;
    }

    // ---------------------------------------------
    // 日次
    // ---------------------------------------------

    const dailyKey =
      getDailyKey(
        migrationDateKey
      );

    const newDailySales =
      Math.max(
        0,
        daily.sales -
          migrationSales
      );

    const newDailyOrders =
      Math.max(
        0,
        daily.orders -
          migrationOrders
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

    // ---------------------------------------------
    // 月間
    // ---------------------------------------------

    const monthlyKey =
      getMonthlyKey(
        migrationMonthKey
      );

    const monthly =
      await getMonthlyValues(
        migrationMonthKey
      );

    const newMonthlySales =
      Math.max(
        0,
        monthly.sales -
          migrationSales
      );

    const newMonthlyOrders =
      Math.max(
        0,
        monthly.orders -
          migrationOrders
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

    // ---------------------------------------------
    // 年間
    // ---------------------------------------------

    const yearlyKey =
      getYearlyKey(
        migrationYearKey
      );

    const yearly =
      await getYearlyValues(
        migrationYearKey
      );

    const newYearlySales =
      Math.max(
        0,
        yearly.sales -
          migrationSales
      );

    const newYearlyOrders =
      Math.max(
        0,
        yearly.orders -
          migrationOrders
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

    // ---------------------------------------------
    // 累計件数
    // ---------------------------------------------

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
        allTimeOrders -
          migrationOrders
      );

    await redisCommand([
      "HSET",
      allTimeKey,

      "orders",
      String(
        newAllTimeOrders
      ),
    ]);

    // ---------------------------------------------
    // 稼働日
    // ---------------------------------------------

    await updateWorkingDay(
      migrationDateKey
    );

    // ---------------------------------------------
    // 二重救済防止
    // ---------------------------------------------

    await redisCommand([
      "SET",
      migrationKey,
      "1",
    ]);

    return {
      sales:
        migrationSales,

      orders:
        migrationOrders,

      dateKey:
        migrationDateKey,

      monthKey:
        migrationMonthKey,
    };
  }

  // =========================================================
  // /cancel
  // =========================================================

  async function processCancel({
    chatId,
  }) {
    // ---------------------------------------------
    // 通常のレコードを探す
    // ---------------------------------------------

    const record =
      await findLatestActiveRecord(
        chatId
      );

    // ---------------------------------------------
    // 新しいレコードがなければ
    // 旧データ救済を1回だけ試す
    // ---------------------------------------------

    if (!record) {
      const migration =
        await processLegacyMigrationCancel(
          chatId
        );

      if (!migration) {
        return {
          success:
            false,

          message:
            "❌ 取り消せる売上がありません。",
        };
      }

      return {
        success:
          true,

        migration:
          true,

        sales:
          migration.sales,

        orders:
          migration.orders,

        dateKey:
          migration.dateKey,

        monthKey:
          migration.monthKey,
      };
    }

    const sales =
      safeNumber(
        record.sales
      );

    const orders =
      safeNumber(
        record.orders
      );

    const recordDateKey =
      record.dateKey;

    const recordMonthKey =
      record.monthKey;

    const recordYearKey =
      record.yearKey;

    // ---------------------------------------------
    // 元の売上日を使用
    // ---------------------------------------------

    const dailyKey =
      getDailyKey(
        recordDateKey
      );

    const monthlyKey =
      getMonthlyKey(
        recordMonthKey
      );

    const yearlyKey =
      getYearlyKey(
        recordYearKey
      );

    const allTimeKey =
      "moheji:delivery:alltime";

    // ---------------------------------------------
    // 日次
    // ---------------------------------------------

    const daily =
      await getDailyValues(
        recordDateKey
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

    // ---------------------------------------------
    // 月間
    // ---------------------------------------------

    const monthly =
      await getMonthlyValues(
        recordMonthKey
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

    // ---------------------------------------------
    // 年間
    // ---------------------------------------------

    const yearly =
      await getYearlyValues(
        recordYearKey
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

    // ---------------------------------------------
    // 累計件数
    // ---------------------------------------------

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
        allTimeOrders -
          orders
      );

    await redisCommand([
      "HSET",
      allTimeKey,

      "orders",
      String(
        newAllTimeOrders
      ),
    ]);

    // ---------------------------------------------
    // 元の日の稼働日を更新
    // ---------------------------------------------

    await updateWorkingDay(
      recordDateKey
    );

    // ---------------------------------------------
    // キャンセル済みにする
    // ---------------------------------------------

    await redisCommand([
      "HSET",
      record.recordKey,

      "cancelled",
      "1",

      "cancelledAt",
      String(
        Date.now()
      ),
    ]);

    return {
      success:
        true,

      migration:
        false,

      sales,

      orders,

      dateKey:
        recordDateKey,

      monthKey:
        recordMonthKey,

      recordId:
        record.id,
    };
  }

  // =========================================================
  // /sales レポート
  // =========================================================

  async function buildSalesReport(
    dateInfo
  ) {
    const daily =
      await getDailyValues(
        dateInfo.dateKey
      );

    const monthly =
      await getMonthlyValues(
        dateInfo.monthKey
      );

    const yearly =
      await getYearlyValues(
        dateInfo.yearKey
      );

    // ---------------------------------------------
    // 累計件数
    // ---------------------------------------------

    const allTimeOrdersRaw =
      await redisCommand([
        "HGET",
        "moheji:delivery:alltime",
        "orders",
      ]);

    const allTimeOrders =
      safeNumber(
        allTimeOrdersRaw
      );

    // ---------------------------------------------
    // 月間最高
    // ---------------------------------------------

    const monthlyBest =
      await getMonthlyBest(
        dateInfo.monthKey
      );

    // ---------------------------------------------
    // 1件あたり
    // ---------------------------------------------

    const perOrder =
      daily.orders > 0
        ? Math.round(
            daily.sales /
              daily.orders
          )
        : 0;

    // ---------------------------------------------
    // 平均売上 / 日
    // ---------------------------------------------

    const averageSalesPerDay =
      monthlyBest.workingDayCount >
      0
        ? Math.round(
            monthly.sales /
              monthlyBest.workingDayCount
          )
        : 0;

    // ---------------------------------------------
    // 月間目標
    // ---------------------------------------------

    const monthlyTarget =
      500000;

    // ---------------------------------------------
    // 達成率
    // ---------------------------------------------

    const achievementRate =
      monthlyTarget > 0
        ? (
            monthly.sales /
            monthlyTarget *
            100
          ).toFixed(1)
        : "0.0";

    // ---------------------------------------------
    // 希望していた以前のフォーマット
    // ---------------------------------------------

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

      `🕐 ${dateInfo.displayDate}`,

      "🛵 今日も配達お疲れ様でした！",
    ].join("\n");
  }

  // =========================================================
  // /record
  // =========================================================

  async function processRecord(
    dateInfo
  ) {
    const monthKeys = [];

    let year =
      Number(
        dateInfo.year
      );

    let month =
      Number(
        dateInfo.month
      );

    // 過去24か月
    for (
      let i = 0;
      i < 24;
      i++
    ) {
      const mm =
        String(month)
          .padStart(2, "0");

      monthKeys.push(
        `${year}-${mm}`
      );

      month--;

      if (month === 0) {
        month = 12;
        year--;
      }
    }

    const records = [];

    for (
      const ym of monthKeys
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

      const best =
        await getMonthlyBest(
          ym
        );

      records.push(
        `${recordYear}年${Number(recordMonth)}月\n` +

        `📅 月間売上 ${monthly.sales.toLocaleString()}円\n` +

        `📦 月間件数 ${monthly.orders.toLocaleString()}件\n` +

        `🏆 月間最高売上 ${best.maxDailySales.toLocaleString()}円\n` +

        `🏆 月間最高件数 ${best.maxDailyOrders.toLocaleString()}件`
      );
    }

    let message =
      "📊 月間記録\n\n";

    if (
      records.length === 0
    ) {
      message +=
        "まだ月間記録がありません。";
    } else {
      message +=
        records.join(
          "\n\n"
        );
    }

    message +=
      `\n\n🕐 ${dateInfo.displayDate}`;

    return message;
  }

  // =========================================================
  // Main
  // =========================================================

  try {
    // ---------------------------------------------
    // Telegram update
    // ---------------------------------------------

    const body =
      typeof req.body === "string"
        ? JSON.parse(
            req.body
          )
        : (
            req.body || {}
          );

    // ---------------------------------------------
    // 二重処理防止
    // ---------------------------------------------

    const updateId =
      body.update_id;

    if (
      updateId !==
        undefined &&
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

    // ---------------------------------------------
    // message
    // ---------------------------------------------

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

    // ---------------------------------------------
    // 東京時間
    // ---------------------------------------------

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
      const report =
        await processRecord(
          dateInfo
        );

      await sendTelegramMessage(
        chatId,
        report
      );

      return res
        .status(200)
        .send("OK");
    }

    // =======================================================
    // コマンド
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
    // =======================================================

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

      let message;

      if (
        result.migration
      ) {
        message =
          "↩️ 過去の売上をキャンセルしました\n\n" +

          `💰 売上 ${result.sales.toLocaleString()}円\n` +

          `📦 件数 ${result.orders.toLocaleString()}件\n` +

          `📅 対象日 ${cancelledDate}\n\n` +

          "※2026/10/04の旧データを一度だけ救済しました。";
      } else {
        message =
          "↩️ 直近の売上を取り消しました\n\n" +

          `💰 売上 ${result.sales.toLocaleString()}円\n` +

          `📦 件数 ${result.orders.toLocaleString()}件\n` +

          `📅 対象日 ${cancelledDate}\n\n` +

          "※元の売上日を基準に日次・月間・年間集計を戻しました。";
      }

      await sendTelegramMessage(
        chatId,
        message
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

    // ---------------------------------------------
    // 売上登録
    // ---------------------------------------------

    await processSales({
      chatId,
      sales,
      orders,
      dateInfo,
    });

    // ---------------------------------------------
    // 以前と同じ売上報告
    // ---------------------------------------------

    const report =
      await buildSalesReport(
        dateInfo
      );

    // ---------------------------------------------
    // 画像 → その下に売上報告
    // ---------------------------------------------

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
