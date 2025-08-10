// Vercel Serverless Function
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, sourceLang, targetLang } = req.body || {};
  if (!text || !targetLang) {
    return res.status(400).json({ error: 'Missing text/targetLang' });
  }

  // If you add a real key later in Vercel settings, we’ll use it. For now, echo text so the app works.
  const DEEPL_KEY = process.env.DEEPL_API_KEY;
  if (!DEEPL_KEY) {
    return res.json({ translated: text, provider: 'mock', confidence: 1.0, detectedLang: sourceLang || 'unknown' });
  }

  try {
    const form = new URLSearchParams();
    form.set('text', text);
    form.set('target_lang', (targetLang || 'EN').toUpperCase().slice(0,2));
    if (sourceLang) form.set('source_lang', sourceLang.toUpperCase().slice(0,2));

    const resp = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': `DeepL-Auth-Key ${DEEPL_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(500).json({ error: 'Translation failed', detail: txt });
    }

    const data = await resp.json();
    const translated = data.translations?.[0]?.text || text;
    const detectedLang = data.translations?.[0]?.detected_source_language || sourceLang || 'unknown';

    return res.json({ translated, provider: 'deepl', confidence: 0.9, detectedLang });
  } catch (err) {
    return res.status(500).json({ error: 'Translation error', detail: String(err) });
  }
}
