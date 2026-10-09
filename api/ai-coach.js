// CBT Test Studio — AI backend (Gemini)
// Modes: extract (strict PDF questions) | notes (generate from concepts) | ai (PYQ-style practice)

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
    return reply('Setup problem: Vercel mein GEMINI_API_KEY nahi mili.');
  }

  const isCBT = context && context.source === 'cbt-test-studio';
  const mode = (context && context.mode) || 'ai'; // 'extract' | 'notes' | 'ai'

  let system;

  if (mode === 'extract') {
    // STRICT EXTRACTION - no invention
    system =
      'You are a question EXTRACTOR for a CBT test app. Your ONLY job is to extract questions that EXIST in the given text.\n\n' +
      'ABSOLUTE RULES:\n' +
      '1. ONLY extract questions literally present in the source text. NEVER invent new questions.\n' +
      '2. NEVER paraphrase or reword. Copy the question text EXACTLY as written.\n' +
      '3. If text contains MCQ with options (A)(B)(C)(D) or (1)(2)(3)(4), copy them EXACTLY.\n' +
      '4. If text contains assertion-reason, match-the-following, sequence, or case-based questions, keep the ORIGINAL content but format as 4-option MCQ (add plausible options if the source gives them).\n' +
      '5. If a question references a diagram/figure/table, include that reference in the question text (e.g., "Refer to the given figure showing..." as it appears in source).\n' +
      '6. If NO questions are found (only theory, notes, answer keys, marks schemes, OMR sheets), return [].\n' +
      '7. Do NOT create questions from theory paragraphs.\n' +
      '8. Do NOT add general knowledge or syllabus-based questions.\n' +
      '9. Extract ALL questions you can find (up to the requested count).\n' +
      '10. "topic" = chapter/section heading from the source text.\n' +
      '11. "diff" = easy/medium/hard based on question complexity.\n' +
      '12. "explain" = ONLY if the source provides an explanation, otherwise empty string "".\n\n' +
      'Reply with ONLY a JSON array. No prose, no markdown.\n' +
      'Format: [{"q":"...","options":["A","B","C","D"],"ans":0,"topic":"ch","diff":"easy","explain":""}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});
  } else if (mode === 'notes') {
    // Generate from notes - PYQ-style
    system =
      'You are an expert Indian exam question setter. Generate MCQs based on the CONCEPTS in the given notes.\n\n' +
      'Generate questions that match the STYLE and PATTERN of popular Indian exam prep books — Oswaal, Arihant, MTG, Disha. ' +
      'Use the NCERT syllabus pattern. Include numerical values, definitions, conceptual traps commonly seen in these books.\n\n' +
      'RULES:\n' +
      '1. Each question has 4 options, only ONE correct.\n' +
      '2. Vary the correct answer index (0,1,2,3).\n' +
      '3. Plausible distractors — like real exam options.\n' +
      '4. "topic" = concept/chapter name from notes.\n' +
      '5. "diff" = easy/medium/hard.\n' +
      '6. "explain" = 1-2 sentence explanation.\n' +
      '7. Cover different concepts from the notes.\n' +
      '8. Match Oswaal/Arihant difficulty level.\n\n' +
      'Reply with ONLY a JSON array. No markdown.\n' +
      'Format: [{"q":"...","options":["A","B","C","D"],"ans":0,"topic":"topic","diff":"easy","explain":"why"}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});
  } else {
    // AI Practice mode - PYQ-style generation
    system =
      'You are an expert Indian competitive-exam question setter with 20 years of experience.\n\n' +
      'Generate high-quality MCQs that match the EXACT style, difficulty, and pattern of popular PYQ books used by lakhs of Indian students:\n' +
      '- Oswaal Question Banks\n' +
      '- Arihant Series\n' +
      '- MTG Publications\n' +
      '- Disha Experts\n\n' +
      'PATTERN REQUIREMENTS:\n' +
      '1. Recent exam pattern (last 5 years trend).\n' +
      '2. NCERT-based concepts.\n' +
      '3. Common trap patterns used in these books.\n' +
      '4. Numerical values typical to exam.\n' +
      '5. Mix of factual, conceptual, and application questions.\n' +
      '6. Difficulty distribution matching real exams.\n\n' +
      'RULES:\n' +
      '- 4 options per question, ONE correct.\n' +
      '- Vary correct option index (0,1,2,3).\n' +
      '- Plausible distractors.\n' +
      '- "topic" = exact chapter name.\n' +
      '- "diff" = easy/medium/hard.\n' +
      '- "explain" = short 1-2 sentence.\n\n' +
      'Reply with ONLY a JSON array. No markdown.\n' +
      'Format: [{"q":"...","options":["A","B","C","D"],"ans":0,"topic":"ch","diff":"easy","explain":"why"}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});
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
      // Extract mode: low temperature for accuracy
      // Other modes: higher temperature for variety
      const temp = mode === 'extract' ? 0.3 : 0.9;

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
              temperature: temp,
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
        return reply('API key problem: ' + msg);
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
