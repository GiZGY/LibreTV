(() => {
  if (!window.OPENSTREAM_LIVE) return;
  const nativeFetch = window.fetch.bind(window);
  let pending, scriptTask;
  function loadWidget() {
    if (window.turnstile) return Promise.resolve();
    if (!scriptTask) scriptTask = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {script.remove();reject(new Error('安全验证加载超时，请重试'));}, 12000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => {clearTimeout(timer);resolve();};
      script.onerror = () => {clearTimeout(timer);script.remove();reject(new Error('无法加载安全验证，请检查网络后重试'));};
      document.head.append(script);
    }).catch(error => {scriptTask = null;throw error;});
    return scriptTask;
  }
  async function challenge(config) {
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'human-dialog';
    dialog.setAttribute('aria-label', '安全验证');
    dialog.innerHTML = '<h2 class="human-title" tabindex="-1" autofocus>安全验证</h2><button class="human-close" type="button" aria-label="关闭安全验证"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><p>验证后即可继续浏览。</p><div class="human-widget"></div><p role="status" class="human-message"></p>';
    document.body.append(dialog);dialog.showModal();
    // Focus the dialog context, not an action the user has not selected.
    dialog.querySelector('.human-title').focus({preventScroll:true});
    let widget, disposed = false;
    const cancelled = new Promise((_, reject) => {
      const cancel = event => {event?.preventDefault();reject(new Error('验证已取消，可以点击重试继续'));};
      dialog.addEventListener('cancel', cancel, {once:true});
      dialog.querySelector('button').onclick = cancel;
    });
    try {
      await Promise.race([loadWidget(), cancelled]);
      await Promise.race([new Promise(resolve => {
        widget = window.turnstile.render(dialog.querySelector('.human-widget'), {
          sitekey:config.siteKey, action:'browse', theme:document.documentElement.dataset.theme === 'dark' ? 'dark' : 'auto',
          size:window.matchMedia('(max-width: 400px)').matches ? 'compact' : 'flexible',
          callback:async token => {
            if (disposed) return;
            const message = dialog.querySelector('.human-message');message.textContent = '正在确认…';
            try {
              const response = await nativeFetch('/api/security/human', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}), signal:AbortSignal.timeout(10000)});
              const result = await response.json();
              if (!response.ok || !result.verified) throw new Error(result.message || '验证未通过，请重试');
              resolve();
            } catch (error) {if (!disposed) {message.textContent = error.message;window.turnstile.reset(widget);}}
          },
          'error-callback':() => {dialog.querySelector('.human-message').textContent = '验证暂不可用，请稍后重试';},
          'expired-callback':() => window.turnstile.reset(widget)
        });
      }), cancelled]);
    } finally {
      disposed = true;
      if (widget !== undefined) window.turnstile?.remove(widget);
      dialog.close();dialog.remove();previous?.focus?.({preventScroll:true});
    }
  }
  function ensure() {
    if (!pending) pending = (async () => {
      const response = await nativeFetch('/api/security/human', {credentials:'same-origin', signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error('安全验证暂不可用，请稍后重试');
      const config = await response.json();
      if (!config.enabled || config.verified) return;
      if (!config.ready) throw new Error('安全验证暂不可用，请稍后重试');
      await challenge(config);
    })().finally(() => {pending = null;});
    return pending;
  }
  // Only retry our read-only endpoints, never media hosts or arbitrary POSTs.
  window.fetch = async (input, options) => {
    const response = await nativeFetch(input, options);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const method = options?.method || input?.method || 'GET';
    if (response.status !== 428 || method !== 'GET' || url.origin !== location.origin || !/^\/(proxy\/|api\/(catalog\/|tvbox\/|proxy\/))/.test(url.pathname)) return response;
    await response.body?.cancel();
    await ensure();
    return nativeFetch(input, options);
  };
  window.HumanAccess = {ensure};
})();
