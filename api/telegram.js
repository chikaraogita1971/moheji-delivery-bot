module.exports = async function handler(req, res) {
  console.log("=== WEBHOOK START ===");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    // ========================================
    // 環境変数
    // ========================================

    const token =
      process.env.TELEGRAM_BOT_TOKEN?.trim();

    const redisUrl =
      process.env.KV_REST_API_URL?.trim();

    const redisToken =
      process.env.KV_REST_API_TOKEN?.trim();

    if (!token) {
      return res.status(500).send("TOKEN MISSING");
    }

    if (!redisUrl || !redisToken) {
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

    // ========================================
    // コマンド
    //
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

    const inputSales =
      Number(match[2]);

    const inputOrders =
      Number(match[3]);

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

    const parts =
      new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).formatToParts(new Date());

    const getPart = (type) =>
      parts.find(
        (p) => p.type === type
      )?.value || "";

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

    const yearMonth =
      `${year}-${month}`;

    const dateKey =
      `${yearMonth}-${day}`;

    const displayDate =
      `${year}/${month}/${day} ${hour}:${minute}`;

    // ========================================
    // Redis
    // ========================================

    async function redisCommand(commandArgs) {
      const response =
        await fetch(
          redisUrl,
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${redisToken}`,

              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(commandArgs)
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
    // 月間売上・件数
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
    // 年間売上・件数
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
    // 今日の売上・件数
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

    // ========================================
    // マイナス防止
    // ========================================

    async function fixNegative(
      key,
      field,
      value
    ) {
      if (value < 0) {
        await redisCommand([
          "HSET",
          key,
          field,
          0
        ]);

        return 0;
      }

      return value;
    }

    todaySales =
      await fixNegative(
        dailyKey,
        "sales",
        todaySales
      );

    todayOrders =
      await fixNegative(
        dailyKey,
        "orders",
        todayOrders
      );

    monthlySales =
      await fixNegative(
        monthlyKey,
        "sales",
        monthlySales
      );

    monthlyOrders =
      await fixNegative(
        monthlyKey,
        "orders",
        monthlyOrders
      );

    yearlySales =
      await fixNegative(
        yearlyKey,
        "sales",
        yearlySales
      );

    yearlyOrders =
      await fixNegative(
        yearlyKey,
        "orders",
        yearlyOrders
      );

    totalOrders =
      await fixNegative(
        totalKey,
        "orders",
        totalOrders
      );

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
    // 月間最高売上・最高件数
    // ========================================

    const workingDates =
      await redisCommand([
        "SMEMBERS",
        workingDaysKey
      ]);

    let maxDailySales = 0;
    let maxDailyOrders = 0;

    if (Array.isArray(workingDates)) {
      for (
        const workingDate
        of workingDates
      ) {
        const checkKey =
          `moheji:delivery:day:${workingDate}`;

        const checkSales =
          Number(
            await redisCommand([
              "HGET",
              checkKey,
              "sales"
            ]) || 0
          );

        const checkOrders =
          Number(
            await redisCommand([
              "HGET",
              checkKey,
              "orders"
            ]) || 0
          );

        if (
          checkSales >
          maxDailySales
        ) {
          maxDailySales =
            checkSales;
        }

        if (
          checkOrders >
          maxDailyOrders
        ) {
          maxDailyOrders =
            checkOrders;
        }
      }
    }

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
    //
    // 1,000円 = 1個
    // 最大10個
    // 今日の累計売上を基準
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
    // メッセージ作成
    // ========================================

    const lines = [];

    if (
      command === "cancel"
    ) {
      lines.push(
        "↩️ 売上を訂正しました"
      );

      lines.push("");
    }

    lines.push(
      "🏍️ 配達売上"
    );

    lines.push(
      `💰 今日の売上 ${todaySales.toLocaleString()}円`
    );

    // 緑丸は売上の直下
    if (circles) {
      lines.push(circles);
    }

    lines.push(
      `📦 今日の件数 ${todayOrders}件`
    );

    lines.push(
      `💵 1件あたり ${perOrder.toLocaleString()}円`
    );

    lines.push(
      `📅 今月売上 ${monthlySales.toLocaleString()}円`
    );

    lines.push(
      `📦 今月件数 ${monthlyOrders.toLocaleString()}件`
    );

    lines.push(
      `🗓️ 年間売上 ${yearlySales.toLocaleString()}円`
    );

    lines.push(
      `📦 年間件数 ${yearlyOrders.toLocaleString()}件`
    );

    lines.push(
      `📈 平均売上／日 ${averageSalesPerDay.toLocaleString()}円`
    );

    lines.push(
      `🎯 月間目標 ${targetSales.toLocaleString()}円`
    );

    lines.push(
      `📊 目標達成率 ${achievementRate}%`
    );

    lines.push(
      `🏆 月間最高売上 ${maxDailySales.toLocaleString()}円`
    );

    lines.push(
      `🏆 月間最高件数 ${maxDailyOrders}件`
    );

    lines.push(
      `📆 稼働日数 ${workingDays}日`
    );

    lines.push(
      `🛵 累計配達件数 ${totalOrders.toLocaleString()}件`
    );

    lines.push(
      `🕐 ${displayDate}`
    );

    lines.push(
      "🛵 今日も配達お疲れ様でした！"
    );

    const messageText =
      lines.join("\n");

    // ========================================
    // Telegram送信
    // GitHubのmoheji.pngを使用
    // ========================================

    const telegramUrl =
      `https://api.telegram.org/bot${token}/sendPhoto`;

    const photoUrl =
      "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/moheji.png";

    const telegramResponse =
      await fetch(
        telegramUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              chat_id: chatId,

              photo: photoUrl,

              caption:
                messageText
            })
        }
      );

    const telegramResult =
      await telegramResponse.text();

    console.log(
      "TELEGRAM RESULT:",
      telegramResult
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
