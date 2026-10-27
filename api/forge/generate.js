export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini is not configured on the server.' });
  }

  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt || prompt.length > 4000) {
    return res.status(400).json({ error: 'Prompt must be between 1 and 4000 characters.' });
  }

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{
              text: 'You are a React expert. Generate a single modern React component using Tailwind CSS for the website described. Use beautiful UI, real dummy data, responsive. Return only code.',
            }],
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 8192 },
        }),
      },
    );

    if (!response.ok) {
      console.error('Gemini generation failed with status:', response.status);
      return res.status(502).json({ error: 'Gemini could not generate the website.' });
    }

    const result = await response.json();
    const rawCode = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!rawCode) {
      return res.status(502).json({ error: 'Gemini returned an empty website. Please try again.' });
    }

    const code = rawCode
      .replace(/^\s*```[^\n]*\n?/, '')
      .replace(/\n?\s*```\s*$/, '')
      .trim();

    if (!/\bexport\s+default\b/.test(code)) {
      return res.status(502).json({
        error: 'Gemini returned code without a default component export. Please try a more specific prompt.',
      });
    }

    return res.status(200).json({ code });
  } catch (error) {
    console.error('Website generation request failed:', error);
    return res.status(502).json({ error: 'Gemini could not generate the website. Please try again.' });
  }
}
