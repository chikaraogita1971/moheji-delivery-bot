module.exports = async function handler(req, res) {
  console.log("=== WEBHOOK START ===");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const redisUrl = process.env.KV_REST_API_URL?.trim();
    const redisToken = process.env.KV_REST_API_TOKEN?.trim();

    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN is missing");
      return res.status(500).send("TOKEN MISSING");
    }

    if (!redisUrl || !redisToken) {
      console.error("KV_REST_API_URL or KV_REST_API_TOKEN is missing");
      return res.status(500).send("REDIS MISSING");
    }

    // ========================================
    // Telegram受信
    // ========================================

    let rawBody = "";

    for await (const chunk of req) {
      rawBody += chunk.toString();
    }

    if (!rawBody) {
      return res.status(200).send("OK");
    }

    const body = JSON.parse(rawBody);

    if (!body.message) {
      return res.status(200).send("OK");
    }

    const message = body.message;
    const chatId = message.chat?.id;
    const text = message.text || "";

    console.log("CHAT_ID:", chatId);
    console.log("TEXT:", text);

    // ========================================
    // コマンド
    // /sales 5000 12
    // /cancel 5000 12
    // ========================================

    const match = text.match(
      /^\/(sales|cancel)(?:@\S+)?\s+(\d+)\s+(\d+)$/
    );

    if (!match) {
      return res.status(200).send("OK");
    }

    const command = match[1];
    const inputSales = Number(match[2]);
    const inputOrders = Number(match[3]);

    if (
      !Number.isFinite(inputSales) ||
      !Number.isFinite(inputOrders) ||
      inputSales < 0 ||
      inputOrders < 0
    ) {
      return res.status(200).send("OK");
    }

    const sign =
      command === "cancel"
        ? -1
        : 1;

    const sales =
      inputSales * sign;

    const orders =
      inputOrders * sign;

    // ========================================
    // 東京時間
    // ========================================

    const now = new Date();

    const parts =
      new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).formatToParts(now);

    const getPart = (type) => {
      const part = parts.find(
        (p) => p.type === type
      );

      return part
        ? part.value
        : "";
    };

    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    const hour = getPart("hour");
    const minute = getPart("minute");

    const yearMonth =
      `${year}-${month}`;

    const dateKey =
      `${yearMonth}-${day}`;

    const displayDate =
      `${year}/${month}/${day} ${hour}:${minute}`;

    // ========================================
    // Redis
    // ========================================

    async function redisCommand(command) {
      const response = await fetch(
        redisUrl,
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${redisToken}`,
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify(command)
        }
      );

      const result =
        await response.json();

      if (
        !response.ok ||
        result.error
      ) {
        throw new Error(
          result.error ||
          "Redis command failed"
        );
      }

      return result.result;
    }

    // ========================================
    // Redisキー
    // ========================================

    const monthlyKey =
      `moheji:delivery:month:${yearMonth}`;

    const yearlyKey =
      `moheji:delivery:year:${year}`;

    const dailyKey =
      `moheji:delivery:day:${dateKey}`;

    const workingDaysKey =
      `moheji:delivery:workingdays:${yearMonth}`;

    const totalKey =
      `moheji:delivery:total`;

    // ========================================
    // 今月
    // ========================================

    let monthlySales =
      Number(
        await redisCommand([
          "HINCRBY",
          monthlyKey,
          "sales",
          sales
        ])
      );

    let monthlyOrders =
      Number(
        await redisCommand([
          "HINCRBY",
          monthlyKey,
          "orders",
          orders
        ])
      );

    // ========================================
    // 年間
    // ========================================

    let yearlySales =
      Number(
        await redisCommand([
          "HINCRBY",
          yearlyKey,
          "sales",
          sales
        ])
      );

    let yearlyOrders =
      Number(
        await redisCommand([
          "HINCRBY",
          yearlyKey,
          "orders",
          orders
        ])
      );

    // ========================================
    // 今日
    // ========================================

    let todaySales =
      Number(
        await redisCommand([
          "HINCRBY",
          dailyKey,
          "sales",
          sales
        ])
      );

    let todayOrders =
      Number(
        await redisCommand([
          "HINCRBY",
          dailyKey,
          "orders",
          orders
        ])
      );

    // ========================================
    // マイナス防止
    // ========================================

    if (todaySales < 0) {
      todaySales = 0;

      await redisCommand([
        "HSET",
        dailyKey,
        "sales",
        0
      ]);
    }

    if (todayOrders < 0) {
      todayOrders = 0;

      await redisCommand([
        "HSET",
        dailyKey,
        "orders",
        0
      ]);
    }

    if (monthlySales < 0) {
      monthlySales = 0;

      await redisCommand([
        "HSET",
        monthlyKey,
        "sales",
        0
      ]);
    }

    if (monthlyOrders < 0) {
      monthlyOrders = 0;

      await redisCommand([
        "HSET",
        monthlyKey,
        "orders",
        0
      ]);
    }

    if (yearlySales < 0) {
      yearlySales = 0;

      await redisCommand([
        "HSET",
        yearlyKey,
        "sales",
        0
      ]);
    }

    if (yearlyOrders < 0) {
      yearlyOrders = 0;

      await redisCommand([
        "HSET",
        yearlyKey,
        "orders",
        0
      ]);
    }

    // ========================================
    // 累計配達件数
    // ========================================

    let totalOrders =
      Number(
        await redisCommand([
          "HINCRBY",
          totalKey,
          "orders",
          orders
        ])
      );

    if (totalOrders < 0) {
      totalOrders = 0;

      await redisCommand([
        "HSET",
        totalKey,
        "orders",
        0
      ]);
    }

    // ========================================
    // 稼働日数
    // ========================================

    if (
      todaySales > 0 ||
      todayOrders > 0
    ) {
      await redisCommand([
        "SADD",
        workingDaysKey,
        dateKey
      ]);
    } else {
      await redisCommand([
        "SREM",
        workingDaysKey,
        dateKey
      ]);
    }

    const workingDays =
      Number(
        await redisCommand([
          "SCARD",
          workingDaysKey
        ])
      );

    // ========================================
    // 月間最高値を再計算
    // ========================================

    const maxSalesKey =
      `moheji:delivery:maxsales:${yearMonth}`;

    const maxOrdersKey =
      `moheji:delivery:maxorders:${yearMonth}`;

    const workingDates =
      await redisCommand([
        "SMEMBERS",
        workingDaysKey
      ]);

    let maxDailySales = 0;
    let maxDailyOrders = 0;

    if (
      Array.isArray(workingDates)
    ) {
      for (
        const workingDate
        of workingDates
      ) {
        const checkDailyKey =
          `moheji:delivery:day:${workingDate}`;

        const checkSales =
          await redisCommand([
            "HGET",
            checkDailyKey,
            "sales"
          ]);

        const checkOrders =
          await redisCommand([
            "HGET",
            checkDailyKey,
            "orders"
          ]);

        const dailySalesValue =
          Number(checkSales || 0);

        const dailyOrdersValue =
          Number(checkOrders || 0);

        if (
          dailySalesValue >
          maxDailySales
        ) {
          maxDailySales =
            dailySalesValue;
        }

        if (
          dailyOrdersValue >
          maxDailyOrders
        ) {
          maxDailyOrders =
            dailyOrdersValue;
        }
      }
    }

    await redisCommand([
      "SET",
      maxSalesKey,
      maxDailySales
    ]);

    await redisCommand([
      "SET",
      maxOrdersKey,
      maxDailyOrders
    ]);

    // ========================================
    // 平均売上／日
    // ========================================

    const averageSalesPerDay =
      workingDays > 0
        ? Math.round(
            monthlySales /
            workingDays
          )
        : 0;

    // ========================================
    // 1件あたり
    // 今日の累計売上 ÷ 今日の累計件数
    // ========================================

    const perOrder =
      todayOrders > 0
        ? Math.round(
            todaySales /
            todayOrders
          )
        : 0;

    // ========================================
    // 月間目標
    // ========================================

    const targetSales =
      500000;

    const achievementRate =
      targetSales > 0
        ? Math.round(
            (
              monthlySales /
              targetSales
            ) * 1000
          ) / 10
        : 0;

    // ========================================
    // 緑丸
    // 今日の売上
    // 1,000円 = 1個
    // 最大10個
    // ========================================

    const circleCount =
      Math.min(
        10,
        Math.floor(
          todaySales / 1000
        )
      );

    const circles =
      "🟢".repeat(
        circleCount
      );

    // ========================================
    // メッセージ
    // ========================================

    const messageLines = [];

    if (command === "cancel") {
      messageLines.push(
        "↩️ 売上を訂正しました"
      );

      messageLines.push("");
    }

    messageLines.push(
      "🏍️ 配達売上"
    );

    messageLines.push(
      "💰 今日の売上 " +
      todaySales.toLocaleString() +
      "円"
    );

    // 緑丸は今日の売上の直下
    if (circles) {
      messageLines.push(
        circles
      );
    }

    messageLines.push(
      "📦 今日の件数 " +
      todayOrders +
      "件"
    );

    messageLines.push(
      "💵 1件あたり " +
      perOrder.toLocaleString() +
      "円"
    );

    messageLines.push(
      "📅 今月売上 " +
      monthlySales.toLocaleString() +
      "円"
    );

    messageLines.push(
      "📦 今月件数 " +
      monthlyOrders.toLocaleString() +
      "件"
    );

    messageLines.push(
      "🗓️ 年間売上 " +
      yearlySales.toLocaleString() +
      "円"
    );

    messageLines.push(
      "📦 年間件数 " +
      yearlyOrders.toLocaleString() +
      "件"
    );

    messageLines.push(
      "📈 平均売上／日 " +
      averageSalesPerDay.toLocaleString() +
      "円"
    );

    messageLines.push(
      "🎯 月間目標 " +
      targetSales.toLocaleString() +
      "円"
    );

    messageLines.push(
      "📊 目標達成率 " +
      achievementRate +
      "%"
    );

    messageLines.push(
      "🏆 月間最高売上 " +
      maxDailySales.toLocaleString() +
      "円"
    );

    messageLines.push(
      "🏆 月間最高件数 " +
      maxDailyOrders +
      "件"
    );

    messageLines.push(
      "📆 稼働日数 " +
      workingDays +
      "日"
    );

    messageLines.push(
      "🛵 累計配達件数 " +
      totalOrders.toLocaleString() +
      "件"
    );

    messageLines.push(
      "🕐 " +
      displayDate
    );

    messageLines.push(
      "🛵 今日も配達お疲れ様でした！"
    );

    const messageText =
      messageLines.join("\n");

    console.log(
      "SENDING:",
      messageText
    );

    // ========================================
    // Telegram送信
    // 画像なし
    // ========================================

    const telegramUrl =
      "https://api.telegram.org/bot" +
      token +
      "/sendMessage";

    const response =
      await fetch(
        telegramUrl,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: messageText
          })
        }
      );

    const result =
      await response.text();

    console.log(
      "TELEGRAM RESULT:",
      result
    );

    return res
      .status(200)
      .send("OK");

  } catch (error) {
    console.error(
      "ERROR:",
      error
    );

    return res
      .status(200)
      .send("OK");
  }
};
    return res
      .status(200)
      .send("OK");
  }
};
