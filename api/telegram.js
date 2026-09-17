```javascript
module.exports = async function handler(req, res) {
  // POST以外は正常終了
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const message = req.body?.message;

    // Tokenまたはメッセージがない場合
    if (!token || !message) {
      return res.status(200).send("OK");
    }

    const text = message.text || "";
    const chatId = message.chat?.id;

    // /sales 5000 12
    // /sales@BotName 5000 12
    const match = text.match(/^\/sales(?:@\S+)?\s+(\d+)\s+(\d+)$/);

    // salesコマンド以外は無視
    if (!match || !chatId) {
      return res.status(200).send("OK");
    }

    const sales = Number(match[1]);
    const orders = Number(match[2]);

    // 500円ごとに●
    const circles = "●".repeat(Math.floor(sales / 500));

    // 日本時間
    const now = new Date();

    const date = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(now);

    const messageText =
`配達売上！

${sales.toLocaleString()}円
${circles}
${orders}件
${date}

お疲れ様でした。`;

    // Telegramへ返信
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
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

    // Telegram APIのエラーをログに残す
    const result = await response.text();
    console.log("Telegram API:", result);

    return res.status(200).send("OK");

  } catch (error) {
    console.error("Telegram webhook error:", error);

    // Telegramには200を返してWebhookの再送を防ぐ
    return res.status(200).send("OK");
  }
};
```
