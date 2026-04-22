import puppeteer from 'puppeteer';
import sharp from 'sharp';

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function colorSaturation(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function isNeutral(r, g, b) {
  const sat = colorSaturation(r, g, b), lum = (r + g + b) / 3;
  return sat < 0.1 || lum > 248 || lum < 8;
}

function colorDist(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

function dedup(entries, threshold = 42) {
  const merged = [];
  for (const e of entries) {
    let found = false;
    for (const m of merged) {
      if (colorDist(e.color, m.color) < threshold) {
        m.score += e.score;
        if (e.score > m.score * 0.4) m.color = e.color;
        found = true; break;
      }
    }
    if (!found) merged.push({ ...e });
  }
  return merged.sort((a, b) => b.score - a.score);
}

function screenshotKmeans(rawRgba, k = 6) {
  const pixels = [];
  for (let i = 0; i < rawRgba.length; i += 4) {
    const r = rawRgba[i], g = rawRgba[i+1], b = rawRgba[i+2], a = rawRgba[i+3];
    if (a < 200 || isNeutral(r, g, b)) continue;
    pixels.push([r, g, b]);
  }
  if (pixels.length < 20) return [];
  const sampled = [];
  const step = Math.max(1, Math.floor(pixels.length / 6000));
  for (let i = 0; i < pixels.length; i += step) sampled.push(pixels[i]);

  let centroids = Array.from({ length: k }, (_, i) => [...sampled[Math.floor((i/k)*sampled.length)]]);
  for (let iter = 0; iter < 20; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    for (const px of sampled) {
      let minD = Infinity, near = 0;
      for (let c = 0; c < k; c++) {
        const d = (px[0]-centroids[c][0])**2 + (px[1]-centroids[c][1])**2 + (px[2]-centroids[c][2])**2;
        if (d < minD) { minD = d; near = c; }
      }
      clusters[near].push(px);
    }
    let conv = true;
    for (let c = 0; c < k; c++) {
      if (!clusters[c].length) continue;
      const len = clusters[c].length;
      const nr = clusters[c].reduce((s,p)=>s+p[0],0)/len;
      const ng = clusters[c].reduce((s,p)=>s+p[1],0)/len;
      const nb = clusters[c].reduce((s,p)=>s+p[2],0)/len;
      if (Math.abs(nr-centroids[c][0])>1) conv=false;
      centroids[c]=[nr,ng,nb];
    }
    if (conv) break;
  }

  const clusters2 = Array.from({ length: k }, () => []);
  for (const px of sampled) {
    let minD=Infinity, near=0;
    centroids.forEach((c,i)=>{const d=(px[0]-c[0])**2+(px[1]-c[1])**2+(px[2]-c[2])**2;if(d<minD){minD=d;near=i;}});
    clusters2[near].push(px);
  }
  return centroids.map(([r,g,b], c) => {
    const [ri,gi,bi] = [r,g,b].map(Math.round);
    return isNeutral(ri,gi,bi) ? null : { color:[ri,gi,bi], score: clusters2[c].length * colorSaturation(ri,gi,bi) };
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
}

export async function extractColors(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, 1200));

    const cssColors = await page.evaluate(() => {
      const results = [];

      // ── helpers ──────────────────────────────────────────────────────
      function parseColor(str) {
        if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return null;
        const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
        if (!m) return null;
        const a = m[4]!==undefined ? parseFloat(m[4]) : 1;
        if (a < 0.5) return null;
        return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      }

      function isBoring(r, g, b) {
        const sat = (Math.max(r,g,b)-Math.min(r,g,b))/(Math.max(r,g,b)||1);
        const lum = (r+g+b)/3;
        return sat < 0.09 || lum > 248 || lum < 8;
      }

      function resolveColor(cssStr) {
        if (!cssStr || cssStr==='transparent') return null;
        const tmp = document.createElement('div');
        tmp.style.display='none'; tmp.style.color=cssStr;
        document.body.appendChild(tmp);
        const resolved = getComputedStyle(tmp).color;
        document.body.removeChild(tmp);
        return parseColor(resolved);
      }

      /**
       * CRITICAL: check if an element is inside an ad container,
       * cross-site widget, or third-party inject.
       */
      function isAdOrThirdParty(el) {
        const adSignals = ['ad','ads','goog','taboola','outbrain','dfp','adsense','sponsor','promo','banner','tracking'];
        let node = el;
        while (node && node !== document.documentElement) {
          const id  = (node.id   || '').toLowerCase();
          const cls = (typeof node.className === 'string' ? node.className : '').toLowerCase();
          const tag = (node.tagName || '').toLowerCase();
          if (tag === 'iframe') return true;
          if (adSignals.some(s => id.includes(s) || cls.includes(s))) return true;
          node = node.parentElement;
        }
        return false;
      }

      function add(rgb, score, source) {
        if (!rgb) return;
        const [r,g,b] = rgb;
        if (isBoring(r,g,b)) return;
        results.push({ color:rgb, score, source });
      }

      // 1. theme-color meta — highest brand signal
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) add(resolveColor(themeMeta.getAttribute('content')), 120, 'theme-color');

      const tileColor = document.querySelector('meta[name="msapplication-TileColor"]');
      if (tileColor) add(resolveColor(tileColor.getAttribute('content')), 100, 'tile-color');

      // 2. CSS custom properties on :root
      try {
        for (const sheet of document.styleSheets) {
          // Only process same-origin or successfully readable sheets
          let rules;
          try { rules = sheet.cssRules; } catch { continue; }
          if (!rules) continue;
          for (const rule of rules) {
            const sel = rule.selectorText || '';
            if (sel === ':root' || sel === 'html' || sel === 'body') {
              const text = rule.cssText || '';
              for (const match of text.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g)) {
                const name = match[1].toLowerCase();
                const val  = match[2].trim();
                const isColorVar = ['color','brand','primary','secondary','accent','theme','main','cta','highlight'].some(k=>name.includes(k));
                if (!isColorVar) continue;
                const rgb = resolveColor(val);
                if (rgb) add(rgb, 90, 'css-var:'+name);
              }
            }
          }
        }
      } catch {}

      // 3. Buttons & CTAs — must NOT be in ad containers
      const btnSelectors = 'button:not([disabled]), [role="button"], input[type="submit"], input[type="button"], a[class*="btn"], a[class*="button"], a[class*="cta"]';
      const buttons = [...document.querySelectorAll(btnSelectors)].filter(el => !isAdOrThirdParty(el));
      const btnBgMap = {};
      buttons.forEach(btn => {
        const s = getComputedStyle(btn);
        const rgb = parseColor(s.backgroundColor);
        if (rgb && !isBoring(...rgb)) {
          const key = rgb.join(',');
          btnBgMap[key] = (btnBgMap[key]||0) + 1;
        }
      });
      Object.entries(btnBgMap).sort((a,b)=>b[1]-a[1]).slice(0,2).forEach(([k,count]) => {
        add(k.split(',').map(Number), 75 + Math.min(count, 10), 'button-bg');
      });

      // 4. Links — filter ad containers, get most common color
      const links = [...document.querySelectorAll('a[href]')].filter(el => !isAdOrThirdParty(el));
      const linkMap = {};
      links.forEach(a => {
        const rgb = parseColor(getComputedStyle(a).color);
        if (rgb && !isBoring(...rgb)) {
          const key = rgb.join(',');
          linkMap[key] = (linkMap[key]||0) + 1;
        }
      });
      Object.entries(linkMap).sort((a,b)=>b[1]-a[1]).slice(0,2).forEach(([k,count]) => {
        add(k.split(',').map(Number), 55 + Math.min(count, 15), 'link-color');
      });

      // 5. Navigation / header — filter ad containers
      const navEls = [...document.querySelectorAll('nav, header, [role="navigation"], [role="banner"]')].filter(el => !isAdOrThirdParty(el));
      navEls.slice(0, 3).forEach(el => {
        const s = getComputedStyle(el);
        add(parseColor(s.backgroundColor), 65, 'nav-bg');
        add(parseColor(s.color), 35, 'nav-text');
      });

      // 6. SVG fills — only within main content, not ad containers
      const mainEl = document.querySelector('main, [role="main"], #main, .main, article') || document.body;
      const svgEls = [...mainEl.querySelectorAll('svg [fill], svg [stroke]')].filter(el => !isAdOrThirdParty(el));
      svgEls.slice(0, 30).forEach(el => {
        const fill   = el.getAttribute('fill');
        const stroke = el.getAttribute('stroke');
        if (fill && fill!=='none' && fill!=='currentColor' && fill!=='transparent') add(resolveColor(fill), 60, 'svg-fill');
        if (stroke && stroke!=='none' && stroke!=='currentColor') add(resolveColor(stroke), 35, 'svg-stroke');
      });

      // 7. Headings
      [...document.querySelectorAll('h1, h2')].filter(el => !isAdOrThirdParty(el)).slice(0,5).forEach(h => {
        add(parseColor(getComputedStyle(h).color), 45, 'heading');
      });

      return results;
    });

    // Screenshot fallback
    const pngBuffer = await page.screenshot({ type: 'png', fullPage: false });
    const { data: rawRgba } = await sharp(pngBuffer).resize(320,220,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const ssColors = screenshotKmeans(rawRgba, 6).map(sc => ({ color:sc.color, score: Math.min(sc.score*0.25, 30), source:'screenshot' }));

    const all = [...cssColors, ...ssColors];
    const deduped = dedup(all, 45);
    const top5 = deduped.slice(0, 5);

    console.log('[extractor] sources:', top5.map(e=>e.source));
    return top5.map(e => rgbToHex(...e.color));
  } finally {
    await browser.close();
  }
}
