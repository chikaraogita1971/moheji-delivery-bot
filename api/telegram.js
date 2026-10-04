// api/telegram.js

import crypto from "crypto";

import {
  registerSale,
  cancelLatestSale,
  buildReport,
  buildRecordReport,
  yen,
  integer,
  runLegacyMigration,
} from "./sales.js";

/* =========================================================
   Environment
========================================================= */

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET;

const TELEGRAM_ALLOWED_CHAT_IDS =
  process.env.TELEGRAM_ALLOWED_CHAT_IDS || "";

const TELEGRAM_ALLOWED_USER_IDS =
  process.env.TELEGRAM_ALLOWED_USER_IDS || "";

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
   Allowed ID parser
========================================================= */

function parseAllowedIds(value) {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

/* =========================================================
   Access control
========================================================= */

function isAllowedAccess(chatId, userId) {
  const allowedChats =
    parseAllowedIds(
      TELEGRAM_ALLOWED_CHAT_IDS
    );

  const allowedUsers =
    parseAllowedIds(
      TELEGRAM_ALLOWED_USER_IDS
    );

  const chatConfigured =
    allowedChats.size > 0;

  const userConfigured =
    allowedUsers.size > 0;

  /*
    If no allow-list is configured,
    do not block.
  */

  if (
    !chatConfigured &&
    !userConfigured
  ) {
    return true;
  }

  const chatAllowed =
    chatConfigured &&
    allowedChats.has(
      String(chatId)
    );

  const userAllowed =
    userConfigured &&
    allowedUsers.has(
      String(userId)
    );

  /*
    Either configured allow-list can authorize.
  */

  if (
    chatAllowed ||
    userAllowed
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   Constant-time comparison
========================================================= */

function secureEqual(
  actual,
  expected
) {
  if (
    typeof actual !== "string" ||
    typeof expected !== "string"
  ) {
    return false;
  }

  const a =
    Buffer.from(actual);

  const b =
    Buffer.from(expected);

  if (
    a.length !== b.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}

/* =========================================================
   Webhook verification
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

async function telegramRequest(
  method,
  payload
) {
  requireEnvironment();

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

  const response =
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body:
        JSON.stringify(payload),
    });

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.ok
  ) {
    throw new Error(
      `Telegram API error: ${response.status} ${JSON.stringify(data)}`
    );
  }

  return data.result;
}

/* =========================================================
   Text sender
========================================================= */

async function sendMessage(
  chatId,
  text
) {
  if (!text) {
    return;
  }

  for (
    let i = 0;
    i < text.length;
    i += TEXT_LIMIT
  ) {
    await telegramRequest(
      "sendMessage",
      {
        chat_id: chatId,
        text:
          text.slice(
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

async function sendPhoto(
  chatId,
  caption
) {
  if (!caption) {
    return telegramRequest(
      "sendPhoto",
      {
        chat_id: chatId,
        photo: PHOTO_URL,
      }
    );
  }

  /*
    Telegram caption limit.
  */

  if (
    caption.length <=
    CAPTION_LIMIT
  ) {
    return telegramRequest(
      "sendPhoto",
      {
        chat_id: chatId,
        photo: PHOTO_URL,
        caption,
      }
    );
  }

  /*
    Long text:
    image first,
    report afterwards as messages.
  */

  await telegramRequest(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: PHOTO_URL,
      caption:
        "📊 売上レポート",
    }
  );

  await sendMessage(
    chatId,
    caption
  );
}

/* =========================================================
   Update validation
========================================================= */

function validateUpdate(
  update
) {
  if (
    !update ||
    typeof update !== "object"
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

  const message =
    update.message;

  /*
    Telegram may send non-message updates.
  */

  if (
    !message ||
    typeof message !== "object"
  ) {
    return null;
  }

  const chat =
    message.chat;

  if (
    !chat ||
    typeof chat !== "object"
  ) {
    throw new Error(
      "Invalid chat."
    );
  }

  if (
    !Number.isSafeInteger(
      chat.id
    )
  ) {
    throw new Error(
      "Invalid chat.id."
    );
  }

  const from =
    message.from;

  if (
    from &&
    typeof from === "object" &&
    !Number.isSafeInteger(
      from.id
    )
  ) {
    throw new Error(
      "Invalid message.from.id."
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

function commandName(
  text
) {
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

function parseSales(
  text
) {
  const body =
    text
      .replace(
        /^\/sales(?:@\w+)?/i,
        ""
      )
      .trim();

  const values =
    body.match(
      /^\s*(\d+)\s+(\d+)\s*$/
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
    !Number.isSafeInteger(
      sales
    ) ||
    !Number.isSafeInteger(
      orders
    )
  ) {
    throw new Error(
      "売上と件数は整数で入力してください。"
    );
  }

  if (
    sales < 0
  ) {
    throw new Error(
      "売上は0以上で入力してください。"
    );
  }

  if (
    orders < 0
  ) {
    throw new Error(
      "件数は0以上で入力してください。"
    );
  }

  if (
    sales === 0 &&
    orders === 0
  ) {
    throw new Error(
      "売上または件数を入力してください。"
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
   Sale result
========================================================= */

function formatSaleResult(
  result
) {
  const record =
    result.record;

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
   Cancel result
========================================================= */

function formatCancelResult(
  result
) {
  const record =
    result.record;

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

function formatReport(
  report
) {
  const progress =
    report.dailyProgressBar ||
    "🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢";

  return [
    "🏍配達売上",
    "",
    `💰 今日の売上 ${yen(report.today.sales)}`,
    progress,
    `📦 今日の件数 ${integer(report.today.orders)}件`,
    `💵 1件あたり ${yen(report.today.averageOrderValue)}`,
    "",
    `📅 今月売上 ${yen(report.month.sales)}`,
    `📦 今月件数 ${integer(report.month.orders)}件`,
    "",
    `🗓️ 年間売上 ${yen(report.year.sales)}`,
    `📦 年間件数 ${integer(report.year.orders)}件`,
    "",
    `📈 平均売上／日 ${yen(report.month.averagePerDay)}`,
    `🎯 月間目標 ${yen(report.monthlyTarget)}`,
    `📊 目標達成率 ${report.month.achievementRate.toFixed(1)}%`,
    "",
    `🏆 月間最高売上 ${yen(report.month.bestSales)}`,
    `🏆 月間最高件数 ${integer(report.month.bestOrders)}件`,
    `📆 稼働日数 ${integer(report.month.workingDays)}日`,
    "",
    `🛵 累計配達件数 ${integer(report.allTime.orders)}件`,
    "",
    `🕐 ${report.now}`,
    "",
    "🛵 今日も配達お疲れ様でした！",
  ].join("\n");
}

/* =========================================================
   Body size
========================================================= */

function bodySize(
  body
) {
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
    Health check
  */

  if (
    req.method === "GET"
  ) {
    return res.status(200).json({
      ok: true,
      service:
        "moheji-telegram-webhook",
    });
  }

  /*
    Telegram only POST
  */

  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      ok: false,
      error:
        "Method Not Allowed",
    });
  }

  try {
    /*
      Webhook authentication
    */

    if (
      !verifyWebhookSecret(req)
    ) {
      return res.status(401).json({
        ok: false,
        error:
          "Unauthorized",
      });
    }

    const update =
      req.body;

    /*
      Payload size defense
    */

    if (
      bodySize(update) >
      MAX_UPDATE_BYTES
    ) {
      return res.status(413).json({
        ok: false,
        error:
          "Payload too large",
      });
    }

    /*
      Telegram update validation
    */

    const message =
      validateUpdate(update);

    /*
      Ignore non-message updates.
    */

    if (!message) {
      return res.status(200).json({
        ok: true,
        ignored: true,
      });
    }

    const chatId =
      message.chat.id;

    const userId =
      message.from?.id;

    /*
      Access control
    */

    if (
      !isAllowedAccess(
        chatId,
        userId
      )
    ) {
      return res.status(403).json({
        ok: false,
        error:
          "Forbidden",
      });
    }

    const text =
      String(
        message.text || ""
      ).trim();

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

    if (
      command === "sales"
    ) {
      try {
        const {
          sales,
          orders,
        } =
          parseSales(text);

        /*
          update_id is passed into sales.js.

          This makes the same Telegram update
          resolve to the same operationId.
        */

        const result =
          await registerSale({
            chatId,
            userId,
            sales,
            orders,
            updateId:
              update.update_id,
          });

        await sendPhoto(
          chatId,
          formatSaleResult(
            result
          )
        );

        return res.status(200).json({
          ok: true,
          command: "sales",
          operationId:
            result.operationId,
        });

      } catch (error) {
        await sendMessage(
          chatId,
          `⚠️ ${error.message}`
        );

        return res.status(200).json({
          ok: false,
          command: "sales",
          error:
            error.message,
        });
      }
    }

    /* =====================================================
       CANCEL
    ===================================================== */

    if (
      command === "cancel"
    ) {
      try {
        const result =
          await cancelLatestSale({
            chatId,
            userId,
            updateId:
              update.update_id,
          });

        await sendPhoto(
          chatId,
          formatCancelResult(
            result
          )
        );

        return res.status(200).json({
          ok: true,
          command: "cancel",
          operationId:
            result.operationId,
        });

      } catch (error) {
        await sendMessage(
          chatId,
          `⚠️ ${error.message}`
        );

        return res.status(200).json({
          ok: false,
          command: "cancel",
          error:
            error.message,
        });
      }
    }

    /* =====================================================
       REPORT
    ===================================================== */

    if (
      command === "report"
    ) {
      try {
        const report =
          await buildReport();

        await sendPhoto(
          chatId,
          formatReport(report)
        );

        return res.status(200).json({
          ok: true,
          command: "report",
        });

      } catch (error) {
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

    if (
      command === "record"
    ) {
      try {
        const report =
          await buildRecordReport();

        /*
          sendPhoto() automatically switches
          to normal Telegram messages if the
          report exceeds caption length.
        */

        await sendPhoto(
          chatId,
          report
        );

        return res.status(200).json({
          ok: true,
          command: "record",
        });

      } catch (error) {
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
       UNKNOWN COMMAND
    ===================================================== */

    if (
      text.startsWith("/")
    ) {
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
        command:
          "unknown",
      });
    }

    /*
      Normal text is ignored.
    */

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
      Do not expose internal errors.
    */

    try {
      const chatId =
        req.body?.message?.chat?.id;

      if (
        Number.isSafeInteger(
          chatId
        )
      ) {
        await sendMessage(
          chatId,
          "⚠️ システムエラーが発生しました。処理は完了していません。"
        );
      }
    } catch (
      notifyError
    ) {
      console.error(
        "Notification error:",
        notifyError
      );
    }

    /*
      Always acknowledge Telegram
      after internal handling.
    */

    return res.status(200).json({
      ok: false,
      error:
        "Internal processing error",
    });
  }
}
