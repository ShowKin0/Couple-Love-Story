// ====== API ======
async function api(method, url, body) {
  const opts = { method, headers: {}, signal: AbortSignal.timeout(35_000) };
  if (body) opts.headers['Content-Type'] = 'application/json', opts.body = JSON.stringify(body);
  try {
    const r = await fetch(url, opts);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `请求失败 (${r.status})`);
    return d;
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('请求超时，请稍后重试');
    throw error;
  }
}
function $(s) { return document.querySelector(s); }
function $$(s) { return document.querySelectorAll(s); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function localTime() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function localDateInputValue(value = localTime()) { return value.replace(' ', 'T').slice(0, 16); }
const DIARY_IMAGE_MARKER = '\uFFFC';

// ====== 全局设置 ======
let appSettings = null;

function isImg(v) { return typeof v === 'string' && (v.startsWith('/uploads/') || v.startsWith('data:')); }
function avaHtml(v) { return isImg(v) ? `<img src="${v}" class="avatar-img">` : v; }
function avaSm(v) { return isImg(v) ? `<img src="${v}" class="avatar-img-sm">` : v; }

async function loadSettings() {
  try {
    const s = await api('GET', '/api/settings');
    appSettings = s;
    applySettings(s);
  } catch {}
}

function applySettings(s) {
  const brand = $('.nav-brand');
  if (brand) brand.textContent = `💕 ${s.hisNickname}和${s.herNickname}的爱情故事`;
  const title = $('.hero-title');
  if (title) title.textContent = `${s.hisNickname}和${s.herNickname}的爱情故事`;
  const hisDiary = $('.diary-his .diary-name');
  if (hisDiary) hisDiary.textContent = `💙 ${s.hisNickname}的日记`;
  const herDiary = $('.diary-her .diary-name');
  if (herDiary) herDiary.textContent = `💗 ${s.herNickname}的日记`;
  const aLeft = $('.avatar-left');
  if (aLeft) aLeft.innerHTML = avaHtml(s.hisAvatar);
  const aRight = $('.avatar-right');
  if (aRight) aRight.innerHTML = avaHtml(s.herAvatar);
  const hisBtn = document.querySelector('.chat-space-btn[data-space="his"]');
  if (hisBtn) hisBtn.innerHTML = `${avaSm(s.hisAvatar)} ${s.hisNickname}`;
  const herBtn = document.querySelector('.chat-space-btn[data-space="her"]');
  if (herBtn) herBtn.innerHTML = `${avaSm(s.herAvatar)} ${s.herNickname}`;
  SPACE_NAMES.his = s.hisNickname;
  SPACE_NAMES.her = s.herNickname;
  const footer = document.querySelector('.footer p');
  if (footer) footer.textContent = `Made with 💖 — 2026 ${s.hisNickname}和${s.herNickname}的爱情故事`;
  updateLoveDays();
}

// ====== 设置弹窗 ======
function initSettings() {
  const overlay = $('#settingsOverlay');
  if (!overlay) return;

  // 头像暂存数据
  const pendingAvatar = { his: null, her: null };
  let aiSettingsToken = null;

  function setAiProviderLocked(locked) {
    const lock = $('#aiProviderLock');
    const form = $('#aiProviderForm');
    if (lock) lock.hidden = !locked;
    if (form) form.hidden = locked;
  }

  function closeSettings() {
    overlay.style.display = 'none';
    // 每次重新进入中转设置都重新验证，token 只在当前设置弹窗内存活。
    aiSettingsToken = null;
    setAiProviderLocked(true);
  }

  async function loadAiProvider() {
    if (!aiSettingsToken) return;
    try {
      const data = await api('GET', `/api/ai/provider?token=${encodeURIComponent(aiSettingsToken)}`);
      $('#settingsAiEndpoint').value = data.endpoint || '';
      $('#settingsAiModel').value = data.model || '';
      $('#settingsAiKey').value = '';
      $('#settingsAiKeyHint').textContent = data.apiKeyMasked
        ? `当前密钥：${data.apiKeyMasked}（留空保持不变） · 来源：${data.source === 'custom' ? '第三方中转' : '.env'}`
        : '当前未配置可用的 AI 密钥';
      setAiProviderLocked(false);
    } catch (error) {
      aiSettingsToken = null;
      setAiProviderLocked(true);
      alert(error?.message || '中转配置加载失败');
    }
  }

  async function unlockAiProvider() {
    const password = await showPasswordPrompt('解锁第三方中转设置', '请输入男生日记密码');
    if (password === null) return;
    if (!password) return;
    try {
      const data = await api('POST', '/api/ai/provider/verify', { password });
      aiSettingsToken = data.token;
      await loadAiProvider();
    } catch (error) {
      alert(error?.message || '密码错误');
    }
  }

  // 头像预览更新
  function updatePreview(person) {
    const preview = document.getElementById(`settings${person === 'his' ? 'His' : 'Her'}AvatarPreview`);
    if (!preview) return;
    const data = pendingAvatar[person] || (appSettings ? appSettings[person === 'his' ? 'hisAvatar' : 'herAvatar'] : null) || (person === 'his' ? '👦' : '👧');
    preview.innerHTML = isImg(data) ? `<img src="${data}" class="avatar-preview-img">` : data;
  }

  // 头像上传绑定
  document.querySelectorAll('.settings-avatar-box').forEach(box => {
    const person = box.dataset.person;
    const input = box.querySelector('.settings-avatar-input');
    box.querySelector('.settings-avatar-btn').addEventListener('click', () => input.click());
    box.querySelector('.settings-avatar-reset').addEventListener('click', () => {
      pendingAvatar[person] = null;
      // 标记恢复默认，保存时用 emoji
      box.dataset.reset = '1';
      updatePreview(person);
    });
    input.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        pendingAvatar[person] = r.result;
        delete box.dataset.reset;
        updatePreview(person);
      };
      r.readAsDataURL(f);
      e.target.value = '';
    });
  });

  function openSettings() {
    if (appSettings) {
      $('#settingsHisName').value = appSettings.hisNickname;
      $('#settingsHerName').value = appSettings.herNickname;
      $('#settingsLoveDate').value = appSettings.loveDate || '2026-04-06';
      $('#settingsAiInstruction').value = appSettings.aiInstruction || '';
      pendingAvatar.his = null;
      pendingAvatar.her = null;
      document.querySelectorAll('.settings-avatar-box').forEach(b => delete b.dataset.reset);
      updatePreview('his');
      updatePreview('her');
    }
    aiSettingsToken = null;
    setAiProviderLocked(true);
    overlay.style.display = 'flex';
  }

  $$('[data-open-settings]').forEach(button => button.addEventListener('click', openSettings));

  $('#settingsCancel').addEventListener('click', closeSettings);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSettings(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.style.display !== 'none') closeSettings(); });

  const aiProviderUnlockButton = $('#aiProviderUnlock');
  const aiProviderSaveButton = $('#settingsAiProviderSave');
  const aiProviderResetButton = $('#settingsAiProviderReset');
  if (aiProviderUnlockButton) aiProviderUnlockButton.addEventListener('click', unlockAiProvider);
  if (aiProviderSaveButton) aiProviderSaveButton.addEventListener('click', async () => {
    if (!aiSettingsToken) return unlockAiProvider();
    const endpoint = $('#settingsAiEndpoint').value.trim();
    const model = $('#settingsAiModel').value.trim();
    const apiKey = $('#settingsAiKey').value.trim();
    try {
      const data = await api('PUT', '/api/ai/provider', { token: aiSettingsToken, endpoint, model, apiKey });
      $('#settingsAiKey').value = '';
      $('#settingsAiKeyHint').textContent = data.provider.apiKeyMasked
        ? `当前密钥：${data.provider.apiKeyMasked}（留空保持不变） · 来源：第三方中转`
        : '当前未配置可用的 AI 密钥';
      alert('第三方中转配置已保存');
    } catch (error) {
      if (/(401|403|需要男生日记密码)/.test(String(error?.message || ''))) {
        aiSettingsToken = null;
        setAiProviderLocked(true);
      }
      alert(error?.message || '中转配置保存失败');
    }
  });
  if (aiProviderResetButton) aiProviderResetButton.addEventListener('click', async () => {
    if (!aiSettingsToken) return unlockAiProvider();
    if (!await showConfirm('清除第三方中转配置，改用 .env 中的 AI 设置？')) return;
    try {
      const data = await api('PUT', '/api/ai/provider', { token: aiSettingsToken, clear: true });
      $('#settingsAiEndpoint').value = data.provider.endpoint || '';
      $('#settingsAiModel').value = data.provider.model || '';
      $('#settingsAiKey').value = '';
      $('#settingsAiKeyHint').textContent = data.provider.apiKeyMasked
        ? `当前密钥：${data.provider.apiKeyMasked}（来源：.env）`
        : '当前未配置可用的 AI 密钥';
      alert('已改用 .env 配置');
    } catch (error) {
      alert(error?.message || '恢复 .env 配置失败');
    }
  });

  $('#settingsSave').addEventListener('click', async () => {
    const hisName = $('#settingsHisName').value.trim() || '男生';
    const herName = $('#settingsHerName').value.trim() || '女生';
    const loveDate = $('#settingsLoveDate').value || '2026-04-06';
    const aiInstruction = $('#settingsAiInstruction').value.trim();
    const body = { hisNickname: hisName, herNickname: herName, loveDate, aiInstruction };

    // 头像：如果有新上传的图片传 data，重置则传 emoji，否则保持原值
    const hisBox = document.querySelector('.settings-avatar-box[data-person="his"]');
    const herBox = document.querySelector('.settings-avatar-box[data-person="her"]');
    if (hisBox.dataset.reset) body.hisAvatar = '👦';
    else if (pendingAvatar.his) body.hisAvatarData = pendingAvatar.his;
    if (herBox.dataset.reset) body.herAvatar = '👧';
    else if (pendingAvatar.her) body.herAvatarData = pendingAvatar.her;

    try {
      const res = await api('PUT', '/api/settings', body);
      appSettings = res.settings;
      applySettings(res.settings);
      updateLoveDays();
      closeSettings();
    } catch { alert('保存失败'); }
  });
}

