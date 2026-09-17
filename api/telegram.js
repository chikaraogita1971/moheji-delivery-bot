module.exports = async function handler(req, res) {
  console.log("=== WEBHOOK START ===");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    let body = req.body;

    // req.body がない場合は raw body を読む
    if (!body) {
      let rawBody = "";

      for await (const chunk of req) {
        rawBody += chunk;
      }

      console.log("RAW BODY:", rawBody);

      if (rawBody) {
        body = JSON.parse(rawBody);
      }
    }

    console.log("BODY:", JSON.stringify(body));

    if (!token || !body || !body.message) {
      console.log("TOKEN OR MESSAGE MISSING");
      return res.status(200).send("OK");
    }

    const message = body.message;
    const chatId = message.chat && message.chat.id;
    const text = message.text || "";

    console.log("CHAT_ID:", chatId);
    console.log("TEXT:", text);

    // /sales 5000 12
    // /sales@BotName 5000 12
    const match = text.match(/^\/sales(?:@\S+)?\s+(\d+)\s+(\d+)$/);

    if (!match) {
      console.log("NOT SALES COMMAND");
      return res.status(200).send("OK");
    }

    const sales = Number(match[1]);
    const orders = Number(match[2]);

    const circles = "●".repeat(Math.floor(sales / 500));

    const now = new Date();

    const date = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(now);

    const messageText = [
      "配達売上！",
      "",
      sales.toLocaleString() + "円",
      circles,
      orders + "件",
      date,
      "",
      "お疲れ様でした。"
    ].join("\n");

    console.log("SENDING:", messageText);

    const response = await fetch(
      "https://api.telegram.org/bot" + token + "/sendMessage",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: messageText
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
