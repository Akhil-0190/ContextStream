const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';
const key = process.env.GEMINI_API_KEY;

if (!key) {
  console.error('GEMINI_API_KEY is not set in this PowerShell session.');
  process.exit(1);
}

async function probe(label, parts, timeoutMs = 30_000) {
  console.log(`${label}: sending request to Gemini 3.8 Flash…`);
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const result = await response.json().catch(() => ({}));
    console.log(`${label}: HTTP ${response.status} after ${Date.now() - started}ms.`);
    if (!response.ok) {
      console.error(`Gemini error: ${result.error?.message || 'No error details returned.'}`);
      return false;
    }
    const answer = result.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '(empty response)';
    console.log(`${label}: response received (${answer.length} characters).`);
    return true;
  } catch (error) {
    const kind = error.name === 'TimeoutError' ? `timed out after ${Math.round(timeoutMs / 1000)} seconds` : `failed: ${error.name}: ${error.message}`;
    console.error(`${label}: ${kind}.`);
    if (error.cause) {
      const cause = error.cause;
      console.error(`${label}: underlying cause: ${cause.code || cause.name || 'Error'}${cause.message ? ` — ${cause.message}` : ''}`);
    }
    return false;
  }
}

(async () => {
  const textOk = await probe('Text probe', [{ text: 'Return this JSON only: {"ok":true}' }], 90_000);
  if (!textOk) process.exitCode = 1;
  else {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
    const imageOk = await probe('Image probe', [
      { text: 'Return JSON only: {"ok":true,"object":"one pixel"}' },
      { inline_data: { mime_type: 'image/png', data: png } }
    ], 90_000);
    if (!imageOk) process.exitCode = 1;
  }
})();