// ====== 密码系统 ======
const TOKENS = { his: null, her: null };
const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_TIMERS = { his: null, her: null };
function cacheDiaryToken(person, token) {
  TOKENS[person] = token;
  if (TOKEN_TIMERS[person]) clearTimeout(TOKEN_TIMERS[person]);
  TOKEN_TIMERS[person] = setTimeout(() => {
    if (TOKENS[person] === token) { TOKENS[person] = null; handleDiaryAuthExpired(person); }
  }, TOKEN_TTL_MS);
}

async function checkStatus(person) {
  try {
    const data = await api('GET', `/api/diary/${person}/status`);
    const lockEl = $(`#diary${cap(person)}Lock`);
    if (lockEl.classList.contains('unlocked')) return;

    const pwMode = $(`#diary${cap(person)}PwMode`);
    const setupMode = $(`#diary${cap(person)}SetupMode`);
    if (data.individualSet) {
      pwMode.style.display = 'block';
      setupMode.style.display = 'none';
    } else {
      pwMode.style.display = 'none';
      setupMode.style.display = 'block';
    }
  } catch {}
}

// 滚动到日记区域时刷新状态
function initStatusOnScroll() {
  const diarySec = document.getElementById('diary');
  if (!diarySec) return;
  let checked = false;
  const ob = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !checked) {
      checked = true;
      checkStatus('his');
      checkStatus('her');
    }
  }, { threshold: 0.3 });
  ob.observe(diarySec);
}


async function setPw(person) {
  const input = $(`#diary${cap(person)}NewPwd`);
  const pwd = input.value.trim();
  if (pwd.length < 4) { alert('密码至少4位'); return; }
  try {
    const d = await api('POST', `/api/diary/${person}/set-password`, { password: pwd });
    if (d.token) cacheDiaryToken(person, d.token);
    alert('密码设置成功！');
    checkStatus(person);
  } catch (e) { alert(e.message); }
}

async function verifyPw(person) {
  const input = $(`#diary${cap(person)}Pwd`);
  const pwd = input.value.trim();
  if (!pwd) return;
  try {
    const d = await api('POST', `/api/diary/${person}/verify`, { password: pwd });
    cacheDiaryToken(person, d.token);
    unlockDiary(person);
  } catch { alert('密码错误'); }
}

function unlockDiary(person) {
  $(`#diary${cap(person)}Lock`).classList.add('unlocked');
  $(`#diary${cap(person)}Content`).classList.add('unlocked');
  loadDiary(person);
}

function handleDiaryAuthExpired(person) {
  TOKENS[person] = null;
  if (TOKEN_TIMERS[person]) { clearTimeout(TOKEN_TIMERS[person]); TOKEN_TIMERS[person] = null; }
  const lock = $(`#diary${cap(person)}Lock`);
  const content = $(`#diary${cap(person)}Content`);
  if (lock) lock.classList.remove('unlocked');
  if (content) content.classList.remove('unlocked');
  checkStatus(person);
}

// ====== 自定义对话框 ======
const dialogContainer = document.getElementById('dialogContainer') || (() => {
  const d = document.createElement('div'); d.id = 'dialogContainer'; d.className = 'dialog-overlay';
  d.innerHTML = `<div class="dialog-box">
    <div class="dialog-title" id="dt">确认</div>
    <div class="dialog-body" id="db"></div>
    <div class="dialog-actions" id="da"></div>
  </div>`;
  document.body.appendChild(d);
  d.addEventListener('click', e => { if (e.target === d) d.style.display = 'none'; });
  return d;
})();

function showConfirm(msg) {
  if (dialogContainer.style.display === 'flex') return Promise.resolve(false);
  return new Promise(resolve => {
    const box = dialogContainer;
    document.getElementById('dt').textContent = '确认';
    document.getElementById('db').innerHTML = `<p style="margin:0;font-size:0.95rem;line-height:1.5">${esc(msg)}</p>`;
    document.getElementById('da').innerHTML =
      `<button class="dlg-btn dlg-primary" id="dy">确认</button>
       <button class="dlg-btn dlg-cancel" id="dn">取消</button>`;
    box.style.display = 'flex';
    document.getElementById('dy').onclick = () => { box.style.display = 'none'; resolve(true); };
    document.getElementById('dn').onclick = () => { box.style.display = 'none'; resolve(false); };
  });
}

function showPrompt(title, placeholder, defaultValue = '') {
  if (dialogContainer.style.display === 'flex') return Promise.resolve(null);
  return new Promise(resolve => {
    const box = dialogContainer;
    document.getElementById('dt').textContent = title || '请输入';
    document.getElementById('db').innerHTML =
      `<input type="text" class="dlg-input" id="di" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}">`;
    document.getElementById('da').innerHTML =
      `<button class="dlg-btn dlg-primary" id="dy">确定</button>
       <button class="dlg-btn dlg-cancel" id="dn">取消</button>`;
    box.style.display = 'flex';
    const inp = document.getElementById('di');
    setTimeout(() => inp.focus(), 100);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('dy').click(); });
    document.getElementById('dy').onclick = () => { box.style.display = 'none'; resolve(inp.value.trim()); };
    document.getElementById('dn').onclick = () => { box.style.display = 'none'; resolve(null); };
  });
}

