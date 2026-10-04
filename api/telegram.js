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
    return res.status(500).send(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
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
      const errorText =
        await response.text();

      throw new Error(
        `Redis error: ${response.status} ${errorText}`
      );
    }

    const data =
      await response.json();

    return data.result;
  }

  // =========================================================
  // Telegram
  // =========================================================

  async function sendTelegramMessage(
    chatId,
    text
  ) {
    const response =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            chat_id: chatId,
            text,
          }),
        }
      );

    if (!response.ok) {
      throw new Error(
        `Telegram error: ${await response.text()}`
      );
    }
  }

  async function sendTelegramPhoto(
    chatId,
    caption
  ) {
    const response =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
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
      throw new Error(
        `Telegram photo error: ${await response.text()}`
      );
    }
  }

  // =========================================================
  // Utility
  // =========================================================

  function safeNumber(value) {
    const number =
      Number(value);

    if (!Number.isFinite(number)) {
      return 0;
    }

    return Math.max(
      0,
      number
    );
  }

  function createRecordId() {
    return (
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 12)}`
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

    const get =
      type =>
        parts.find(
          item =>
            item.type === type
        )?.value;

    const year =
      get("year");

    const month =
      get("month");

    const day =
      get("day");

    const hour =
      get("hour");

    const minute =
      get("minute");

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
        year,

      displayDate:
        `${year}/${month}/${day} ${hour}:${minute}`,
    };
  }

  // =========================================================
  // Redis keys
  // =========================================================

  function dailyKey(dateKey) {
    return (
      `moheji:delivery:daily:${dateKey}`
    );
  }

  function monthlyKey(monthKey) {
    return (
      `moheji:delivery:month:${monthKey}`
    );
  }

  function yearlyKey(yearKey) {
    return (
      `moheji:delivery:year:${yearKey}`
    );
  }

  function workingDaysKey(monthKey) {
    return (
      `moheji:delivery:workingdays:${monthKey}`
    );
  }

  function recordIndexKey(chatId) {
    return (
      `moheji:delivery:records:${chatId}`
    );
  }

  function recordKey(
    chatId,
    recordId
  ) {
    return (
      `moheji:delivery:record:${chatId}:${recordId}`
    );
  }

  const allTimeKey =
    "moheji:delivery:alltime";

  // =========================================================
  // 集計取得
  // =========================================================

  async function getHashValues(
    key
  ) {
    const result =
      await redisCommand([
        "HGETALL",
        key,
      ]);

    const obj = {};

    if (Array.isArray(result)) {
      for (
        let i = 0;
        i < result.length;
        i += 2
      ) {
        obj[result[i]] =
          result[i + 1];
      }
    } else if (
      result &&
      typeof result === "object"
    ) {
      Object.assign(
        obj,
        result
      );
    }

    return obj;
  }

  async function getDaily(
    dateKey
  ) {
    const data =
      await getHashValues(
        dailyKey(dateKey)
      );

    return {
      sales:
        safeNumber(
          data.sales
        ),

      orders:
        safeNumber(
          data.orders
        ),
    };
  }

  async function getMonthly(
    monthKey
  ) {
    const data =
      await getHashValues(
        monthlyKey(monthKey)
      );

    return {
      sales:
        safeNumber(
          data.sales
        ),

      orders:
        safeNumber(
          data.orders
        ),
    };
  }

  async function getYearly(
    yearKey
  ) {
    const data =
      await getHashValues(
        yearlyKey(yearKey)
      );

    return {
      sales:
        safeNumber(
          data.sales
        ),

      orders:
        safeNumber(
          data.orders
        ),
    };
  }

  // =========================================================
  // 稼働日
  // =========================================================

  async function updateWorkingDay(
    dateKey
  ) {
    const [
      year,
      month,
    ] =
      dateKey.split("-");

    const monthKey =
      `${year}-${month}`;

    const daily =
      await getDaily(
        dateKey
      );

    if (
      daily.sales > 0 ||
      daily.orders > 0
    ) {
      await redisCommand([
        "SADD",
        workingDaysKey(
          monthKey
        ),
        dateKey,
      ]);
    } else {
      await redisCommand([
        "SREM",
        workingDaysKey(
          monthKey
        ),
        dateKey,
      ]);
    }
  }

  async function getMonthlyBest(
    monthKey
  ) {
    const dates =
      await redisCommand([
        "SMEMBERS",
        workingDaysKey(
          monthKey
        ),
      ]);

    let maxSales = 0;
    let maxOrders = 0;

    if (Array.isArray(dates)) {
      for (
        const dateKey
        of dates
      ) {
        const daily =
          await getDaily(
            dateKey
          );

        maxSales =
          Math.max(
            maxSales,
            daily.sales
          );

        maxOrders =
          Math.max(
            maxOrders,
            daily.orders
          );
      }
    }

    return {
      days:
        Array.isArray(dates)
          ? dates.length
          : 0,

      maxSales,

      maxOrders,
    };
  }

  // =========================================================
  // レポート
  // =========================================================

  async function buildReport(
    dateInfo
  ) {
    const daily =
      await getDaily(
        dateInfo.dateKey
      );

    const monthly =
      await getMonthly(
        dateInfo.monthKey
      );

    const yearly =
      await getYearly(
        dateInfo.yearKey
      );

    const allTimeRaw =
      await redisCommand([
        "HGET",
        allTimeKey,
        "orders",
      ]);

    const allTimeOrders =
      safeNumber(
        allTimeRaw
      );

    const best =
      await getMonthlyBest(
        dateInfo.monthKey
      );

    const perOrder =
      daily.orders > 0
        ? Math.round(
            daily.sales /
            daily.orders
          )
        : 0;

    const average =
      best.days > 0
        ? Math.round(
            monthly.sales /
            best.days
          )
        : 0;

    const target =
      500000;

    const achievement =
      target > 0
        ? (
            monthly.sales /
            target *
            100
          ).toFixed(1)
        : "0.0";

    const circleCount =
      Math.min(
        10,
        Math.floor(
          daily.sales /
          1000
        )
      );

    const circles =
      "🟢".repeat(
        circleCount
      );

    const lines = [
      "🏍️ 配達売上",

      `💰 今日の売上 ${daily.sales.toLocaleString()}円`,
    ];

    if (circles) {
      lines.push(
        circles
      );
    }

    lines.push(
      `📦 今日の件数 ${daily.orders.toLocaleString()}件`,

      `💵 1件あたり ${perOrder.toLocaleString()}円`,

      `📅 今月売上 ${monthly.sales.toLocaleString()}円`,

      `📦 今月件数 ${monthly.orders.toLocaleString()}件`,

      `🗓️ 年間売上 ${yearly.sales.toLocaleString()}円`,

      `📦 年間件数 ${yearly.orders.toLocaleString()}件`,

      `📈 平均売上／日 ${average.toLocaleString()}円`,

      `🎯 月間目標 ${target.toLocaleString()}円`,

      `📊 目標達成率 ${achievement}%`,

      `🏆 月間最高売上 ${best.maxSales.toLocaleString()}円`,

      `🏆 月間最高件数 ${best.maxOrders.toLocaleString()}件`,

      `📆 稼働日数 ${best.days}日`,

      `🛵 累計配達件数 ${allTimeOrders.toLocaleString()}件`,

      `🕐 ${dateInfo.displayDate}`,

      "🛵 今日も配達お疲れ様でした！"
    );

    return lines.join(
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
    const id =
      createRecordId();

    const key =
      recordKey(
        chatId,
        id
      );

    const index =
      recordIndexKey(
        chatId
      );

    const createdAt =
      Date.now();

    await redisCommand([
      "HSET",
      key,

      "id",
      id,

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
      index,
      String(createdAt),
      id,
    ]);

    return id;
  }

  // =========================================================
  // 最新の未キャンセル売上
  // =========================================================

  async function findLatestActiveRecord(
    chatId
  ) {
    const ids =
      await redisCommand([
        "ZREVRANGE",
        recordIndexKey(
          chatId
        ),
        "0",
        "-1",
      ]);

    if (!Array.isArray(ids)) {
      return null;
    }

    for (
      const id of ids
    ) {
      const key =
        recordKey(
          chatId,
          id
        );

      const raw =
        await getHashValues(
          key
        );

      if (!raw.id) {
        continue;
      }

      if (
        raw.cancelled === "1"
      ) {
        continue;
      }

      return {
        ...raw,
        recordKey: key,
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
    await saveSalesRecord({
      chatId,
      sales,
      orders,
      dateInfo,
    });

    const daily =
      await getDaily(
        dateInfo.dateKey
      );

    await redisCommand([
      "HSET",
      dailyKey(
        dateInfo.dateKey
      ),

      "sales",
      String(
        daily.sales +
        sales
      ),

      "orders",
      String(
        daily.orders +
        orders
      ),
    ]);

    const monthly =
      await getMonthly(
        dateInfo.monthKey
      );

    await redisCommand([
      "HSET",
      monthlyKey(
        dateInfo.monthKey
      ),

      "sales",
      String(
        monthly.sales +
        sales
      ),

      "orders",
      String(
        monthly.orders +
        orders
      ),
    ]);

    const yearly =
      await getYearly(
        dateInfo.yearKey
      );

    await redisCommand([
      "HSET",
      yearlyKey(
        dateInfo.yearKey
      ),

      "sales",
      String(
        yearly.sales +
        sales
      ),

      "orders",
      String(
        yearly.orders +
        orders
      ),
    ]);

    const allTime =
      safeNumber(
        await redisCommand([
          "HGET",
          allTimeKey,
          "orders",
        ])
      );

    await redisCommand([
      "HSET",
      allTimeKey,

      "orders",
      String(
        allTime +
        orders
      ),
    ]);

    await updateWorkingDay(
      dateInfo.dateKey
    );
  }

  // =========================================================
  // キャンセル
  // =========================================================

  async function processCancel(
    chatId
  ) {
    const record =
      await findLatestActiveRecord(
        chatId
      );

    if (!record) {
      return {
        success:
          false,

        message:
          "❌ 取り消せる売上がありません。",
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

    /*
     * ★重要
     *
     * 現在の日付ではなく、
     * 売上を登録したときの
     * dateKey / monthKey / yearKey
     * を使う。
     *
     * これで
     *
     * 10/4 23:59
     * /sales 17014 17
     *
     * ↓
     *
     * 10/5 00:01
     * /cancel
     *
     * が正常に動く。
     */

    const originalDate =
      record.dateKey;

    const originalMonth =
      record.monthKey;

    const originalYear =
      record.yearKey;

    // -------------------------------------------------------
    // 日次
    // -------------------------------------------------------

    const daily =
      await getDaily(
        originalDate
      );

    await redisCommand([
      "HSET",
      dailyKey(
        originalDate
      ),

      "sales",
      String(
        Math.max(
          0,
          daily.sales -
          sales
        )
      ),

      "orders",
      String(
        Math.max(
          0,
          daily.orders -
          orders
        )
      ),
    ]);

    // -------------------------------------------------------
    // 月間
    // -------------------------------------------------------

    const monthly =
      await getMonthly(
        originalMonth
      );

    await redisCommand([
      "HSET",
      monthlyKey(
        originalMonth
      ),

      "sales",
      String(
        Math.max(
          0,
          monthly.sales -
          sales
        )
      ),

      "orders",
      String(
        Math.max(
          0,
          monthly.orders -
          orders
        )
      ),
    ]);

    // -------------------------------------------------------
    // 年間
    // -------------------------------------------------------

    const yearly =
      await getYearly(
        originalYear
      );

    await redisCommand([
      "HSET",
      yearlyKey(
        originalYear
      ),

      "sales",
      String(
        Math.max(
          0,
          yearly.sales -
          sales
        )
      ),

      "orders",
      String(
        Math.max(
          0,
          yearly.orders -
          orders
        )
      ),
    ]);

    // -------------------------------------------------------
    // 累計件数
    // -------------------------------------------------------

    const allTime =
      safeNumber(
        await redisCommand([
          "HGET",
          allTimeKey,
          "orders",
        ])
      );

    await redisCommand([
      "HSET",
      allTimeKey,

      "orders",
      String(
        Math.max(
          0,
          allTime -
          orders
        )
      ),
    ]);

    // -------------------------------------------------------
    // 稼働日
    // -------------------------------------------------------

    await updateWorkingDay(
      originalDate
    );

    // -------------------------------------------------------
    // キャンセル済みにする
    // -------------------------------------------------------

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

      sales,

      orders,

      dateKey:
        originalDate,

      monthKey:
        originalMonth,

      yearKey:
        originalYear,
    };
  }

  // =========================================================
  // /record
  // =========================================================

  async function processRecord(
    dateInfo
  ) {
    const records = [];

    let year =
      Number(
        dateInfo.year
      );

    let month =
      Number(
        dateInfo.month
      );

    for (
      let i = 0;
      i < 24;
      i++
    ) {
      const monthText =
        String(month)
          .padStart(
            2,
            "0"
          );

      const monthKeyText =
        `${year}-${monthText}`;

      const monthly =
        await getMonthly(
          monthKeyText
        );

      if (
        monthly.sales !== 0 ||
        monthly.orders !== 0
      ) {
        const best =
          await getMonthlyBest(
            monthKeyText
          );

        records.push(
          `${year}年${month}月\n` +
          `📅 月間売上 ${monthly.sales.toLocaleString()}円\n` +
          `📦 月間件数 ${monthly.orders.toLocaleString()}件\n` +
          `🏆 月間最高売上 ${best.maxSales.toLocaleString()}円\n` +
          `🏆 月間最高件数 ${best.maxOrders.toLocaleString()}件`
        );
      }

      month--;

      if (month === 0) {
        month = 12;
        year--;
      }
    }

    let message =
      "📊 月間記録\n\n";

    if (records.length === 0) {
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
    let body =
      req.body;

    if (
      typeof body === "string"
    ) {
      body =
        JSON.parse(body);
    }

    // -------------------------------------------------------
    // 二重処理防止
    // -------------------------------------------------------

    const updateId =
      body?.update_id;

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
        return res
          .status(200)
          .send("OK");
      }
    }

    // -------------------------------------------------------
    // Message
    // -------------------------------------------------------

    const message =
      body?.message;

    if (!message) {
      return res
        .status(200)
        .send("OK");
    }

    const chatId =
      message.chat?.id;

    const text =
      String(
        message.text || ""
      ).trim();

    if (
      !chatId ||
      !text
    ) {
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
      text.split(
        /\s+/
      );

    const first =
      parts[0];

    // =======================================================
    // /cancel
    // =======================================================

    if (
      first === "/cancel" ||
      first.startsWith(
        "/cancel@"
      )
    ) {
      const result =
        await processCancel(
          chatId
        );

      if (!result.success) {
        await sendTelegramMessage(
          chatId,
          result.message
        );

        return res
          .status(200)
          .send("OK");
      }

      const report =
        await buildReport(
          dateInfo
        );

      const displayDate =
        result.dateKey.replace(
          /^(\d{4})-(\d{2})-(\d{2})$/,
          "$1/$2/$3"
        );

      const messageText =
        "↩️ 直近の売上を取り消しました\n\n" +
        `💰 売上 ${result.sales.toLocaleString()}円\n` +
        `📦 件数 ${result.orders.toLocaleString()}件\n` +
        `📅 対象日 ${displayDate}\n\n` +
        "※元の売上日を基準に日次・月間・年間集計を戻しました。\n\n" +
        report;

      await sendTelegramPhoto(
        chatId,
        messageText
      );

      return res
        .status(200)
        .send("OK");
    }

    // =======================================================
    // /sales
    // =======================================================

    if (
      first === "/sales" ||
      first.startsWith(
        "/sales@"
      )
    ) {
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

      await processSales({
        chatId,
        sales,
        orders,
        dateInfo,
      });

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
    }

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
