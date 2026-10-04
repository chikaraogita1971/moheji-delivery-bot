// api/telegram.js

import crypto from "crypto";

import {
  registerSale,
  cancelLatestSale,
  buildReport,
  buildRecordReport,
  runLegacyMigration,
  yen,
  integer,
} from "./sales.js";


/* =========================================================
   Environment
========================================================= */

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET;

const PHOTO_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";


/* =========================================================
   Constants
========================================================= */

const TEXT_LIMIT = 3500;
const CAPTION_LIMIT = 900;
const MAX_UPDATE_BYTES = 20000;


/* =========================================================
   Environment validation
========================================================= */

function requireEnvironment() {
  const missing = [];

  if (!TELEGRAM_BOT_TOKEN) {
    missing.push("TELEGRAM_BOT_TOKEN");
  }

  if (!TELEGRAM_WEBHOOK_SECRET) {
    missing.push("TELEGRAM_WEBHOOK_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}


/* =========================================================
   Constant-time comparison
========================================================= */

function secureEqual(actual, expected) {
  if (
    typeof actual !== "string" ||
    typeof expected !== "string"
  ) {
    return false;
  }

  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}


/* =========================================================
   Telegram webhook verification
========================================================= */

function verifyWebhookSecret(req) {
  requireEnvironment();

  const received =
    req.headers[
      "x-telegram-bot-api-secret-token"
    ];

  return secureEqual(
    received,
    TELEGRAM_WEBHOOK_SECRET
  );
}


/* =========================================================
   Telegram API
========================================================= */

async function telegramRequest(method, payload) {
  requireEnvironment();

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify(payload),
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Telegram returned invalid JSON. HTTP ${response.status}`
    );
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram API error: ${response.status} ${JSON.stringify(data)}`
    );
  }

  return data.result;
}


/* =========================================================
   Text sender
========================================================= */

async function sendMessage(chatId, text) {
  const value = String(text ?? "");

  if (!value) {
    return;
  }

  for (
    let i = 0;
    i < value.length;
    i += TEXT_LIMIT
  ) {
    await telegramRequest(
      "sendMessage",
      {
        chat_id: chatId,
        text: value.slice(
          i,
          i + TEXT_LIMIT
        ),
      }
    );
  }
}


/* =========================================================
   Photo sender
========================================================= */

async function sendPhoto(chatId, caption = "") {
  const value = String(caption ?? "");

  if (!value) {
    return telegramRequest(
      "sendPhoto",
      {
        chat_id: chatId,
        photo: PHOTO_URL,
      }
    );
  }

  /*
   * Telegram caption limit protection.
   */
  if (value.length <= CAPTION_LIMIT) {
    return telegramRequest(
      "sendPhoto",
      {
        chat_id: chatId,
        photo: PHOTO_URL,
        caption: value,
      }
    );
  }

  /*
   * Long content:
   * send image with short caption,
   * then send the complete text separately.
   */
  await telegramRequest(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: PHOTO_URL,
      caption: "📊 売上レポート",
    }
  );

  await sendMessage(
    chatId,
    value
  );
}


/* =========================================================
   Update validation
========================================================= */

function validateUpdate(update) {
  if (
    !update ||
    typeof update !== "object" ||
    Array.isArray(update)
  ) {
    throw new Error(
      "Invalid Telegram update."
    );
  }

  if (
    !Number.isSafeInteger(
      update.update_id
    )
  ) {
    throw new Error(
      "Invalid update_id."
    );
  }

  const message = update.message;

  /*
   * We only process ordinary messages.
   */
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    return null;
  }

  const chat = message.chat;

  if (
    !chat ||
    typeof chat !== "object"
  ) {
    throw new Error(
      "Invalid chat."
    );
  }

  if (
    !Number.isSafeInteger(chat.id)
  ) {
    throw new Error(
      "Invalid chat.id."
    );
  }

  if (
    typeof message.text !==
    "undefined" &&
    typeof message.text !==
    "string"
  ) {
    throw new Error(
      "Invalid message.text."
    );
  }

  if (
    message.text &&
    message.text.length > 4096
  ) {
    throw new Error(
      "Message is too long."
    );
  }

  return message;
}


/* =========================================================
   Command parser
========================================================= */

function commandName(text) {
  const match =
    text.match(
      /^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s|$)/
    );

  return match
    ? match[1].toLowerCase()
    : null;
}


/* =========================================================
   /sales parser
========================================================= */

function parseSales(text) {
  const body =
    text
      .replace(
        /^\/sales(?:@\w+)?/i,
        ""
      )
      .trim();

  const values =
    body.match(
      /^(\d+)\s+(\d+)$/
    );

  if (!values) {
    throw new Error(
      [
        "入力形式が正しくありません。",
        "",
        "例：",
        "/sales 10000 5",
      ].join("\n")
    );
  }

  const sales =
    Number(values[1]);

  const orders =
    Number(values[2]);

  if (
    !Number.isSafeInteger(sales) ||
    !Number.isSafeInteger(orders) ||
    sales <= 0 ||
    orders <= 0
  ) {
    throw new Error(
      "売上と件数は1以上の整数で入力してください。"
    );
  }

  return {
    sales,
    orders,
  };
}