function showPasswordPrompt(title, placeholder) {
  if (dialogContainer.style.display === 'flex') return Promise.resolve(null);
  return new Promise(resolve => {
    const box = dialogContainer;
    document.getElementById('dt').textContent = title || '请输入密码';
    document.getElementById('db').innerHTML =
      `<input type="password" class="dlg-input" id="di" placeholder="${esc(placeholder)}" autocomplete="current-password">`;
    document.getElementById('da').innerHTML =
      `<button class="dlg-btn dlg-primary" id="dy">确认</button>
       <button class="dlg-btn dlg-cancel" id="dn">取消</button>`;
    box.style.display = 'flex';
    const input = document.getElementById('di');
    setTimeout(() => input.focus(), 100);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') document.getElementById('dy').click(); });
    document.getElementById('dy').onclick = () => { box.style.display = 'none'; resolve(input.value.trim()); };
    document.getElementById('dn').onclick = () => { box.style.display = 'none'; resolve(null); };
  });
}

// ====== 音频播放器（带进度条）=====
function renderContent(content, entryId) {
  try {
    const data = JSON.parse(content);
    let html = '';
    if (data.title) html += `<div class="diary-render-title">${esc(data.title)}</div>`;
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    if (blocks.length) {
      let imageIndex = 0;
      blocks.forEach(block => {
        if (block?.type === 'image' && block.data) {
          html += `<span class="media-item" data-eid="${entryId}" data-type="image" data-idx="${imageIndex++}"><img src="${esc(block.data)}" loading="lazy"><button class="media-item-del" title="删除图片">×</button></span>`;
        } else if (block?.type === 'text' && block.value) html += `<div class="diary-render-text">${esc(block.value).replace(/\n/g, '<br>')}</div>`;
      });
    } else if (data.text) html += `<div class="diary-render-text">${esc(data.text).replace(/\n/g, '<br>')}</div>`;
    if (data.images && !blocks.length) data.images.forEach((img, i) => {
      html += `<span class="media-item" data-eid="${entryId}" data-type="image" data-idx="${i}"><img src="${esc(img)}" loading="lazy"><button class="media-item-del" title="删除图片">×</button></span>`;
    });
    if (data.audio) data.audio.forEach((a, i) => {
      const isObj = typeof a === 'object' && a.data;
      const type = isObj ? a.type : 'record';
      const src = isObj ? a.data : a;
      const icon = type === 'upload' ? '📁' : '🎤';
      const label = type === 'upload' ? '音频' : '录音';
      const name = (isObj ? a.name : null) || label;
      html += `<span class="media-item" data-eid="${entryId}" data-type="audio" data-idx="${i}">`;
      html += `<span class="diary-audio-player ${type}" data-src="${esc(src)}">
        <span class="ap-btn">▶</span>
        <span class="ap-info">${icon} ${esc(name)}</span>
        <span class="ap-bar-wrap"><span class="ap-bar"><span class="ap-fill"></span></span></span>
        <span class="ap-time">00:00</span>
      </span>`;
      html += `</span>`;
    });
    return html || '(空)';
  } catch {
    return esc(content);
  }
}

// 初始化音频播放器（事件委托，防连点+可拖动进度条）
function initAudioPlayers() {
  document.querySelectorAll('.diary-list').forEach(list => {
    const playerClick = e => {
      const player = e.target.closest('.diary-audio-player');
      if (!player || !player.dataset.src) return;
      // 点击进度条不触发播放/暂停
      if (e.target.closest('.ap-bar-wrap') || e.target.closest('.ap-bar')) return;

      const src = player.dataset.src;

      // 正在播放则暂停
      if (player._audio && player._playing) {
        player._audio.pause();
        player._playing = false;
        player.querySelector('.ap-btn').textContent = '▶';
        return;
      }

      // 如果已创建过音频但暂停了，恢复播放
      if (player._audio && !player._playing) {
        player._audio.play();
        player._playing = true;
        player.querySelector('.ap-btn').textContent = '⏸';
        return;
      }

      // 防止连点：正在加载中
      if (player._loading) return;
      player._loading = true;
      player.querySelector('.ap-btn').textContent = '⏳';

      const audio = new Audio(src);
      const barFill = player.querySelector('.ap-fill');
      const timeEl = player.querySelector('.ap-time');
      const barWrap = player.querySelector('.ap-bar-wrap');

      audio.ontimeupdate = () => {
        if (!audio.duration) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        barFill.style.width = pct + '%';
        timeEl.textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
      };

      audio.onloadedmetadata = () => {
        player._loading = false;
        player._playing = true;
        player.querySelector('.ap-btn').textContent = '⏸';
        timeEl.textContent = '00:00 / ' + formatTime(audio.duration);
        audio.play();
      };

      audio.onended = () => {
        player._playing = false;
        player.querySelector('.ap-btn').textContent = '▶';
        barFill.style.width = '0%';
        timeEl.textContent = formatTime(audio.duration || 0);
      };

      audio.onerror = () => {
        player._loading = false;
        player._playing = false;
        player.querySelector('.ap-btn').textContent = '⚠️';
      };

      // 拖动/点击进度条（同时支持鼠标和触屏）
      let seeking = false;
      const seek = (ev) => {
        if (!audio.duration) return;
        const rect = barWrap.getBoundingClientRect();
        const clientX = ev.clientX || (ev.touches && ev.touches[0].clientX);
        if (!clientX) return;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        audio.currentTime = pct * audio.duration;
      };

      barWrap.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        seeking = true;
        seek(ev);
        barWrap.setPointerCapture(ev.pointerId);
      });
      barWrap.addEventListener('pointermove', (ev) => {
        if (!seeking) return;
        ev.stopPropagation();
        seek(ev);
      });
      barWrap.addEventListener('pointerup', (ev) => {
        seeking = false;
        ev.stopPropagation();
        barWrap.releasePointerCapture(ev.pointerId);
      });
      barWrap.addEventListener('pointercancel', () => { seeking = false; });

      player._audio = audio;
    };
    list.addEventListener('click', playerClick);
  });
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

// 构建日记内容 JSON
function buildContent(person) {
  const title = $(`#diary${cap(person)}Title`)?.value.trim() || '未命名日记';
  const input = $(`#diary${cap(person)}Input`);
  const rawText = input?.value || '';
  const mediaData = diaryMedia[person] || { images: [], audio: [] };
  if (!rawText.replaceAll(DIARY_IMAGE_MARKER, '').trim() && !mediaData.images.length && !mediaData.audio.length) return null;
  const blocks = [];
  const orderedImages = [];
  const markerCount = [...rawText].filter(ch => ch === DIARY_IMAGE_MARKER).length;
  let text = '', chunk = '', imageIndex = 0;
  for (const ch of rawText) {
    if (ch !== DIARY_IMAGE_MARKER) { chunk += ch; continue; }
    if (chunk) { blocks.push({ type: 'text', value: chunk }); text += chunk; chunk = ''; }
    const data = mediaData.images[imageIndex++];
    if (data) { blocks.push({ type: 'image', data }); orderedImages.push(data); }
  }
  if (chunk) { blocks.push({ type: 'text', value: chunk }); text += chunk; }
  // 兼容旧版本“图片作为附件”格式；新编辑器只保存正文中实际存在的图片。
  if (markerCount === 0) mediaData.images.forEach(data => { blocks.push({ type: 'image', data }); orderedImages.push(data); });
  return JSON.stringify({ title, text: text.trim(), blocks, images: orderedImages, audio: mediaData.audio });
}

function diaryTextAndImages(data) {
  const images = [], parts = [];
  const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
  if (blocks.length) {
    blocks.forEach(block => {
      if (block?.type === 'image' && block.data) { parts.push(DIARY_IMAGE_MARKER); images.push(block.data); }
      else if (block?.type === 'text') parts.push(block.value || '');
    });
  } else {
    parts.push(data?.text || '');
    (data?.images || []).forEach(img => { parts.push(DIARY_IMAGE_MARKER); images.push(img); });
  }
  return { text: parts.join(''), images };
}

function diaryDateValue(person) {
  const input = $(`#diary${cap(person)}Date`);
  const value = input ? input.value.trim() : '';
  return value ? value.replace('T', ' ') : localTime();
}

