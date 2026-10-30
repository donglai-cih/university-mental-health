const screen = document.getElementById('screen');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

const S = {
  user: JSON.parse(localStorage.getItem('mh_app_user') || 'null'),
  bootstrap: null,
  seq: 0,
  tab: 'all',
  cat: '全部',
  search: '',
  searchOpen: false,
  pickDate: null,
  pickSlot: null,
  mode: 'online_text',
  unread: 0,
  chatTimer: null,
  rate: 5,
  note: '',
  modalSubmit: null,
};

const ROLE_TEXT = { student: '学生', teacher: '心理老师', admin: '管理员' };
const MODE_TEXT = { online_text: '线上文字咨询', offline: '线下会谈' };
const STATUS_TEXT = {
  pending: '待老师处理', approved: '预约成功', in_progress: '进行中',
  completed: '已完成', cancelled: '已取消', rejected: '已拒绝', archived: '已归档',
};

/* ---------------- 工具 ---------------- */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(text, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = text;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.user) headers['x-user-id'] = S.user.id;
  const res = await fetch('/api' + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401) {
    logout();
    throw new Error(data.message || '请重新登录');
  }
  if (!res.ok || data.ok === false) throw new Error(data.message || '请求失败');
  return data;
}
function go(path) { location.hash = '#' + path; }
function fmtMD(date) {
  const [, m, d] = date.split('-');
  return `${Number(m)}月${Number(d)}日`;
}
function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function dateTimeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${timeOf(iso)}`;
}
function stars(n) {
  return '<span class="stars">' + '★'.repeat(Math.round(n)) + '<span class="off">' + '☆'.repeat(5 - Math.round(n)) + '</span></span>';
}
function avatar(name, cls = '') {
  return `<div class="avatar ${cls}">${esc((name || '?').slice(0, 1))}</div>`;
}

/* ---------------- 通用框架 ---------------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>',
  msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5.5h16v11h-9l-4 3v-3H4z"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c.6-3.6 3.3-5.6 7-5.6s6.4 2 7 5.6"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4 7 12l8 8"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
};

function navBar({ title, back = true, right = '' }) {
  return `<div class="nav">
    ${back ? `<button class="icon-btn" data-act="back">${ICONS.back}</button>` : '<div class="spacer"></div>'}
    <div class="title">${esc(title)}</div>
    ${right || '<div class="spacer"></div>'}
  </div>`;
}

function tabbar(active) {
  const items = [
    { key: 'home', label: '首页', icon: ICONS.home, path: '/home' },
    { key: 'messages', label: '消息', icon: ICONS.msg, path: '/messages' },
    { key: 'profile', label: '我的', icon: ICONS.me, path: '/profile' },
  ];
  return `<div class="tabbar">${items.map((it) => `
    <button class="${active === it.key ? 'on' : ''}" data-act="go" data-path="${it.path}">
      <span class="badge">${it.icon}${it.key === 'messages' && S.unread ? `<b>${S.unread > 99 ? '99+' : S.unread}</b>` : ''}</span>
      <span>${it.label}</span>
    </button>`).join('')}</div>`;
}

function shell({ title, content, back = true, tab = null, right = '', bottom = '' }) {
  const activeTab = tab || title;
  return `<div class="page ${tab ? '' : 'no-tab'}">
    ${navBar({ title, back, right })}
    <div class="scroll">${content}</div>
    ${bottom}
    ${tab ? tabbar(activeTab) : ''}
  </div>`;
}

function spinner() { return '<div class="spinner">加载中…</div>'; }

/* ---------------- 登录 ---------------- */
async function renderLogin() {
  const seq = S.seq;
  screen.innerHTML = `<div class="login">${spinner()}</div>`;
  try {
    if (!S.bootstrap) S.bootstrap = await api('/bootstrap');
  } catch (e) { toast(e.message, true); }
  if (seq !== S.seq) return;
  const accounts = S.bootstrap?.demoAccounts || [];
  const groups = [
    { role: 'student', label: '学生账号' },
    { role: 'teacher', label: '心理老师账号' },
    { role: 'admin', label: '管理员账号' },
  ];
  screen.innerHTML = `<div class="login">
    <div class="logo">心</div>
    <h1>校园心理平台</h1>
    <div class="sub">大学生心理健康咨询 · App 演示版</div>
    ${groups.map((g) => {
      const list = accounts.filter((a) => a.role === g.role);
      if (!list.length) return '';
      return `<div class="acct-group"><h4>${g.label}</h4>
        ${list.map((a) => `<button class="acct" data-act="login" data-u="${esc(a.username)}">
          <div class="avatar">${esc(a.avatar)}</div>
          <div><div class="nm">${esc(a.name)}</div><div class="ds">${esc(a.username)} · ${ROLE_TEXT[a.role]}</div></div>
        </button>`).join('')}
      </div>`;
    }).join('')}
    <div class="footnote">演示账号直接点选登录，数据与 Web 端共用</div>
  </div>`;
}

function logout() {
  S.user = null;
  S.unread = 0;
  localStorage.removeItem('mh_app_user');
  go('/home');
  render();
}

async function loginAs(username) {
  try {
    const { user } = await api('/login', { method: 'POST', body: { username } });
    S.user = user;
    localStorage.setItem('mh_app_user', JSON.stringify(user));
    S.tab = user.role === 'teacher' ? 'pending' : 'all';
    go(user.role === 'teacher' ? '/appointments' : '/home');
    render();
    toast(`已登录：${user.name}`);
  } catch (e) { toast(e.message, true); }
}

/* ---------------- 首页 ---------------- */
async function renderHome() {
  const seq = S.seq;
  const content = `
    <div class="hero">
      <div>
        <div class="t1">你好，${esc(S.user.name)}</div>
        <div class="t2">愿今天的你，被温柔以待</div>
      </div>
      <svg class="art" viewBox="0 0 120 96" fill="none" stroke="#7f9fdf" stroke-width="2">
        <rect x="22" y="12" width="76" height="50" rx="6" stroke="#9db6e8"/>
        <rect x="30" y="20" width="60" height="34" rx="3" stroke="#c2d3f2"/>
        <path d="M36 30h30M36 38h44M36 46h22" stroke="#b9ccef"/>
        <path d="M50 70h20l4 8H46z" stroke="#9db6e8"/>
        <path d="M44 82h32" stroke="#9db6e8"/>
      </svg>
    </div>
    <div class="entry-grid">
      <button class="entry" data-act="go" data-path="/teachers">
        <div class="ic">${ICONS.msg}</div><div class="nm">心理咨询预约</div><div class="ds">免费 · 保密</div>
      </button>
      <button class="entry" data-act="soon">
        <div class="ic">${ICONS.search}</div><div class="nm">心理测评中心</div><div class="ds">即将上线</div>
      </button>
      <button class="entry" data-act="soon">
        <div class="ic">${ICONS.me}</div><div class="nm">心理科普文章</div><div class="ds">即将上线</div>
      </button>
    </div>
    <div class="notice"><i>ⓘ</i><span>校内免费心理咨询，全程保密，请放心预约</span></div>
    <div class="pad"><div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <strong style="font-size:15px">我的预约</strong>
        <button class="btn sm soft" data-act="go" data-path="/appointments">全部记录</button>
      </div>
      ${S.user.role === 'student' ? '<div style="color:var(--ink-3);font-size:12px">查看进度、进入咨询会话与提交评价</div>' : '<div style="color:var(--ink-3);font-size:12px">处理学生预约申请与咨询</div>'}
    </div></div>
    <div class="quick" style="margin-top:14px">
      <button class="pill" data-act="go" data-path="/teachers">找老师</button>
      <button class="pill" data-act="go" data-path="/appointments">我的预约</button>
      ${S.user.role === 'student' ? '<button class="pill" data-act="go" data-path="/letters">我的留言</button>' : ''}
      <button class="pill" data-act="go" data-path="/messages">消息通知</button>
    </div>
  `;
  screen.innerHTML = shell({ title: '校园心理平台', content, back: false, tab: 'home' });
  loadUnread();
}

async function loadUnread() {
  try {
    const data = await api('/notifications');
    if (data.unread !== S.unread) {
      S.unread = data.unread;
      const badge = document.querySelector('.tabbar .badge b');
      if (badge) badge.textContent = S.unread;
      else if (S.unread) render();
    }
  } catch { /* ignore */ }
}

/* ---------------- 老师列表 ---------------- */
async function renderTeachers() {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '心理老师', content: spinner() });
  let teachers = [];
  try { teachers = (await api('/teachers')).teachers; } catch (e) { toast(e.message, true); }
  if (seq !== S.seq) return;

  const cats = ['全部', ...new Set(teachers.map((t) => t.specialties[0]))];
  const kw = S.search.trim().toLowerCase();
  let list = S.cat === '全部' ? teachers : teachers.filter((t) => t.specialties.includes(S.cat));
  if (kw) list = list.filter((t) => (t.name + t.specialties.join('') + t.bio).toLowerCase().includes(kw));

  const content = `
    ${S.searchOpen ? `<div class="pad" style="padding-bottom:10px"><input type="text" id="search-input" placeholder="搜索老师或擅长方向" value="${esc(S.search)}" /></div>` : ''}
    <div class="seg">
      ${cats.map((c) => `<button class="${S.cat === c ? 'on' : ''}" data-act="set-cat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <div class="pad gap-12">
      ${list.map((t) => `<div class="card teacher-card">
        <div data-act="teacher" data-id="${t.id}">${avatar(t.name)}</div>
        <div class="body" data-act="teacher" data-id="${t.id}">
          <div class="row1">
            <div class="nm">${esc(t.name)}</div>
            <div class="rate"><b>★</b>${t.rating ? t.rating.toFixed(1) : '暂无'}</div>
          </div>
          <div class="tags">${t.specialties.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>
          <div class="bio">${esc(t.bio)}</div>
          <div class="foot">
            <span class="meta">${esc(t.title || '')} · ${t.years ? t.years + '年经验' : ''}</span>
            <button class="btn sm" data-act="book" data-id="${t.id}">预约咨询</button>
          </div>
        </div>
      </div>`).join('') || '<div class="empty">没有符合条件的老师</div>'}
    </div>
  `;
  const right = `<button class="icon-btn" data-act="search-toggle">${ICONS.search}</button>`;
  screen.innerHTML = shell({ title: '心理老师', content, right });
  const input = document.getElementById('search-input');
  if (input) {
    input.focus();
    input.addEventListener('input', () => { S.search = input.value; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') renderTeachers(); });
  }
}

/* ---------------- 老师详情 ---------------- */
async function renderTeacher(id) {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '老师详情', content: spinner() });
  let t;
  try { t = (await api('/teachers/' + id)).teacher; } catch (e) { toast(e.message, true); return; }
  if (seq !== S.seq) return;

  const content = `
    <div class="pad">
      <div class="card profile">
        ${avatar(t.name, 'lg')}
        <div>
          <div class="nm">${esc(t.name)}</div>
          <div class="sub">${esc(t.title || '心理健康教师')}${t.years ? ` · ${t.years}年经验` : ''}</div>
          <div style="margin-top:6px">${stars(t.rating || 0)} <span style="font-size:12px;color:var(--ink-3)">${t.rating ? t.rating.toFixed(1) : '暂无'} · ${t.reviewCount} 条评价</span></div>
        </div>
      </div>

      <div class="card detail-block" style="margin-top:12px">
        <h3>擅长方向</h3>
        <p>${t.specialties.map(esc).join('、')}</p>
        <p style="margin-top:10px;color:var(--ink-3)">${esc(t.bio || '')}</p>
      </div>

      <div class="actions-2">
        <button class="btn ghost" data-act="anon" data-id="${t.id}">匿名留言</button>
        <button class="btn" data-act="book" data-id="${t.id}">预约咨询</button>
      </div>

      <div class="card detail-block" style="margin-top:16px">
        <h3>学员评价</h3>
        ${(t.reviews || []).map((r) => `<div class="review">
          <div class="head"><span style="color:var(--blue)">✔</span>${stars(r.rating)}<span>${esc(dateTimeOf(r.createdAt).split(' ')[0])}</span></div>
          <div class="txt">${esc(r.content)}</div>
        </div>`).join('') || '<div class="empty">暂无公开评价</div>'}
      </div>
      <div class="footnote">评价由管理员审核通过后公开展示</div>
    </div>
  `;
  screen.innerHTML = shell({ title: '老师详情', content });
}

/* ---------------- 日期选择 ---------------- */
async function renderDatePick(teacherId) {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '选择预约日期', content: spinner() });
  let data, teacher;
  try {
    [data, { teacher }] = await Promise.all([
      api(`/teachers/${teacherId}/slots?days=14`),
      api('/teachers/' + teacherId),
    ]);
  } catch (e) { toast(e.message, true); return; }
  if (seq !== S.seq) return;

  const days = data.days;
  const lead = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'].indexOf(weekdayOf(days[0].date));
  const selected = S.pickDate || '';
  const content = `
    <div class="pad">
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          ${avatar(teacher.name)}
          <div><div style="font-weight:700">${esc(teacher.name)}</div><div style="font-size:12px;color:var(--ink-3)">${esc(teacher.title || '')} · 次日及以后可约</div></div>
        </div>
        <div class="cal-head" style="margin-top:10px">
          ${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div>周${w}</div>`).join('')}
        </div>
        <div class="cal-grid">
          ${Array.from({ length: lead }, () => '<div></div>').join('')}
          ${days.map((d) => {
            const dd = Number(d.date.split('-')[2]);
            const on = d.availableCount > 0;
            return `<button class="day ${on ? '' : 'off'} ${selected === d.date ? 'sel' : ''}"
              ${on ? '' : 'disabled'} data-act="pick-day" data-date="${d.date}">
              <span class="n">${dd}</span>${on ? '<b></b>' : ''}
            </button>`;
          }).join('')}
        </div>
        <div class="cal-legend">
          <span><s style="background:var(--blue)"></s>有空闲时段</span>
          <span><s style="background:#dfe3ea"></s>不可预约</span>
        </div>
      </div>
      ${selected ? `<div class="card" style="margin-top:12px">
        <div style="font-size:13px;color:var(--ink-2);margin-bottom:10px">${fmtMD(selected)} ${weekdayOf(selected)} 可约时段</div>
        <div class="tags">${days.find((d) => d.date === selected).slots.filter((s) => s.status === 'available')
          .map((s) => `<span class="tag">${s.start}-${s.end}</span>`).join('') || '<span style="font-size:12px;color:var(--ink-3)">当天已约满</span>'}</div>
      </div>` : ''}
    </div>
    <div class="fixed-bottom">
      <button class="btn block" data-act="confirm-date" data-id="${teacherId}" ${selected ? '' : 'disabled'}>确认选择</button>
    </div>
  `;
  screen.innerHTML = shell({ title: '选择预约日期', content });
}

/* ---------------- 预约表单 ---------------- */
async function renderBookForm(teacherId, date) {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '预约信息填写', content: spinner() });
  let data, teacher;
  try {
    [data, { teacher }] = await Promise.all([
      api(`/teachers/${teacherId}/slots?days=14`),
      api('/teachers/' + teacherId),
    ]);
  } catch (e) { toast(e.message, true); return; }
  if (seq !== S.seq) return;

  const day = data.days.find((d) => d.date === date);
  if (!day) { toast('该日期不可预约', true); go('/teachers/' + teacherId); return; }
  if (!S.pickSlot || !day.slots.some((s) => s.start === S.pickSlot && s.status === 'available')) S.pickSlot = null;

  const content = `
    <div class="pad">
      <div class="card">
        <div style="font-size:12px;color:var(--ink-3);margin-bottom:8px">预约老师</div>
        <div style="display:flex;align-items:center;gap:10px">
          ${avatar(teacher.name)}
          <div><div style="font-weight:700">${esc(teacher.name)}</div>
          <div style="font-size:12px;color:var(--ink-3)">${fmtMD(date)} ${weekdayOf(date)}</div></div>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="field" style="margin:0">
          <label>预约时段</label>
          <div class="slot-grid">
            ${day.slots.map((s) => `<button class="slot ${S.pickSlot === s.start ? 'on' : ''}"
              ${s.status === 'available' ? '' : 'disabled'} data-act="pick-slot" data-start="${s.start}">${s.start}-${s.end}</button>`).join('')}
          </div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:8px">灰色时段已被预约或已锁定，每个时段 1 小时</div>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="field" style="margin:0">
          <label>咨询形式</label>
          <div class="radio-row">
            ${Object.entries(MODE_TEXT).map(([k, v]) => `<button class="radio ${S.mode === k ? 'on' : ''}" data-act="set-mode" data-mode="${k}"><i></i><span>${v}</span></button>`).join('')}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="field" style="margin:0">
          <label>备注</label>
          <textarea id="book-note" rows="4" placeholder="给老师的备注（选填），例如希望讨论的问题">${esc(S.note)}</textarea>
        </div>
      </div>
      <div class="footnote">只可预约次日及以后的时段，提交后等待老师确认</div>
    </div>
    <div class="fixed-bottom">
      <button class="btn block" data-act="submit-book" data-id="${teacherId}" data-date="${date}" ${S.pickSlot ? '' : 'disabled'}>提交预约</button>
    </div>
  `;
  screen.innerHTML = shell({ title: '预约信息填写', content });
  document.getElementById('book-note')?.addEventListener('input', (e) => { S.note = e.target.value; });
}

async function submitBooking(teacherId, date) {
  if (!S.pickSlot) return toast('请选择预约时段', true);
  try {
    await api('/appointments', {
      method: 'POST',
      body: { teacherId, date, start: S.pickSlot, mode: S.mode, note: (S.note || '').trim() },
    });
    toast('预约申请已提交，等待老师确认');
    S.pickSlot = null;
    S.note = '';
    go('/appointments');
  } catch (e) { toast(e.message, true); }
}

/* ---------------- 我的预约 ---------------- */
async function renderAppointments() {
  const seq = S.seq;
  const isTeacher = S.user.role === 'teacher';
  screen.innerHTML = shell({ title: isTeacher ? '预约管理' : '我的预约', content: spinner(), tab: null });
  let data;
  try { data = await api('/appointments'); } catch (e) { toast(e.message, true); }
  if (seq !== S.seq) return;

  const tabs = isTeacher
    ? [['pending', '待处理'], ['approved', '预约成功'], ['in_progress', '进行中'], ['completed', '已完成']]
    : [['all', '全部'], ['pending', '待老师处理'], ['approved', '预约成功'], ['completed', '已完成'], ['cancelled', '已取消']];
  const counts = data.counts || {};
  const items = (data.appointments || []).filter((a) => S.tab === 'all' || a.status === S.tab);

  const content = `
    <div class="seg" style="padding-top:4px">
      ${tabs.map(([k, label]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="appt-tab" data-tab="${k}">${label}${counts[k] ? ` ${counts[k]}` : ''}</button>`).join('')}
    </div>
    <div class="pad gap-12">
      ${items.map((a) => appointmentCardHTML(a, isTeacher)).join('') || '<div class="empty">暂无预约记录</div>'}
    </div>
    <div class="footnote">预约记录保存 3 个月，到期自动归档</div>
  `;
  screen.innerHTML = shell({ title: isTeacher ? '预约管理' : '我的预约', content });
}

function appointmentCardHTML(a, isTeacher) {
  const who = isTeacher ? a.student : a.teacher;
  const name = who?.name || (isTeacher ? '匿名同学' : '老师');
  const cls = a.status;
  const foot = isTeacher ? teacherFoot(a) : studentFoot(a);
  return `<div class="card appt-card">
    <div class="appt-head">
      <span style="font-size:13px;font-weight:600">${esc(MODE_TEXT[a.mode] || '')}</span>
      <span class="status ${cls}">${esc(a.statusText || STATUS_TEXT[cls] || cls)}</span>
    </div>
    <div class="appt-main" data-act="appt" data-id="${a.id}">
      ${avatar(name)}
      <div class="t">
        <div class="nm">${esc(name)}</div>
        <div class="sub">${fmtMD(a.date)} ${a.start}-${a.end} · ${esc(a.weekday || '')}</div>
        <div class="mode">${esc(MODE_TEXT[a.mode] || '')}${a.note ? ` · ${esc(a.note.slice(0, 18))}` : ''}</div>
      </div>
    </div>
    ${a.cancelRequested ? '<div class="hint">已提交取消申请，等待老师确认</div>' : ''}
    ${a.endRequested && a.status === 'in_progress' ? '<div class="hint">已申请结束咨询，等待老师确认</div>' : ''}
    ${foot ? `<div class="appt-foot">${foot}</div>` : ''}
  </div>`;
}

function studentFoot(a) {
  if (a.status === 'pending') return '<span class="hint">提交后等待老师处理</span>';
  if (a.status === 'approved') {
    return `${a.mode === 'online_text' ? `<button class="btn sm soft" data-act="chat" data-id="${a.id}">进入咨询</button>` : ''}
      <button class="btn sm" data-act="appt" data-id="${a.id}">查看详情</button>`;
  }
  if (a.status === 'in_progress') return `<button class="btn sm" data-act="chat" data-id="${a.id}">进入咨询会话</button>`;
  if (a.status === 'completed') return a.hasReview
    ? '<button class="btn sm gray" data-act="appt" data-id="' + a.id + '">已评价</button>'
    : `<button class="btn sm" data-act="review" data-id="${a.id}">去评价</button>`;
  if (a.status === 'rejected' || a.status === 'cancelled') return `<button class="btn sm gray" data-act="appt" data-id="${a.id}">查看详情</button>`;
  return '';
}

function teacherFoot(a) {
  if (a.status === 'pending') {
    return `<button class="btn sm gray" data-act="reject" data-id="${a.id}">拒绝</button>
      <button class="btn sm" data-act="approve" data-id="${a.id}">同意预约</button>`;
  }
  if (a.status === 'approved') {
    return `${a.mode === 'online_text' ? `<button class="btn sm soft" data-act="chat" data-id="${a.id}">进入咨询</button>` : ''}
      ${a.cancelRequested ? `<button class="btn sm" data-act="cancel-confirm" data-id="${a.id}">确认取消</button>` : `<button class="btn sm gray" data-act="cancel-manual" data-id="${a.id}">取消预约</button>`}
      <button class="btn sm" data-act="appt" data-id="${a.id}">详情</button>`;
  }
  if (a.status === 'in_progress') {
    return `${a.mode === 'online_text' ? `<button class="btn sm soft" data-act="chat" data-id="${a.id}">进入咨询</button>` : ''}
      ${a.endRequested ? `<button class="btn sm" data-act="end-confirm" data-id="${a.id}">确认结束</button>` : ''}
      <button class="btn sm" data-act="appt" data-id="${a.id}">详情</button>`;
  }
  return `<button class="btn sm gray" data-act="appt" data-id="${a.id}">查看详情</button>`;
}

/* ---------------- 预约详情 ---------------- */
async function renderAppointment(id) {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '预约详情', content: spinner() });
  let data;
  try { data = await api('/appointments/' + id); } catch (e) { toast(e.message, true); return; }
  if (seq !== S.seq) return;
  const a = data.appointment;
  const isTeacher = S.user.role === 'teacher';
  const who = isTeacher ? a.student : a.teacher;
  const name = who?.name || (isTeacher ? '匿名同学' : '老师');

  const startLeft = a.status === 'approved' ? new Date(`${a.date}T${a.start}:00+08:00`).getTime() - Date.now() : null;
  const canCancel = startLeft !== null && startLeft >= 2 * 3600 * 1000 && !a.cancelRequested;

  let bottom = '';
  if (isTeacher) {
    if (a.status === 'pending') {
      bottom = `<div style="display:flex;gap:10px">
        <button class="btn ghost" style="flex:1" data-act="reject" data-id="${a.id}">拒绝</button>
        <button class="btn" style="flex:1" data-act="approve" data-id="${a.id}">同意预约</button></div>`;
    } else if (a.status === 'approved') {
      bottom = `<div style="display:flex;gap:10px">
        <button class="btn ghost" style="flex:1" data-act="extend" data-id="${a.id}" data-min="30">延长30分钟</button>
        <button class="btn ghost" style="flex:1" data-act="extend" data-id="${a.id}" data-min="60">延长60分钟</button>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px">
        ${a.cancelRequested ? `<button class="btn danger" style="flex:1" data-act="cancel-confirm" data-id="${a.id}">确认取消申请</button>` : `<button class="btn gray" style="flex:1" data-act="cancel-manual" data-id="${a.id}">取消该预约</button>`}
        ${a.mode === 'online_text' ? `<button class="btn" style="flex:1" data-act="chat" data-id="${a.id}">进入会话</button>` : ''}
      </div>`;
    } else if (a.status === 'in_progress') {
      bottom = `<div style="display:flex;gap:10px">
        <button class="btn ghost" style="flex:1" data-act="extend" data-id="${a.id}" data-min="30">延长30分钟</button>
        <button class="btn" style="flex:1" data-act="${a.endRequested ? 'end-confirm' : 'noop'}" data-id="${a.id}" ${a.endRequested ? '' : 'disabled'}>确认结束咨询</button>
      </div>`;
    }
  } else {
    if (a.status === 'approved') {
      bottom = `${a.mode === 'online_text' ? '<button class="btn block" data-act="chat" data-id="' + a.id + '" style="margin-bottom:10px">进入咨询会话</button>' : ''}
        ${canCancel ? `<button class="btn ghost block" data-act="cancel-request" data-id="${a.id}">申请取消预约</button>` : ''}`;
    } else if (a.status === 'in_progress') {
      bottom = `<button class="btn block" data-act="chat" data-id="${a.id}">进入咨询会话</button>`;
    } else if (a.status === 'completed') {
      const reviewed = !!data.review;
      bottom = `<button class="btn block" data-act="review" data-id="${a.id}" ${reviewed ? 'disabled' : ''}>${reviewed ? '已提交评价' : '去评价本次咨询'}</button>`;
    }
  }

  const hints = [];
  if (!isTeacher && a.status === 'approved') {
    hints.push(canCancel ? '距离开始 2 小时以上，可申请取消（需老师确认）' : '距离开始不足 2 小时，请给老师留言说明情况，由老师处理取消');
  }
  if (a.status === 'completed') hints.push('咨询已完成，可提交评价，管理员审核通过后公开展示');
  if (a.cancelRequested) hints.push('你已提交取消申请，等待老师确认');
  if (a.endRequested && a.status === 'in_progress') hints.push('学生已申请结束咨询');
  if (a.rejectReason) hints.push('拒绝理由：' + a.rejectReason);
  if (a.cancelReason) hints.push('取消原因：' + a.cancelReason);

  const content = `
    <div class="pad">
      <div class="card">
        <div style="display:flex;align-items:center;gap:12px">
          ${avatar(name)}
          <div style="flex:1"><div style="font-weight:700;font-size:17px">${esc(name)}</div>
          <div style="font-size:12px;color:var(--ink-3)">${isTeacher ? esc(a.student?.className || '') : esc(data.teacherSchedule ? '心理健康教师' : '')}</div></div>
          <span class="badge" style="background:${a.status === 'approved' || a.status === 'completed' ? '#e7f7f1;color:#12a182' : 'var(--blue-soft);color:var(--blue)'}">${esc(a.statusText)}</span>
        </div>
        <div class="timeline">
          <div class="dot">
            <div class="when">${fmtMD(a.date)} ${a.start}-${a.end}${a.extendMinutes ? `（延长${a.extendMinutes}分钟）` : ''}</div>
            <div class="line">${esc(MODE_TEXT[a.mode])} · ${weekdayOf(a.date)}</div>
            ${a.note ? `<div class="line" style="color:var(--ink-3);font-size:13px">备注：${esc(a.note)}</div>` : ''}
          </div>
        </div>
        ${hints.length ? `<div class="timeline" style="border-left-color:transparent;padding-left:0;margin-top:14px">
          ${hints.map((h) => `<div style="font-size:12px;color:var(--ink-3);margin-top:6px">${esc(h)}</div>`).join('')}
        </div>` : ''}
      </div>
      <div class="footnote">预约单号：${esc(a.id)} · 创建于 ${esc(dateTimeOf(a.createdAt))}</div>
    </div>
    ${bottom ? `<div class="fixed-bottom">${bottom}</div>` : ''}
  `;
  screen.innerHTML = shell({ title: '预约详情', content });
}

