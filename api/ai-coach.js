// api/ai-coach.js — Vercel Serverless Function using Google Gemini API
// Requires env var: GEMINI_API_KEY  (optional: GEMINI_MODEL)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      message: 'GEMINI_API_KEY is not set on the server.',
      detail: 'Add it in Vercel → Project → Settings → Environment Variables.'
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ message: 'Invalid JSON body.' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ message: 'Missing request body.' });
  }

  const message = String(body.message || '').trim();
  const history = Array.isArray(body.history) ? body.history : [];

  let images = [];
  if (Array.isArray(body.images)) images = body.images;
  else if (body.image) images = [body.image];

  if (!message && images.length === 0) {
    return res.status(400).json({ message: 'Provide a message and/or an image.' });
  }

  const parts = [];
  if (message) parts.push({ text: message });

  for (const img of images) {
    if (!img || !img.data) continue;
    let raw = String(img.data);
    const comma = raw.indexOf(',');
    if (raw.startsWith('data:') && comma > -1) raw = raw.slice(comma + 1);
    parts.push({
      inline_data: {
        mime_type: img.mime || img.mimeType || 'image/jpeg',
        data: raw
      }
    });
  }

  const SYSTEM_INSTRUCTION = [
    'You are an expert exam question-setter and MCQ extractor for Indian competitive exams',
    '(CUET, JEE, NEET, NDA, SSC, UPSC, CBSE Boards).',
    'Always obey the user instructions exactly. When the user asks for JSON,',
    'reply with ONLY valid JSON — no markdown, no code fences, no prose.'
  ].join(' ');

  const contents = [];
  for (const h of history) {
    if (!h || !h.content) continue;
    const role = (h.role === 'assistant' || h.role === 'model') ? 'model' : 'user';
    contents.push({ role, parts: [{ text: String(h.content) }] });
  }
  contents.push({ role: 'user', parts });

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) +
    ':generateContent?key=' +
    encodeURIComponent(apiKey);

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 8192
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const errMsg =
        (data && data.error && data.error.message) ||
        ('Gemini API error ' + r.status);
      return res.status(r.status).json({
        message: errMsg,
        detail: (data && data.error && data.error.status) || ''
      });
    }

    const candidate = data && data.candidates && data.candidates[0];
    const text =
      (candidate &&
        candidate.content &&
        Array.isArray(candidate.content.parts) &&
        candidate.content.parts.map(p => p.text || '').join('')) || '';

    if (!text.trim()) {
      const reason = (candidate && candidate.finishReason) || 'unknown';
      return res.status(502).json({
        message: 'Empty AI response (finishReason: ' + reason + ').',
        detail: reason === 'MAX_TOKENS'
          ? 'Output truncated. Ask for fewer questions per request.'
          : ''
      });
    }

    return res.status(200).json({ message: text });
  } catch (e) {
    return res.status(500).json({
      message: 'AI request failed: ' + (e && e.message ? e.message : 'unknown')
    });
  }
};