function validDiaryDate(value) {
  return /^\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2})?$/.test(value);
}

// 清空日记表单
function resetDiaryForm(person) {
  const date = $(`#diary${cap(person)}Date`);
  if (date) date.value = localDateInputValue();
  const title = $(`#diary${cap(person)}Title`);
  if (title) title.value = '';
  const textInput = $(`#diary${cap(person)}Input`);
  textInput.value = '';
  textInput.dispatchEvent(new Event('input', { bubbles: true }));
  $(`#diary${cap(person)}MediaPreview`).innerHTML = '';
  diaryMedia[person] = { images: [], audio: [] };
}

// 多媒体数据存储
const diaryMedia = { his: { images: [], audio: [] }, her: { images: [], audio: [] } };
const diaryFilter = { his: '', her: '' };

async function loadDiary(person) {
  const token = TOKENS[person];
  if (!token) return;
  try {
    const entries = await api('GET', `/api/diary/${person}/entries?token=${token}`);
    const filterDate = diaryFilter[person];
    const filtered = filterDate
      ? entries.filter(e => e.time.startsWith(filterDate))
      : entries;
    const list = $(`#diary${cap(person)}List`);
    list.innerHTML = filtered.map(e =>
      `<div class="diary-entry" data-id="${e.id}">
        <div class="de-time">${esc(e.time)}</div>
        <div class="de-content">${renderContent(e.content, e.id)}</div>
        <button class="de-edit" data-p="${person}" data-id="${e.id}">✏️</button>
        <button class="de-del" data-p="${person}" data-id="${e.id}">🗑</button>
      </div>`
    ).join('');
    list.querySelectorAll('.de-del').forEach(b => b.addEventListener('click', async () => {
      if (!await showConfirm('确定删除？')) return;
      await api('DELETE', `/api/diary/${b.dataset.p}/entries/${b.dataset.id}?token=${TOKENS[b.dataset.p]}`);
      loadDiary(b.dataset.p);
    }));
    list.querySelectorAll('.de-edit').forEach(b => b.addEventListener('click', () => editEntry(b.dataset.p, b.dataset.id)));
    // 媒体单独删除
    list.querySelectorAll('.media-item-del').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const item = btn.closest('.media-item');
        const eid = item.dataset.eid, type = item.dataset.type, idx = +item.dataset.idx;
        if (!await showConfirm(`确定删除此${type === 'image' ? '图片' : '音频'}？`)) return;
        try {
          const entries = await api('GET', `/api/diary/${person}/entries?token=${TOKENS[person]}`);
          const entry = entries.find(en => en.id === eid);
          if (!entry) return;
          const data = JSON.parse(entry.content);
          if (type === 'image') {
            data.images = Array.isArray(data.images) ? data.images : [];
            data.images.splice(idx, 1);
            if (Array.isArray(data.blocks)) {
              let imageNo = -1;
              data.blocks = data.blocks.filter(block => {
                if (block?.type !== 'image') return true;
                imageNo++;
                return imageNo !== idx;
              });
            }
          } else data.audio.splice(idx, 1);
          await api('PUT', `/api/diary/${person}/entries/${eid}`, { token: TOKENS[person], content: JSON.stringify(data), time: entry.time.replace(' ✏️', '') });
          loadDiary(person);
        } catch { alert('删除失败'); }
      });
    });
    initAudioPlayers();
  } catch (error) {
    const list = $(`#diary${cap(person)}List`);
    if (!list) return;
    if (/(401|403|未登录|无权限)/.test(String(error?.message || ''))) {
      handleDiaryAuthExpired(person);
      list.innerHTML = '';
    } else {
      list.innerHTML = '<div class="diary-load-error">日记加载失败，请稍后重试</div>';
    }
  }
}

// 编辑日记
function renderEditMedia(editMedia, person, container) {
  if (!container) return;
  container.innerHTML = '';
  editMedia.images.forEach((img, i) => {
    const div = document.createElement('div');
    div.className = 'media-thumb';
    div.innerHTML = `<img src="${img}"><button class="media-del" data-idx="${i}">×</button>`;
    div.querySelector('.media-del').addEventListener('click', () => {
      const input = container.closest('.de-edit-area')?.querySelector('.de-edit-text') || $(`#diary${cap(person)}Input`);
      if (input) {
        const chars = [...input.value]; let seen = 0;
        for (let k = 0; k < chars.length; k++) if (chars[k] === DIARY_IMAGE_MARKER) { if (seen++ === i) { input.setRangeText('', k, k + 1, 'end'); break; } }
      }
      editMedia.images.splice(i, 1);
      renderEditMedia(editMedia, person, container);
    });
    container.appendChild(div);
  });
  editMedia.audio.forEach((a, i) => {
    const div = document.createElement('div');
    const isUpload = a && a.type === 'upload';
    const icon = isUpload ? '📁' : '🎤';
    const name = a.name || (isUpload ? '音频' : '录音');
    div.className = 'media-audio-tag';
    div.innerHTML = `${icon} <span class="audio-name">${esc(name)}</span> <button class="media-del" data-idx="${i}">×</button>`;
    div.querySelector('.media-del').addEventListener('click', () => {
      editMedia.audio.splice(i, 1);
      renderEditMedia(editMedia, person, container);
    });
    div.querySelector('.audio-name').addEventListener('click', async () => {
      const cur = editMedia.audio[i] ? editMedia.audio[i].name || '' : '';
      const nn = await showPrompt('重命名', '输入新名称', cur);
      if (nn && nn.trim()) { editMedia.audio[i].name = nn.trim(); renderEditMedia(editMedia, person, container); }
    });
    container.appendChild(div);
  });
}

