module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    console.log("REQUEST BODY:", JSON.stringify(req.body));

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const message = req.body && req.body.message;

    if (!token) {
      console.log("ERROR: TELEGRAM_BOT_TOKEN is missing");
      return res.status(200).send("OK");
    }

    if (!message) {
      console.log("ERROR: message is missing");
      return res.status(200).send("OK");
    }

    const text = message.text || "";
    const chatId = message.chat && message.chat.id;

    console.log("TEXT:", text);
    console.log("CHAT ID:", chatId);

    const match = text.match(/^\/sales(?:@\S+)?\s+(\d+)\s+(\d+)$/);

    console.log("MATCH:", match);

    if (!match || !chatId) {
      console.log("SALES COMMAND NOT MATCHED");
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

    console.log("TELEGRAM API RESULT:", result);

    return res.status(200).send("OK");

  } catch (error) {
    console.error("ERROR:", error);
    return res.status(200).send("OK");
  }
};
