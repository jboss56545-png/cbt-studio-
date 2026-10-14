// CBT Test Studio — AI Master Backend (PDF + Image + Scanned PDF)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const reply = (text) => res.status(200).json({ message: text });

  const { message, context, history, image, images } = req.body || {};
  if (!message || typeof message !== 'string' || message.length > 80000) {
    return res.status(400).json({ error: 'BAD_INPUT', message: 'Message missing or too long.' });
  }

  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return res.status(500).json({ error: 'NO_KEY', message: 'Setup: GEMINI_API_KEY missing on Vercel.' });

  const isCBT = context && context.source === 'cbt-test-studio';
  const mode = (context && context.mode) || 'chat';

  // Collect all images (single + array)
  let allImages = [];
  if (Array.isArray(images) && images.length) {
    allImages = images.filter(i => i && i.data && i.mime);
  } else if (image && image.data && image.mime) {
    allImages = [image];
  }
  const hasImages = allImages.length > 0;

  let system;

  // ===== SCANNED PDF / IMAGE OCR EXTRACT =====
  if (hasImages && (mode === 'scanned-extract' || mode === 'image-extract' || mode === 'extract' || mode === 'notes')) {
    system =
      'You are an expert at extracting exam questions from photos/scans of Indian educational material (Oswaal, Arihant, MTG, NCERT, CBSE, CUET, JEE, NEET question papers, notes, textbook pages, handwritten or printed).\n\n' +
      'You have received ' + allImages.length + ' page image(s). Read text carefully from ALL images.\n\n' +
      'INPUT MAY CONTAIN:\n' +
      '• Real MCQs with options (A/B/C/D or 1/2/3/4)\n' +
      '• Match List I with List II questions\n' +
      '• Assertion-Reason questions\n' +
      '• Statement-based questions\n' +
      '• Fill in the blanks\n' +
      '• Theory paragraphs (for notes mode — generate MCQs)\n' +
      '• Multiple columns, mixed English + Hindi text\n' +
      '• Tables, diagrams (ignore diagrams, focus on text)\n\n' +
      'YOUR MISSION:\n' +
      'Extract ALL valid exam questions and convert to standard 4-option MCQ format.\n\n' +
      'CONVERSION RULES:\n' +
      '1. Standard MCQ: Copy question + options EXACTLY as in image.\n' +
      '2. Match-the-Following: "Match List I with List II: [items]. Options: (1)... (2)... (3)... (4)...".\n' +
      '3. Assertion-Reason: "Assertion (A): ... Reason (R): ... Options: (1) Both true, R explains A (2) Both true, R does not explain A (3) A true, R false (4) A false, R true".\n' +
      '4. Statement-based: "Consider the following statements: I. ... II. ... Which are correct? (1)... (2)... (3)... (4)...".\n' +
      '5. If image blurry, do your best — DO NOT invent questions.\n' +
      '6. Do NOT extract page numbers, headers, footers, section headings.\n' +
      '7. Do NOT extract answer keys/solutions as questions.\n\n' +
      'STRICT RULES:\n' +
      '1. Copy question text EXACTLY. Do NOT paraphrase.\n' +
      '2. Preserve original answer if given (map A/B/C/D → 0/1/2/3, 1/2/3/4 → 0/1/2/3).\n' +
      '3. Every question: exactly 4 options, ONE correct.\n' +
      '4. If options missing but question exists, ADD 4 plausible distractors.\n' +
      '5. "topic" = chapter name if visible, else "General".\n' +
      '6. "diff" = easy/medium/hard.\n' +
      '7. "explain" = short reasoning if available, else "".\n' +
      '8. If NO questions found in these images, return [] — but only after thorough reading.\n\n' +
      'FORMAT — Reply with ONLY a valid JSON array:\n' +
      '[{"q":"question text","options":["A","B","C","D"],"ans":0,"topic":"chapter","diff":"easy","explain":""}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});

  // ===== TEXT EXTRACT =====
  } else if (isCBT && mode === 'extract') {
    system =
      'You are an expert at extracting exam questions from Indian educational PDFs (Oswaal, Arihant, MTG, NCERT, CBSE, CUET, JEE, NEET).\n\n' +
      'INPUT TEXT MAY CONTAIN:\n' +
      '• Real MCQs (numbered)\n• Match List I with List II\n• Assertion-Reason\n• Statement-based\n• Sequence/Order\n• Fill in the blanks\n• Case-based\n' +
      '• OMR grids (SKIP)\n• Answer keys, solutions (SKIP)\n• Theory paragraphs (SKIP)\n\n' +
      'CONVERSION RULES:\n' +
      '1. Standard MCQ: Copy question + options EXACTLY.\n' +
      '2. Match: "Match List I with List II: [items]. Options: (1)... (2)... (3)... (4)...".\n' +
      '3. A-R: "Assertion (A): ... Reason (R): ... Options: (1)... (2)... (3)... (4)...".\n' +
      '4. Statement: "Consider following statements: I. ... II. ... Options: (1)... (2)... (3)... (4)...".\n' +
      '5. Sequence: "Arrange: A... B... C... Options: (1) ABCD (2) BACD...".\n\n' +
      'STRICT RULES:\n' +
      '1. Copy question text EXACTLY.\n' +
      '2. Preserve original answer (map A/B/C/D → 0/1/2/3, 1/2/3/4 → 0/1/2/3).\n' +
      '3. Exactly 4 options, ONE correct.\n' +
      '4. "topic" = chapter name, else "General".\n' +
      '5. "diff" = easy/medium/hard.\n' +
      '6. "explain" = short reasoning if available, else "".\n' +
      '7. Extract EVERY valid question. If none, return [].\n\n' +
      'FORMAT — Reply with ONLY a valid JSON array:\n' +
      '[{"q":"...","options":["A","B","C","D"],"ans":0,"topic":"ch","diff":"easy","explain":""}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});

  // ===== NOTES MODE =====
  } else if (isCBT && mode === 'notes') {
    system =
      'You are an expert Indian exam question setter (Oswaal/Arihant/MTG style).\n\n' +
      'Generate high-quality MCQs based on the CONCEPTS in the given notes.\n\n' +
      'RULES:\n' +
      '1. Each question: 4 options, ONE correct.\n' +
      '2. Vary correct option index (0,1,2,3).\n' +
      '3. Plausible distractors like real exams.\n' +
      '4. "topic" = concept/chapter.\n' +
      '5. "diff" = easy/medium/hard.\n' +
      '6. "explain" = 1-2 sentence reasoning.\n' +
      '7. Cover DIFFERENT concepts.\n\n' +
      'FORMAT — Reply with ONLY a valid JSON array:\n' +
      '[{"q":"...","options":["A","B","C","D"],"ans":0,"topic":"topic","diff":"easy","explain":"why"}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});

  // ===== AI PRACTICE =====
  } else if (isCBT && mode === 'ai') {
    system =
      'You are an expert Indian competitive-exam question setter with 20 years experience.\n\n' +
      'Generate MCQs matching EXACT style of PYQ books: Oswaal, Arihant, MTG, Disha.\n\n' +
      'PATTERN: Recent exam trend, NCERT-based, common traps, mix of factual/conceptual/application.\n\n' +
      'RULES: 4 options, ONE correct, vary index (0,1,2,3). "topic" = exact chapter. "diff" = easy/medium/hard. "explain" = 1-2 sentences.\n\n' +
      'FORMAT — Reply with ONLY a valid JSON array:\n' +
      '[{"q":"...","options":["A","B","C","D"],"ans":0,"topic":"ch","diff":"easy","explain":"why"}]\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {});

  // ===== GENERAL CHAT =====
  } else {
    system =
      'You are "The Raven", a wise and encouraging AI coach for competitive exam students (JEE, NEET, UPSC, CUET, Boards).\n\n' +
      'Personality:\n' +
      '- Supportive, motivating, slightly poetic.\n' +
      '- Help with study plans, habits, focus, time management, mental health.\n' +
      '- Analyze progress data (in context) and give actionable advice.\n' +
      '- Concise and friendly. Emojis sparingly.\n' +
      '- NEVER output JSON. Natural language (Hinglish/English mix OK).\n\n' +
      'USER REQUEST:\n' + JSON.stringify(context || {}) + '\n\nUser Message: ' + message;
  }

  // Build contents
  let msgs = (Array.isArray(history) ? history : [])
    .slice(-10)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) msgs = [{ role: 'user', content: message }];

  let contents = msgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  // Attach all images to LAST user message
  if (hasImages) {
    const lastMsg = contents[contents.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      for (const img of allImages) {
        lastMsg.parts.push({
          inline_data: {
            mime_type: img.mime,
            data: img.data
          }
        });
      }
    }
  }

  const models = [
    (process.env.GEMINI_MODEL || '').trim(),
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash'
  ].filter((m, i, a) => m && a.indexOf(m) === i);

  let lastErr = '';
  let sawQuota = false;
  let authError = '';

  for (const model of models) {
    try {
      console.log('[ai-coach] Trying model:', model, '| Images:', allImages.length);
      const temp = isCBT ? 0.15 : 0.85;
      const genConfig = { maxOutputTokens: 16384, temperature: temp };
      if (isCBT) genConfig.responseMimeType = 'application/json';

      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: genConfig
          })
        }
      );
      const data = await r.json().catch(() => ({}));

      if (r.ok) {
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        let text = parts ? parts.map(p => p.text || '').join('').trim() : '';
        if (text) {
          if (isCBT) {
            text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
            const fb = text.indexOf('[');
            const lb = text.lastIndexOf(']');
            if (fb >= 0 && lb > fb) text = text.slice(fb, lb + 1);
          }
          console.log('[ai-coach] SUCCESS:', model);
          return reply(text);
        }
        lastErr = '[' + model + '] Empty response';
        continue;
      }

      const msg = (data.error && data.error.message) || ('HTTP ' + r.status);
      lastErr = '[' + model + '] ' + r.status + ': ' + msg;
      console.error('[ai-coach]', lastErr);

      if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(msg))) { authError = msg; break; }
      if (r.status === 429) sawQuota = true;
    } catch (e) {
      lastErr = '[' + model + '] ' + (e && e.message ? e.message : 'network error');
      console.error('[ai-coach]', lastErr);
    }
  }

  if (authError) return res.status(401).json({ error: 'AUTH_ERROR', message: 'Google API key problem: ' + authError, detail: lastErr });
  if (sawQuota) return res.status(429).json({ error: 'QUOTA_EXCEEDED', message: 'Free limit poori hai. 1-2 minute baad try karo.', detail: lastErr });
  return res.status(502).json({ error: 'AI_UNAVAILABLE', message: 'AI se jawab nahi mila. Sabhi models fail ho gaye.', detail: lastErr });
};

module.exports.config = { maxDuration: 60 };
