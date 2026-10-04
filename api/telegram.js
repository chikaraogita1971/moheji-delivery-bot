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
  //
  // 1件ごとの売上を保存する。
  //
  // これにより、
  //
  // 10/4 23:59
  // /sales 17014 17
  //
  // 10/5 00:01
  // /cancel
  //
  // のように日付をまたいでも、
  // 元の10/4の集計を正しく戻せる。
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
  //
  // Upstashの返却形式が環境によって
  // 配列 / オブジェクトになる場合に対応
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
  // ここまで Part 1
  // ============================================================
  // ============================================================
  // 集計値を加算・減算する
  // ============================================================

  async function changeHashValues(key, salesDelta, ordersDelta) {
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
  // 全期間集計の取得
  // ============================================================

  async function getAllTimeValues() {
    const data = await getHash(allTimeKey);

    return {
      sales: safeNumber(data.sales),
      orders: safeNumber(data.orders)
    };
  }

  // ============================================================
  // 営業日を更新
  //
  // その日の売上が0より大きい場合 → 営業日として登録
  // 売上が0になった場合 → 営業日から削除
  // ============================================================

  async function updateWorkingDay(dateKey, monthKey) {
    const daily = await getDailyValues(dateKey);

    const key = workingDaysKey(monthKey);

    if (daily.sales > 0 || daily.orders > 0) {
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
  //
  // 1件の /sales を丸ごと保存する。
  //
  // cancelled = 0
  // のレコードだけが有効な売上。
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

    const key = recordKey(chatId, recordId);

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

    // 最新のレコードを簡単に取得できるように
    // 作成時刻をscoreとしてZSETへ保存
    await redis(
      "ZADD",
      recordsKey(chatId),
      createdAt,
      recordId
    );

    return {
      id: recordId,
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
  //
  // ZSETを新しい順に取得し、
  // cancelled=0 のものを最初に見つける。
  //
  // これにより
  //
  // /sales 100 1
  // /sales 200 2
  // /sales 300 3
  //
  // /cancel
  //
  // → 300 3
  //
  // /cancel
  //
  // → 200 2
  //
  // /cancel
  //
  // → 100 1
  //
  // の順番になる。
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

  async function processSales(chatId, sales, orders) {
    const now = new Date();

    const {
      dateKey,
      monthKey,
      yearKey
    } = getTokyoDateInfo(now);

    // ----------------------------------------------------------
    // 個別売上レコードを先に保存
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
    // 日別集計
    // ----------------------------------------------------------

    await changeHashValues(
      dailyKey(dateKey),
      sales,
      orders
    );

    // ----------------------------------------------------------
    // 月別集計
    // ----------------------------------------------------------

    await changeHashValues(
      monthlyKey(monthKey),
      sales,
      orders
    );

    // ----------------------------------------------------------
    // 年別集計
    // ----------------------------------------------------------

    await changeHashValues(
      yearlyKey(yearKey),
      sales,
      orders
    );

    // ----------------------------------------------------------
    // 全期間集計
    // ----------------------------------------------------------

    await changeHashValues(
      allTimeKey,
      sales,
      orders
    );

    // ----------------------------------------------------------
    // 営業日登録
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

    const dateText = new Intl.DateTimeFormat(
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
  // /cancel は金額・件数を受け取らない。
  //
  // 最新の未キャンセルレコードを取得し、
  // そのレコードに保存されている
  //
  // dateKey
  // monthKey
  // yearKey
  //
  // を使って元の日付の集計を戻す。
  //
  // これが「日付またぎキャンセル」に対応する重要部分。
  // ============================================================

  async function processCancel(chatId) {
    const record = await findLatestActiveRecord(
      chatId
    );

    // ----------------------------------------------------------
    // キャンセル対象がない場合
    // ----------------------------------------------------------

    if (!record) {
      await sendTelegram(
        chatId,
        "キャンセルできる売上がありません。"
      );

      return null;
    }

    // ----------------------------------------------------------
    // レコードに保存されている元の日付を使用
    // ----------------------------------------------------------

    const dateKey = record.dateKey;
    const monthKey = record.monthKey;
    const yearKey = record.yearKey;

    const sales = record.sales;
    const orders = record.orders;

    // ----------------------------------------------------------
    // 元の日付の日別集計から減算
    // ----------------------------------------------------------

    await changeHashValues(
      dailyKey(dateKey),
      -sales,
      -orders
    );

    // ----------------------------------------------------------
    // 元の月の月別集計から減算
    // ----------------------------------------------------------

    await changeHashValues(
      monthlyKey(monthKey),
      -sales,
      -orders
    );

    // ----------------------------------------------------------
    // 元の年の年別集計から減算
    // ----------------------------------------------------------

    await changeHashValues(
      yearlyKey(yearKey),
      -sales,
      -orders
    );

    // ----------------------------------------------------------
    // 全期間集計から減算
    // ----------------------------------------------------------

    await changeHashValues(
      allTimeKey,
      -sales,
      -orders
    );

    // ----------------------------------------------------------
    // 営業日を再判定
    //
    // 例えば10/4の売上を全部キャンセルして0になった場合、
    // 10/4を営業日から外す。
    // ----------------------------------------------------------

    await updateWorkingDay(
      dateKey,
      monthKey
    );

    // ----------------------------------------------------------
    // 二重キャンセル防止
    // cancelled = 1 にする
    // ----------------------------------------------------------

    await redis(
      "HSET",
      recordKey(chatId, record.id),
      "cancelled",
      "1"
    );

    // ----------------------------------------------------------
    // キャンセル完了メッセージ
    // ----------------------------------------------------------

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

  // ============================================================
  // ここまで Part 2
  // ============================================================
  // ============================================================
  // 月間最高売上を取得
  //
  // 月内の営業日数で割った
  // 「1営業日あたり平均売上」を比較する。
  //
  // キャンセル後は日別集計が更新されているため、
  // ここでも正しい値が反映される。
  // ============================================================

  async function getMonthlyBest(monthKey) {
    const workingDays = await redis(
      "SMEMBERS",
      workingDaysKey(monthKey)
    );

    if (!Array.isArray(workingDays) || workingDays.length === 0) {
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
      const daily = await getDailyValues(dateKey);

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
  // 月間レコード表示
  //
  // 直近24か月を表示する。
  // ============================================================

  async function processRecord(chatId) {
    const now = new Date();

    const {
      year,
      month
    } = getTokyoDateInfo(now);

    const currentYear = Number(year);
    const currentMonth = Number(month);

    const lines = [];

    lines.push(" 配達売上記録");
    lines.push("");

    // ----------------------------------------------------------
    // 直近24か月
    // ----------------------------------------------------------

    for (let i = 0; i < 24; i++) {
      let targetYear = currentYear;
      let targetMonth = currentMonth - i;

      while (targetMonth <= 0) {
        targetMonth += 12;
        targetYear -= 1;
      }

      const monthKey =
        `${targetYear}-${String(targetMonth).padStart(2, "0")}`;

      const monthly = await getMonthlyValues(
        monthKey
      );

      const workingDays = await redis(
        "SMEMBERS",
        workingDaysKey(monthKey)
      );

      const workingDayCount =
        Array.isArray(workingDays)
          ? workingDays.length
          : 0;

      const average =
        workingDayCount > 0
          ? monthly.sales / workingDayCount
          : 0;

      const best =
        await getMonthlyBest(monthKey);

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

    // ----------------------------------------------------------
    // 年間・全期間集計
    // ----------------------------------------------------------

    const yearly =
      await getYearlyValues(String(currentYear));

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
  // コマンド解析
  // ============================================================

  // ------------------------------------------------------------
  // /record
  // ------------------------------------------------------------

  if (/^\/record(?:@\w+)?$/.test(text)) {
    try {
      await processRecord(chatId);
      return res.status(200).send("OK");
    } catch (error) {
      console.error(
        "record error:",
        error
      );

      await sendTelegram(
        chatId,
        "記録の取得中にエラーが発生しました。"
      );

      return res.status(200).send("OK");
    }
  }

  // ------------------------------------------------------------
  // /cancel
  //
  // 引数は禁止。
  //
  // OK:
  // /cancel
  //
  // NG:
  // /cancel 100 1
  // ------------------------------------------------------------

  if (/^\/cancel(?:@\w+)?$/.test(text)) {
    try {
      await processCancel(chatId);
      return res.status(200).send("OK");
    } catch (error) {
      console.error(
        "cancel error:",
        error
      );

      await sendTelegram(
        chatId,
        "キャンセル処理中にエラーが発生しました。"
      );

      return res.status(200).send("OK");
    }
  }

  // ------------------------------------------------------------
  // /sales 売上 件数
  //
  // 例:
  //
  // /sales 17014 17
  // ------------------------------------------------------------

  const salesMatch =
    text.match(
      /^\/sales(?:@\w+)?\s+(\d+)\s+(\d+)$/
    );

  if (salesMatch) {
    const sales = Number(
      salesMatch[1]
    );

    const orders = Number(
      salesMatch[2]
    );

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

      return res.status(200).send("OK");
    }

    try {
      await processSales(
        chatId,
        sales,
        orders
      );

      return res.status(200).send("OK");
    } catch (error) {
      console.error(
        "sales error:",
        error
      );

      await sendTelegram(
        chatId,
        "売上登録中にエラーが発生しました。"
      );

      return res.status(200).send("OK");
    }
  }

  // ============================================================
  // 対応していないメッセージ
  // ============================================================

  return res.status(200).send("OK");
}