/* ---------------- 咨询会话 ---------------- */
async function renderChat(id) {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '咨询会话', content: spinner() });
  let data;
  try { data = await api('/appointments/' + id); } catch (e) { toast(e.message, true); return; }
  if (seq !== S.seq) return;
  const a = data.appointment;
  const isTeacher = S.user.role === 'teacher';
  const title = isTeacher ? `${(a.student?.name || '学生')} 的咨询会话` : `${a.teacher.name} 咨询会话`;
  const canEnd = a.status === 'in_progress' && !isTeacher && !a.endRequested;
  const teacherCanEnd = isTeacher && a.status === 'in_progress' && a.endRequested;

  const content = `
    <div class="chat-body" style="min-height:100%">
      <div class="msgs" id="msgs">${msgsHTML(data.messages, isTeacher)}</div>
    </div>
    <div class="chat-input">
      <div class="row">
        <label class="up" for="chat-file">＋</label>
        <input type="file" id="chat-file" accept="image/png,image/jpeg,image/webp" hidden />
        <input type="text" id="chat-text" placeholder="输入消息…" />
        <button class="btn send" data-act="send-msg" data-id="${id}">发送</button>
      </div>
      ${canEnd ? `<button class="btn ghost end" data-act="end-request" data-id="${id}">申请结束咨询</button>` : ''}
      ${teacherCanEnd ? `<button class="btn end" data-act="end-confirm" data-id="${id}">确认结束咨询</button>` : ''}
    </div>
  `;
  screen.innerHTML = shell({ title, content });
  const setTitle = document.querySelector('.nav .title');
  if (setTitle) setTitle.textContent = title;

  const textInput = document.getElementById('chat-text');
  textInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMsg(id);
  });
  const file = document.getElementById('chat-file');
  file?.addEventListener('change', () => uploadChatImage(id, file));
  scrollMsgs();

  S.chatTimer = setInterval(async () => {
    if (!location.hash.includes('/chat/' + id)) return;
    try {
      const res = await api('/appointments/' + id + '/messages');
      const box = document.getElementById('msgs');
      if (box) {
        const nearBottom = box.parentElement.scrollHeight - box.parentElement.scrollTop - box.parentElement.clientHeight < 140;
        box.innerHTML = msgsHTML(res.messages, isTeacher);
        if (nearBottom) scrollMsgs();
      }
    } catch { /* ignore */ }
  }, 4000);
}

