module.exports = async function handler(req, res) {
  console.log("=== WEBHOOK START ===");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    // Vercelの環境変数
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

    console.log("TOKEN EXISTS:", !!token);
    console.log("TOKEN LENGTH:", token ? token.length : 0);
    console.log(
      "TOKEN PREFIX:",
      token ? token.substring(0, 10) : "NONE"
    );

    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN is missing");
      return res.status(500).send("TOKEN MISSING");
    }

    // Telegramから届いたデータを取得
    let rawBody = "";

    for await (const chunk of req) {
      rawBody += chunk.toString();
    }

    console.log("RAW BODY:", rawBody);

    if (!rawBody) {
      console.log("EMPTY BODY");
      return res.status(200).send("OK");
    }

    const body = JSON.parse(rawBody);

    console.log("PARSED BODY:", JSON.stringify(body));

    if (!body.message) {
      console.log("MESSAGE MISSING");
      return res.status(200).send("OK");
    }

    const message = body.message;

    const chatId = message.chat?.id;
    const text = message.text || "";

    console.log("CHAT_ID:", chatId);
    console.log("TEXT:", text);

    // /sales 5000 12
    const match = text.match(
      /^\/sales(?:@\S+)?\s+(\d+)\s+(\d+)$/
    );

    if (!match) {
      console.log("NOT SALES COMMAND");
      return res.status(200).send("OK");
    }

    const sales = Number(match[1]);
    const orders = Number(match[2]);

    // 500円ごとに緑の丸
    const circles = "🟢".repeat(
      Math.floor(sales / 500)
    );

    // 日本時間
    const now = new Date();

    const date = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(now);

    // 1件あたり単価
    const perOrder =
      orders > 0
        ? Math.round(sales / orders)
        : 0;

    // 売上レポート
    const messageText = [
      "🏍️ 配達売上レポート",
      "",
      "💰 " + sales.toLocaleString() + "円",
      "📦 " + orders + "件",
      "",
      "💵 1件あたり " + perOrder.toLocaleString() + "円",
      "",
      circles,
      "",
      "🕐 " + date,
      "",
      "🏍️ 今日も配達お疲れ様でした！"
    ].join("\n");

    console.log("SENDING:", messageText);

    // Telegram Botの確認
    const getMeResponse = await fetch(
      "https://api.telegram.org/bot" +
        token +
        "/getMe"
    );

    const getMeResult = await getMeResponse.text();

    console.log("GETME RESULT:", getMeResult);

    // GitHubに保存した画像
    const imageUrl =
      "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/2B9038BB-2F1D-4FA2-B3D3-8FC3D76DCA87.png";

    // 画像＋売上レポートを送信
    const telegramUrl =
      "https://api.telegram.org/bot" +
      token +
      "/sendPhoto";

    console.log(
      "TELEGRAM URL:",
      telegramUrl.replace(token, "[TOKEN]")
    );

    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo: imageUrl,
        caption: messageText
      })
    });

    const result = await response.text();

    console.log("TELEGRAM RESULT:", result);

    return res.status(200).send("OK");

  } catch (error) {
    console.error("ERROR:", error);

    return res.status(200).send("OK");
  }
};
