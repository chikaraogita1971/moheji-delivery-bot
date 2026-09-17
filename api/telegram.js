module.exports = async function handler(req, res) {
  console.log("=== TELEGRAM TEST START ===");
  console.log(JSON.stringify(req.body));

  return res.status(200).json({
    ok: true,
    test: "TELEGRAM_TEST_12345"
  });
};
