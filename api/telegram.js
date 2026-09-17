module.exports = async function handler(req, res) {
  console.log("=== WEBHOOK START ===");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const redisUrl = process.env.KV_REST_API_URL?.trim();
    const redisToken = process.env.KV_REST_API_TOKEN?.trim();

    console.log("TOKEN EXISTS:", !!token);
    console.log("REDIS EXISTS:", !!redisUrl && !!redisToken);

    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN is missing");
      return res.status(500).send("TOKEN MISSING");
    }

    if (!redisUrl || !redisToken) {
      console.error("KV_REST_API_URL or KV_REST_API_TOKEN is missing");
      return res.status(500).send("REDIS MISSING");
    }

    // =============================
    // Telegram受信
    // =============================

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

    // =============================
    // コマンド解析
    // /sales 5000 12
    // /cancel 5000 12
    // =============================

    const match = text.match(
      /^\/(sales|cancel)(?:@\S+)?\s+(\d+)\s+(\d+)$/
    );

    if (!match) {
      console.log("NOT SALES/CANCEL COMMAND");
      return res.status(200).send("OK");
    }

    const command = match[1];
    const inputSales = Number(match[2]);
    const inputOrders = Number(match[3]);

    if (inputSales < 0 || inputOrders < 0) {
      return res.status(200).send("OK");
    }

    // /sales = 加算
    // /cancel = 減算
    const sign = command === "cancel" ? -1 : 1;

    const sales = inputSales * sign;
    const orders = inputOrders * sign;

    console.log("COMMAND:", command);
    console.log("SALES:", sales);
    console.log("ORDERS:", orders);

    // =============================
    // 東京時間
    // =============================

    const now = new Date();

    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(now);

    const getPart = (type) => {
      const part = parts.find((p) => p.type === type);
      return part ? part.value : "";
    };

    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    const hour = getPart("hour");
    const minute = getPart("minute");

    const yearMonth = `${year}-${month}`;
    const dateKey = `${yearMonth}-${day}`;

    const displayDate =
      `${year}/${month}/${day} ${hour}:${minute}`;

    // =============================
    // Redis
    // =============================

    async function redisCommand(command) {
      const response = await fetch(redisUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${redisToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(command)
      });

      const result = await response.json();

      console.log("REDIS RESULT:", result);

      if (!response.ok || result.error) {
        throw new Error(
          result.error || "Redis command failed"
        );
      }

      return result.result;
    }

    // =============================
    // Redisキー
    // =============================

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

    // =============================
    // 今月累計
    // =============================

    const monthlySales =
      await redisCommand([
        "HINCRBY",
        monthlyKey,
        "sales",
        sales
      ]);

    const monthlyOrders =
      await redisCommand([
        "HINCRBY",
        monthlyKey,
        "orders",
        orders
      ]);

    // =============================
    // 年間累計
    // =============================

    const yearlySales =
      await redisCommand([
        "HINCRBY",
        yearlyKey,
        "sales",
        sales
      ]);

    const yearlyOrders =
      await redisCommand([
        "HINCRBY",
        yearlyKey,
        "orders",
        orders
      ]);

    // =============================
    // 今日の累計
    // =============================

    const todaySales =
      await redisCommand([
        "HINCRBY",
        dailyKey,
        "sales",
        sales
      ]);

    const todayOrders =
      await redisCommand([
        "HINCRBY",
        dailyKey,
        "orders",
        orders
      ]);

    // =============================
    // 累計配達件数
    // =============================

    const totalOrders =
      await redisCommand([
        "HINCRBY",
        totalKey,
        "orders",
        orders
      ]);

    // =============================
    // 稼働日判定
    // =============================

    let workingDays = 0;

    if (Number(todaySales) !== 0 || Number(todayOrders) !== 0) {
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

    workingDays =
      await redisCommand([
        "SCARD",
        workingDaysKey
      ]);

    // =============================
    // 月間最高売上を取得
    // =============================

    const maxSalesKey =
      `moheji:delivery:maxsales:${yearMonth}`;

    const maxOrdersKey =
      `moheji:delivery:maxorders:${yearMonth}`;

    let maxDailySales =
      Number(
        await redisCommand([
          "GET",
          maxSalesKey
        ]) || 0
      );

    let maxDailyOrders =
      Number(
        await redisCommand([
          "GET",
          maxOrdersKey
        ]) || 0
      );

    // =============================
    // 最高値を更新
    // =============================

    if (Number(todaySales) > maxDailySales) {
      maxDailySales = Number(todaySales);

      await redisCommand([
        "SET",
        maxSalesKey,
        maxDailySales
      ]);
    }

    if (Number(todayOrders) > maxDailyOrders) {
      maxDailyOrders = Number(todayOrders);

      await redisCommand([
        "SET",
        maxOrdersKey,
        maxDailyOrders
      ]);
    }

    // =============================
    // 平均売上／日
    // =============================

    const averageSalesPerDay =
      Number(workingDays) > 0
        ? Math.round(
            Number(monthlySales) /
            Number(workingDays)
          )
        : 0;

    // =============================
    // 1件あたり
    // =============================

    const perOrder =
      inputOrders > 0
        ? Math.round(inputSales / inputOrders)
        : 0;

    // =============================
    // 月間目標 50万円
    // =============================

    const targetSales = 500000;

    const achievementRate =
      targetSales > 0
        ? Math.round(
            (Number(monthlySales) /
              targetSales) *
              1000
          ) / 10
        : 0;

    // =============================
    // 緑丸
    // 1,000円 = 1個
    // 最大10個
    // =============================

    const circles = "🟢".repeat(
      Math.min(
        10,
        Math.floor(inputSales / 1000)
      )
    );

    // =============================
    // 表示
    // =============================

    const prefix =
      command === "cancel"
        ? "↩️ 売上を訂正しました\n\n"
        : "";

    const messageText =
      prefix +
      [
        "🏍️ 配達売上",
        "💰 今日の売上 " +
          Number(todaySales).toLocaleString() +
          "円",
        "📦 今日の件数 " +
          Number(todayOrders) +
          "件",
        "💵 1件あたり " +
          perOrder.toLocaleString() +
          "円",
        circles,
        "📅 今月売上 " +
          Number(monthlySales).toLocaleString() +
          "円",
        "📦 今月件数 " +
          Number(monthlyOrders).toLocaleString() +
          "件",
        "🗓️ 年間売上 " +
          Number(yearlySales).toLocaleString() +
          "円",
        "📦 年間件数 " +
          Number(yearlyOrders).toLocaleString() +
          "件",
        "📈 平均売上／日 " +
          averageSalesPerDay.toLocaleString() +
          "円",
        "🎯 月間目標 " +
          targetSales.toLocaleString() +
          "円",
        "📊 目標達成率 " +
          achievementRate +
          "%",
        "🏆 月間最高売上 " +
          maxDailySales.toLocaleString() +
          "円",
        "🏆 月間最高件数 " +
          maxDailyOrders +
          "件",
        "📆 稼働日数 " +
          workingDays +
          "日",
        "🛵 累計配達件数 " +
          Number(totalOrders).toLocaleString() +
          "件",
        "🕐 " + displayDate,
        "🛵 今日も配達お疲れ様でした！"
      ].join("\n");

    console.log("SENDING:", messageText);

    // =============================
    // 画像
    // =============================

    const imageUrl =
      "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/2B9038BB-2F1D-4FA2-B3D3-8FC3D76DCA87.png";

    // =============================
    // Telegram送信
    // =============================

    const telegramUrl =
      "https://api.telegram.org/bot" +
      token +
      "/sendPhoto";

    const response = await fetch(
      telegramUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption: messageText
        })
      }
    );

    const result = await response.text();

    console.log(
      "TELEGRAM RESULT:",
      result
    );

    return res.status(200).send("OK");

  } catch (error) {
    console.error("ERROR:", error);

    return res.status(200).send("OK");
  }
};
