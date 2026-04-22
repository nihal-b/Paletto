import './style.css';

// ─── DOM refs ──────────────────────────────────────────────
const form       = document.getElementById('extract-form');
const urlInput   = document.getElementById('url-input');
const extractBtn = document.getElementById('extract-btn');
const inputGroup = document.getElementById('input-group');
const errorBar   = document.getElementById('error-bar');
const divider    = document.getElementById('divider');
const results    = document.getElementById('results');
const swatches   = document.getElementById('swatches');
const resultsUrl = document.getElementById('results-url');
const copyAllBtn = document.getElementById('copy-all-btn');
const toast      = document.getElementById('toast');
const toastMsg   = document.getElementById('toast-msg');
const chips      = document.querySelectorAll('.chip');
const exportCss      = document.getElementById('export-css');
const exportTailwind = document.getElementById('export-tailwind');
const exportJson     = document.getElementById('export-json');

let currentColors = [];

// ─── Color Naming (HSL-based, no external dep) ────────────
function hexToRgb(hex) {
  const h = hex.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function rgbToHsl(r, g, b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0, s=0, l=(max+min)/2;
  if (max!==min) {
    const d=max-min;
    s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return [h,s,l];
}

function getColorName(hex) {
  const [r,g,b] = hexToRgb(hex);
  const [h,s,l] = rgbToHsl(r,g,b);
  const hd = h*360;
  if (l < 0.12) return 'Pitch Black';
  if (l > 0.93) return 'Near White';
  if (s < 0.1)  { return l<0.35?'Charcoal':l<0.55?'Slate Gray':l<0.72?'Silver':'Pale Gray'; }
  const hueMap = [
    [12,'Crimson'],[22,'Red'],[35,'Vermilion'],[50,'Orange'],
    [65,'Amber'],[80,'Gold'],[100,'Yellow'],[150,'Lime'],
    [160,'Green'],[175,'Emerald'],[190,'Teal'],[210,'Cyan'],
    [235,'Sky Blue'],[260,'Blue'],[280,'Indigo'],[300,'Violet'],
    [325,'Purple'],[340,'Fuchsia'],[355,'Rose'],[360,'Crimson'],
  ];
  let base = 'Red';
  for (const [deg,name] of hueMap) { if (hd <= deg) { base=name; break; } }
  if (s>0.8&&l>0.6)  return `Bright ${base}`;
  if (s>0.7&&l<0.38) return `Deep ${base}`;
  if (s<0.4)         return `Muted ${base}`;
  if (l>0.72)        return `Light ${base}`;
  if (l<0.28)        return `Dark ${base}`;
  return base;
}

// ─── 21st-style toast ─────────────────────────────────────
let toastTimer;
function showToast(msg, type='copy') {
  toastMsg.textContent = msg;
  toast.className = `toast toast--${type}`;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
}

// ─── Error ────────────────────────────────────────────────
function showError(msg) {
  errorBar.textContent = msg;
  errorBar.classList.add('visible');
  inputGroup.classList.add('error');
  setTimeout(clearError, 6000);
}
function clearError() {
  errorBar.classList.remove('visible');
  errorBar.textContent = '';
  inputGroup.classList.remove('error');
}

// ─── Loading ──────────────────────────────────────────────
function setLoading(on) {
  extractBtn.classList.toggle('loading', on);
  extractBtn.disabled = on;
  urlInput.disabled = on;
}

// ─── Skeleton ─────────────────────────────────────────────
function showSkeletons() {
  swatches.innerHTML = Array.from({length:5}).map(()=>'<div class="swatch-skeleton"></div>').join('');
  divider.removeAttribute('hidden');
  results.removeAttribute('hidden');
}

// ─── Render palette ───────────────────────────────────────
function renderPalette(colors, url) {
  currentColors = colors;
  try {
    const u = new URL(url);
    resultsUrl.textContent = u.hostname + (u.pathname!=='/'?u.pathname:'');
  } catch { resultsUrl.textContent = url; }

  swatches.innerHTML = colors.map((hex) => `
    <div class="swatch" role="listitem" tabindex="0" aria-label="${hex}" data-hex="${hex}">
      <div class="swatch__color" style="
        background:${hex};
        box-shadow:0 8px 24px ${hex}44, 0 2px 8px ${hex}22;
      "></div>
      <div class="swatch__info">
        <span class="swatch__name">${getColorName(hex)}</span>
        <span class="swatch__hex">${hex}</span>
      </div>
    </div>
  `).join('');

  swatches.querySelectorAll('.swatch').forEach(el => {
    const copyFn = () => {
      navigator.clipboard.writeText(el.dataset.hex).then(() => {
        showToast(`Copied ${el.dataset.hex}`, 'copy');
        // Flash checkmark
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 1200);
      });
    };
    el.addEventListener('click', copyFn);
    el.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();copyFn();} });
  });
}

// ─── Extraction ───────────────────────────────────────────
async function handleExtract(rawUrl) {
  clearError();
  const url = rawUrl.trim();
  if (!url) { showError('Please enter a URL.'); urlInput.focus(); return; }
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try { new URL(normalized); } catch {
    showError("That doesn't look like a valid URL. Try https://stripe.com");
    return;
  }

  setLoading(true);
  showSkeletons();

  try {
    const res = await fetch('/api/extract', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({url:normalized}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'Extraction failed.');
    renderPalette(data.colors, normalized);
  } catch(err) {
    divider.setAttribute('hidden','');
    results.setAttribute('hidden','');
    showError(err.message||'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
  }
}

// ─── Export helpers ───────────────────────────────────────
function copyText(text, label) {
  navigator.clipboard.writeText(text).then(() => showToast(label, 'copy'));
}

exportCss.addEventListener('click', () => {
  if (!currentColors.length) return;
  const vars = currentColors.map((c,i)=>`  --color-${i+1}: ${c};`).join('\n');
  copyText(`:root {\n${vars}\n}`, 'Copied CSS variables');
});

exportTailwind.addEventListener('click', () => {
  if (!currentColors.length) return;
  const obj = currentColors.reduce((acc,c,i)=>{acc[`brand-${i+1}`]=c;return acc;}, {});
  copyText(JSON.stringify({colors:obj}, null, 2), 'Copied Tailwind config');
});

exportJson.addEventListener('click', () => {
  if (!currentColors.length) return;
  copyText(JSON.stringify(currentColors, null, 2), 'Copied JSON array');
});

copyAllBtn.addEventListener('click', () => {
  if (!currentColors.length) return;
  navigator.clipboard.writeText(currentColors.join(', ')).then(() => showToast('Copied all colors!', 'copy'));
});

// ─── Form & chips ─────────────────────────────────────────
form.addEventListener('submit', e => { e.preventDefault(); handleExtract(urlInput.value); });
chips.forEach(chip => chip.addEventListener('click', () => {
  urlInput.value = chip.dataset.url;
  handleExtract(chip.dataset.url);
}));
urlInput.addEventListener('input', clearError);