function msgsHTML(messages, isTeacher) {
  if (!messages.length) return '<div class="empty" style="color:#98a1b2">还没有消息，发送第一条吧</div>';
  return messages.map((m) => `<div class="msg ${m.mine ? 'mine' : ''}">
    ${m.mine ? '' : avatar(isTeacher ? '学' : '师')}
    <div class="bubble">
      ${m.image ? `<img src="${esc(m.image)}" alt="图片" />` : esc(m.content)}
      <div class="tm">${timeOf(m.createdAt)}</div>
    </div>
  </div>`).join('');
}

function scrollMsgs() {
  const box = document.querySelector('.chat-body');
  if (box) box.scrollTop = box.scrollHeight;
  const sc = document.querySelector('.scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
}

async function sendMsg(id) {
  const input = document.getElementById('chat-text');
  const content = (input?.value || '').trim();
  if (!content) return;
  try {
    await api(`/appointments/${id}/messages`, { method: 'POST', body: { content } });
    input.value = '';
    const res = await api('/appointments/' + id + '/messages');
    const box = document.getElementById('msgs');
    if (box) box.innerHTML = msgsHTML(res.messages, S.user.role === 'teacher');
    scrollMsgs();
  } catch (e) { toast(e.message, true); }
}

async function uploadChatImage(id, fileInput) {
  const file = fileInput.files?.[0];
  if (!file) return;
  fileInput.value = '';
  try {
    const dataUrl = await compressImage(file);
    const { url } = await api('/upload', { method: 'POST', body: { dataUrl } });
    await api(`/appointments/${id}/messages`, { method: 'POST', body: { image: url } });
    const res = await api('/appointments/' + id + '/messages');
    const box = document.getElementById('msgs');
    if (box) box.innerHTML = msgsHTML(res.messages, S.user.role === 'teacher');
    scrollMsgs();
  } catch (e) { toast(e.message, true); }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1400;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/* ---------------- 评价 ---------------- */
async function renderReview(id) {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '评价老师', content: spinner() });
  let data;
  try { data = await api('/appointments/' + id); } catch (e) { toast(e.message, true); return; }
  if (seq !== S.seq) return;
  const a = data.appointment;
  S.rate = S.rate || 5;
  const content = `
    <div class="pad">
      <div class="card" style="text-align:center;padding:22px 16px">
        <div style="font-size:20px;font-weight:700">${esc(a.teacher.name)}</div>
        <div style="font-size:13px;color:var(--ink-3);margin-top:4px">${fmtMD(a.date)} ${a.start}-${a.end} · ${esc(MODE_TEXT[a.mode])}</div>
        <div style="margin-top:18px;font-size:14px;color:var(--ink-2)">请打分</div>
        <div class="star-row">
          ${[1, 2, 3, 4, 5].map((n) => `<button class="${S.rate >= n ? 'on' : ''}" data-act="rate" data-n="${n}">★</button>`).join('')}
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <label style="font-size:13px;color:var(--ink-2);font-weight:600">写下你的评价</label>
        <textarea id="review-text" rows="7" style="margin-top:8px" placeholder="分享这次咨询的感受，帮助更多同学了解老师（必填）"></textarea>
      </div>
      <div class="footnote">提交后将由管理员审核，通过后公开展示到老师详情页</div>
    </div>
    <div class="fixed-bottom">
      <button class="btn block" data-act="submit-review" data-id="${id}">提交评价</button>
    </div>
  `;
  screen.innerHTML = shell({ title: '评价老师', content });
  if (data.review) {
    toast('该预约已提交过评价');
  }
}

