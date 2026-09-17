module.exports = async function handler(req, res) {
  console.log("REQUEST:", JSON.stringify(req.body));

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const message = req.body && req.body.message;

  if (!token) {
    console.log("TOKEN MISSING");
    return res.status(200).send("OK");
  }

  if (!message) {
    console.log("MESSAGE MISSING");
    return res.status(200).send("OK");
  }

  const chatId = message.chat && message.chat.id;

  console.log("CHAT ID:", chatId);
  console.log("TEXT:", message.text);

  try {
    const response = await fetch(
      "https://api.telegram.org/bot" + token + "/sendMessage",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: "テスト返信です"
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
