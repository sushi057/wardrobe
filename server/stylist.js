// Stylist chat: turns Meta AI's free-text answer into an intro plus shoppable pieces.
const CATS = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'];

/** Meta wraps outbound links in l.meta.ai/?u=<real url>; unwrap them. */
export function realUrl(href) {
  try {
    const u = new URL(href);
    if (u.hostname === 'l.meta.ai' || u.hostname === 'l.facebook.com') {
      const t = u.searchParams.get('u');
      if (t) return new URL(t).toString();
    }
    return u.toString();
  } catch { return null; }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function categoryOf(text) {
  const t = String(text || '').toLowerCase();
  for (const c of CATS) if (t.startsWith(c) || new RegExp(`\\b${c}\\b`).test(t)) return c;
  if (/\b(shirt|tee|t-shirt|sweater|hoodie|knit|polo)\b/.test(t)) return 'top';
  if (/\b(trouser|pant|jean|short|skirt|chino)\b/.test(t)) return 'bottom';
  if (/\b(jacket|coat|vest|blazer|overshirt)\b/.test(t)) return 'outerwear';
  if (/\b(shoe|loafer|sneaker|boot)\b/.test(t)) return 'shoes';
  return 'accessory';
}

/** Prompt sent to Meta AI. The strict format is what parseAnswer relies on. */
export function stylistPrompt(request, closet = []) {
  const owned = closet.length ? `\nPieces I already own (suggest things that go with them): ${closet.map((i) => i.name || i.category).slice(0, 25).join(', ')}.` : '';
  return [
    `You are my personal stylist. ${request.trim()}`,
    owned,
    'Use current fashion trends and the current season/weather where I live.',
    'Reply with one or two sentences of overview, then exactly 4 numbered pieces. For every piece use this layout:',
    '1. <piece name>',
    'Category: <one of top, bottom, dress, outerwear, shoes, accessory>',
    'Why it works: <one line>',
    'Buy: <product name> on <shop name> (direct product page link, from a shop that ships to my country)',
    'Finish with one line on how to wear them together.',
  ].filter(Boolean).join('\n');
}

export function parseAnswer(row) {
  const text = String(row.text || '').replace(/\r/g, '');
  let links = [];
  try { links = JSON.parse(row.links || '[]'); } catch { /* ignore */ }
  links = links.map((l) => ({ url: realUrl(l.href), text: l.text || '' })).filter((l) => l.url);

  const lines = text.split('\n').map((l) => l.trim());
  const isProgress = (l) => /^(show thinking|sources)$/i.test(l) || /^(I'm|I am|Searching|Checking|Pulling|Switching|Looking)\b/i.test(l);
  // A piece is anchored on its "Category:" line; its name is the nearest non-empty line above (numbering stripped).
  const anchors = [];
  lines.forEach((l, i) => { if (/^Category:/i.test(l)) anchors.push(i); });
  if (!anchors.length) {
    return { intro: lines.filter((l) => l && !isProgress(l)).join('\n').slice(0, 1200), pieces: [], outro: '' };
  }
  const nameIdx = anchors.map((a) => { let j = a - 1; while (j >= 0 && !lines[j]) j -= 1; return j; });
  const intro = lines.slice(0, Math.max(0, nameIdx[0])).filter((l) => l && !isProgress(l)).join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 1200);

  const pieces = [];
  let lastBuy = -1;
  anchors.forEach((a, k) => {
    const end = k + 1 < anchors.length ? nameIdx[k + 1] : lines.length;
    const block = lines.slice(nameIdx[k], end);
    const get = (re) => { const l = block.find((x) => re.test(x)); return l ? l.replace(re, '').trim() : ''; };
    const name = (block[0] || '').replace(/^\d+[.)]\s+/, '').replace(/[*_#]/g, '').slice(0, 120);
    const buy = get(/^Buy:\s*/i);
    const buyAt = block.findIndex((x) => /^Buy:/i.test(x));
    if (buyAt >= 0) lastBuy = nameIdx[k] + buyAt;
    const inline = /https?:\/\/[^\s)>\]]+/.exec(buy)?.[0] ?? null;
    const label = buy.replace(/\(?https?:\/\/\S+\)?/g, '').trim();
    const nb = norm(label);
    const byText = links.find((l) => l.text && nb.includes(norm(l.text).slice(0, 40)));
    const url = inline || byText?.url || links[pieces.length]?.url || null;
    const shopMatch = /\bon\s+([^-–—(]+?)(?:\s+[-–—(]|\s*$)/i.exec(label);
    pieces.push({
      name,
      category: categoryOf(get(/^Category:\s*/i) || name),
      why: get(/^Why it works:\s*/i).slice(0, 240),
      product: label.replace(/\s+on\s+[^-–—(]+(?:\s+[-–—(].*)?$/i, '').slice(0, 140),
      shop: shopMatch ? shopMatch[1].trim().slice(0, 60) : '',
      url,
    });
  });
  const outro = lines.slice(lastBuy + 1).filter((l) => l && !isProgress(l)).join(' ').slice(0, 300);
  return { intro, pieces: pieces.slice(0, 8), outro };
}