/* =========================================================
   Help
========================================================= */

function helpText() {
  return [
    "🤖 売上管理Bot",
    "",
    "【コマンド】",
    "",
    "💰 売上登録",
    "/sales 売上 件数",
    "",
    "例：",
    "/sales 10000 5",
    "",
    "↩️ 最新売上を取消",
    "/cancel",
    "",
    "📊 現在の集計",
    "/report",
    "",
    "📚 過去24か月",
    "/record",
    "",
    "❓ ヘルプ",
    "/help",
  ].join("\n");
}


/* =========================================================
   Sale result formatter
========================================================= */

function formatSaleResult(result) {
  const record =
    result?.record;

  if (!record) {
    throw new Error(
      "Invalid sale result."
    );
  }

  return [
    "✅ 売上を登録しました。",
    "",
    `💰 ${yen(record.sales)}`,
    `📦 ${integer(record.orders)}件`,
    "",
    `📅 ${record.dateKey}`,
    "",
    `🆔 ${result.operationId}`,
  ].join("\n");
}


/* =========================================================
   Cancel result formatter
========================================================= */

function formatCancelResult(result) {
  const record =
    result?.record;

  if (!record) {
    throw new Error(
      "Invalid cancel result."
    );
  }

  return [
    "↩️ 売上を取り消しました。",
    "",
    `💰 -${yen(record.sales)}`,
    `📦 -${integer(record.orders)}件`,
    "",
    `📅 ${record.dateKey}`,
    "",
    `🆔 ${result.operationId}`,
  ].join("\n");
}


/* =========================================================
   Report formatter
========================================================= */

function formatReport(report) {
  if (
    !report ||
    typeof report !== "object"
  ) {
    throw new Error(
      "Invalid report."
    );
  }

  const today =
    report.today || {};

  const month =
    report.month || {};

  const year =
    report.year || {};

  const allTime =
    report.allTime || {};

  return [
    "📊 売上レポート",
    "",
    `📅 今日: ${report.dateKey}`,
    `💰 今日売上: ${yen(today.sales)}`,
    `📦 今日件数: ${integer(today.orders)}件`,
    "",
    `📅 今月: ${report.monthKey}`,
    `💰 今月売上: ${yen(month.sales)}`,
    `📦 今月件数: ${integer(month.orders)}件`,
    `🗓 稼働日数: ${integer(report.workingDays)}日`,
    `📈 1日平均: ${yen(report.dailyAverage)}`,
    `🧾 平均客単価: ${yen(report.averageOrderValue)}`,
    "",
    `🎯 月間目標: ${yen(report.monthlyTarget)}`,
    `📊 達成率: ${Number(report.achievementRate || 0).toFixed(1)}%`,
    `🔥 残り: ${yen(report.remaining)}`,
    "",
    `🏆 月間最高日売上: ${yen(report.bestDailySales)}`,
    `📅 ${report.bestDailySalesDate || "-"}`,
    `🏆 月間最高日件数: ${integer(report.bestDailyOrders)}件`,
    `📅 ${report.bestDailyOrdersDate || "-"}`,
    "",
    `📆 今年売上: ${yen(year.sales)}`,
    `📦 今年件数: ${integer(year.orders)}件`,
    "",
    `♾ 累計売上: ${yen(allTime.sales)}`,
    `📦 累計件数: ${integer(allTime.orders)}件`,
  ].join("\n");
}


/* =========================================================
   24-month record formatter
========================================================= */

function formatRecordReport(rows) {
  if (!Array.isArray(rows)) {
    throw new Error(
      "Invalid record report."
    );
  }

  const lines = [
    "📚 過去24か月売上",
    "",
  ];

  for (const row of rows) {
    lines.push(
      `${row.monthKey}`,
      `  💰 売上: ${yen(row.sales)}`,
      `  📦 件数: ${integer(row.orders)}件`,
      `  🗓 稼働: ${integer(row.workingDays)}日`,
      `  📈 日平均: ${yen(row.dailyAverage)}`,
      `  🏆 最高売上: ${yen(row.bestDailySales)}`,
      `  🏆 最高件数: ${integer(row.bestDailyOrders)}件`,
      ""
    );
  }

  return lines.join("\n");
}


/* =========================================================
   Request body size
========================================================= */

function bodySize(body) {
  try {
    return Buffer.byteLength(
      JSON.stringify(body),
      "utf8"
    );
  } catch {
    return Infinity;
  }
}


/* =========================================================
   Main handler
========================================================= */

