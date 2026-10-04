// api/telegram.js

import crypto from "crypto";

import {
  registerSale,
  cancelLatestSale,
  buildReport,
  buildRecordReport,
} from "./sales.js";


/* =========================================================
   ENV
========================================================= */

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET;

const TELEGRAM_ALLOWED_CHAT_IDS =
  process.env.TELEGRAM_ALLOWED_CHAT_IDS ||
  "";

const TELEGRAM_ALLOWED_USER_IDS =
  process.env.TELEGRAM_ALLOWED_USER_IDS ||
  "";


/* =========================================================
   IMAGE
========================================================= */

const PHOTO_URL =
  "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/D261A432-2C27-4ADD-900E-E6BE35B57595.png";


/* =========================================================
   LIMIT
========================================================= */

const MAX_UPDATE_BYTES =
  20000;

const TEXT_LIMIT =
  3500;

const CAPTION_LIMIT =
  900;


/* =========================================================
   ENV CHECK
========================================================= */

function requireEnvironment() {
  if (
    !TELEGRAM_BOT_TOKEN
  ) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing."
    );
  }

  if (
    !TELEGRAM_WEBHOOK_SECRET
  ) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET is missing."
    );
  }
}


/* =========================================================
   ALLOWLIST
========================================================= */

function parseIdList(
  value
) {
  return new Set(
    String(value)
      .split(",")
      .map(
        value =>
          value.trim()
      )
      .filter(
        Boolean
      )
  );
}


const allowedChatIds =
  parseIdList(
    TELEGRAM_ALLOWED_CHAT_IDS
  );


const allowedUserIds =
  parseIdList(
    TELEGRAM_ALLOWED_USER_IDS
  );


function isAllowed(
  message
) {
  const chatId =
    String(
      message.chat.id
    );

  const userId =
    message.from &&
    Number.isSafeInteger(
      message.from.id
    )
      ? String(
          message.from.id
        )
      : null;


  if (
    allowedChatIds.size > 0 &&
    !allowedChatIds.has(
      chatId
    )
  ) {
    return false;
  }


  if (
    allowedUserIds.size > 0 &&
    (
      !userId ||
      !allowedUserIds.has(
        userId
      )
    )
  ) {
    return false;
  }

  return true;
}


/* =========================================================
   SECRET COMPARE
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


function verifyWebhookSecret(
  req
) {
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
   TELEGRAM API
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
        method:
          "POST",

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
   SEND MESSAGE
========================================================= */

async function sendMessage(
  chatId,
  text
) {
  if (
    !text
  ) {
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
            i +
              TEXT_LIMIT
          ),
      }
    );
  }
}


/* =========================================================
   SEND PHOTO
========================================================= */

async function sendPhoto(
  chatId,
  text
) {
  if (
    text.length <=
    CAPTION_LIMIT
  ) {
    await telegramRequest(
      "sendPhoto",
      {
        chat_id:
          chatId,

        photo:
          PHOTO_URL,

        caption:
          text,
      }
    );

    return;
  }

  await telegramRequest(
    "sendPhoto",
    {
      chat_id:
        chatId,

      photo:
        PHOTO_URL,
    }
  );

  await sendMessage(
    chatId,
    text
  );
}


/* =========================================================
   UPDATE VALIDATION
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

  if (
    !message
  ) {
    return null;
  }

  if (
    !message.chat ||
    !Number.isSafeInteger(
      message.chat.id
    )
  ) {
    throw new Error(
      "Invalid chat."
    );
  }

  if (
    typeof message.text !==
      "string"
  ) {
    return null;
  }

  if (
    message.text.length >
    4096
  ) {
    throw new Error(
      "Message too long."
    );
  }

  return message;
}


/* =========================================================
   COMMAND
========================================================= */

function getCommand(
  text
) {
  const match =
    text.match(
      /^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s|$)/
    );

  if (!match) {
    return null;
  }

  const command =
    match[1].toLowerCase();

  /*
    コマンドは3つだけ。
  */

  if (
    command === "sales" ||
    command === "cancel" ||
    command === "record"
  ) {
    return command;
  }

  return null;
}


/* =========================================================
   SALES INPUT
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

  const parts =
    body.split(
      /\s+/
    );

  if (
    parts.length !== 2
  ) {
    throw new Error(
      "入力形式：/sales 売上 件数"
    );
  }

  const sales =
    Number(
      parts[0]
    );

  const orders =
    Number(
      parts[1]
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
    sales <= 0 ||
    orders <= 0
  ) {
    throw new Error(
      "売上と件数は1以上で入力してください。"
    );
  }

  return {
    sales,
    orders,
  };
}


/* =========================================================
   OPERATION ID
========================================================= */

