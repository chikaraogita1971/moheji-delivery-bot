module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const KV_REST_API_URL = process.env.KV_REST_API_URL;
  const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    return res.status(500).send(
      "Redis environment variables are missing"
    );
  }

  async function redisCommand(command) {
    const response = await fetch(KV_REST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Redis error: ${response.status} ${text}`
      );
    }

    const data = await response.json();
    return data.result;
  }

  try {
    const keys = [
      "moheji:delivery:daily:2026-09-18",
      "moheji:delivery:month:2026-09",
      "moheji:delivery:year:2026",
      "moheji:delivery:workingdays:2026-09",
      "moheji:delivery:alltime",
    ];

    for (const key of keys) {
      await redisCommand([
        "DEL",
        key,
      ]);
    }

    return res.status(200).send(
      "RESET OK"
    );

  } catch (error) {
    console.error(
      "Reset error:",
      error
    );

    return res.status(500).send(
      "Reset failed"
    );
  }
};
