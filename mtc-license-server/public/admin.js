(function () {
  'use strict';
  const API = ''; // same-origin
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  let TOKEN = localStorage.getItem('mtc_admin_token') || '';
  const PERM_LABELS = {
    lines: 'الاينات', pin: 'التثبيت', fps: 'رفع الفريمات', colors: 'الألوان',
    macro: 'الماكرو', clip: 'تسجيل الشاشة', alerts: 'تنبيهات الحجم',
    profiles: 'البروفايلات', recorder: 'مسجل الحزم',
  };

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { data, status: res.status });
    return data;
  }

  function fmtDate(ts) {
    if (!ts) return '— بلا انتهاء —';
    const d = new Date(ts);
    return d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  }
  function timeLeft(ts) {
    if (!ts) return '∞';
    const ms = ts - Date.now();
    if (ms <= 0) return 'منتهي';
    const days = Math.floor(ms / 86400000);
    const hrs = Math.floor((ms % 86400000) / 3600000);
    return days > 0 ? `${days} يوم ${hrs} س` : `${hrs} س`;
  }

  // ---------- login ----------
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try {
      const data = await api('/api/admin/login', { method: 'POST', body: { username: $('#u').value, password: $('#p').value } });
      TOKEN = data.token;
      localStorage.setItem('mtc_admin_token', TOKEN);
      showDash();
    } catch (err) {
      $('#loginErr').textContent = 'بيانات الدخول غير صحيحة';
    }
  });
  $('#logoutBtn').addEventListener('click', () => {
    TOKEN = '';
    localStorage.removeItem('mtc_admin_token');
    $('#dash').classList.add('hidden');
    $('#loginScreen').classList.remove('hidden');
  });

  function showDash() {
    $('#loginScreen').classList.add('hidden');
    $('#dash').classList.remove('hidden');
    loadCodes();
  }

  // ---------- tabs ----------
  $$('.navBtn').forEach((btn) => btn.addEventListener('click', () => {
    $$('.navBtn').forEach((b) => b.classList.remove('active'));
    $$('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'logs') loadLogs();
    if (btn.dataset.tab === 'stats') loadStats();
  }));

  // ---------- codes ----------
  async function loadCodes() {
    const wrap = $('#codesTableWrap');
    wrap.innerHTML = '<p>جارٍ التحميل...</p>';
    try {
      const { codes } = await api('/api/admin/codes');
      if (!codes.length) { wrap.innerHTML = '<p>لا توجد أكواد بعد.</p>'; return; }
      const rows = codes.map((c) => {
        const now = Date.now();
        const status = !c.active ? ['ملغي', 'bad'] : (c.expiresAt && c.expiresAt < now ? ['منتهي', 'warn'] : ['فعّال', 'good']);
        return `<tr data-code="${c.code}">
          <td class="codeCell">${c.code}</td>
          <td>${c.note || '—'}</td>
          <td><span class="pill ${status[1]}">${status[0]}</span></td>
          <td>${timeLeft(c.expiresAt)}</td>
          <td>${(c.usedBy || []).length}/${c.maxDevices}</td>
          <td>${c.loginCount || 0}</td>
          <td class="rowActions">
            <button class="ghost actExtend">+7 يوم</button>
            <button class="ghost actToggle">${c.active ? 'إلغاء' : 'تفعيل'}</button>
            <button class="ghost actReset">تصفير الأجهزة</button>
            <button class="ghost actDelete">حذف</button>
          </td>
        </tr>`;
      }).join('');
      wrap.innerHTML = `<table>
        <thead><tr><th>الكود</th><th>ملاحظة</th><th>الحالة</th><th>متبقي</th><th>الأجهزة</th><th>دخول</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
      wrap.querySelectorAll('tr[data-code]').forEach((tr) => {
        const code = tr.dataset.code;
        tr.querySelector('.actExtend').onclick = () => patchCode(code, { extendDays: 7 });
        tr.querySelector('.actToggle').onclick = () => patchCode(code, { active: tr.querySelector('.actToggle').textContent.includes('تفعيل') });
        tr.querySelector('.actReset').onclick = () => patchCode(code, { resetDevices: true });
        tr.querySelector('.actDelete').onclick = async () => {
          if (!confirm('تأكيد حذف الكود ' + code + '؟')) return;
          await api('/api/admin/codes/' + encodeURIComponent(code), { method: 'DELETE' });
          loadCodes();
        };
      });
    } catch (err) {
      wrap.innerHTML = '<p class="err">تعذر تحميل الأكواد</p>';
    }
  }
  async function patchCode(code, body) {
    await api('/api/admin/codes/' + encodeURIComponent(code), { method: 'PATCH', body });
    loadCodes();
  }

  // ---------- new-code modal ----------
  const modal = $('#codeModal');
  function buildPermsFieldset() {
    const fs = $('#f_perms');
    fs.innerHTML = '<legend>الصلاحيات المفعّلة</legend>' + Object.keys(PERM_LABELS).map((k) =>
      `<label><input type="checkbox" data-perm="${k}" checked /> ${PERM_LABELS[k]}</label>`).join('');
  }
  $('#newCodeBtn').addEventListener('click', () => {
    $('#f_code').value = ''; $('#f_duration').value = 30; $('#f_maxDevices').value = 1; $('#f_note').value = '';
    buildPermsFieldset();
    modal.classList.remove('hidden');
  });
  $('#modalCancel').addEventListener('click', () => modal.classList.add('hidden'));
  $('#modalSave').addEventListener('click', async () => {
    const permissions = {};
    $$('#f_perms input[data-perm]').forEach((cb) => { permissions[cb.dataset.perm] = cb.checked; });
    try {
      await api('/api/admin/codes', {
        method: 'POST',
        body: {
          code: $('#f_code').value || undefined,
          durationDays: Number($('#f_duration').value),
          maxDevices: Number($('#f_maxDevices').value),
          note: $('#f_note').value,
          permissions,
        },
      });
      modal.classList.add('hidden');
      loadCodes();
    } catch (err) {
      alert('تعذر إنشاء الكود: ' + (err.data && err.data.error));
    }
  });

  // ---------- logs ----------
  async function loadLogs() {
    const wrap = $('#logsTableWrap');
    wrap.innerHTML = '<p>جارٍ التحميل...</p>';
    const { logs } = await api('/api/admin/logs');
    const typeAr = { login_success: ['دخول ناجح', 'good'], login_fail: ['دخول فاشل', 'bad'], admin_login_fail: ['دخول أدمن فاشل', 'bad'] };
    const rows = logs.map((l) => {
      const t = typeAr[l.type] || [l.type, 'warn'];
      return `<tr><td>${fmtDate(l.ts)}</td><td><span class="pill ${t[1]}">${t[0]}</span></td><td class="codeCell">${l.code || l.username || '—'}</td><td>${l.reason || ''}</td><td>${l.ip || ''}</td></tr>`;
    }).join('');
    wrap.innerHTML = `<table><thead><tr><th>الوقت</th><th>النوع</th><th>الكود/المستخدم</th><th>السبب</th><th>IP</th></tr></thead><tbody>${rows || '<tr><td colspan=5>لا يوجد سجل بعد</td></tr>'}</tbody></table>`;
  }

  // ---------- stats ----------
  async function loadStats() {
    const grid = $('#statsGrid');
    const s = await api('/api/admin/stats');
    const cards = [
      ['إجمالي الأكواد', s.totalCodes], ['أكواد فعّالة', s.activeCodes],
      ['أكواد منتهية', s.expiredCodes], ['أكواد ملغاة', s.revokedCodes],
      ['دخول ناجح', s.totalLogins], ['دخول فاشل', s.failedLogins],
      ['أجهزة مستخدَمة', s.devicesInUse],
    ];
    grid.innerHTML = cards.map(([lbl, num]) => `<div class="statCard"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join('');
  }

  // ---------- boot ----------
  if (TOKEN) {
    api('/api/admin/codes').then(showDash).catch(() => { TOKEN = ''; localStorage.removeItem('mtc_admin_token'); });
  }
})();
