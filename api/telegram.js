```javascript
export default async function handler(req, res) {
  console.log("TELEGRAM WEBHOOK RECEIVED");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  console.log("BODY:", JSON.stringify(req.body));

  return res.status(200).send("OK");
}
```
