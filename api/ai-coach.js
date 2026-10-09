// CBT Test Studio — AI backend (Gemini)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const reply = (text) => res.status(200).json({ message: text });
  const { message, context, history } = req.body || {};
  if (!message || typeof message !== 'string' || message.length > 80000) {
    return res.status(400).json({ error: 'Bad message' });
  }

  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return reply('Setup: GEMINI_API_KEY missing on Vercel.');

  const isCBT = context && context.source === 'cbt-test-studio';
  const mode = (context && context.mode) || 'ai';

  let system;
  if (mode === 'extract') {
    system = 'You are a question EXTRACTOR. Extract ONLY questions from the given text. ' +
      'DO NOT invent. DO NOT paraphrase. Copy EXACTLY. ' +
      'If MCQ with (A)(B)(C)(D) or (1)(2)(3)(4), copy exactly. ' +
      'If assertion-reason/match/sequence, keep original as 4-option MCQ. ' +
      'Include diagram references in question text if present. ' +
      'If NO questions in text, return []. ' +
      'Extract ALL questions up to requested count. ' +
      'Reply with ONLY a JSON array. Format: ' +
      '[{"q":"question","options":["A","B","C","D"],"ans":0,"topic":"ch","diff":"easy","explain":""}]';
  } else if (mode === 'notes') {
    system = 'You are an expert Indian exam question setter. Generate MCQs from concepts in the notes. ' +
      'Match Oswaal/Arihant/MTG style and difficulty. ' +
      'Reply with ONLY a JSON array. Format: ' +
      '[{"q":"question","options":["A","B","C","D"],"ans":0,"topic":"topic","diff":"easy","explain":"why"}]';
  } else {
    system = 'You are an expert Indian competitive-exam question setter. ' +
      'Generate MCQs matching Oswaal/Arihant/MTG pattern and difficulty. ' +
      'Reply with ONLY a JSON array. Format: ' +
      '[{"q":"question","options":["A","B","C","D"],"ans":0,"topic":"ch","diff":"easy","explain":"why"}]';
  }

  let msgs = (Array.isArray(history) ? history : [])
    .slice(-10)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) msgs = [{ role: 'user', content: message }];

  const contents = msgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const models = [
    (process.env.GEMINI_MODEL || '').trim(),
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ].filter((m, i, a) => m && a.indexOf(m) === i);

  let lastErr = '';
  let sawQuota = false;

  for (const model of models) {
    try {
      const temp = mode === 'extract' ? 0.2 : 0.9;
      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
              maxOutputTokens: 16384,
              temperature: temp,
              responseMimeType: 'application/json'
            }
          })
        }
      );
      const data = await r.json().catch(() => ({}));

      if (r.ok) {
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        let text = parts ? parts.map(p => p.text || '').join('').trim() : '';
        if (text) {
          text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
          const firstBracket = text.indexOf('[');
          const lastBracket = text.lastIndexOf(']');
          if (firstBracket >= 0 && lastBracket > firstBracket) {
            text = text.slice(firstBracket, lastBracket + 1);
          }
          return reply(text);
        }
        lastErr = '[' + model + '] Empty response';
        continue;
      }

      const msg = (data.error && data.error.message) || ('HTTP ' + r.status);
      lastErr = '[' + model + '] ' + r.status + ': ' + msg;
      console.error('Gemini error', lastErr);

      if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(msg))) {
        return reply('API key problem: ' + msg);
      }
      if (r.status === 429) sawQuota = true;
    } catch (e) {
      lastErr = '[' + model + '] ' + (e && e.message ? e.message : 'network error');
      console.error(lastErr);
    }
  }

  if (sawQuota) return reply('Free limit poori hai. 1-2 min baad try karo.\n\nDetail: ' + lastErr);
  return reply('AI se jawab nahi mila.\n\nDetail: ' + lastErr);
};

module.exports.config = { maxDuration: 60 };
