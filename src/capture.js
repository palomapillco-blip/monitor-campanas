// Visita una home con Playwright: cierra pop-ups, hace scroll lento, captura y extrae texto.

const CLOSE_TEXT = /^(aceptar|acepto|aceptar todo|aceptar todas|aceptar cookies|entendido|de acuerdo|ok|continuar|cerrar|no,? gracias|ahora no|mas tarde|más tarde|omitir|x|×|✕)$/i;

const CLOSE_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#truste-consent-button',
  '.cookie-consent button',
  '[id*="cookie" i] button',
  '[class*="cookie" i] button',
  '[aria-label*="cerrar" i]',
  '[aria-label*="close" i]',
  '[title*="cerrar" i]',
  '[data-testid*="close" i]',
  '[class*="modal" i] [class*="close" i]',
  '[class*="popup" i] [class*="close" i]',
  '[class*="Popup" i] [class*="Close" i]',
  '[class*="dialog" i] [class*="close" i]',
  '.dy-lb-close',
  '.insider-opt-in-notification-button',
  '[class*="ins-close" i]',
  '#wps-overlay-close-button',
  '.andes-modal__close-button',
  '.cookie-consent-banner-opt-out__action--key-accept',
];

export async function dismissPopups(page) {
  let clicked = 0;
  for (const frame of page.frames()) {
    try {
      clicked += await frame.evaluate(
        ({ selectors, textSrc }) => {
          const textRe = new RegExp(textSrc, 'i');
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
          };
          let n = 0;
          const seen = new Set();
          const click = (el) => {
            if (seen.has(el) || !visible(el)) return;
            seen.add(el);
            // Nunca seguir links reales: solo cerrar cosas.
            const a = el.closest('a[href]');
            const href = a?.getAttribute('href') || '';
            if (a && href && !href.startsWith('#') && !href.startsWith('javascript')) return;
            try { el.click(); n++; } catch {}
          };
          for (const sel of selectors) {
            try { document.querySelectorAll(sel).forEach(click); } catch {}
          }
          document.querySelectorAll('button, [role="button"], a, span, div').forEach((el) => {
            if (el.children.length > 2) return;
            const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
            if (t.length <= 20 && textRe.test(t)) {
              // Evita links de navegación: solo dentro de overlays/banners fijos o botones.
              const inOverlay = el.closest('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="popup" i], [class*="cookie" i], [class*="consent" i], [class*="overlay" i], [class*="banner" i]');
              if (inOverlay || el.tagName === 'BUTTON') click(el);
            }
          });
          return n;
        },
        { selectors: CLOSE_SELECTORS, textSrc: CLOSE_TEXT.source }
      );
    } catch {}
  }
  await page.keyboard.press('Escape').catch(() => {});
  return clicked;
}

// Quita overlays fijos que tapan la pantalla (modales que no se dejaron cerrar).
export async function removeBlockingOverlays(page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    let removed = 0;
    for (const el of document.querySelectorAll('body *')) {
      const st = getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      const z = Number(st.zIndex) || 0;
      const coversScreen = r.width >= vw * 0.6 && r.height >= vh * 0.5;
      const looksModal = el.matches('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="popup" i], [class*="overlay" i], [class*="backdrop" i], [id*="modal" i], [id*="popup" i]');
      if (coversScreen && (z >= 100 || looksModal) && el.tagName !== 'HEADER') {
        el.remove();
        removed++;
      }
    }
    // Los modales suelen bloquear el scroll con overflow: hidden. Se vuelve a "visible" (no "auto"): con html y
    // body en auto y una altura fija (p. ej. Hiraoka), el body pasa a ser una caja con scroll propio y la página
    // queda de una pantalla de alto.
    if (removed) {
      document.documentElement.style.setProperty('overflow', 'visible', 'important');
      document.body.style.setProperty('overflow', 'visible', 'important');
    }
    return removed;
  });
}

async function slowScroll(page, maxY) {
  await page.evaluate(async (maxY) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let y = 0;
    while (y < Math.min(maxY, document.body.scrollHeight)) {
      y += 350;
      window.scrollTo(0, y);
      await sleep(300);
    }
    await sleep(800);
    window.scrollTo(0, 0);
  }, maxY);
}

function looksBlocked(title, text, url = '') {
  if (/account-verification|captcha|challenge|\/blocked/i.test(url)) return true;
  const t = `${title} ${text.slice(0, 600)}`.toLowerCase();
  return /access denied|acceso denegado|attention required|just a moment|verify you are human|are you a robot|captcha|request blocked|forbidden|pardon our interruption|found\. redirecting to/.test(t);
}

