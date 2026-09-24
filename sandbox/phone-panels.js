// Phone layout only: the original main.js owns every visual and simulation setting.
if (document.documentElement.classList.contains('phone-ui')) {
  const root = document.documentElement;
  const caption = document.createElement('div'); caption.className = 'phone-caption';
  const title = document.createElement('strong'); title.textContent = 'Harbor Ring · 8 architectures';
  const status = document.createElement('span'); status.textContent = 'Loading original Astra graphics…';
  const revision = document.createElement('small'); revision.textContent = 'Astra e44ede0 · 75.717 s 8-car lap';
  caption.append(title, status, revision);
  const bar = document.createElement('nav'); bar.className = 'phone-bar'; bar.setAttribute('aria-label', 'Phone race controls');
  const close = document.createElement('button'); close.className = 'phone-close'; close.textContent = 'Close';
  function panel(name) {
    root.dataset.phonePanel = root.dataset.phonePanel === name ? '' : name;
    for (const button of bar.children) if (button.dataset.panel) button.setAttribute('aria-pressed', String(button.dataset.panel === root.dataset.phonePanel));
  }
  for (const [label, name, original] of [['Camera', '', 'btn-camera-mode'], ['Timing', 'timing'], ['Telemetry', 'telemetry'], ['Debug', 'debug'], ['Menu', '', 'btn-race-menu']]) {
    const button = document.createElement('button'); button.textContent = label; button.dataset.panel = name;
    button.onclick = () => { if (name) panel(name); else { root.dataset.phonePanel = ''; document.getElementById(original)?.click(); } };
    bar.append(button);
  }
  close.onclick = () => panel(root.dataset.phonePanel);
  document.body.append(caption, bar, close);
  const source = document.getElementById('status-line');
  if (source) {
    const update = () => { status.textContent = source.textContent; };
    new MutationObserver(update).observe(source, { childList: true, characterData: true, subtree: true }); update();
  }
}
