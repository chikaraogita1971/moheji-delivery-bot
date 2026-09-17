module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const TELEGRAM_BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN;

  const KV_REST_API_URL =
    process.env.KV_REST_API_URL;

  const KV_REST_API_TOKEN =
    process.env.KV_REST_API_TOKEN;

  if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is missing");
    return res.status(500).send(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  if (
    !KV_REST_API_URL ||
    !KV_REST_API_TOKEN
  ) {
    console.error(
      "Redis environment variables are missing"
    );

    return res.status(500).send(
      "Redis environment variables are missing"
    );
  }

  // =========================
  // Redis
  // =========================
  async function redisCommand(command) {
    const response = await fetch(
      KV_REST_API_URL,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${KV_REST_API_TOKEN}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(command),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Redis error: ${response.status} ${text}`
      );
    }

    const data =
      await response.json();

    return data.result;
  }

  // =========================
  // Telegram message
  // =========================
  async function sendTelegramMessage(
    chatId,
    message
  ) {
    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Telegram sendMessage error: ${response.status} ${text}`
      );
    }
  }

  // =========================
  // Telegram photo
  // =========================
  async function sendTelegramPhoto(
    chatId,
    caption
  ) {
    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;

    const response = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          photo:
            "https://raw.githubusercontent.com/chikaraogita1971/moheji-delivery-bot/main/moheji.png",
          caption,
        }),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Telegram sendPhoto error: ${response.status} ${text}`
      );
    }
  }

  try {
    // =========================
    // Telegram update
    // =========================
    const rawBody =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(
            req.body || {}
          );

    const body =
      JSON.parse(rawBody);

    // =========================
    // 二重処理防止
    // =========================
    const updateId =
      body.update_id;

    if (
      updateId !== undefined &&
      updateId !== null
    ) {
      const processedKey =
        `moheji:telegram:processed:${updateId}`;

      const result =
        await redisCommand([
          "SET",
          processedKey,
          "1",
          "NX",
          "EX",
          "86400",
        ]);

      if (result !== "OK") {
        console.log(
          `Duplicate update ignored: ${updateId}`
        );

        return res
          .status(200)
          .send("OK");
      }
    }

    // =========================
    // Message check
    // =========================
    if (!body.message) {
      return res
        .status(200)
        .send("OK");
    }

    const message =
      body.message;

    const chatId =
      message.chat?.id;

    const text =
      (message.text || "").trim();

    if (!chatId || !text) {
      return res
        .status(200)
        .send("OK");
    }

    // =========================
    // Tokyo time
    // =========================
    const now = new Date();

    const tokyoParts =
      new Intl.DateTimeFormat(
        "ja-JP",
        {
          timeZone:
            "Asia/Tokyo",
          year:
            "numeric",
          month:
            "2-digit",
          day:
            "2-digit",
          hour:
            "2-digit",
          minute:
            "2-digit",
          hour12:
            false,
        }
      ).formatToParts(now);

    const getPart =
      (type) =>
        tokyoParts.find(
          (p) =>
            p.type === type
        )?.value;

    const year =
      getPart("year");

    const month =
      getPart("month");

    const day =
      getPart("day");

    const hour =
      getPart("hour");

    const minute =
      getPart("minute");

    const dateKey =
      `${year}-${month}-${day}`;

    const monthKey =
      `${year}-${month}`;

    const yearKey =
      `${year}`;

    const displayDate =
      `${year}/${month}/${day} ${hour}:${minute}`;

    // =========================
    // Redis keys
    // =========================
    const dailyKey =
      `moheji:delivery:daily:${dateKey}`;

    const monthlyKey =
      `moheji:delivery:month:${monthKey}`;

    const yearlyKey =
      `moheji:delivery:year:${yearKey}`;

    const workingDaysKey =
      `moheji:delivery:workingdays:${monthKey}`;

    const allTimeKey =
      `moheji:delivery:alltime`;

    // =========================
    // /record
    // =========================
    if (
      text === "/record" ||
      text.startsWith("/record@")
    ) {
      const monthKeys = [];

      let currentYear =
        Number(year);

      let currentMonth =
        Number(month);

      for (
        let i = 0;
        i < 24;
        i++
      ) {
        const mm =
          String(
            currentMonth
          ).padStart(2, "0");

        monthKeys.push(
          `${currentYear}-${mm}`
        );

        currentMonth--;

        if (
          currentMonth === 0
        ) {
          currentMonth = 12;
          currentYear--;
        }
      }

      const records = [];

      for (
        const ym of monthKeys
      ) {
        const [
          recordYear,
          recordMonth,
        ] =
          ym.split("-");

        const recordMonthlyKey =
          `moheji:delivery:month:${ym}`;

        const recordWorkingDaysKey =
          `moheji:delivery:workingdays:${ym}`;

        const monthlySalesRaw =
          await redisCommand([
            "HGET",
            recordMonthlyKey,
            "sales",
          ]);

        const monthlyOrdersRaw =
          await redisCommand([
            "HGET",
            recordMonthlyKey,
            "orders",
          ]);

        const monthlySales =
          Math.max(
            0,
            Number(
              monthlySalesRaw || 0
            )
          );

        const monthlyOrders =
          Math.max(
            0,
            Number(
              monthlyOrdersRaw || 0
            )
          );

        if (
          monthlySales === 0 &&
          monthlyOrders === 0
        ) {
          continue;
        }

        const workingDays =
          await redisCommand([
            "SMEMBERS",
            recordWorkingDaysKey,
          ]);

        let maxDailySales = 0;
        let maxDailyOrders = 0;

        if (
          Array.isArray(
            workingDays
          )
        ) {
          for (
            const workingDate
              of workingDays
          ) {
            const recordDailyKey =
              `moheji:delivery:daily:${workingDate}`;

            const dailySalesRaw =
              await redisCommand([
                "HGET",
                recordDailyKey,
                "sales",
              ]);

            const dailyOrdersRaw =
              await redisCommand([
                "HGET",
                recordDailyKey,
                "orders",
              ]);

            const dailySales =
              Math.max(
                0,
                Number(
                  dailySalesRaw || 0
                )
              );

            const dailyOrders =
              Math.max(
                0,
                Number(
                  dailyOrdersRaw || 0
                )
              );

            maxDailySales =
              Math.max(
                maxDailySales,
                dailySales
              );

            maxDailyOrders =
              Math.max(
                maxDailyOrders,
                dailyOrders
              );
          }
        }

        records.push(
          `${recordYear}年${Number(recordMonth)}月\n` +
          `📅 月間売上 ${monthlySales.toLocaleString()}円\n` +
          `📦 月間件数 ${monthlyOrders.toLocaleString()}件\n` +
          `🏆 月間最高売上 ${maxDailySales.toLocaleString()}円\n` +
          `🏆 月間最高件数 ${maxDailyOrders.toLocaleString()}件`
        );
      }

      let recordMessage =
        "📊 月間記録\n\n";

      if (
        records.length === 0
      ) {
        recordMessage +=
          "まだ月間記録がありません。";
      } else {
        recordMessage +=
          records.join(
            "\n\n"
          );
      }

      recordMessage +=
        `\n\n🕐 ${displayDate}`;

      await sendTelegramMessage(
        chatId,
        recordMessage
      );

      return res
        .status(200)
        .send("OK");
    }

    // =========================
    // /sales /cancel
    // =========================
    const parts =
      text.split(/\s+/);

    let command = "";

    if (
      parts[0] === "/sales" ||
      parts[0].startsWith(
        "/sales@"
      )
    ) {
      command = "sales";
    } else if (
      parts[0] === "/cancel" ||
      parts[0].startsWith(
        "/cancel@"
      )
    ) {
      command = "cancel";
    } else {
      return res
        .status(200)
        .send("OK");
    }

    if (
      parts.length < 3
    ) {
      await sendTelegramMessage(
        chatId,
        command === "sales"
          ? "使い方：\n/sales 売上 件数\n\n例：\n/sales 5000 12"
          : "使い方：\n/cancel 売上 件数\n\n例：\n/cancel 3000 3"
      );

      return res
        .status(200)
        .send("OK");
    }

    let sales =
      Number(parts[1]);

    let orders =
      Number(parts[2]);

    if (
      !Number.isFinite(sales) ||
      !Number.isFinite(orders) ||
      sales < 0 ||
      orders < 0
    ) {
      await sendTelegramMessage(
        chatId,
        "売上と件数は0以上の数字で入力してください。"
      );

      return res
        .status(200)
        .send("OK");
    }

    sales =
      Math.floor(sales);

    orders =
      Math.floor(orders);

    // =========================
    // 今日の現在値
    // =========================
    const currentDailySalesRaw =
      await redisCommand([
        "HGET",
        dailyKey,
        "sales",
      ]);

    const currentDailyOrdersRaw =
      await redisCommand([
        "HGET",
        dailyKey,
        "orders",
      ]);

    const currentDailySales =
      Math.max(
        0,
        Number(
          currentDailySalesRaw || 0
        )
      );

    const currentDailyOrders =
      Math.max(
        0,
        Number(
          currentDailyOrdersRaw || 0
        )
      );

    // =========================
    // 今日を更新
    // =========================
    let newDailySales;
    let newDailyOrders;

    if (
      command === "sales"
    ) {
      newDailySales =
        currentDailySales +
        sales;

      newDailyOrders =
        currentDailyOrders +
        orders;
    } else {
      newDailySales =
        Math.max(
          0,
          currentDailySales -
            sales
        );

      newDailyOrders =
        Math.max(
          0,
          currentDailyOrders -
            orders
        );
    }

    // 実際に変化した金額・件数
    const actualSalesChange =
      command === "sales"
        ? sales
        : currentDailySales -
          newDailySales;

    const actualOrdersChange =
      command === "sales"
        ? orders
        : currentDailyOrders -
          newDailyOrders;

    await redisCommand([
      "HSET",
      dailyKey,
      "sales",
      String(newDailySales),
      "orders",
      String(newDailyOrders),
    ]);

    // =========================
    // 月間
    // =========================
    const currentMonthlySalesRaw =
      await redisCommand([
        "HGET",
        monthlyKey,
        "sales",
      ]);

    const currentMonthlyOrdersRaw =
      await redisCommand([
        "HGET",
        monthlyKey,
        "orders",
      ]);

    const currentMonthlySales =
      Math.max(
        0,
        Number(
          currentMonthlySalesRaw || 0
        )
      );

    const currentMonthlyOrders =
      Math.max(
        0,
        Number(
          currentMonthlyOrdersRaw || 0
        )
      );

    let newMonthlySales;
    let newMonthlyOrders;

    if (
      command === "sales"
    ) {
      newMonthlySales =
        currentMonthlySales +
        actualSalesChange;

      newMonthlyOrders =
        currentMonthlyOrders +
        actualOrdersChange;
    } else {
      newMonthlySales =
        Math.max(
          0,
          currentMonthlySales -
            actualSalesChange
        );

      newMonthlyOrders =
        Math.max(
          0,
          currentMonthlyOrders -
            actualOrdersChange
        );
    }

    await redisCommand([
      "HSET",
      monthlyKey,
      "sales",
      String(newMonthlySales),
      "orders",
      String(newMonthlyOrders),
    ]);

    // =========================
    // 年間
    // =========================
    const currentYearlySalesRaw =
      await redisCommand([
        "HGET",
        yearlyKey,
        "sales",
      ]);

    const currentYearlyOrdersRaw =
      await redisCommand([
        "HGET",
        yearlyKey,
        "orders",
      ]);

    const currentYearlySales =
      Math.max(
        0,
        Number(
          currentYearlySalesRaw || 0
        )
      );

    const currentYearlyOrders =
      Math.max(
        0,
        Number(
          currentYearlyOrdersRaw || 0
        )
      );

    let newYearlySales;
    let newYearlyOrders;

    if (
      command === "sales"
    ) {
      newYearlySales =
        currentYearlySales +
        actualSalesChange;

      newYearlyOrders =
        currentYearlyOrders +
        actualOrdersChange;
    } else {
      newYearlySales =
        Math.max(
          0,
          currentYearlySales -
            actualSalesChange
        );

      newYearlyOrders =
        Math.max(
          0,
          currentYearlyOrders -
            actualOrdersChange
        );
    }

    await redisCommand([
      "HSET",
      yearlyKey,
      "sales",
      String(newYearlySales),
      "orders",
      String(newYearlyOrders),
    ]);

    // =========================
    // 累計配達件数
    // =========================
    const currentAllTimeOrdersRaw =
      await redisCommand([
        "HGET",
        allTimeKey,
        "orders",
      ]);

    const currentAllTimeOrders =
      Math.max(
        0,
        Number(
          currentAllTimeOrdersRaw || 0
        )
      );

    let newAllTimeOrders;

    if (
      command === "sales"
    ) {
      newAllTimeOrders =
        currentAllTimeOrders +
        actualOrdersChange;
    } else {
      newAllTimeOrders =
        Math.max(
          0,
          currentAllTimeOrders -
            actualOrdersChange
        );
    }

    await redisCommand([
      "HSET",
      allTimeKey,
      "orders",
      String(newAllTimeOrders),
    ]);

    // =========================
    // 稼働日
    // =========================
    if (
      newDailySales > 0 ||
      newDailyOrders > 0
    ) {
      await redisCommand([
        "SADD",
        workingDaysKey,
        dateKey,
      ]);
    } else {
      await redisCommand([
        "SREM",
        workingDaysKey,
        dateKey,
      ]);
    }

    // =========================
    // 稼働日一覧
    // =========================
    const workingDays =
      await redisCommand([
        "SMEMBERS",
        workingDaysKey,
      ]);

    const workingDayCount =
      Array.isArray(
        workingDays
      )
        ? workingDays.length
        : 0;

    // =========================
    // 月間最高値を再計算
    // =========================
    let maxDailySales = 0;
    let maxDailyOrders = 0;

    if (
      Array.isArray(
        workingDays
      )
    ) {
      for (
        const workingDate
          of workingDays
      ) {
        const checkDailyKey =
          `moheji:delivery:daily:${workingDate}`;

        const checkSalesRaw =
          await redisCommand([
            "HGET",
            checkDailyKey,
            "sales",
          ]);

        const checkOrdersRaw =
          await redisCommand([
            "HGET",
            checkDailyKey,
            "orders",
          ]);

        const checkSales =
          Math.max(
            0,
            Number(
              checkSalesRaw || 0
            )
          );

        const checkOrders =
          Math.max(
            0,
            Number(
              checkOrdersRaw || 0
            )
          );

        maxDailySales =
          Math.max(
            maxDailySales,
            checkSales
          );

        maxDailyOrders =
          Math.max(
            maxDailyOrders,
            checkOrders
          );
      }
    }

    // =========================
    // 1件あたり
    // =========================
    const perOrder =
      newDailyOrders > 0
        ? Math.round(
            newDailySales /
              newDailyOrders
          )
        : 0;

    // =========================
    // 平均売上／日
    // =========================
    const averageSalesPerDay =
      workingDayCount > 0
        ? Math.round(
            newMonthlySales /
              workingDayCount
          )
        : 0;

    // =========================
    // 月間目標
    // =========================
    const monthlyTarget =
      500000;

    // =========================
    // 目標達成率
    // =========================
    const achievementRate =
      monthlyTarget > 0
        ? (
            (newMonthlySales /
              monthlyTarget) *
            100
          ).toFixed(1)
        : "0.0";

    // =========================
    // 緑丸
    // =========================
    const circleCount =
      Math.min(
        10,
        Math.floor(
          newDailySales / 1000
        )
      );

    const circles =
      "🟢".repeat(
        circleCount
      );

// =========================
// レポート
// =========================
const reportLines = [
  "🏍️ 配達売上",
  `💰 今日の売上 ${newDailySales.toLocaleString()}円`,
];

if (circles) {
  reportLines.push(
    circles
  );
}

reportLines.push(
  `📦 今日の件数 ${newDailyOrders.toLocaleString()}件`,
  `💵 1件あたり ${perOrder.toLocaleString()}円`,
  `📅 今月売上 ${newMonthlySales.toLocaleString()}円`,
  `📦 今月件数 ${newMonthlyOrders.toLocaleString()}件`,
  `🗓️ 年間売上 ${newYearlySales.toLocaleString()}円`,
  `📦 年間件数 ${newYearlyOrders.toLocaleString()}件`,
  `📈 平均売上／日 ${averageSalesPerDay.toLocaleString()}円`,
  `🎯 月間目標 ${monthlyTarget.toLocaleString()}円`,
  `📊 目標達成率 ${achievementRate}%`,
  `🏆 月間最高売上 ${maxDailySales.toLocaleString()}円`,
  `🏆 月間最高件数 ${maxDailyOrders.toLocaleString()}件`,
  `📆 稼働日数 ${workingDayCount}日`,
  `🛵 累計配達件数 ${newAllTimeOrders.toLocaleString()}件`,
  `🕐 ${displayDate}`,
  "🛵 今日も配達お疲れ様でした！"
);

const report =
  reportLines.join("\n");

    // =========================
    // 画像付き送信
    // =========================
    await sendTelegramPhoto(
      chatId,
      report
    );

    return res
      .status(200)
      .send("OK");

  } catch (error) {
    console.error(
      "Telegram handler error:",
      error
    );

    return res
      .status(500)
      .send(
        "Internal Server Error"
      );
  }
};