function createSaleOperationId(
  updateId
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      `telegram:sales:${updateId}`,
      "utf8"
    )
    .digest(
      "hex"
    );
}


function createCancelOperationId(
  updateId
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      `telegram:cancel:${updateId}`,
      "utf8"
    )
    .digest(
      "hex"
    );
}


/* =========================================================
   BODY SIZE
========================================================= */

function getBodySize(
  body
) {
  return Buffer.byteLength(
    JSON.stringify(
      body || {}
    ),
    "utf8"
  );
}


/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  /*
    GETはWebhook確認用。
    コマンドではありません。
  */

  if (
    req.method ===
    "GET"
  ) {
    return res
      .status(200)
      .json({
        ok:
          true,
      });
  }


  if (
    req.method !==
    "POST"
  ) {
    return res
      .status(405)
      .json({
        ok:
          false,

        error:
          "Method Not Allowed",
      });
  }


  try {
    /* -----------------------------------------------
       Secret
    ----------------------------------------------- */

    if (
      !verifyWebhookSecret(
        req
      )
    ) {
      return res
        .status(401)
        .json({
          ok:
            false,

          error:
            "Unauthorized",
        });
    }


    /* -----------------------------------------------
       Body
    ----------------------------------------------- */

    if (
      getBodySize(
        req.body
      ) >
      MAX_UPDATE_BYTES
    ) {
      return res
        .status(413)
        .json({
          ok:
            false,

          error:
            "Payload too large",
        });
    }


    /* -----------------------------------------------
       Telegram update
    ----------------------------------------------- */

    const message =
      validateUpdate(
        req.body
      );

    if (!message) {
      return res
        .status(200)
        .send("OK");
    }


    /* -----------------------------------------------
       Allowlist
    ----------------------------------------------- */

    if (
      !isAllowed(
        message
      )
    ) {
      return res
        .status(200)
        .send("OK");
    }


    const text =
      message.text.trim();

    const chatId =
      message.chat.id;

    const command =
      getCommand(
        text
      );


    /*
      3コマンド以外は完全に無視。
    */

    if (!command) {
      return res
        .status(200)
        .send("OK");
    }


    /* =================================================
       /sales
    ================================================= */

    if (
      command ===
      "sales"
    ) {
      try {
        const {
          sales,
          orders,
        } =
          parseSales(
            text
          );

        const operationId =
          createSaleOperationId(
            req.body.update_id
          );

        await registerSale({
          chatId,
          sales,
          orders,
          operationId,
        });

        const report =
          await buildReport();

        await sendPhoto(
          chatId,
          report
        );

        return res
          .status(200)
          .send("OK");
      } catch (
        error
      ) {
        console.error(
          "SALES ERROR:",
          error
        );

        try {
          await sendMessage(
            chatId,
            `⚠️ ${error.message}`
          );
        } catch (
          sendError
        ) {
          console.error(
            "SALES SEND ERROR:",
            sendError
          );
        }

        return res
          .status(200)
          .send("OK");
      }
    }


    /* =================================================
       /cancel
    ================================================= */

    if (
      command ===
      "cancel"
    ) {
      try {
        const operationId =
          createCancelOperationId(
            req.body.update_id
          );

        await cancelLatestSale({
          chatId,
          operationId,
        });

        const report =
          await buildReport();

        await sendPhoto(
          chatId,
          report
        );

        return res
          .status(200)
          .send("OK");
      } catch (
        error
      ) {
        console.error(
          "CANCEL ERROR:",
          error
        );

        try {
          await sendMessage(
            chatId,
            `⚠️ ${error.message}`
          );
        } catch (
          sendError
        ) {
          console.error(
            "CANCEL SEND ERROR:",
            sendError
          );
        }

        return res
          .status(200)
          .send("OK");
      }
    }


    /* =================================================
       /record
    ================================================= */

    if (
      command ===
      "record"
    ) {
      try {
        const report =
          await buildRecordReport();

        await sendPhoto(
          chatId,
          report
        );

        return res
          .status(200)
          .send("OK");
      } catch (
        error
      ) {
        console.error(
          "RECORD ERROR:",
          error
        );

        try {
          await sendMessage(
            chatId,
            `⚠️ ${error.message}`
          );
        } catch (
          sendError
        ) {
          console.error(
            "RECORD SEND ERROR:",
            sendError
          );
        }

        return res
          .status(200)
          .send("OK");
      }
    }


    /*
      ここには通常来ない。
      コマンドは上の3つだけ。
    */

    return res
      .status(200)
      .send("OK");

  } catch (
    error
  ) {
    console.error(
      "TELEGRAM WEBHOOK ERROR:",
      error
    );

    /*
      TelegramへのWebhook応答は
      200にして無限リトライを防止。
    */

    return res
      .status(200)
      .send("OK");
  }
}
