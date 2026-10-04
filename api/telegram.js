// api/telegram.js

import crypto from "crypto";

import {
  registerSale,
  cancelLatestSale,
  buildReport,
  buildRecordReport,
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


/* =========================================================
   Image
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

  if (
    !TELEGRAM_BOT_TOKEN
  ) {
    missing.push(
      "TELEGRAM_BOT_TOKEN"
    );
  }

  if (
    !TELEGRAM_WEBHOOK_SECRET
  ) {
    missing.push(
      "TELEGRAM_WEBHOOK_SECRET"
    );
  }

  if (
    missing.length > 0
  ) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}


/* =========================================================
   Allowed IDs
========================================================= */

function parseIdList(
  value
) {
  return new Set(
    String(value)
      .split(",")
      .map(
        item =>
          item.trim()
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


  /*
    Chat allowlistが設定されている場合
    chat IDを必ず確認。
  */

  if (
    allowedChatIds.size > 0 &&
    !allowedChatIds.has(
      chatId
    )
  ) {
    return false;
  }


  /*
    User allowlistが設定されている場合
    user IDを必ず確認。
  */

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
   Constant-time compare
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
   Webhook secret
========================================================= */

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
   Send message
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
    let offset = 0;
    offset < text.length;
    offset += TEXT_LIMIT
  ) {
    await telegramRequest(
      "sendMessage",
      {
        chat_id:
          chatId,

        text:
          text.slice(
            offset,
            offset +
              TEXT_LIMIT
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
  text
) {
  /*
    画像＋本文をcaptionで送れる場合
  */

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


  /*
    captionが長い場合は
    画像と本文を分離。
  */

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
    message以外のTelegram updateは
    このBotでは処理しない。
  */

  if (
    !message ||
    typeof message !==
      "object"
  ) {
    return null;
  }

  if (
    !message.chat ||
    typeof message.chat !==
      "object"
  ) {
    throw new Error(
      "Invalid message.chat."
    );
  }

  if (
    !Number.isSafeInteger(
      message.chat.id
    )
  ) {
    throw new Error(
      "Invalid message.chat.id."
    );
  }

  if (
    message.text !==
      undefined &&
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

function parseCommand(
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
    この3つ以外はコマンドとして認識しない。
  */

  if (
    command !== "sales" &&
    command !== "cancel" &&
    command !== "record"
  ) {
    return null;
  }

  return command;
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

  const match =
    body.match(
      /^(\d+)\s+(\d+)$/
    );

  if (!match) {
    throw new Error(
      "入力形式: /sales 売上 件数"
    );
  }

  const sales =
    Number(
      match[1]
    );

  const orders =
    Number(
      match[2]
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
      "売上は1以上で入力してください。"
    );
  }

  if (
    orders <= 0
  ) {
    throw new Error(
      "件数は1以上で入力してください。"
    );
  }

  return {
    sales,
    orders,
  };
}


/* =========================================================
   Operation ID
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
   Handler
========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method ===
    "GET"
  ) {
    return res.status(
      200
    ).json({
      ok:
        true,

      service:
        "moheji-telegram-webhook",
    });
  }


  if (
    req.method !==
    "POST"
  ) {
    return res.status(
      405
    ).json({
      ok:
        false,

      error:
        "Method Not Allowed",
    });
  }


  try {
    /*
      Webhook secret
    */

    if (
      !verifyWebhookSecret(
        req
      )
    ) {
      return res.status(
        401
      ).json({
        ok:
          false,

        error:
          "Unauthorized",
      });
    }


    /*
      Body size
    */

    if (
      bodySize(
        req.body
      ) >
      MAX_UPDATE_BYTES
    ) {
      return res.status(
        413
      ).json({
        ok:
          false,

        error:
          "Payload too large",
      });
    }


    /*
      Validate Telegram update
    */

    const message =
      validateUpdate(
        req.body
      );

    if (!message) {
      return res.status(
        200
      ).json({
        ok:
          true,

        ignored:
          true,
      });
    }


    /*
      Allowlist
    */

    if (
      !isAllowed(
        message
      )
    ) {
      return res.status(
        200
      ).json({
        ok:
          true,

        ignored:
          true,
      });
    }


    const chatId =
      message.chat.id;

    const text =
      String(
        message.text || ""
      ).trim();


    if (!text) {
      return res.status(
        200
      ).json({
        ok:
          true,

        ignored:
          true,
      });
    }


    const command =
      parseCommand(
        text
      );


    /*
      3コマンド以外は何もしない。
    */

    if (!command) {
      return res.status(
        200
      ).json({
        ok:
          true,

        ignored:
          true,
      });
    }


    /* =====================================================
       /sales
    ===================================================== */

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

        /*
          売上登録後、
          画像付き現在集計を表示。
        */

        const report =
          await buildReport();

        await sendPhoto(
          chatId,
          report
        );

        return res.status(
          200
        ).json({
          ok:
            true,

          command:
            "sales",

          operationId,
        });
      } catch (
        error
      ) {
        console.error(
          "sales error:",
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
            "sales notify error:",
            notifyError
          );
        }

        return res.status(
          200
        ).json({
          ok:
            false,

          command:
            "sales",

          error:
            error.message,
        });
      }
    }


    /* =====================================================
       /cancel
    ===================================================== */

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

        /*
          取消後も現在集計を表示。
        */

        const report =
          await buildReport();

        await sendPhoto(
          chatId,
          report
        );

        return res.status(
          200
        ).json({
          ok:
            true,

          command:
            "cancel",

          operationId,
        });
      } catch (
        error
      ) {
        console.error(
          "cancel error:",
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
            "cancel notify error:",
            notifyError
          );
        }

        return res.status(
          200
        ).json({
          ok:
            false,

          command:
            "cancel",

          error:
            error.message,
        });
      }
    }
        /* =====================================================
       /record
    ===================================================== */

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

        return res.status(
          200
        ).json({
          ok:
            true,

          command:
            "record",
        });
      } catch (
        error
      ) {
        console.error(
          "record error:",
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
            "record notify error:",
            notifyError
          );
        }

        return res.status(
          200
        ).json({
          ok:
            false,

          command:
            "record",

          error:
            error.message,
        });
      }
    }


    /*
      ここには到達しない想定。
      3コマンド以外はparseCommandで除外。
    */

    return res.status(
      200
    ).json({
      ok:
        true,

      ignored:
        true,
    });
  } catch (
    error
  ) {
    console.error(
      "telegram webhook error:",
      error
    );

    /*
      Telegramに401/500を返して
      無限リトライさせない。
    */

    return res.status(
      200
    ).json({
      ok:
        false,

      error:
        "Internal processing error",
    });
  }
}