async function submitReview(id) {
  const content = (document.getElementById('review-text')?.value || '').trim();
  if (!content) return toast('请填写评价内容', true);
  if (S.rate < 1) return toast('请选择评分', true);
  try {
    await api('/reviews', { method: 'POST', body: { appointmentId: id, rating: S.rate, content } });
    toast('评价已提交，等待管理员审核');
    go('/appointments');
  } catch (e) { toast(e.message, true); }
}

/* ---------------- 消息 ---------------- */
async function renderMessages() {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '消息', content: spinner(), back: false, tab: 'messages' });
  let data;
  try { data = await api('/notifications'); } catch (e) { toast(e.message, true); }
  if (seq !== S.seq) return;
  S.unread = data.unread || 0;
  const list = data.notifications || [];
  const content = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 16px 10px">
      <span style="font-size:12px;color:var(--ink-3)">${S.unread ? `${S.unread} 条未读` : '全部已读'}</span>
      ${S.unread ? '<button class="btn sm gray" data-act="read-all">全部已读</button>' : ''}
    </div>
    ${list.map((n) => `<button class="msg-item ${n.read ? '' : 'unread'}" data-act="read-one" data-id="${n.id}">
      <div class="ico">${n.type === 'chat_message' ? ICONS.msg : ICONS.bell}</div>
      <div class="t">
        <div class="ttl">${esc(n.title)}</div>
        <div class="bd">${esc(n.body)}</div>
        <div class="tm">${esc(dateTimeOf(n.createdAt))}</div>
      </div>
    </button>`).join('') || '<div class="empty">暂无站内消息</div>'}
    <div class="footnote">预约、取消、会话与评价审核结果都会通过站内消息通知</div>
  `;
  screen.innerHTML = shell({ title: '消息', content, back: false, tab: 'messages' });
}

/* ---------------- 我的 ---------------- */
function renderProfile() {
  const u = S.user;
  const content = `
    <div class="card" style="margin:12px 16px 0">
      <div class="profile-top" style="padding:0">
        ${avatar(u.name, 'lg')}
        <div>
          <div class="nm">${esc(u.name)}</div>
          <div class="sub">${esc(ROLE_TEXT[u.role])}${u.className ? ' · ' + esc(u.className) : ''}</div>
        </div>
      </div>
    </div>
    <div style="margin-top:12px;border-radius:16px;overflow:hidden;margin-left:16px;margin-right:16px;border:1px solid var(--line)">
      <div class="list-item" data-act="go" data-path="/appointments"><span class="ic">▤</span><span>${u.role === 'teacher' ? '预约管理' : '我的预约'}</span><span class="go">›</span></div>
      ${u.role === 'student' ? '<div class="list-item" data-act="go" data-path="/letters"><span class="ic">✉</span><span>我的匿名留言</span><span class="go">›</span></div>' : ''}
      <div class="list-item" data-act="go" data-path="/messages"><span class="ic">◔</span><span>消息通知</span><span class="go">›</span></div>
      <div class="list-item" data-act="go" data-path="/teachers"><span class="ic">☺</span><span>心理老师</span><span class="go">›</span></div>
      ${u.role === 'admin' || u.role === 'teacher' ? '<div class="list-item" data-act="web"><span class="ic">⌗</span><span>打开 Web 管理端</span><span class="go">›</span></div>' : ''}
    </div>
    <div style="margin:18px 16px">
      <button class="btn gray block" data-act="logout">退出登录</button>
    </div>
    <div class="footnote">校园心理健康咨询平台 · App 演示版 · 数据与 Web 端共用</div>
  `;
  screen.innerHTML = shell({ title: '我的', content, back: false, tab: 'profile' });
}

/* ---------------- 匿名留言记录 ---------------- */
async function renderLetters() {
  const seq = S.seq;
  screen.innerHTML = shell({ title: '我的匿名留言', content: spinner() });
  let data;
  try { data = await api('/anon-messages'); } catch (e) { toast(e.message, true); return; }
  if (seq !== S.seq) return;
  const msgs = data.messages || [];
  const groups = new Map();
  for (const m of msgs) {
    if (!groups.has(m.teacherId)) groups.set(m.teacherId, []);
    groups.get(m.teacherId).push(m);
  }
  const content = `
    <div class="pad gap-12" style="padding-top:12px">
      ${[...groups.entries()].map(([tid, list]) => `<div class="card">
        <div style="font-weight:700;margin-bottom:8px">${esc(list[0].teacherName)} 老师</div>
        ${list.map((m) => `<div style="margin:8px 0;font-size:13px;color:${m.isReply ? 'var(--blue)' : 'var(--ink-2)'}">
          <div style="font-size:11px;color:var(--ink-3)">${m.isReply ? '老师回复' : '我'} · ${esc(dateTimeOf(m.createdAt))}</div>
          ${esc(m.content)}
        </div>`).join('')}
        <button class="btn sm ghost" data-act="anon" data-id="${tid}">继续留言</button>
      </div>`).join('') || '<div class="empty">还没有留言，去老师详情页匿名留言吧</div>'}
    </div>
    <div class="footnote">老师看不到你的真实身份，留言为纯文字，支持匿名追问</div>
  `;
  screen.innerHTML = shell({ title: '我的匿名留言', content });
}

/* ---------------- 弹窗 ---------------- */
function openModal(html) {
  modalRoot.innerHTML = `<div class="modal-mask" data-act="close-modal"><div class="modal" data-stop="1">${html}</div></div>`;
}
function closeModal() {
  modalRoot.innerHTML = '';
  S.modalSubmit = null;
}
function reasonModal({ title, placeholder, confirmText = '确定', danger = false, onSubmit }) {
  openModal(`<h3>${esc(title)}</h3>
    <textarea id="modal-input" placeholder="${esc(placeholder)}"></textarea>
    <div class="btns">
      <button class="btn gray" data-act="close-modal">取消</button>
      <button class="btn ${danger ? '' : ''}" data-act="modal-submit">${esc(confirmText)}</button>
    </div>`);
  S.modalSubmit = (value) => {
    const text = value.trim();
    if (!text) return toast('请填写内容', true);
    onSubmit(text);
  };
}
function anonModal(teacherId) {
  openModal(`<h3>给老师匿名留言</h3>
    <textarea id="modal-input" placeholder="写下你想说的话，老师不会看到你的真实身份"></textarea>
    <div class="btns">
      <button class="btn gray" data-act="close-modal">取消</button>
      <button class="btn" data-act="anon-send" data-id="${teacherId}">发送留言</button>
    </div>`);
}

async function sendAnon(teacherId) {
  const content = (document.getElementById('modal-input')?.value || '').trim();
  if (!content) return toast('留言内容不能为空', true);
  try {
    await api(`/teachers/${teacherId}/anon-messages`, { method: 'POST', body: { content } });
    closeModal();
    toast('留言已发送');
  } catch (e) { toast(e.message, true); }
}

/* ---------------- 预约操作 ---------------- */
async function doAction(id, body, successText) {
  try {
    await api(`/appointments/${id}/action`, { method: 'POST', body });
    if (successText) toast(successText);
    render();
  } catch (e) { toast(e.message, true); }
}

function approve(id) { doAction(id, { action: 'approve' }, '已同意预约，已通知学生'); }

function reject(id) {
  reasonModal({
    title: '拒绝预约', placeholder: '请填写拒绝理由（必填，将通知学生）', confirmText: '确认拒绝',
    onSubmit: async (text) => {
      closeModal();
      await doAction(id, { action: 'reject', reason: text }, '已拒绝预约');
    },
  });
}

function cancelRequest(id) {
  reasonModal({
    title: '申请取消预约', placeholder: '请填写取消原因（必填，需老师确认）', confirmText: '提交申请',
    onSubmit: async (text) => {
      closeModal();
      await doAction(id, { action: 'cancel-request', reason: text }, '取消申请已提交');
    },
  });
}

function cancelManual(id) {
  reasonModal({
    title: '取消预约', placeholder: '请填写取消理由（会通知学生）', confirmText: '确认取消', danger: false,
    onSubmit: async (text) => {
      closeModal();
      await doAction(id, { action: 'cancel-manual', reason: text }, '预约已取消');
    },
  });
}

function cancelConfirm(id) {
  if (!confirm('确认同意取消该预约？')) return;
  doAction(id, { action: 'cancel-confirm' }, '已确认取消，已通知学生');
}

function extend(id, minutes) {
  doAction(id, { action: 'extend', minutes: Number(minutes) }, `已延长 ${minutes} 分钟，后续相邻时段已锁定`);
}

function endRequest(id) { doAction(id, { action: 'end-request' }, '已申请结束咨询，等待老师确认'); }

function endConfirm(id) {
  if (!confirm('确认结束本次咨询？')) return;
  doAction(id, { action: 'end-confirm' }, '咨询已完成，学生可提交评价');
}

/* ---------------- 路由 ---------------- */
function stopPoll() {
  if (S.chatTimer) { clearInterval(S.chatTimer); S.chatTimer = null; }
}

function render() {
  stopPoll();
  const seq = ++S.seq;
  const raw = location.hash.replace(/^#/, '') || '/home';
  const parts = raw.split('/').filter(Boolean);

  if (!S.user) { renderLogin(); return; }
  if (S.user.role === 'admin') {
    const content = `<div class="pad" style="padding-top:20px">
      <div class="card" style="text-align:center;padding:28px 18px">
        <div style="font-size:44px">⌗</div>
        <div style="font-size:18px;font-weight:700;margin-top:10px">管理员请使用 Web 管理端</div>
        <div style="font-size:13px;color:var(--ink-3);margin-top:8px;line-height:1.7">排班配置、评价审核、记录导出与数据统计在电脑端操作更完整。</div>
        <button class="btn block" style="margin-top:18px" data-act="web">打开 Web 管理端</button>
        <button class="btn gray block" style="margin-top:10px" data-act="logout">退出登录</button>
      </div>
    </div>`;
    screen.innerHTML = shell({ title: '校园心理平台', content, back: false });
    return;
  }

  if (parts[0] === 'teachers' && parts[1]) { renderTeacher(parts[1]); return; }

  switch (parts[0]) {
    case 'home':
      renderHome(); break;
    case 'teachers':
      renderTeachers(); break;
    case 'book':
      if (parts[1] && parts[2]) renderBookForm(parts[1], parts[2]);
      else if (parts[1]) renderDatePick(parts[1]);
      else renderTeachers();
      break;
    case 'appointments':
      renderAppointments(); break;
    case 'appointment':
      renderAppointment(parts[1]); break;
    case 'chat':
      renderChat(parts[1]); break;
    case 'review':
      renderReview(parts[1]); break;
    case 'messages':
      renderMessages(); break;
    case 'profile':
      renderProfile(); break;
    case 'letters':
      renderLetters(); break;
    default:
      go('/home');
  }
}

/* ---------------- 事件 ---------------- */
document.addEventListener('click', async (e) => {
  const stop = e.target.closest('[data-stop]');
  if (stop) e.stopPropagation();

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;

  switch (act) {
    case 'back':
      if (history.length > 1) history.back(); else go('/home');
      break;
    case 'go': go(el.dataset.path); break;
    case 'login': await loginAs(el.dataset.u); break;
    case 'logout': logout(); break;
    case 'web': window.open('/', '_blank'); break;
    case 'soon': toast('该模块即将上线，敬请期待'); break;
    case 'search-toggle':
      S.searchOpen = !S.searchOpen;
      if (!S.searchOpen) S.search = '';
      renderTeachers(); break;
    case 'set-cat': S.cat = el.dataset.c; renderTeachers(); break;
    case 'teacher': go('/teachers/' + id); break;
    case 'book': S.pickDate = null; S.pickSlot = null; S.mode = 'online_text'; S.note = ''; go('/book/' + id); break;
    case 'pick-day':
      S.pickDate = el.dataset.date;
      S.pickSlot = null;
      renderDatePick(partsTeacherId());
      break;
    case 'confirm-date':
      if (!S.pickDate) break;
      go(`/book/${id}/${S.pickDate}`);
      break;
    case 'pick-slot':
      S.pickSlot = el.dataset.start;
      renderBookForm(partsBookTeacher(), partsBookDate());
      break;
    case 'set-mode': S.mode = el.dataset.mode; renderBookForm(partsBookTeacher(), partsBookDate()); break;
    case 'submit-book': await submitBooking(id, el.dataset.date); break;
    case 'anon': anonModal(id); break;
    case 'anon-send': await sendAnon(id); break;
    case 'close-modal': closeModal(); break;
    case 'modal-submit': {
      const fn = S.modalSubmit;
      if (fn) await fn((document.getElementById('modal-input')?.value || ''));
      break;
    }
    case 'appt-tab': S.tab = el.dataset.tab; renderAppointments(); break;
    case 'appt': go('/appointment/' + id); break;
    case 'chat': go('/chat/' + id); break;
    case 'review': go('/review/' + id); break;
    case 'approve': approve(id); break;
    case 'reject': reject(id); break;
    case 'cancel-request': cancelRequest(id); break;
    case 'cancel-manual': cancelManual(id); break;
    case 'cancel-confirm': cancelConfirm(id); break;
    case 'extend': extend(id, el.dataset.min); break;
    case 'end-request': endRequest(id); break;
    case 'end-confirm': endConfirm(id); break;
    case 'noop': break;
    case 'rate': S.rate = Number(el.dataset.n); renderReview(partsApptId()); break;
    case 'submit-review': await submitReview(id); break;
    case 'read-one':
      await api('/notifications/read', { method: 'POST', body: { id } });
      renderMessages(); break;
    case 'read-all':
      await api('/notifications/read', { method: 'POST', body: {} });
      renderMessages(); break;
    case 'send-msg': await sendMsg(id); break;
    default: break;
  }
});

function partsTeacherId() { return location.hash.split('/')[2]; }
function partsBookTeacher() { return location.hash.split('/')[2]; }
function partsBookDate() { return location.hash.split('/')[3]; }
function partsApptId() { return location.hash.split('/')[2]; }

window.addEventListener('hashchange', () => render());
render();
