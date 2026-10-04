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


/* =========================================================
   Photo
========================================================= */

const PHOTO_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";


/* =========================================================
   Limits
========================================================= */

const TEXT_LIMIT =
  3500;

const CAPTION_LIMIT =
  900;

const MAX_UPDATE_BYTES =
  20000;


/* =========================================================
   Environment validation
========================================================= */

function requireEnvironment() {
  const missing = [];

  if (!TELEGRAM_BOT_TOKEN) {
    missing.push(
      "TELEGRAM_BOT_TOKEN"
    );
  }

  if (!TELEGRAM_WEBHOOK_SECRET) {
    missing.push(
      "TELEGRAM_WEBHOOK_SECRET"
    );
  }

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}


/* =========================================================
   Constant-time comparison
========================================================= */

function secureEqual(
  actual,
  expected
) {
  if (
    typeof actual !==
      "string" ||
    typeof expected !==
      "string"
  ) {
    return false;
  }

  const a =
    Buffer.from(
      actual,
      "utf8"
    );

  const b =
    Buffer.from(
      expected,
      "utf8"
    );

  if (
    a.length !==
    b.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}


/* =========================================================
   Telegram webhook verification
========================================================= */

function verifyWebhookSecret(
  req
) {
  requireEnvironment();

  const received =
    req.headers[
      "x-telegram-bot-api-secret-token"
    ];

  if (
    !secureEqual(
      received,
      TELEGRAM_WEBHOOK_SECRET
    )
  ) {
    return false;
  }

  return true;
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
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            payload
          ),
      }
    );

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
   Send message
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
        chat_id:
          chatId,

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
   Send photo
========================================================= */