async function editEntry(person, id) {
  const entry = $(`#diary${cap(person)}List`).querySelector(`.diary-entry[data-id="${id}"]`);
  const contentEl = entry.querySelector('.de-content');
  const originalHTML = contentEl.innerHTML;
  const origContent = await getEntryContent(person, id);
  const editorData = diaryTextAndImages(origContent);
  const editMedia = { images: [...editorData.images], audio: JSON.parse(JSON.stringify(origContent.audio || [])) };
  const legacyTitle = origContent.title || (origContent.text || '').split(/\r?\n/, 1)[0] || '';
  const legacyText = editorData.text || '';
  const legacyBody = origContent.title ? legacyText : (legacyText.includes('\n') ? legacyText.split(/\r?\n/).slice(1).join('\n') : legacyText);

  contentEl.innerHTML = `
    <div class="de-edit-area">
      <input type="text" class="input diary-title-input de-edit-title" value="${esc(legacyTitle)}" placeholder="标题" maxlength="80">
      <input type="datetime-local" class="input diary-date-input de-edit-date" value="${esc(localDateInputValue((entry.querySelector('.de-time')?.textContent || localTime()).replace(' ✏️', '')))}" aria-label="日记日期时间">
      <textarea class="input diary-input de-edit-text" rows="10">${esc(legacyBody)}</textarea>
      <div class="de-edit-media"></div>
      <div class="diary-toolbar">
        <button class="btn btn-sm ${person === 'his' ? 'btn-blue' : 'btn-pink'} de-edit-img">📷 图片</button>
        <button class="btn btn-sm ${person === 'his' ? 'btn-blue' : 'btn-pink'} de-edit-record">🎤 录音</button>
        <button class="btn btn-sm ${person === 'his' ? 'btn-blue' : 'btn-pink'} de-edit-audio">📁 上传音频</button>
      </div>
      <input type="file" class="de-edit-file-img" accept="image/*" hidden>
      <input type="file" class="de-edit-file-audio" accept="audio/*" hidden>
      <span class="diary-audio-timer de-edit-timer" style="display:none">⏺️ 00:00</span>
      <div class="de-edit-actions" style="margin-top:10px">
        <button class="btn btn-sm btn-blue de-edit-save">💾 保存</button>
        <button class="btn btn-sm de-edit-cancel" style="background:#eee">取消</button>
      </div>
    </div>`;

  // 渲染已有媒体
  const mediaContainer = contentEl.querySelector('.de-edit-media');
  renderEditMedia(editMedia, person, mediaContainer);

  // 图片上传
  const imgInput = contentEl.querySelector('.de-edit-file-img');
  contentEl.querySelector('.de-edit-img').addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', e => {
    Array.from(e.target.files).forEach(f => {
      const r = new FileReader();
      r.onload = () => {
        const input = contentEl.querySelector('.de-edit-text');
        const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
        const markerIndex = [...input.value.slice(0, start)].filter(ch => ch === DIARY_IMAGE_MARKER).length;
        input.setRangeText(DIARY_IMAGE_MARKER, start, end, 'end');
        editMedia.images.splice(markerIndex, 0, r.result);
        renderEditMedia(editMedia, person, mediaContainer);
      };
      r.readAsDataURL(f);
    });
    e.target.value = '';
  });

  // 录音
  let recorder = null, chunks = [], timer = null;
  const recordBtn = contentEl.querySelector('.de-edit-record');
  const timerEl = contentEl.querySelector('.de-edit-timer');
  recordBtn.addEventListener('click', async () => {
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm', audioBitsPerSecond: 128000 });
      chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const r = new FileReader();
        r.onload = () => { editMedia.audio.push({ type: 'record', data: r.result, name: '录音' }); renderEditMedia(editMedia, person, mediaContainer); };
        r.readAsDataURL(blob);
        clearInterval(timer);
        timerEl.style.display = 'none';
        recordBtn.textContent = '🎤 录音';
      };
      recorder.start();
      recordBtn.textContent = '⏹️ 停止';
      timerEl.style.display = 'inline';
      let sec = 0;
      timer = setInterval(() => { sec++; timerEl.textContent = `⏺️ ${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }, 1000);
    } catch { alert('无法访问麦克风'); }
  });

  // 上传音频
  const audioInput = contentEl.querySelector('.de-edit-file-audio');
  contentEl.querySelector('.de-edit-audio').addEventListener('click', () => audioInput.click());
  audioInput.addEventListener('change', e => {
    Array.from(e.target.files).forEach(f => {
      const r = new FileReader();
      r.onload = () => { editMedia.audio.push({ type: 'upload', data: r.result, name: '音频' }); renderEditMedia(editMedia, person, mediaContainer); };
      r.readAsDataURL(f);
    });
    e.target.value = '';
  });

  // 保存
  contentEl.querySelector('.de-edit-save').addEventListener('click', async () => {
    const title = contentEl.querySelector('.de-edit-title').value.trim() || '未命名日记';
    const input = contentEl.querySelector('.de-edit-text');
    const rawText = input.value || '';
    const text = rawText.replaceAll(DIARY_IMAGE_MARKER, '').trim();
    const markerCount = [...rawText].filter(ch => ch === DIARY_IMAGE_MARKER).length;
    if (!text && !markerCount && !editMedia.audio.length) { alert('内容不能为空'); return; }
    const time = (contentEl.querySelector('.de-edit-date').value.trim() || localDateInputValue()).replace('T', ' ');
    if (!validDiaryDate(time)) { alert('日期格式应为 YYYY-MM-DD HH:mm'); return; }
      const blocks = [], orderedImages = [];
      let chunk = '', plainText = '', imageIndex = 0;
      for (const ch of rawText) {
        if (ch !== DIARY_IMAGE_MARKER) { chunk += ch; continue; }
        if (chunk) { blocks.push({ type: 'text', value: chunk }); plainText += chunk; chunk = ''; }
        const data = editMedia.images[imageIndex++];
        if (data) { blocks.push({ type: 'image', data }); orderedImages.push(data); }
      }
      if (chunk) { blocks.push({ type: 'text', value: chunk }); plainText += chunk; }
      if (markerCount === 0) editMedia.images.forEach(data => { blocks.push({ type: 'image', data }); orderedImages.push(data); });
      const content = JSON.stringify({ title, text: plainText.trim(), blocks, images: orderedImages, audio: editMedia.audio });
    try {
      const d = await api('PUT', `/api/diary/${person}/entries/${id}`, { token: TOKENS[person], content, time });
      contentEl.innerHTML = renderContent(content, id);
      const te = entry.querySelector('.de-time');
      if (te) te.textContent = d.time;
    } catch (error) {
      if (/(401|403|未登录|无权限)/.test(String(error?.message || ''))) handleDiaryAuthExpired(person);
      alert(`保存失败：${error?.message || '请稍后重试'}`);
    }
  });

  // 取消
  contentEl.querySelector('.de-edit-cancel').addEventListener('click', () => { contentEl.innerHTML = originalHTML; });
}

// 获取原始条目内容
async function getEntryContent(person, id) {
  const entries = await api('GET', `/api/diary/${person}/entries?token=${TOKENS[person]}`);
  const entry = entries.find(e => e.id === id);
  if (!entry) return { text: '' };
  try { return JSON.parse(entry.content); } catch { return { text: entry.content }; }
}

async function addEntry(person) {
  const token = TOKENS[person];
  if (!token) { alert('请先解锁'); return; }
  const content = buildContent(person);
  if (!content) { alert('写点什么吧～'); return; }
  const time = diaryDateValue(person);
  if (!validDiaryDate(time)) { alert('日期格式应为 YYYY-MM-DD HH:mm'); return; }
  try {
    await api('POST', `/api/diary/${person}/entries`, { token, content, time });
    resetDiaryForm(person);
    loadDiary(person);
  } catch (error) {
    if (/(401|403|未登录|无权限)/.test(String(error?.message || ''))) handleDiaryAuthExpired(person);
    alert(`保存失败：${error?.message || '请稍后重试'}`);
  }
}

// ====== 日记多媒体 ======
function initDiaryMedia(person) {
  const textInput = $(`#diary${cap(person)}Input`);
  let previousDiaryText = textInput?.value || '';
  const insertImage = data => {
    if (!textInput || !data) return;
    const start = Math.max(0, textInput.selectionStart ?? textInput.value.length);
    const end = Math.max(start, textInput.selectionEnd ?? start);
    const before = textInput.value.slice(0, start);
    const markerIndex = [...before].filter(ch => ch === DIARY_IMAGE_MARKER).length;
    textInput.setRangeText(DIARY_IMAGE_MARKER, start, end, 'end');
    diaryMedia[person].images.splice(markerIndex, 0, data);
    renderMediaPreview(person);
  };
  textInput?.addEventListener('input', () => {
    const next = textInput.value || '';
    const oldMarkers = [...previousDiaryText].reduce((a, ch, i) => ch === DIARY_IMAGE_MARKER ? a.concat(i) : a, []);
    const newMarkers = [...next].reduce((a, ch, i) => ch === DIARY_IMAGE_MARKER ? a.concat(i) : a, []);
    if (oldMarkers.length > newMarkers.length) {
      let removed = 0;
      for (let i = 0; i < oldMarkers.length; i++) if (newMarkers[i - removed] !== oldMarkers[i]) { removed = 1; diaryMedia[person].images.splice(i, 1); break; }
      if (!removed && diaryMedia[person].images.length > newMarkers.length) diaryMedia[person].images.splice(newMarkers.length);
    }
    previousDiaryText = next;
  });
  // 图片上传
  const imgInput = $(`#diary${cap(person)}ImgInput`);
  const imgBtn = $(`#diary${cap(person)}Form`).querySelector('.diary-img-btn');
  imgBtn.addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', e => {
    Array.from(e.target.files).forEach(f => {
      const r = new FileReader();
      r.onload = () => {
        insertImage(r.result);
      };
      r.readAsDataURL(f);
    });
    e.target.value = '';
  });

  // 录音
  let mediaRecorder = null;
  let audioChunks = [];
  let audioTimer = null;
  const audioBtn = $(`#diary${cap(person)}Form`).querySelector('.diary-audio-btn');
  const timerEl = $(`#diary${cap(person)}AudioTimer`);

  audioBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm', audioBitsPerSecond: 128000 });
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        const r = new FileReader();
        r.onload = () => {
          diaryMedia[person].audio.push({ type: 'record', data: r.result, name: '录音' });
          renderMediaPreview(person);
        };
        r.readAsDataURL(blob);
        clearInterval(audioTimer);
        timerEl.style.display = 'none';
        audioBtn.textContent = '🎤 录音';
      };
      mediaRecorder.start();
      audioBtn.textContent = '⏹️ 停止';
      timerEl.style.display = 'inline';
      let sec = 0;
      audioTimer = setInterval(() => {
        sec++;
        timerEl.textContent = `⏺️ ${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
      }, 1000);
    } catch { alert('无法访问麦克风'); }
  });

  // 上传音频文件
  const audioUploadBtn = $(`#diary${cap(person)}Form`).querySelector('.diary-audio-upload-btn');
  const audioInput = $(`#diary${cap(person)}AudioInput`);
  audioUploadBtn.addEventListener('click', () => audioInput.click());
  audioInput.addEventListener('change', e => {
    Array.from(e.target.files).forEach(f => {
      const r = new FileReader();
      r.onload = () => {
        diaryMedia[person].audio.push({ type: 'upload', data: r.result, name: '音频' });
        renderMediaPreview(person);
      };
      r.readAsDataURL(f);
    });
    e.target.value = '';
  });
}

function renderMediaPreview(person) {
  const preview = $(`#diary${cap(person)}MediaPreview`);
  const data = diaryMedia[person];
  preview.innerHTML = '';
  data.images.forEach((img, i) => {
    const div = document.createElement('div');
    div.className = 'media-thumb';
    div.innerHTML = `<img src="${img}"><button class="media-del" data-type="image" data-idx="${i}">×</button>`;
    div.querySelector('.media-del').addEventListener('click', () => {
      const input = $(`#diary${cap(person)}Input`);
      let removedFromText = false;
      if (input) {
        const chars = [...input.value]; let seen = 0;
        for (let k = 0; k < chars.length; k++) if (chars[k] === DIARY_IMAGE_MARKER) { if (seen++ === i) { input.setRangeText('', k, k + 1, 'end'); removedFromText = true; break; } }
      }
      if (!removedFromText) data.images.splice(i, 1);
      renderMediaPreview(person);
    });
    preview.appendChild(div);
  });
  data.audio.forEach((a, i) => {
    const div = document.createElement('div');
    const isUpload = a && a.type === 'upload';
    const icon = isUpload ? '📁' : '🎤';
    const name = a.name || (isUpload ? '音频' : '录音');
    div.className = 'media-audio-tag';
    div.innerHTML = `${icon} <span class="audio-name">${esc(name)}</span> <button class="media-del">×</button>`;
    const delBtn = div.querySelector('.media-del');
    const nameSpan = div.querySelector('.audio-name');
    delBtn.addEventListener('click', () => {
      data.audio.splice(i, 1);
      renderMediaPreview(person);
    });
    nameSpan.addEventListener('click', async () => {
      const current = data.audio[i] ? data.audio[i].name || '' : '';
      const newName = await showPrompt('重命名', '输入新名称', current);
      if (newName && newName.trim()) {
        data.audio[i].name = newName.trim();
        renderMediaPreview(person);
      }
    });
    preview.appendChild(div);
  });
}

// ====== 倒计时 ======
function calcDaysUntilNext(dateStr) {
  const parts = dateStr.split('-');
  const m = +parts[1], d = +parts[2];
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), m - 1, d);
  let next;
  if (thisYear >= now) next = thisYear;
  else next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.ceil((next - now) / (1000 * 60 * 60 * 24));
}

