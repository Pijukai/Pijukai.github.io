/* Same-site links swap the page content in place instead of reloading the page,
   so the background music and rain keep playing without a break.
   The address bar, Back / Forward and page titles behave as usual; anything unusual
   (other sites, PDFs, new tabs, a failed fetch) falls back to a normal page load.
   Pages announce themselves with two events: "page:leave" (stop timers) and "page:enter". */
(() => {
  // pages opened straight from disk (file://) can't be fetched: links then load normally
  if (location.protocol === 'file:' || !window.fetch || !history.pushState || !window.DOMParser) return;
  const SHARED = /(^|\/)(music|router)\.js$/;          // shared scripts: already running, never re-run
  history.scrollRestoration = 'manual';
  let latest = null;

  const isPage = u => u.origin === location.origin && (/\.html?$/.test(u.pathname) || u.pathname.endsWith('/'));

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const u = new URL(a.getAttribute('href'), location.href);
    if (!isPage(u)) return;
    if (u.pathname === location.pathname && u.hash) return;     // anchor on the same page
    e.preventDefault();
    go(u.href, true);
  });
  addEventListener('popstate', e => go(location.href, false, (e.state && e.state.y) || 0));

  async function go(href, push, y = 0) {
    const me = latest = {};
    let html;
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(res.status);
      html = await res.text();
    } catch { location.href = href; return; }
    if (me !== latest) return;                         // a newer click took over
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (push) { history.replaceState({ y: scrollY }, ''); history.pushState({ y: 0 }, '', href); }

    // styles first, so the new page never flashes unstyled
    const old = [...document.head.querySelectorAll('link[rel=stylesheet], style')];
    const next = [...doc.head.querySelectorAll('link[rel=stylesheet], style')].map(n => {
      if (n.tagName === 'STYLE') { const s = document.createElement('style'); s.textContent = n.textContent; return s; }
      const url = new URL(n.getAttribute('href'), href).href;
      return old.find(o => o.tagName === 'LINK' && o.href === url) ||
        Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url });
    });
    await Promise.all(next.filter(n => n.tagName === 'LINK' && !n.isConnected)
      .map(l => new Promise(done => { l.onload = l.onerror = done; document.head.appendChild(l); })));
    if (me !== latest) return;

    document.dispatchEvent(new Event('page:leave'));
    old.forEach(n => { if (!next.includes(n)) n.remove(); });
    next.forEach(n => { if (!n.isConnected) document.head.appendChild(n); });
    document.title = doc.title;
    for (const name of ['description', 'theme-color']) {
      const from = doc.querySelector(`meta[name="${name}"]`), to = document.querySelector(`meta[name="${name}"]`);
      if (from && to) to.content = from.content;
    }

    const body = document.adoptNode(doc.body);
    document.body.replaceWith(body);
    for (const s of body.querySelectorAll('script')) {          // run the page's own scripts
      const src = s.getAttribute('src');
      if (src && SHARED.test(src)) { s.remove(); continue; }
      const run = document.createElement('script');
      if (src) run.src = new URL(src, href).href; else run.textContent = s.textContent;
      s.replaceWith(run);
    }
    scrollTo(0, y);
    const main = body.querySelector('main');
    if (push && main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
    document.dispatchEvent(new Event('page:enter'));
  }
})();
