export default async function handler(req, res) {
  // ============================================================
  // 基本設定
  // ============================================================

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const redisUrl = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;

  const message = req.body?.message;

  if (!token || !redisUrl || !redisToken || !message) {
    return res.status(200).send("OK");
  }

  const chatId = message.chat?.id;

  if (!chatId) {
    return res.status(200).send("OK");
  }

  const text = String(message.text || "").trim();

  // ============================================================
  // Redis
  // ============================================================

  async function redis(command, ...args) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([command, ...args])
    });

    if (!response.ok) {
      throw new Error(`Redis HTTP error: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Redis error: ${data.error}`);
    }

    return data.result;
  }

  // ============================================================
  // 数値処理
  // ============================================================

  function safeNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 0;
    }

    return number;
  }

  // ============================================================
  // 東京時間
  // ============================================================

  function getTokyoDateInfo(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);

    const values = {};

    for (const part of parts) {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
    }

    const year = values.year;
    const month = values.month;
    const day = values.day;

    return {
      year,
      month,
      day,
      dateKey: `${year}-${month}-${day}`,
      monthKey: `${year}-${month}`,
      yearKey: year
    };
  }

  // ============================================================
  // Redisキー
  // ============================================================

  function dailyKey(dateKey) {
    return `moheji:delivery:daily:${dateKey}`;
  }

  function monthlyKey(monthKey) {
    return `moheji:delivery:month:${monthKey}`;
  }

  function yearlyKey(yearKey) {
    return `moheji:delivery:year:${yearKey}`;
  }

  function workingDaysKey(monthKey) {
    return `moheji:delivery:workingdays:${monthKey}`;
  }

  const allTimeKey = "moheji:delivery:alltime";

  // ============================================================
  // 売上レコード用Redisキー
  // ============================================================

  function recordsKey(chatId) {
    return `moheji:delivery:records:${chatId}`;
  }

  function recordKey(chatId, recordId) {
    return `moheji:delivery:record:${chatId}:${recordId}`;
  }

  // ============================================================
  // レコードID
  // ============================================================

  function createRecordId() {
    return `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  // ============================================================
  // Redis Hash取得
  // ============================================================

  async function getHash(key) {
    const result = await redis("HGETALL", key);

    if (!result) {
      return {};
    }

    if (Array.isArray(result)) {
      const object = {};

      for (let i = 0; i < result.length; i += 2) {
        const field = result[i];
        const value = result[i + 1];

        if (field !== undefined) {
          object[field] = value;
        }
      }

      return object;
    }

    if (typeof result === "object") {
      return result;
    }

    return {};
  }

  // ============================================================
  // Telegram送信
  // ============================================================

  async function sendTelegram(chatId, messageText) {
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

    if (!response.ok) {
      throw new Error(
        `Telegram sendMessage error: ${response.status}`
      );
    }

    return response;
  }

  // ============================================================
  // 日別集計取得
  // ============================================================

  async function getDailyValues(dateKey) {
    const data = await getHash(dailyKey(dateKey));

    return {
      sales: safeNumber(data.sales),
      orders: safeNumber(data.orders)
    };
  }

  // ============================================================
  // 月別集計取得
  // ============================================================

  async function getMonthlyValues(monthKey) {
    const data = await getHash(monthlyKey(monthKey));

    return {
      sales: safeNumber(data.sales),
      orders: safeNumber(data.orders)
    };
  }

  // ============================================================
  // 年別集計取得
  // ============================================================

  async function getYearlyValues(yearKey) {
    const data = await getHash(yearlyKey(yearKey));

    return {
      sales: safeNumber(data.sales),
      orders: safeNumber(data.orders)
    };
  }

  // ============================================================
  // 集計値を加算・減算
  // ============================================================

  async function changeHashValues(
    key,
    salesDelta,
    ordersDelta
  ) {
    await redis(
      "HINCRBY",
      key,
      "sales",
      salesDelta
    );

    await redis(
      "HINCRBY",
      key,
      "orders",
      ordersDelta
    );
  }

  // ============================================================
  // 全期間集計取得
  // ============================================================

  async function getAllTimeValues() {
    const data = await getHash(allTimeKey);

    return {
      sales: safeNumber(data.sales),
      orders: safeNumber(data.orders)
    };
  }

  // ============================================================
  // 営業日更新
  // ============================================================

  async function updateWorkingDay(
    dateKey,
    monthKey
  ) {
    const daily = await getDailyValues(dateKey);

    const key = workingDaysKey(monthKey);

    if (
      daily.sales > 0 ||
      daily.orders > 0
    ) {
      await redis(
        "SADD",
        key,
        dateKey
      );
    } else {
      await redis(
        "SREM",
        key,
        dateKey
      );
    }
  }

  // ============================================================
  // 売上レコード保存
  // ============================================================

  async function saveSalesRecord({
    chatId,
    sales,
    orders,
    dateKey,
    monthKey,
    yearKey,
    createdAt
  }) {
    const recordId = createRecordId();

    const key = recordKey(
      chatId,
      recordId
    );

    await redis(
      "HSET",
      key,
      "id",
      recordId,
      "chatId",
      String(chatId),
      "sales",
      String(sales),
      "orders",
      String(orders),
      "dateKey",
      dateKey,
      "monthKey",
      monthKey,
      "yearKey",
      yearKey,
      "createdAt",
      String(createdAt),
      "cancelled",
      "0"
    );

    await redis(
      "ZADD",
      recordsKey(chatId),
      createdAt,
      recordId
    );

    return {
      id: recordId,
      chatId,
      sales,
      orders,
      dateKey,
      monthKey,
      yearKey,
      createdAt
    };
  }

  // ============================================================
  // 最新の未キャンセル売上を探す
  // ============================================================

  async function findLatestActiveRecord(chatId) {
    const ids = await redis(
      "ZREVRANGE",
      recordsKey(chatId),
      "0",
      "-1"
    );

    if (!ids) {
      return null;
    }

    const recordIds = Array.isArray(ids)
      ? ids
      : [];

    for (const recordId of recordIds) {
      const record = await getHash(
        recordKey(chatId, recordId)
      );

      if (!record || !record.id) {
        continue;
      }

      const cancelled = String(
        record.cancelled ?? "0"
      );

      if (cancelled === "1") {
        continue;
      }

      return {
        id: record.id,
        chatId: record.chatId,
        sales: safeNumber(record.sales),
        orders: safeNumber(record.orders),
        dateKey: record.dateKey,
        monthKey: record.monthKey,
        yearKey: record.yearKey,
        createdAt: safeNumber(record.createdAt),
        cancelled: false
      };
    }

    return null;
  }

  // ============================================================
  // 売上登録
  // ============================================================

  async function processSales(
    chatId,
    sales,
    orders
  ) {
    const now = new Date();

    const {
      dateKey,
      monthKey,
      yearKey
    } = getTokyoDateInfo(now);

    // ----------------------------------------------------------
    // 個別売上レコードを保存
    // ----------------------------------------------------------

    const record = await saveSalesRecord({
      chatId,
      sales,
      orders,
      dateKey,
      monthKey,
      yearKey,
      createdAt: Date.now()
    });

    // ----------------------------------------------------------
    // 日別
    // ----------------------------------------------------------

    await changeHashValues(
      dailyKey(dateKey),
      sales,
      orders
    );

    // ----------------------------------------------------------
    // 月別
    // ----------------------------------------------------------

    await changeHashValues(
      monthlyKey(monthKey),
      sales,
      orders
    );

    // ----------------------------------------------------------
    // 年別
    // ----------------------------------------------------------

    await changeHashValues(
      yearlyKey(yearKey),
      sales,
      orders
    );

    // ----------------------------------------------------------
    // 全期間
    // ----------------------------------------------------------

    await changeHashValues(
      allTimeKey,
      sales,
      orders
    );

    // ----------------------------------------------------------
    // 営業日
    // ----------------------------------------------------------

    await updateWorkingDay(
      dateKey,
      monthKey
    );

    // ----------------------------------------------------------
    // Telegram表示
    // ----------------------------------------------------------

    const circles = " ".repeat(
      Math.floor(sales / 500)
    );

    const dateText =
      new Intl.DateTimeFormat(
        "ja-JP",
        {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }
      ).format(now);

    const messageText =
` 配達売上！

 ${sales.toLocaleString()}円
${circles}
 ${orders}件
 ${dateText}

お疲れ様でした。`;

    await sendTelegram(
      chatId,
      messageText
    );

    return record;
  }

  // ============================================================
  // キャンセル処理
  //
  // /cancel は引数なし。
  //
  // 1. 最新の未キャンセルレコードをキャンセル
  // 2. レコードがない場合は旧データ救済
  // ============================================================

  async function processCancel(chatId) {
    const record =
      await findLatestActiveRecord(chatId);

    // ==========================================================
    // 通常のレコードがある場合
    // ==========================================================

    if (record) {
      const dateKey = record.dateKey;
      const monthKey = record.monthKey;
      const yearKey = record.yearKey;

      const sales = record.sales;
      const orders = record.orders;

      // --------------------------------------------------------
      // 元の日付
      // --------------------------------------------------------

      await changeHashValues(
        dailyKey(dateKey),
        -sales,
        -orders
      );

      // --------------------------------------------------------
      // 元の月
      // --------------------------------------------------------

      await changeHashValues(
        monthlyKey(monthKey),
        -sales,
        -orders
      );

      // --------------------------------------------------------
      // 元の年
      // --------------------------------------------------------

      await changeHashValues(
        yearlyKey(yearKey),
        -sales,
        -orders
      );

      // --------------------------------------------------------
      // 全期間
      // --------------------------------------------------------

      await changeHashValues(
        allTimeKey,
        -sales,
        -orders
      );

      // --------------------------------------------------------
      // 営業日更新
      // --------------------------------------------------------

      await updateWorkingDay(
        dateKey,
        monthKey
      );

      // --------------------------------------------------------
      // 二重キャンセル防止
      // --------------------------------------------------------

      await redis(
        "HSET",
        recordKey(
          chatId,
          record.id
        ),
        "cancelled",
        "1"
      );

      // --------------------------------------------------------
      // 完了メッセージ
      // --------------------------------------------------------

      const messageText =
` 売上をキャンセルしました。

 ${sales.toLocaleString()}円
 ${orders}件

対象日：${dateKey}`;

      await sendTelegram(
        chatId,
        messageText
      );

      return record;
    }

    // ==========================================================
    // 旧データ救済
    //
    // 2026/10/04 23:59頃
    //
    // 17,014円 / 17件
    //
    // 個別レコード保存機能を導入する前の売上。
    // ==========================================================

    const migrationDateKey =
      "2026-10-04";

    const migrationMonthKey =
      "2026-10";

    const migrationYearKey =
      "2026";

    const migrationSales =
      17014;

    const migrationOrders =
      17;

    const migrationKey =
      `moheji:delivery:migration:cancel:${chatId}:2026-10-04:17014:17`;

    // ----------------------------------------------------------
    // すでに救済済みなら再度引かない
    // ----------------------------------------------------------

    const alreadyMigrated =
      await redis(
        "GET",
        migrationKey
      );

    if (alreadyMigrated) {
      await sendTelegram(
        chatId,
        "キャンセルできる売上がありません。"
      );

      return null;
    }

    // ----------------------------------------------------------
    // 10/4の日別集計を確認
    // ----------------------------------------------------------

    const daily =
      await getDailyValues(
        migrationDateKey
      );

    if (
      daily.sales < migrationSales ||
      daily.orders < migrationOrders
    ) {
      await sendTelegram(
        chatId,
        "キャンセル対象の過去売上を確認できませんでした。"
      );

      return null;
    }

    // ----------------------------------------------------------
    // 10/4 日別
    // ----------------------------------------------------------

    await changeHashValues(
      dailyKey(migrationDateKey),
      -migrationSales,
      -migrationOrders
    );

    // ----------------------------------------------------------
    // 2026年10月 月別
    // ----------------------------------------------------------

    await changeHashValues(
      monthlyKey(migrationMonthKey),
      -migrationSales,
      -migrationOrders
    );

    // ----------------------------------------------------------
    // 2026年 年別
    // ----------------------------------------------------------

    await changeHashValues(
      yearlyKey(migrationYearKey),
      -migrationSales,
      -migrationOrders
    );

    // ----------------------------------------------------------
    // 全期間
    // ----------------------------------------------------------

    await changeHashValues(
      allTimeKey,
      -migrationSales,
      -migrationOrders
    );

    // ----------------------------------------------------------
    // 10/4営業日を再判定
    // ----------------------------------------------------------

    await updateWorkingDay(
      migrationDateKey,
      migrationMonthKey
    );

    // ----------------------------------------------------------
    // 救済済みフラグ
    // ----------------------------------------------------------

    await redis(
      "SET",
      migrationKey,
      "1"
    );

    // ----------------------------------------------------------
    // 救済完了メッセージ
    // ----------------------------------------------------------

    const messageText =
` 過去の売上をキャンセルしました。

 ${migrationSales.toLocaleString()}円
 ${migrationOrders}件

対象日：${migrationDateKey}`;

    await sendTelegram(
      chatId,
      messageText
    );

    return {
      id: "migration-2026-10-04-17014-17",
      chatId,
      sales: migrationSales,
      orders: migrationOrders,
      dateKey: migrationDateKey,
      monthKey: migrationMonthKey,
      yearKey: migrationYearKey,
      cancelled: true,
      migration: true
    };
  }

  // ============================================================
  // 月間最高売上
  // ============================================================

  async function getMonthlyBest(monthKey) {
    const workingDays =
      await redis(
        "SMEMBERS",
        workingDaysKey(monthKey)
      );

    if (
      !Array.isArray(workingDays) ||
      workingDays.length === 0
    ) {
      return {
        sales: 0,
        orders: 0,
        dateKey: null,
        workingDays: 0
      };
    }

    let best = {
      sales: 0,
      orders: 0,
      dateKey: null,
      workingDays: workingDays.length
    };

    for (const dateKey of workingDays) {
      const daily =
        await getDailyValues(dateKey);

      if (daily.sales > best.sales) {
        best = {
          sales: daily.sales,
          orders: daily.orders,
          dateKey,
          workingDays: workingDays.length
        };
      }
    }

    return best;
  }

  // ============================================================
  // 月間・年間・全期間記録
  // ============================================================

  async function processRecord(chatId) {
    const now = new Date();

    const {
      year,
      month
    } = getTokyoDateInfo(now);

    const currentYear =
      Number(year);

    const currentMonth =
      Number(month);

    const lines = [];

    lines.push(
      " 配達売上記録"
    );

    lines.push("");

    // ==========================================================
    // 直近24か月
    // ==========================================================

    for (let i = 0; i < 24; i++) {
      let targetYear =
        currentYear;

      let targetMonth =
        currentMonth - i;

      while (targetMonth <= 0) {
        targetMonth += 12;
        targetYear -= 1;
      }

      const monthKey =
        `${targetYear}-${String(
          targetMonth
        ).padStart(2, "0")}`;

      const monthly =
        await getMonthlyValues(
          monthKey
        );

      const workingDays =
        await redis(
          "SMEMBERS",
          workingDaysKey(monthKey)
        );

      const workingDayCount =
        Array.isArray(workingDays)
          ? workingDays.length
          : 0;

      const average =
        workingDayCount > 0
          ? monthly.sales /
            workingDayCount
          : 0;

      const best =
        await getMonthlyBest(
          monthKey
        );

      lines.push(
        `${targetYear}/${targetMonth}`
      );

      lines.push(
        `売上：${monthly.sales.toLocaleString()}円`
      );

      lines.push(
        `件数：${monthly.orders.toLocaleString()}件`
      );

      lines.push(
        `営業日：${workingDayCount}日`
      );

      lines.push(
        `1日平均：${Math.round(
          average
        ).toLocaleString()}円`
      );

      if (best.dateKey) {
        lines.push(
          `最高日：${best.dateKey.replaceAll(
            "-",
            "/"
          )} ${best.sales.toLocaleString()}円`
        );
      } else {
        lines.push(
          "最高日：-"
        );
      }

      lines.push("");
    }

    // ==========================================================
    // 年間・全期間
    // ==========================================================

    const yearly =
      await getYearlyValues(
        String(currentYear)
      );

    const allTime =
      await getAllTimeValues();

    lines.push(
      `【${currentYear}年】`
    );

    lines.push(
      `年間売上：${yearly.sales.toLocaleString()}円`
    );

    lines.push(
      `年間件数：${yearly.orders.toLocaleString()}件`
    );

    lines.push("");

    lines.push(
      "【全期間】"
    );

    lines.push(
      `総売上：${allTime.sales.toLocaleString()}円`
    );

    lines.push(
      `総件数：${allTime.orders.toLocaleString()}件`
    );

    await sendTelegram(
      chatId,
      lines.join("\n")
    );
  }

  // ============================================================
  // /record
  // ============================================================

  if (
    /^\/record(?:@\w+)?$/.test(text)
  ) {
    try {
      await processRecord(chatId);

      return res
        .status(200)
        .send("OK");
    } catch (error) {
      console.error(
        "record error:",
        error
      );

      await sendTelegram(
        chatId,
        "記録の取得中にエラーが発生しました。"
      );

      return res
        .status(200)
        .send("OK");
    }
  }

  // ============================================================
  // /cancel
  //
  // 引数なし
  //
  // OK:
  // /cancel
  //
  // NG:
  // /cancel 100 1
  // ============================================================

  if (
    /^\/cancel(?:@\w+)?$/.test(text)
  ) {
    try {
      await processCancel(chatId);

      return res
        .status(200)
        .send("OK");
    } catch (error) {
      console.error(
        "cancel error:",
        error
      );

      await sendTelegram(
        chatId,
        "キャンセル処理中にエラーが発生しました。"
      );

      return res
        .status(200)
        .send("OK");
    }
  }

  // ============================================================
  // /sales 売上 件数
  //
  // 例:
  // /sales 17014 17
  // ============================================================

  const salesMatch =
    text.match(
      /^\/sales(?:@\w+)?\s+(\d+)\s+(\d+)$/
    );

  if (salesMatch) {
    const sales =
      Number(salesMatch[1]);

    const orders =
      Number(salesMatch[2]);

    // ----------------------------------------------------------
    // 不正値防止
    // ----------------------------------------------------------

    if (
      !Number.isSafeInteger(sales) ||
      !Number.isSafeInteger(orders) ||
      sales < 0 ||
      orders < 0
    ) {
      await sendTelegram(
        chatId,
        "売上または件数が正しくありません。"
      );

      return res
        .status(200)
        .send("OK");
    }

    try {
      await processSales(
        chatId,
        sales,
        orders
      );

      return res
        .status(200)
        .send("OK");
    } catch (error) {
      console.error(
        "sales error:",
        error
      );

      await sendTelegram(
        chatId,
        "売上登録中にエラーが発生しました。"
      );

      return res
        .status(200)
        .send("OK");
    }
  }

  // ============================================================
  // 対応していないメッセージ
  // ============================================================

  return res
    .status(200)
    .send("OK");
}