function fmtCountdown(days) {
  if (days === 0) return '🎉 就是今天！';
  if (days < 0) return '';
  const months = Math.floor(days / 30);
  const remain = days % 30;
  let text = '';
  if (months > 0) text += months + '个月';
  text += remain + '天';
  return '⏰ 距下次还有 ' + text;
}

function updateHeroAnnouncements(items) {
  const container = $('#heroAnnounce');
  const upcoming = items
    .map(it => ({ ...it, days: calcDaysUntilNext(it.date) }))
    .filter(it => it.days >= 0 && it.days <= 10)
    .sort((a, b) => a.days - b.days);

  if (!upcoming.length) { container.innerHTML = ''; return; }

  container.innerHTML = upcoming.map(it => {
    const cls = it.days <= 3 ? 'hero-announce-item urgent' : 'hero-announce-item';
    const label = it.days === 0 ? '今天' : it.days + '天后';
    return `<div class="${cls}" data-timeline-id="${esc(it.id || '')}" role="button" tabindex="0"><span class="announce-title">${esc(it.title || '纪念日')}</span><span class="announce-countdown">${label} · 纪念日快乐</span><span class="announce-date">${esc(it.date)}</span></div>`;
  }).join('');
  container.querySelectorAll('[data-timeline-id]').forEach(card => {
    const focus = () => focusTimeline(card.dataset.timelineId);
    card.addEventListener('click', focus);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(); } });
  });
}

function focusTimeline(id) {
  const target = id ? Array.from(document.querySelectorAll('.tl-item')).find(item => item.dataset.id === id) : null;
  const section = target || document.getElementById('timeline');
  section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (target) {
    target.classList.add('focus-highlight');
    setTimeout(() => target.classList.remove('focus-highlight'), 1400);
  }
}

// 每日内容由服务端按上海时区缓存；页面只读取，不在客户端重复生成。
async function loadDailyInspiration() {
  const box = $('#dailyInspiration');
  if (!box) return;
  const textEl = box.querySelector('.daily-inspiration-text');
  try {
    const data = await api('GET', '/api/daily-inspiration');
    textEl.textContent = `“${data.text || '今天也要好好相爱'}”`;
  } catch {
    textEl.textContent = '“把普通的日子过得浪漫一点，就是爱情。”';
  }
}

// ====== 粒子 ======
function createParticles() {
  const c = $('#particles');
  const isMobile = window.innerWidth < 768;
  const count = isMobile ? 8 : 20;
  const emojis = ['🌸','💕','✨','💗','🩷','🦋','⭐','💖'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'particle';
    el.textContent = emojis[i % emojis.length];
    el.style.left = Math.random() * 100 + '%';
    el.style.animationDuration = (6 + Math.random() * 8) + 's';
    el.style.animationDelay = Math.random() * 10 + 's';
    el.style.fontSize = (isMobile ? 12 : 14) + Math.random() * (isMobile ? 12 : 18) + 'px';
    c.appendChild(el);
  }
}

