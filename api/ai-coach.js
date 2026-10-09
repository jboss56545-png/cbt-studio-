// CBT Test Studio — AI backend (Gemini)
// Handles: Extract questions from PDF, Generate MCQs from notes, AI chat

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
  if (!key) {
    return reply('Setup problem: Vercel mein GEMINI_API_KEY nahi mili. Settings > Environment Variables mein add karke Redeploy karo.');
  }

  const isCBT = context && context.source === 'cbt-test-studio';
  const isNotesMode = isCBT && context.mode === 'notes';
  const isExtractMode = isCBT && context.mode === 'extract';

  let system;
  if (isExtractMode) {
    system = 
      'You are a question EXTRACTOR (NOT generator). Extract ONLY the questions literally present in the given text.\n\n' +
      'STRICT RULES:\n' +
      '1. DO NOT generate new questions. DO NOT paraphrase. Copy questions EXACTLY as written in the source.\n' +
      '2. If the text has MCQ with options (A)(B)(C)(D) or (1)(2)(3)(4), copy them exactly with their options.\n' +
      '3. If the text has assertion-reason, match-the-following, sequence-based, or case-based questions, keep the ORIGINAL content but format as 4-option MCQ.\n' +
      '4. If the text has questions with diagrams/figures, describe the diagram in the question text (like "Refer to the figure showing..." or "As shown in the diagram...").\n' +
      '5. If NO questions are found in the text (only theory/notes/answer key), return [] — empty array. DO NOT invent.\n' +
      '6. Extract ALL questions found, up to the requested count.\n' +
      '7. 4 options per question, only ONE correct. Preserve the original answer if given (A/B/C/D → 0/1/2/3).\n' +
      '8. "topic" = chapter/section name from text.\n' +
      '9. "diff" = easy/medium/hard based on question difficulty.\n' +
      '10. "explain" = brief 1-sentence explanation ONLY if provided in source, otherwise leave empty string.\n\n' +
      'IMPORTANT: Reply with ONLY a strict JSON array. No prose, no markdown, no code fences.\n' +
      'Format:\n' +
      '[{"q":"question text","options":["A","B","C","D"],"ans":0,"topic":"chapter","diff":"easy","explain":""}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});
  } else if (isNotesMode) {
    system = 
      'You are an expert exam question generator. The user has provided NOTES/THEORY text.\n' +
      'Generate high-quality multiple-choice questions based on the CONCEPTS in the notes.\n\n' +
      'RULES:\n' +
      '1. Generate questions that test understanding of concepts from the notes.\n' +
      '2. Each question must have 4 options, only ONE correct.\n' +
      '3. Vary the correct option index (0,1,2,3).\n' +
      '4. "topic" = concept/chapter name from notes.\n' +
      '5. "explain" = short 1-2 sentence explanation.\n' +
      '6. Cover different topics from the notes.\n' +
      '7. Plausible distractors.\n' +
      '8. No markdown, raw JSON only.\n\n' +
      'IMPORTANT: Reply with ONLY a strict JSON array.\n' +
      'Format:\n' +
      '[{"q":"question text","options":["A","B","C","D"],"ans":0,"topic":"topic","diff":"easy","explain":"why"}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});
  } else {
    system = 
      'You are an AI assistant. Answer the user\'s question helpfully and concisely.\n' +
      'Reply in the same language the user writes in (Hinglish is fine).\n\n' +
      'CONTEXT:\n' + JSON.stringify(context || {});
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
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash'
  ].filter((m, i, a) => m && a.indexOf(m) === i);

  let lastErr = '';
  let sawQuota = false;

  for (const model of models) {
    try {
      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
              maxOutputTokens: isCBT ? 16384 : 2048,
              temperature: isExtractMode ? 0.4 : (isCBT ? 0.85 : 1.0),
              ...(isCBT ? { responseMimeType: 'application/json' } : {})
            }
          })
        }
      );
      const data = await r.json().catch(() => ({}));

      if (r.ok) {
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const text = parts ? parts.map(p => p.text || '').join('').trim() : '';
        if (text) return reply(text);
        lastErr = '[' + model + '] Empty response';
        continue;
      }

      const msg = (data.error && data.error.message) || ('HTTP ' + r.status);
      lastErr = '[' + model + '] ' + r.status + ': ' + msg;
      console.error('Gemini error', lastErr);

      if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(msg))) {
        return reply('API key problem: ' + msg + '. Check GEMINI_API_KEY in Vercel.');
      }
      if (r.status === 429) sawQuota = true;
    } catch (e) {
      lastErr = '[' + model + '] ' + (e && e.message ? e.message : 'network error');
      console.error(lastErr);
    }
  }

  if (sawQuota) {
    return reply('Free limit poori hai. 1-2 minute baad try karo.\n\nDetail: ' + lastErr);
  }
  return reply('AI se jawab nahi mila.\n\nDetail: ' + lastErr);
};

module.exports.config = {
  maxDuration: 60
};