export default async function handler(
  req,
  res
) {
  /*
   * Health check
   */
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service:
        "moheji-telegram-webhook",
    });
  }

  /*
   * Telegram webhook = POST only
   */
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
  }

  try {
    /*
     * 1. Webhook secret
     */
    if (!verifyWebhookSecret(req)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
      });
    }

    /*
     * 2. Request body
     */
    const update = req.body;

    /*
     * 3. Payload size
     */
    if (
      bodySize(update) >
      MAX_UPDATE_BYTES
    ) {
      return res.status(413).json({
        ok: false,
        error: "Payload too large",
      });
    }

    /*
     * 4. Validate Telegram update
     */
    const message =
      validateUpdate(update);

    /*
     * 5. Ignore non-message updates
     */
    if (!message) {
      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }

    const chatId =
      message.chat.id;

    const text =
      String(
        message.text || ""
      ).trim();

    /*
     * 6. Ignore non-text messages
     */
    if (!text) {
      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }

    const command =
      commandName(text);


    /* =====================================================
       START / HELP
    ===================================================== */

    if (
      command === "start" ||
      command === "help"
    ) {
      await sendPhoto(
        chatId,
        helpText()
      );

      return res.status(200).json({
        ok: true,
        command,
      });
    }


    /* =====================================================
       SALES
    ===================================================== */

    if (command === "sales") {
      try {
        const {
          sales,
          orders,
        } = parseSales(text);

        const result =
          await registerSale({
            chatId,
            sales,
            orders,
          });

        await sendPhoto(
          chatId,
          formatSaleResult(result)
        );

        return res.status(200).json({
          ok: true,
          command: "sales",
          operationId:
            result.operationId,
        });

      } catch (error) {
        console.error(
          "Sales error:",
          error
        );

        await sendMessage(
          chatId,
          `⚠️ ${error.message}`
        );

        return res.status(200).json({
          ok: false,
          command: "sales",
          error: error.message,
        });
      }
    }


    /* =====================================================
       CANCEL
    ===================================================== */

    if (command === "cancel") {
      try {
        const result =
          await cancelLatestSale(
            chatId
          );

        await sendPhoto(
          chatId,
          formatCancelResult(result)
        );

        return res.status(200).json({
          ok: true,
          command: "cancel",
          operationId:
            result.operationId,
        });

      } catch (error) {
        console.error(
          "Cancel error:",
          error
        );

        await sendMessage(
          chatId,
          `⚠️ ${error.message}`
        );

        return res.status(200).json({
          ok: false,
          command: "cancel",
          error: error.message,
        });
      }
    }


    /* =====================================================
       REPORT
    ===================================================== */

    if (command === "report") {
      try {
        const report =
          await buildReport();

        const textReport =
          formatReport(report);

        await sendPhoto(
          chatId,
          textReport
        );

        return res.status(200).json({
          ok: true,
          command: "report",
        });

      } catch (error) {
        console.error(
          "Report error:",
          error
        );

        await sendMessage(
          chatId,
          `⚠️ ${error.message}`
        );

        return res.status(200).json({
          ok: false,
          command: "report",
        });
      }
    }


    /* =====================================================
       RECORD
    ===================================================== */

    if (command === "record") {
      try {
        const rows =
          await buildRecordReport();

        const textReport =
          formatRecordReport(rows);

        /*
         * sendPhoto() automatically sends
         * long content as normal messages.
         */
        await sendPhoto(
          chatId,
          textReport
        );

        return res.status(200).json({
          ok: true,
          command: "record",
        });

      } catch (error) {
        console.error(
          "Record error:",
          error
        );

        await sendMessage(
          chatId,
          `⚠️ ${error.message}`
        );

        return res.status(200).json({
          ok: false,
          command: "record",
        });
      }
    }


    /* =====================================================
       Unknown slash command
    ===================================================== */

    if (text.startsWith("/")) {
      await sendMessage(
        chatId,
        [
          "❓ コマンドが分かりません。",
          "",
          helpText(),
        ].join("\n")
      );

      return res.status(200).json({
        ok: true,
        command: "unknown",
      });
    }


    /* =====================================================
       Normal text
    ===================================================== */

    return res.status(200).json({
      ok: true,
      ignored: true,
    });

  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    /*
     * Do not expose internal details.
     */
    try {
      const chatId =
        req.body?.message?.chat?.id;

      if (
        Number.isSafeInteger(chatId)
      ) {
        await sendMessage(
          chatId,
          "⚠️ システムエラーが発生しました。処理は完了していません。"
        );
      }
    } catch (notifyError) {
      console.error(
        "Notification error:",
        notifyError
      );
    }

    /*
     * Return 200 to Telegram so it does
     * not endlessly retry an already-handled
     * application-level error.
     */
    return res.status(200).json({
      ok: false,
      error:
        "Internal processing error",
    });
  }
}
