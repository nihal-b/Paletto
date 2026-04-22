# 🎨 Paletto — Brand Color Extractor

Extract the **true brand colors** from any website — not just pixel averages.

Paletto uses a hybrid approach: it inspects the page's CSS properties, theme-color meta tags, button backgrounds, link colors, SVG fills, and navigation styles to find the **actual brand palette**.

---

## 🚀 Quick Start

```bash
cd /home/nihal-b/Desktop/Workspace/Personal/brand-color-extractor
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧠 How It Works

Unlike screenshot-only tools that return muddy gray averages, Paletto uses a **3-step hybrid extraction**:

### Step 1 — Visit
A headless Chrome browser (Puppeteer) navigates to the URL exactly like a real user — full CSS rendering, JavaScript execution, web fonts, and animations.

### Step 2 — Analyze CSS
Inside the page, we inspect **9 different sources** of brand color:

| Source | Priority | Why It Matters |
|---|---|---|
| `<meta name="theme-color">` | ⭐⭐⭐⭐⭐ | Explicit brand declaration by the site |
| CSS custom properties (`:root`) | ⭐⭐⭐⭐ | `--brand-color`, `--primary`, `--accent` |
| Button backgrounds | ⭐⭐⭐⭐ | CTAs use the brand's most important color |
| Navigation backgrounds | ⭐⭐⭐ | Often branded header/nav bars |
| SVG fills (logos, icons) | ⭐⭐⭐ | Logo colors = brand identity |
| Heading text colors | ⭐⭐⭐ | H1-H3 often use brand colors |
| Link colors | ⭐⭐⭐ | `<a>` colors are deliberate brand choices |
| Body/main backgrounds | ⭐⭐ | Secondary signal |
| Screenshot k-means | ⭐ | Fallback for sites with minimal CSS |

### Step 3 — Score & Deduplicate
All extracted colors are scored by brand-relevance, deduplicated (colors within distance 45 are merged), and the top 5 unique colors are returned.

---

## 📁 Project Structure

```
brand-color-extractor/
├── server/
│   ├── index.js           # Express API (POST /api/extract)
│   └── extractor.js       # Hybrid CSS + screenshot color extraction
├── src/
│   ├── main.js            # Frontend logic
│   └── style.css          # Dark glassmorphism design system
├── index.html             # App entry (hero, card, how-it-works)
├── vite.config.js         # Proxy /api → Express:3001
└── package.json           # npm run dev = Express + Vite concurrently
```

## 🛠️ Tech Stack

- **Frontend:** Vite (vanilla JS), Inter + JetBrains Mono fonts
- **Backend:** Node.js, Express
- **Automation:** Puppeteer (headless Chrome)
- **Image Processing:** Sharp (raw RGBA pixel extraction)
- **Algorithm:** Hybrid CSS inspection + k-means clustering

## 📝 Usage

1. Enter a URL (e.g., `stripe.com`) — `https://` is auto-added
2. Click **Extract Palette** or use a quick pick chip
3. View the 5 brand colors with colored swatches
4. Click any swatch to **copy its HEX** code
5. Click **Copy All** to grab the entire palette
