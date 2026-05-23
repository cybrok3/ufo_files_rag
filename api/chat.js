export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: req.body.model || process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: req.body.messages,
      temperature: 0.2
    })
  });

  const data = await groqRes.text();
  res.status(groqRes.status).setHeader("Content-Type", "application/json");
  res.send(data);
}