// ====== 相恋天数 ======
function getLoveStart() {
  const d = (appSettings && appSettings.loveDate) || '2026-04-06';
  const p = d.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
function updateLoveDays() {
  const now = new Date();
  const diff = now - getLoveStart();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const el = $('#heroDays');
  if (el) el.innerHTML = `💕 我们在一起的第 <span class="days-num">${days}</span> 天`;
}

// ====== 时钟 ======
function updateClock() {
  const now = new Date();
  const wd = ['日','一','二','三','四','五','六'];
  if ($('#clockDate')) $('#clockDate').textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${wd[now.getDay()]}`;
  if ($('#clockTime')) $('#clockTime').textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  updateLoveDays();
}

// ====== 导航 ======
function initNav() {
  $('#navToggle').addEventListener('click', () => $('#navLinks').classList.toggle('open'));
  $$('[data-nav]').forEach(a => a.addEventListener('click', event => {
    $('#navLinks').classList.remove('open');
    const target = document.querySelector(a.getAttribute('href'));
    if (target && Math.abs(target.getBoundingClientRect().top) < 2) event.preventDefault();
  }));
  const ss = $$('section[id]'), ns = $$('[data-nav]');
  window.addEventListener('scroll', () => {
    let cur = '';
    ss.forEach(s => { if (scrollY >= s.offsetTop - 200) cur = s.id; });
    ns.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
  });
}

// ====== 滚动动画 ======
function initScrollAnim() {
  const ob = new IntersectionObserver(e => { e.forEach(x => { if (x.isIntersecting) x.target.classList.add('visible'); }); }, { threshold: 0.15 });
  document.querySelectorAll('.tl-item, .fade-up').forEach(el => ob.observe(el));
}

// ====== 时间线 ======
async function renderTimeline() {
  try {
    const items = await api('GET', '/api/timeline');
    const container = $('#timelineContainer');
    container.innerHTML = items.map(item => {
      const days = calcDaysUntilNext(item.date);
      const cdText = fmtCountdown(days);
      const urgentCls = days >= 0 && days <= 10 ? ' urgent' : '';
      return `<div class="tl-item" data-id="${esc(item.id)}"><div class="tl-dot"></div><div class="tl-card"><div class="tl-date">${esc(item.date)}</div><div class="tl-title">${esc(item.title || '纪念日')}</div>${item.desc ? `<div class="tl-desc">${esc(item.desc)}</div>` : ''}${cdText ? `<div class="tl-countdown${urgentCls}">${cdText}</div>` : ''}<button class="tl-del" data-id="${esc(item.id)}">🗑</button></div></div>`;
    }).join('');
    container.querySelectorAll('.tl-del').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await api('DELETE', `/api/timeline/${b.dataset.id}`);
      renderTimeline();
    }));
    initScrollAnim();
    updateHeroAnnouncements(items);
  } catch {}
}

function initTL() {
  $('#tlAddBtn').addEventListener('click', async () => {
    const date = $('#tlDate').value, title = $('#tlTitle').value.trim(), desc = $('#tlDesc').value.trim();
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date) || !title) { alert('请填写正确日期（YYYY-MM-DD）和标题～'); return; }
    try {
      await api('POST', '/api/timeline', { date, title, desc });
      renderTimeline();
      $('#tlDate').value = ''; $('#tlTitle').value = ''; $('#tlDesc').value = '';
    } catch { alert('添加失败'); }
  });
}

// ====== 照片墙 ======
async function renderPhotos() {
  try {
    const photos = await api('GET', '/api/photos');
    $('#photoGrid').innerHTML = photos.map(p => `<div class="photo-card" data-pid="${p.id}"><img src="${p.url}" alt="photo"></div>`).join('');
    $('#photoGrid').querySelectorAll('.photo-card').forEach(c => c.addEventListener('click', () => {
      $('#modalImg').src = c.querySelector('img').src;
      $('#photoModal')._pid = c.dataset.pid;
      $('#photoModal').classList.add('active');
      document.body.style.overflow = 'hidden';
    }));
  } catch {}
}

function initPhotos() {
  $('#photoInput').addEventListener('change', async e => {
    for (const f of Array.from(e.target.files)) {
      const r = new FileReader();
      r.onload = async () => { try { await api('POST', '/api/photos/upload', { data: r.result }); renderPhotos(); } catch {} };
      r.readAsDataURL(f);
    }
    e.target.value = '';
  });
  $('#modalClose').addEventListener('click', () => { $('#photoModal').classList.remove('active'); document.body.style.overflow = ''; });
  $('#photoModal').addEventListener('click', e => { if (e.target === $('#photoModal')) { $('#photoModal').classList.remove('active'); document.body.style.overflow = ''; } });
  $('#modalDel').addEventListener('click', async () => {
    if (!await showConfirm('确定删除？')) return;
    await api('DELETE', `/api/photos/${$('#photoModal')._pid}`);
    renderPhotos();
    $('#photoModal').classList.remove('active');
    document.body.style.overflow = '';
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#photoModal').classList.remove('active'); document.body.style.overflow = ''; } });
}

// ====== AI 聊天（支持私密空间）=====
let curConv = null, chatLoading = false;
let chatSpace = 'public'; // 'public', 'his', 'her'
const chatSpaceToken = { his: null, her: null };
const CHAT_TOKEN_TIMERS = { his: null, her: null };
function cacheChatToken(space, token) {
  chatSpaceToken[space] = token;
  if (CHAT_TOKEN_TIMERS[space]) clearTimeout(CHAT_TOKEN_TIMERS[space]);
  CHAT_TOKEN_TIMERS[space] = setTimeout(() => {
    if (chatSpaceToken[space] === token) { chatSpaceToken[space] = null; CHAT_TOKEN_TIMERS[space] = null; if (chatSpace === space) { chatSpace = 'public'; updateSpaceUI(); loadPublicChat(); } }
  }, TOKEN_TTL_MS);
}
const SPACE_NAMES = { public: '公开', his: '男生', her: '女生' };

function chatApiUrl(path) {
  let url = path;
  if (chatSpace !== 'public') {
    const token = chatSpaceToken[chatSpace];
    if (!token) return null;
    url += (url.includes('?') ? '&' : '?') + 'token=' + token;
  }
  return url;
}

async function loadConvs() {
  try {
    let url = '/api/chat/conversations?space=' + chatSpace;
    if (chatSpace !== 'public') {
      const token = chatSpaceToken[chatSpace];
      if (!token) return;
      url += '&token=' + token;
    }
    const list = await api('GET', url);
    $('#chatHistoryList').innerHTML = list.map(c => `
      <div class="chat-history-item-wrap">
        <div class="chat-history-item ${c.id === curConv ? 'active' : ''}" data-cid="${c.id}">
          ${esc(c.title)}
          <div class="h-time">${c.createdAt.slice(0,16).replace('T',' ')}</div>
        </div>
        <div class="chat-history-actions">
          <button class="ch-rename" data-cid="${c.id}" title="重命名">✏️</button>
          <button class="ch-delete" data-cid="${c.id}" title="删除">🗑</button>
        </div>
      </div>
    `).join('');
    $('#chatHistoryList').querySelectorAll('.chat-history-item').forEach(el => el.addEventListener('click', () => switchConv(el.dataset.cid)));
    $('#chatHistoryList').querySelectorAll('.ch-rename').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); renameConv(b.dataset.cid); }));
    $('#chatHistoryList').querySelectorAll('.ch-delete').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteConv(b.dataset.cid); }));
  } catch {}
}

async function switchConv(id) {
  const url = chatApiUrl(`/api/chat/conversations/${id}`);
  if (!url) return;
  try {
    const conv = await api('GET', url);
    curConv = conv.id;
    const el = $('#chatMessages');
    el.innerHTML = conv.messages.map(m => `<div class="chat-msg ${m.role === 'user' ? 'user' : 'bot'}">${esc(m.content)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
    $('#chatTitle').textContent = '[' + SPACE_NAMES[conv.space || 'public'] + '] ' + conv.title;
    loadConvs();
  } catch {}
}

async function renameConv(id) {
  const t = await showPrompt('重命名对话', '输入新标题');
  if (!t || !t.trim()) return;
  try {
    const body = { title: t.trim() };
    if (chatSpace !== 'public') body.token = chatSpaceToken[chatSpace];
    await api('PUT', `/api/chat/conversations/${id}`, body);
    if (id === curConv) $('#chatTitle').textContent = t.trim();
    loadConvs();
  } catch { alert('重命名失败'); }
}

async function deleteConv(id) {
  if (!await showConfirm('确定删除此对话？')) return;
  try {
    const token = chatSpace !== 'public' ? chatSpaceToken[chatSpace] : '';
    await api('DELETE', `/api/chat/conversations/${id}${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    if (id === curConv) newConv();
    else loadConvs();
  } catch {}
}

async function newConv() {
  const title = '新对话 ' + localTime();
  try {
    const body = { title, space: chatSpace };
    if (chatSpace !== 'public') body.token = chatSpaceToken[chatSpace];
    const conv = await api('POST', '/api/chat/conversations', body);
    curConv = conv.id;
    $('#chatMessages').innerHTML = '<div class="chat-msg bot">你好呀！我是你们的小助手 💕 有什么我可以帮忙的吗？</div>';
    $('#chatTitle').textContent = '[' + SPACE_NAMES[chatSpace] + '] ' + conv.title;
    loadConvs();
  } catch {}
}

async function sendMsg() {
  const input = $('#chatInput'), text = input.value.trim();
  if (!text || chatLoading) return;
  if (!curConv) await newConv();
  if (!curConv) return;
  const el = $('#chatMessages');
  el.innerHTML += `<div class="chat-msg user">${esc(text)}</div>`;
  el.scrollTop = el.scrollHeight;
  input.value = '';
  chatLoading = true;
  $('#chatLoading').style.display = 'block';
  el.scrollTop = el.scrollHeight;
  try {
    const body = { role: 'user', content: text };
    if (chatSpace !== 'public') body.token = chatSpaceToken[chatSpace];
    const d = await api('POST', `/api/chat/conversations/${curConv}/messages`, body);
    $('#chatLoading').style.display = 'none';
    if (d.reply) {
      el.innerHTML += `<div class="chat-msg bot">${esc(d.reply)}</div>`;
      el.scrollTop = el.scrollHeight;
      loadConvs();
      try { const c = await api('GET', chatApiUrl(`/api/chat/conversations/${curConv}`)); $('#chatTitle').textContent = '[' + SPACE_NAMES[chatSpace] + '] ' + c.title; } catch {}
    } else {
      el.innerHTML += '<div class="chat-msg bot">呜呜，小助手好像走神了…💦</div>';
    }
  } catch {
    $('#chatLoading').style.display = 'none';
    el.innerHTML += '<div class="chat-msg bot">呜呜，出错了…💦</div>';
  }
  chatLoading = false;
}

let pendingSpace = null;

async function switchChatSpace(space) {
  if (space === 'public') {
    chatSpace = 'public';
    updateSpaceUI();
    loadPublicChat();
    return;
  }
  // 已有 token 直接切换
  if (chatSpaceToken[space]) {
    chatSpace = space;
    updateSpaceUI();
    loadPublicChat();
    return;
  }
  // 弹出密码框
  pendingSpace = space;
  $('#chatPwdTitle').textContent = `请输入${SPACE_NAMES[space]}的密码`;
  $('#chatPwdInput').value = '';
  $('#chatPwdError').style.display = 'none';
  $('#chatPwdOverlay').style.display = 'flex';
  setTimeout(() => $('#chatPwdInput').focus(), 100);
}

function initChatPwdDialog() {
  $('#chatPwdConfirm').addEventListener('click', async () => {
    const pwd = $('#chatPwdInput').value.trim();
    if (!pwd) return;
    try {
      const d = await api('POST', `/api/diary/${pendingSpace}/verify`, { password: pwd });
      cacheChatToken(pendingSpace, d.token);
      $('#chatPwdOverlay').style.display = 'none';
      chatSpace = pendingSpace;
      updateSpaceUI();
      loadPublicChat();
    } catch {
      $('#chatPwdError').style.display = 'block';
      setTimeout(() => $('#chatPwdError').style.display = 'none', 2000);
    }
  });
  $('#chatPwdCancel').addEventListener('click', () => {
    $('#chatPwdOverlay').style.display = 'none';
    pendingSpace = null;
  });
  $('#chatPwdOverlay').addEventListener('click', e => {
    if (e.target === $('#chatPwdOverlay')) {
      $('#chatPwdOverlay').style.display = 'none';
      pendingSpace = null;
    }
  });
  $('#chatPwdInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#chatPwdConfirm').click();
  });
}

function updateSpaceUI() {
  document.querySelectorAll('.chat-space-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.space === chatSpace);
  });
  // 更新标题
  $('#chatTitle').textContent = chatSpace === 'public' ? '公开聊天' : '[' + SPACE_NAMES[chatSpace] + '] 私密空间';
}

async function loadPublicChat() {
  curConv = null;
  $('#chatMessages').innerHTML = '<div class="chat-msg bot">' + (chatSpace === 'public' ? '你好呀！我是你们的小助手 💕 有什么我可以帮忙的吗？' : '🔒 欢迎进入私密空间，只有你能看到这里的对话') + '</div>';
  loadConvs();
  // 自动加载第一个对话
  try {
    let url = '/api/chat/conversations?space=' + chatSpace;
    if (chatSpace !== 'public') url += '&token=' + chatSpaceToken[chatSpace];
    const list = await api('GET', url);
    if (list && list.length > 0) switchConv(list[0].id);
    else newConv();
  } catch { newConv(); }
}

function initChat() {
  $('#chatSend').addEventListener('click', sendMsg);
  $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
  $('#chatNewBtn').addEventListener('click', newConv);
  $('#chatToggleBtn').addEventListener('click', () => $('#chatSidebar').classList.toggle('open'));
  // 空间切换
  document.querySelectorAll('.chat-space-btn').forEach(b => {
    b.addEventListener('click', () => switchChatSpace(b.dataset.space));
  });
  initChatPwdDialog();
  // 默认加载公开聊天
  loadPublicChat();
}

// ====== 启动 ======
function showSiteAccessGate(message = '') {
  $('#siteAccessGate').hidden = false;
  $('#siteAccessError').textContent = message;
  $('#siteAccessPassword').focus();
}

function initSiteAccessGate() {
  $('#siteAccessForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#siteAccessPassword').value;
    try {
      await api('POST', '/api/access/login', { password });
      $('#siteAccessGate').hidden = true;
      initApp();
    } catch (error) {
      $('#siteAccessError').textContent = error.message;
    }
  });
}

async function initApp() {
  await loadSettings();
  ['his', 'her'].forEach(person => {
    const date = $(`#diary${cap(person)}Date`);
    if (date && !date.value) date.value = localTime();
  });
  createParticles();
  updateClock();
  setInterval(updateClock, 1000);
  initNav();
  initScrollAnim();
  loadDailyInspiration();
  initTL();
  renderTimeline();

  ['his', 'her'].forEach(p => {
    checkStatus(p);
    $(`#diary${cap(p)}SetPwdBtn`).addEventListener('click', () => setPw(p));
    $(`#diary${cap(p)}Lock`).querySelector('.diary-pwd-btn').addEventListener('click', () => verifyPw(p));
    $(`#diary${cap(p)}Add`).addEventListener('click', () => addEntry(p));
    initDiaryMedia(p);
    $(`#diary${cap(p)}Filter`).addEventListener('change', e => {
      diaryFilter[p] = e.target.value || '';
      const clearBtn = $(`.diary-filter-clear[data-person="${p}"]`);
      clearBtn.style.display = diaryFilter[p] ? 'inline-flex' : 'none';
      loadDiary(p);
    });
    $(`.diary-filter-clear[data-person="${p}"]`).addEventListener('click', () => {
      diaryFilter[p] = '';
      $(`#diary${cap(p)}Filter`).value = '';
      $(`.diary-filter-clear[data-person="${p}"]`).style.display = 'none';
      loadDiary(p);
    });
  });
  initStatusOnScroll();

  initPhotos();
  renderPhotos();
  initChat();
  initSettings();
}

async function init() {
  initSiteAccessGate();
  try {
    const access = await api('GET', '/api/access/status');
    if (access.invalidConfiguration) return showSiteAccessGate('服务器访问密码至少需要 4 位');
    if (!access.configured) return initApp();
    if (!access.authenticated) return showSiteAccessGate();
    initApp();
  } catch (error) {
    showSiteAccessGate(error.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