export async function extractContent(page) {
  return page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none';
    };

    const visibleText = clean(document.body?.innerText || '');

    const alts = [];
    document.querySelectorAll('img[alt], img[title], [role="img"][aria-label], picture img').forEach((img) => {
      const v = clean(img.getAttribute('alt') || img.getAttribute('title') || img.getAttribute('aria-label'));
      if (v && v.length > 2 && !alts.includes(v)) alts.push(v);
    });

    const bannerSel = [
      '[class*="banner" i]', '[class*="hero" i]', '[class*="carousel" i]', '[class*="slider" i]', '[class*="swiper" i]',
      '[class*="slick" i]', '[class*="promo" i]', '[class*="campaign" i]', '[class*="countdown" i]', '[class*="timer" i]',
      '[id*="banner" i]', '[id*="hero" i]', '[id*="carousel" i]',
    ].join(',');
    const banners = [];
    const pushBanner = (v) => {
      v = clean(v);
      if (v && v.length > 3 && v.length < 600 && !banners.includes(v)) banners.push(v);
    };
    document.querySelectorAll(bannerSel).forEach((el) => {
      // Solo hojas "razonables": evita contenedores gigantes que repiten todo el texto.
      if (el.querySelectorAll(bannerSel).length > 3) return;
      pushBanner(el.innerText);
      el.querySelectorAll('img').forEach((img) => pushBanner(img.alt || img.title));
      el.querySelectorAll('a[title], a[aria-label]').forEach((a) => pushBanner(a.title || a.getAttribute('aria-label')));
    });

    const countdowns = [...document.querySelectorAll('[class*="countdown" i], [class*="timer" i], [class*="contador" i], [id*="countdown" i]')]
      .filter(isVisible)
      .map((el) => clean(el.innerText))
      .filter((t) => /\d/.test(t))
      .slice(0, 10);

    return {
      title: document.title,
      visibleText,
      alts: alts.slice(0, 400),
      banners: banners.slice(0, 200),
      countdowns,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
}

// Versión invertida y en grises del hero: el OCR lee mal texto blanco sobre fondos de color.
async function ocrVariant(page) {
  try {
    await page.addStyleTag({ content: 'html { filter: invert(1) grayscale(1) contrast(1.4) !important; }' });
    await page.waitForTimeout(300);
    const buf = await page.screenshot({ type: 'png', scale: 'device' });
    await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('invert(1) grayscale(1)') && s.remove()));
    return buf;
  } catch {
    return null;
  }
}

// Si un clic nos sacó de la home, volvemos.
async function dismissAndStay(page, homeUrl) {
  const n = await dismissPopups(page);
  await page.waitForTimeout(600);
  if (new URL(page.url()).pathname !== new URL(homeUrl).pathname) {
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  return n;
}

export async function captureSite(context, site, settings, paths) {
  const page = await context.newPage();
  const t0 = Date.now();
  const result = { status: 'ok', popupsClosed: 0, overlaysRemoved: 0 };
  try {
    const resp = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: settings.navigationTimeoutMs });
    result.httpStatus = resp?.status() ?? null;
    result.finalUrl = page.url();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(settings.settleMs);

    const home = page.url();
    result.popupsClosed += await dismissAndStay(page, home);
    await page.waitForTimeout(1200);
    result.popupsClosed += await dismissAndStay(page, home);

    await slowScroll(page, settings.fullPageMaxHeight + 1500);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    // Algunos pop-ups aparecen al hacer scroll o con retraso.
    result.popupsClosed += await dismissAndStay(page, home);
    await page.waitForTimeout(800);
    result.overlaysRemoved = await removeBlockingOverlays(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);

    await page.screenshot({ path: paths.hero, type: 'jpeg', quality: settings.jpegQuality, scale: 'css' });
    // Para OCR: misma vista a resolución 2x (el contexto usa deviceScaleFactor 2), mejora mucho el texto de banners.
    const hero = await page.screenshot({ type: 'png', scale: 'device' });
    const heroInverted = await ocrVariant(page);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const clipH = Math.max(settings.viewport.height, Math.min(height, settings.fullPageMaxHeight));
    await page.screenshot({
      path: paths.full,
      type: 'jpeg',
      quality: settings.jpegQuality,
      fullPage: true,
      scale: 'css',
      clip: { x: 0, y: 0, width: settings.viewport.width, height: clipH },
    });

    const content = await extractContent(page);
    if (looksBlocked(content.title, content.visibleText, page.url()) || (result.httpStatus && result.httpStatus >= 400)) {
      result.status = 'blocked';
    } else if (content.visibleText.length < 200) {
      result.status = 'partial';
    }
    Object.assign(result, { content, ocrImages: [hero, heroInverted].filter(Boolean) });
  } catch (err) {
    result.status = 'error';
    result.error = String(err?.message || err).split('\n')[0];
    // Intenta igual una captura de lo que haya.
    try {
      await page.screenshot({ path: paths.hero, type: 'jpeg', quality: settings.jpegQuality, scale: 'css' });
      result.ocrImages = [await page.screenshot({ type: 'png', scale: 'device' })];
      result.content = await extractContent(page);
    } catch {}
  } finally {
    result.durationMs = Date.now() - t0;
    await page.close().catch(() => {});
  }
  return result;
}
