import express from 'express';
import cors from 'cors';
import { extractColors } from './extractor.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Main extraction endpoint
app.post('/api/extract', async (req, res) => {
  const { url } = req.body;

  // Validate presence
  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'URL is required.',
      code: 'MISSING_URL',
    });
  }

  // Validate format
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({
      error: 'Invalid URL. Please include http:// or https://',
      code: 'INVALID_URL',
    });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({
      error: 'Only http:// and https:// URLs are supported.',
      code: 'UNSUPPORTED_PROTOCOL',
    });
  }

  // SSRF Protection: Block internal IPs and localhost
  const hostname = parsedUrl.hostname.toLowerCase();
  const isInternal = 
    hostname === 'localhost' || 
    hostname === '127.0.0.1' || 
    hostname.startsWith('10.') || 
    hostname.startsWith('192.168.') || 
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    hostname.startsWith('169.254.'); // Cloud metadata

  if (isInternal) {
    return res.status(403).json({
      error: 'Access to internal or private addresses is forbidden.',
      code: 'FORBIDDEN_ADDRESS',
    });
  }

  try {
    console.log(`[extract] Visiting: ${url}`);
    const colors = await extractColors(url);
    console.log(`[extract] Found colors:`, colors);
    res.json({ colors, url });
  } catch (err) {
    console.error(`[extract] Error:`, err.message);

    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return res.status(502).json({
        error: 'Page took too long to load. Try a different URL.',
        code: 'TIMEOUT',
      });
    }

    res.status(502).json({
      error: 'Failed to load the page. It may be blocked or unreachable.',
      code: 'PAGE_LOAD_FAILED',
    });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`\n🎨 Brand Color Extractor API running on http://localhost:${PORT}`);
    console.log(`   POST /api/extract — { url: string }\n`);
  });
}

export default app;
