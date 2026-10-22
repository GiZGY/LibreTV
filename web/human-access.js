(() => {
  if (!window.OPENSTREAM_LIVE) return;
  const nativeFetch = window.fetch.bind(window);
  let pending, scriptTask, configTask, configUntil = 0;
  function configuration(force = false) {
    if (force || Date.now() >= configUntil) configTask = null;
    if (!configTask) {
      configUntil = Date.now() + 60000;
      configTask = nativeFetch('/api/security/human', {credentials:'same-origin', signal:AbortSignal.timeout(8000)})
        .then(response => {
          if (!response.ok) throw new Error('安全验证暂不可用，请稍后重试');
          return response.json();
        }).catch(error => {configTask = null;throw error;});
    }
    return configTask;
  }
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
    dialog.setAttribute('closedby', 'none');
    dialog.innerHTML = '<h2 class="human-title" tabindex="-1" autofocus>安全验证</h2><p>验证后即可继续浏览。</p><div class="human-widget"></div><p role="status" class="human-message"></p>';
    document.body.append(dialog);dialog.showModal();
    // Focus the dialog context, not an action the user has not selected.
    dialog.querySelector('.human-title').focus({preventScroll:true});
    let widget, watchdog, attempt = 0, disposed = false;
    // A failed challenge must not expose a seemingly usable protected application.
    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();}
    });
    try {
      for (;;) {
      const currentAttempt = ++attempt;
      try {
      config = await configuration();
      if (!config.enabled || config.verified) break;
      if (!config.ready) throw new Error('安全验证暂不可用，请稍后重试');
      await loadWidget();
      await new Promise((resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error('验证连接较慢，请重试')), 45000);
        widget = window.turnstile.render(dialog.querySelector('.human-widget'), {
          sitekey:config.siteKey, action:'browse', theme:document.documentElement.dataset.theme === 'dark' ? 'dark' : 'auto',
          size:window.matchMedia('(max-width: 400px)').matches ? 'compact' : 'flexible',
          callback:async token => {
            if (disposed || currentAttempt !== attempt) return;
            clearTimeout(watchdog);
            const message = dialog.querySelector('.human-message');message.textContent = '正在确认…';
            try {
              const response = await nativeFetch('/api/security/human', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}), signal:AbortSignal.timeout(10000)});
              const result = await response.json();
              if (!response.ok || !result.verified) throw new Error(result.message || '验证未通过，请重试');
              if (disposed || currentAttempt !== attempt) return;
              // Verify that this browser actually retained the session cookie.
              const session = await configuration(true);
              if (!session.verified) throw new Error('验证尚未生效，请重试');
              if (disposed || currentAttempt !== attempt) return;
              configTask = Promise.resolve(session);
              configUntil = Date.now() + 60000;
              resolve();
            } catch (error) {if (!disposed && currentAttempt === attempt) reject(error);}
          },
          'error-callback':() => {reject(new Error('验证连接失败，请重试'));},
          'timeout-callback':() => reject(new Error('验证已超时，请重试')),
          'expired-callback':() => window.turnstile.reset(widget)
        });
      });
      break;
      } catch (error) {
        attempt++;
        clearTimeout(watchdog);
        if (widget !== undefined) {window.turnstile?.remove(widget);widget = undefined;}
        const message = dialog.querySelector('.human-message');
        message.textContent = error.message || '验证连接失败，请重试';
        const retry = document.createElement('button');
        retry.type = 'button';retry.className = 'secondary';retry.textContent = '重新验证';
        message.append(retry);
        await new Promise(resolve => {retry.onclick = () => {configTask = null;resolve();};});
        message.textContent = '正在连接验证服务…';
      }
      }
    } finally {
      clearTimeout(watchdog);
      disposed = true;
      if (widget !== undefined) window.turnstile?.remove(widget);
      dialog.close();dialog.remove();previous?.focus?.({preventScroll:true});
    }
  }
  function ensure(force = false) {
    if (!pending) pending = (async () => {
      let config;
      try {config = await configuration(force);} catch {}
      if (config && (!config.enabled || config.verified)) return;
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
    await ensure(true);
    return nativeFetch(input, options);
  };
  window.HumanAccess = {ensure};
  // Prepare the widget while the rest of the application starts, without opening a dialog.
  configuration().then(config => {
    if (config.enabled && config.ready && !config.verified) return loadWidget();
  }).catch(() => {});
})();