async function sendPhoto(
  chatId,
  caption
) {
  if (!caption) {
    return telegramRequest(
      "sendPhoto",
      {
        chat_id:
          chatId,

        photo:
          PHOTO_URL,
      }
    );
  }

  /*
    Telegram photo caption has a much smaller limit
    than normal message text.

    Therefore long reports are sent as:
      1. image
      2. normal message
  */

  if (
    caption.length <=
    CAPTION_LIMIT
  ) {
    return telegramRequest(
      "sendPhoto",
      {
        chat_id:
          chatId,

        photo:
          PHOTO_URL,

        caption,
      }
    );
  }

  await telegramRequest(
    "sendPhoto",
    {
      chat_id:
        chatId,

      photo:
        PHOTO_URL,

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
    typeof update !==
      "object"
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
    Telegram can send many kinds of updates.
    This bot only processes normal messages.
  */

  if (
    !message ||
    typeof message !==
      "object"
  ) {
    return null;
  }

  const chat =
    message.chat;

  if (
    !chat ||
    typeof chat !==
      "object"
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
    message.text.length >
      4096
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
   Sales parser
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

  /*
    Integer only.
    Examples:
      /sales 10000 5
      /sales 17014 17
  */

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
    Number(
      values[1]
    );

  const orders =
    Number(
      values[2]
    );

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
    sales <= 0
  ) {
    throw new Error(
      "売上は1円以上で入力してください。"
    );
  }

  if (
    orders <= 0
  ) {
    throw new Error(
      "件数は1件以上で入力してください。"
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
    `🆔 ${record.operationId}`,
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
   Body size
========================================================= */

function bodySize(
  body
) {
  try {
    return Buffer.byteLength(
      JSON.stringify(
        body
      ),
      "utf8"
    );
  } catch {
    return Infinity;
  }
}


/* =========================================================
   Deterministic operation ID
========================================================= */

/*
  Telegram retries the same update when the webhook response
  is not accepted.

  Using update_id as part of the operation ID prevents the same
  Telegram update from becoming multiple sales operations.
*/

function createUpdateOperationId(
  updateId
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      `telegram-update:${updateId}`,
      "utf8"
    )
    .digest("hex");
}


/*
  Cancel gets a different namespace from sales.
*/
function createCancelOperationId(
  updateId
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      `telegram-cancel:${updateId}`,
      "utf8"
    )
    .digest("hex");
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
    req.method ===
    "GET"
  ) {
    return res.status(
      200
    ).json({
      ok: true,
      service:
        "moheji-telegram-webhook",
    });
  }


  /*
    Only POST is accepted.
  */
  if (
    req.method !==
    "POST"
  ) {
    return res.status(
      405
    ).json({
      ok: false,
      error:
        "Method Not Allowed",
    });
  }


  try {
    /* -------------------------------------------------------
       Webhook secret
    ------------------------------------------------------- */

    if (
      !verifyWebhookSecret(
        req
      )
    ) {
      return res.status(
        401
      ).json({
        ok: false,
        error:
          "Unauthorized",
      });
    }


    /* -------------------------------------------------------
       Body
    ------------------------------------------------------- */

    const update =
      req.body;


    if (
      bodySize(update) >
      MAX_UPDATE_BYTES
    ) {
      return res.status(
        413
      ).json({
        ok: false,
        error:
          "Payload too large",
      });
    }


    /* -------------------------------------------------------
       Validate Telegram update
    ------------------------------------------------------- */

    const message =
      validateUpdate(
        update
      );


    /*
      Ignore non-message updates.
    */

    if (!message) {
      return res.status(
        200
      ).json({
        ok: true,
        ignored: true,
      });
    }


    /* -------------------------------------------------------
       Basic message data
    ------------------------------------------------------- */

    const chatId =
      message.chat.id;

    const text =
      String(
        message.text || ""
      ).trim();


    /*
      Empty messages are ignored.
    */

    if (!text) {
      return res.status(
        200
      ).json({
        ok: true,
        ignored: true,
      });
    }


    const command =
      commandName(
        text
      );


    /* =======================================================
       /start
       /help
    ======================================================= */

    if (
      command === "start" ||
      command === "help"
    ) {
      await sendPhoto(
        chatId,
        helpText()
      );

      return res.status(
        200
      ).json({
        ok: true,
        command,
      });
    }


    /* =======================================================
       /sales
    ======================================================= */

    if (
      command === "sales"
    ) {
      try {
        const {
          sales,
          orders,
        } =
          parseSales(
            text
          );


        /*
          IMPORTANT:
          Same Telegram update -> same operationId.
          This prevents duplicate sales on webhook retry.
        */

        const operationId =
          createUpdateOperationId(
            update.update_id
          );


        const result =
          await registerSale({
            chatId,
            sales,
            orders,
            operationId,
          });


        await sendPhoto(
          chatId,
          formatSaleResult(
            result
          )
        );


        return res.status(
          200
        ).json({
          ok: true,
          command:
            "sales",
          operationId:
            result.operationId,
          duplicate:
            Boolean(
              result.duplicate
            ),
        });
      } catch (error) {
        console.error(
          "Sales error:",
          error
        );


        try {
          await sendMessage(
            chatId,
            `⚠️ ${error.message}`
          );
        } catch (
          notifyError
        ) {
          console.error(
            "Sales notification error:",
            notifyError
          );
        }


        /*
          Return 200 so Telegram does not endlessly retry
          a command which has already been processed at the
          application level.
        */

        return res.status(
          200
        ).json({
          ok: false,
          command:
            "sales",
          error:
            error.message,
        });
      }
    }


    /* =======================================================
       /cancel
    ======================================================= */

    if (
      command === "cancel"
    ) {
      try {
        const operationId =
          createCancelOperationId(
            update.update_id
          );


        const result =
          await cancelLatestSale({
            chatId,
            operationId,
          });


        await sendPhoto(
          chatId,
          formatCancelResult(
            result
          )
        );


        return res.status(
          200
        ).json({
          ok: true,
          command:
            "cancel",
          operationId:
            result.operationId,
          duplicate:
            Boolean(
              result.duplicate
            ),
        });
      } catch (error) {
        console.error(
          "Cancel error:",
          error
        );


        try {
          await sendMessage(
            chatId,
            `⚠️ ${error.message}`
          );
        } catch (
          notifyError
        ) {
          console.error(
            "Cancel notification error:",
            notifyError
          );
        }


        return res.status(
          200
        ).json({
          ok: false,
          command:
            "cancel",
          error:
            error.message,
        });
      }
    }


    /* =======================================================
       /report
    ======================================================= */

    if (
      command === "report"
    ) {
      try {
        const report =
          await buildReport();


        await sendPhoto(
          chatId,
          report
        );


        return res.status(
          200
        ).json({
          ok: true,
          command:
            "report",
        });
      } catch (error) {
        console.error(
          "Report error:",
          error
        );


        try {
          await sendMessage(
            chatId,
            `⚠️ ${error.message}`
          );
        } catch (
          notifyError
        ) {
          console.error(
            "Report notification error:",
            notifyError
          );
        }


        return res.status(
          200
        ).json({
          ok: false,
          command:
            "report",
          error:
            error.message,
        });
      }
    }


    /* =======================================================
       /record
    ======================================================= */

    if (
      command === "record"
    ) {
      try {
        const report =
          await buildRecordReport();


        /*
          sendPhoto() automatically switches to a normal
          Telegram message if the caption is too long.
        */

        await sendPhoto(
          chatId,
          report
        );


        return res.status(
          200
        ).json({
          ok: true,
          command:
            "record",
        });
      } catch (error) {
        console.error(
          "Record error:",
          error
        );


        try {
          await sendMessage(
            chatId,
            `⚠️ ${error.message}`
          );
        } catch (
          notifyError
        ) {
          console.error(
            "Record notification error:",
            notifyError
          );
        }


        return res.status(
          200
        ).json({
          ok: false,
          command:
            "record",
          error:
            error.message,
        });
      }
    }


    /* =======================================================
       Unknown command
    ======================================================= */

    if (
      text.startsWith(
        "/"
      )
    ) {
      await sendMessage(
        chatId,
        [
          "❓ コマンドが分かりません。",
          "",
          helpText(),
        ].join("\n")
      );


      return res.status(
        200
      ).json({
        ok: true,
        command:
          "unknown",
      });
    }


    /* =======================================================
       Normal text
    ======================================================= */

    return res.status(
      200
    ).json({
      ok: true,
      ignored: true,
    });
  } catch (error) {
    /* =======================================================
       Global error
    ======================================================= */

    console.error(
      "Webhook error:",
      error
    );


    /*
      Never expose internal details to Telegram unnecessarily.
    */

    try {
      const chatId =
        req.body
          ?.message
          ?.chat
          ?.id;


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
      Return 200 to Telegram to prevent repeated delivery
      storms from a malformed/unexpected update.
    */

    return res.status(
      200
    ).json({
      ok: false,
      error:
        "Internal processing error",
    });
  }
}
