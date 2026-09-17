module.exports = async function handler(req, res) {
  console.log("=== WEBHOOK START ===");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

    console.log("TOKEN EXISTS:", !!token);
    console.log("REDIS EXISTS:", !!redisUrl && !!redisToken);

    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN is missing");
      return res.status(500).send("TOKEN MISSING");
    }

    if (!redisUrl || !redisToken) {
      console.error("REDIS ENV is missing");
      return res.status(500).send("REDIS MISSING");
    }

    // =========================
    // リクエスト取得
    // =========================

    let rawBody = "";

    for await (const chunk of req) {
      rawBody += chunk.toString();
    }

    console.log("RAW BODY:", rawBody);

    if (!rawBody) {
      return res.status(200).send("OK");
    }

    const body = JSON.parse(rawBody);

    if (!body.message) {
      console.log("MESSAGE MISSING");
      return res.status(200).send("OK");
    }

    const message = body.message;

    const chatId = message.chat?.id;
    const text = message.text || "";

    console.log("CHAT_ID:", chatId);
    console.log("TEXT:", text);

    // =========================
    // /sales コマンド
    // =========================

    const match = text.match(
      /^\/sales(?:@\S+)?\s+(\d+)\s+(\d+)$/
    );

    if (!match) {
      console.log("NOT SALES COMMAND");
      return res.status(200).send("OK");
    }

    const sales = Number(match[1]);
    const orders = Number(match[2]);

    // =========================
    // 日本時間
    // =========================

    const now = new Date();

    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(now);

    const getPart = (type) =>
      parts.find((p) => p.type === type)?.value;

    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    const hour = getPart("hour");
    const minute = getPart("minute");

    const yearMonth = `${year}-${month}`;
    const yearKey = year;

    const displayDate =
      `${year}/${month}/${day} ${hour}:${minute}`;

    console.log("YEAR:", year);
    console.log("MONTH:", month);
    console.log("YEAR_MONTH:", yearMonth);

    // =========================
    // Redis
    // =========================

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

      if (!response.ok || result.error) {
        console.error("REDIS ERROR:", result);
        throw new Error("Redis command failed");
      }

      return result.result;
    }

    // =========================
    // 今月累計を加算
    // =========================

    const monthlyKey =
      `delivery:stats:${yearMonth}`;

    const yearlyKey =
      `delivery:stats:${yearKey}`;

    const monthlySales = await redisCommand([
      "HINCRBY",
      monthlyKey,
      "sales",
      sales
    ]);

    const monthlyOrders = await redisCommand([
      "HINCRBY",
      monthlyKey,
      "orders",
      orders
    ]);

    // =========================
    // 年間累計を加算
    // =========================

    const yearlySales = await redisCommand([
      "HINCRBY",
      yearlyKey,
      "sales",
      sales
    ]);

    const yearlyOrders = await redisCommand([
      "HINCRBY",
      yearlyKey,
      "orders",
      orders
    ]);

    console.log("MONTHLY SALES:", monthlySales);
    console.log("MONTHLY ORDERS:", monthlyOrders);
    console.log("YEARLY SALES:", yearlySales);
    console.log("YEARLY ORDERS:", yearlyOrders);

    // =========================
    // 表示用
    // =========================

    const circles = "🟢".repeat(
      Math.floor(sales / 500)
    );

    const perOrder =
      orders > 0
        ? Math.round(sales / orders)
        : 0;

    const messageText = [
      "🏍️ 配達売上レポート",
      "💰 " + sales.toLocaleString() + "円",
      circles,
      "📦 " + orders + "件",
      "💵 1件あたり " +
        perOrder.toLocaleString() +
        "円",
      "📅 今月累計 " +
        Number(monthlySales).toLocaleString() +
        "円",
      "📦 今月累計 " +
        Number(monthlyOrders).toLocaleString() +
        "件",
      "🗓️ 年間累計 " +
        Number(yearlySales).toLocaleString() +
        "円",
      "📦 年間累計 " +
        Number(yearlyOrders).toLocaleString() +
        "件",
      "🕐 " + displayDate,
      "🛵 今日も配達お疲れ様でした！"
    ].join("\n");

    console.log("SENDING:", messageText);

    // =========================
    // Telegram送信
    // =========================

    const imageUrl =
      "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/2B9038BB-2F1D-4FA2-B3D3-8FC3D76DCA87.png";

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

    console.log("TELEGRAM RESULT:", result);

    return res.status(200).send("OK");

  } catch (error) {
    console.error("ERROR:", error);

    return res.status(200).send("OK");
  }
};
