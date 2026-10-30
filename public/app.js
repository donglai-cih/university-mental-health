const root = document.getElementById('root');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

const state = {
  user: JSON.parse(localStorage.getItem('mh_user') || 'null'),
  bootstrap: null,
  unread: 0,
  tab: { appts: 'all', tappts: 'pending', reviews: 'pending', records: 'appointments' },
  specialty: '',
  book: null,
  renderSeq: 0,
};

const ROLE_TEXT = { student: '学生', teacher: '心理老师', admin: '管理员' };

const STATUS_CLASS = {
  pending: 'pending', approved: 'approved', in_progress: 'in_progress',
  completed: 'completed', rejected: 'rejected', cancelled: 'cancelled', archived: 'archived',
};

/* ---------------- 基础工具 ---------------- */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.user) headers['x-user-id'] = state.user.id;
  const res = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401) {
    logout(false);
    throw new Error(data.message || '请重新登录');
  }
  if (!res.ok || data.ok === false) throw new Error(data.message || '请求失败');
  return data;
}

function dateLabel(date) {
  const [, m, d] = date.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateTimeText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${timeOf(iso)}`;
}

function shortTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return '刚刚';
  if (diff < 60) return `${Math.floor(diff)}分钟前`;
  if (diff < 1440) return `${Math.floor(diff / 60)}小时前`;
  if (diff < 43200) return `${Math.floor(diff / 1440)}天前`;
  return dateTimeText(iso).slice(0, 10);
}

function stars(rating) {
  const r = Math.round(Number(rating) || 0);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function statusBadge(a) {
  return `<span class="badge ${STATUS_CLASS[a.status] || ''}">${esc(a.statusText)}</span>`;
}

function empty(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

/* ---------------- 弹窗 ---------------- */

function openModal(title, body, wide = false) {
  modalRoot.innerHTML = `
    <div class="overlay" data-overlay="1">
      <div class="modal" style="${wide ? 'width:min(720px,100%)' : ''}">
        <div class="modal-head">
          <h2>${esc(title)}</h2>
          <button class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
        </div>
        ${body}
      </div>
    </div>`;
}

function closeModal() { modalRoot.innerHTML = ''; }

/* ---------------- 登录 ---------------- */

async function renderLogin() {
  document.body.classList.add('login-mode');
  const boot = state.bootstrap || await fetch('/api/bootstrap').then((r) => r.json());
  state.bootstrap = boot;
  const groups = { student: '学生', teacher: '心理老师', admin: '管理员' };
  const accounts = ['student', 'teacher', 'admin'].map((role) => {
    const list = boot.demoAccounts.filter((a) => a.role === role);
    if (!list.length) return '';
    return `
      <div class="small muted" style="margin:10px 0 6px">${groups[role]}</div>
      ${list.map((a) => `
        <button class="account" data-action="login" data-username="${esc(a.username)}">
          <span class="avatar">${esc(a.avatar || a.name[0])}</span>
          <span><b>${esc(a.name)}</b><span>@${esc(a.username)}</span></span>
          <span class="tag gray role-tag">${groups[a.role]}</span>
        </button>`).join('')}`;
  }).join('');

  const shell = document.querySelector('.shell');
  if (shell) shell.remove();
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-left">
          <div class="brand" style="padding:0">
            <div class="brand-logo">心</div>
            <div>
              <div class="brand-name">心屿 · 校园心理健康</div>
              <div class="brand-sub">CAMPUS MENTAL HEALTH</div>
            </div>
          </div>
          <h1>低门槛、可匿名、<br />免费的校内心理支持</h1>
          <p>学生预约咨询与匿名留言；心理老师处理预约、接待咨询；管理员统一排班、审核评价与归档记录。</p>
          <ul>
            <li>仅可预约次日及以后时段，按 1 小时分块</li>
            <li>线上文字 / 线下会谈两种咨询形式</li>
            <li>学生发起结束，评价经管理员审核后公开</li>
            <li>全部站内通知，记录保留 3 个月</li>
          </ul>
          <div class="foot">演示环境 · 选择下方任一账号即可进入对应角色</div>
        </div>
        <div class="login-right">
          <h2>选择演示账号</h2>
          <div class="hint">无需密码，点击账号直接进入</div>
          <div class="account-list">${accounts}</div>
        </div>
      </div>
    </div>`;
}

async function doLogin(username) {
  const { user } = await api('/login', { method: 'POST', body: { username } });
  state.user = user;
  localStorage.setItem('mh_user', JSON.stringify(user));
  document.body.classList.remove('login-mode');
  location.hash = defaultHash();
  await render();
}

function logout(rerender = true) {
  state.user = null;
  localStorage.removeItem('mh_user');
  if (rerender) {
    location.hash = '';
    renderLogin();
  }
}

function defaultHash() {
  if (!state.user) return '#/';
  if (state.user.role === 'student') return '#/teachers';
  if (state.user.role === 'teacher') return '#/t/appointments';
  return '#/a/overview';
}

/* ---------------- 布局 ---------------- */

function navItems() {
  if (!state.user) return [];
  if (state.user.role === 'student') {
    return [
      ['#/teachers', '老师列表', '◎'],
      ['#/appointments', '我的预约', '▤'],
      ['#/messages', '匿名留言', '✎'],
      ['#/notifications', '消息通知', '◔'],
    ];
  }
  if (state.user.role === 'teacher') {
    return [
      ['#/t/appointments', '预约工作台', '▤'],
      ['#/t/messages', '匿名留言', '✎'],
      ['#/notifications', '消息通知', '◔'],
    ];
  }
  return [
    ['#/a/overview', '工作台总览', '◫'],
    ['#/a/schedule', '排班配置', '◷'],
    ['#/a/reviews', '评价审核', '★'],
    ['#/a/records', '记录与导出', '⤓'],
    ['#/notifications', '消息通知', '◔'],
  ];
}

function layout(title, subtitle, content) {
  const active = location.hash || defaultHash();
  const nav = navItems().map(([href, label, icon]) => {
    const isActive = active.startsWith(href);
    return `<a href="${href}" class="${isActive ? 'active' : ''}"><span class="ico">${icon}</span>${label}</a>`;
  }).join('');
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-logo">心</div>
          <div>
            <div class="brand-name">心屿 · 心理健康</div>
            <div class="brand-sub">校园咨询平台</div>
          </div>
        </div>
        <nav class="nav">${nav}</nav>
        <div class="sidebar-foot">全部站内通知 · 记录保留 3 个月<br />本平台免费提供服务</div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <h1 class="page-title">${esc(title)}</h1>
            ${subtitle ? `<div class="page-sub">${esc(subtitle)}</div>` : ''}
          </div>
          <div class="topbar-right">
            <a href="#/notifications" class="icon-btn" title="消息通知">◔<span class="dot" id="unread-dot" style="display:none">0</span></a>
            <div class="user-chip">
              <span class="avatar">${esc(state.user.avatar || state.user.name[0])}</span>
              <span class="meta"><b>${esc(state.user.name)}</b><span>${ROLE_TEXT[state.user.role]}${state.user.className ? ` · ${esc(state.user.className)}` : ''}</span></span>
            </div>
            <button class="btn btn-sm" data-action="logout">退出</button>
          </div>
        </div>
        ${content}
      </main>
    </div>`;
}

async function loadUnread() {
  try {
    const data = await api('/notifications');
    state.unread = data.unread;
    const dot = document.getElementById('unread-dot');
    if (dot) {
      if (data.unread > 0) { dot.style.display = 'grid'; dot.textContent = data.unread > 99 ? '99+' : data.unread; }
      else dot.style.display = 'none';
    }
  } catch { /* ignore */ }
}

/* ---------------- 学生：老师列表 ---------------- */

async function pageTeachers() {
  const boot = state.bootstrap || await fetch('/api/bootstrap').then((r) => r.json());
  state.bootstrap = boot;
  const query = state.specialty ? `?specialty=${encodeURIComponent(state.specialty)}` : '';
  const { teachers } = await api(`/teachers${query}`);
  const chips = ['全部', ...boot.specialties].map((s) => {
    const active = (s === '全部' && !state.specialty) || s === state.specialty;
    return `<button class="tab ${active ? 'active' : ''}" data-action="filter-specialty" data-value="${esc(s)}">${esc(s)}</button>`;
  }).join('');

  const cards = teachers.map((t) => `
    <article class="teacher-card">
      <div class="teacher-top">
        <div class="teacher-avatar">${esc(t.avatar || t.name[0])}</div>
        <div>
          <div class="teacher-name">${esc(t.name)}</div>
          <div class="teacher-title">${esc(t.title)} · ${t.years}年经验</div>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div class="rating">${t.rating ? `${stars(t.rating)}` : '暂无评价'}</div>
          <div class="small muted">${t.rating ? `${t.rating} 分 · ${t.reviewCount} 条公开评价` : '等待首次评价'}</div>
        </div>
      </div>
      <div class="row">${t.specialties.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
      <div class="teacher-bio">${esc(t.bio)}</div>
      <div class="row spread">
        <span class="small muted">支持线上文字 / 线下会谈</span>
        <button class="btn btn-primary btn-sm" data-action="teacher-detail" data-id="${t.id}">查看详情</button>
      </div>
    </article>`).join('');

  return {
    title: '心理老师',
    subtitle: '按擅长方向筛选，查看公开评价后预约咨询',
    html: `
      <div class="card">
        <div class="card-head"><h2>擅长方向</h2><span class="small muted">仅展示管理员审核通过的公开评价</span></div>
        <div class="tabs" style="margin:0">${chips}</div>
      </div>
      <div class="teacher-grid" style="margin-top:14px">${cards || empty('暂无匹配的老师')}</div>`,
  };
}

/* ---------------- 学生：老师详情 ---------------- */

async function pageTeacherDetail(id) {
  const { teacher } = await api(`/teachers/${id}`);
  const threads = await api('/anon-messages');
  const mine = threads.messages.filter((m) => m.teacherId === id);
  const reviews = teacher.reviews || [];
  return {
    title: teacher.name,
    subtitle: '查看擅长方向与公开评价',
    html: `
      <div class="card hero">
        <div class="teacher-avatar">${esc(teacher.avatar || teacher.name[0])}</div>
        <div style="flex:1">
          <h1>${esc(teacher.name)}</h1>
          <div class="small muted">${esc(teacher.title)} · ${teacher.years} 年咨询经验</div>
          <div class="row" style="margin-top:10px">${teacher.specialties.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
          <div class="teacher-bio" style="margin-top:10px">${esc(teacher.bio)}</div>
          <div class="row" style="margin-top:14px">
            <button class="btn btn-soft" data-action="open-anon" data-id="${id}">匿名留言</button>
            <a class="btn btn-primary" href="#/book/${id}">预约咨询</a>
            <span class="small muted">预约仅可选择次日及以后的时段</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>公开评价</h2>
          <span class="rating">${teacher.rating ? `${stars(teacher.rating)} ${teacher.rating} 分` : '暂无公开评价'}</span>
        </div>
        ${reviews.length ? reviews.map((r) => `
          <div class="review">
            <span class="rating">${stars(r.rating)}</span>
            <div>${esc(r.content)}</div>
            <div class="small muted" style="margin-top:4px">匿名学生 · ${dateTimeText(r.createdAt)}</div>
          </div>`).join('') : empty('暂无审核通过的公开评价')}
      </div>

      <div class="card">
        <div class="card-head">
          <h2>我的匿名留言</h2>
          <button class="btn btn-sm" data-action="open-anon" data-id="${id}">继续留言</button>
        </div>
        <div class="notice" style="margin-bottom:12px">留言身份对老师保密；预约成功后老师才可见你的完整信息。</div>
        ${mine.length ? `<div class="msg-thread">${mine.map((m) => msgItem(m)).join('')}</div>` : empty('你还没有给这位老师留言')}
      </div>`,
  };
}

function msgItem(m) {
  return `<div class="msg-item ${m.isReply ? 'reply' : ''}">
    <b>${m.isReply ? '老师回复' : '我'}</b>
    <div>${esc(m.content)}</div>
    <time>${dateTimeText(m.createdAt)}</time>
  </div>`;
}

/* ---------------- 学生：预约流程 ---------------- */

async function pageBook(teacherId) {
  const [{ teacher }, avail] = await Promise.all([
    api(`/teachers/${teacherId}`),
    api(`/teachers/${teacherId}/slots?days=14`),
  ]);
  if (!state.book || state.book.teacherId !== teacherId) {
    const first = avail.days.find((d) => d.availableCount > 0) || avail.days[0];
    state.book = { teacherId, date: first?.date, start: '', mode: 'online_text' };
  }
  const bk = state.book;
  if (!avail.days.some((d) => d.date === bk.date)) bk.date = avail.days[0]?.date;
  const current = avail.days.find((d) => d.date === bk.date) || avail.days[0];

  const dates = avail.days.map((d) => `
    <button class="date-chip ${d.date === bk.date ? 'active' : ''}" data-action="pick-date" data-date="${d.date}">
      <b>${dateLabel(d.date)}</b>
      <span>${d.weekday}</span>
      <span class="count">${d.availableCount} 个可约</span>
    </button>`).join('');

  const slots = current ? current.slots.map((s) => {
    const disabled = s.status !== 'available';
    const cls = disabled ? s.status : (bk.start === s.start ? 'active' : '');
    const label = { booked: '已被预约', locked: '已锁定', past: '已过时段' }[s.status] || '可预约';
    return `<button class="slot ${cls}" ${disabled ? 'disabled' : ''} data-action="pick-slot" data-start="${s.start}" data-end="${s.end}">
      ${s.start}-${s.end}<small>${disabled ? label : '可预约'}</small>
    </button>`;
  }).join('') : '';

  return {
    title: `预约 ${teacher.name} 老师`,
    subtitle: '选择日期与 1 小时时段，填写咨询形式与备注',
    html: `
      <div class="card">
        <div class="row spread">
          <div class="row">
            <div class="teacher-avatar" style="width:40px;height:40px;font-size:16px;border-radius:12px">${esc(teacher.avatar)}</div>
            <div>
              <b>${esc(teacher.name)}</b>
              <div class="small muted">${esc(teacher.title)} · ${teacher.specialties.join(' / ')}</div>
            </div>
          </div>
          <span class="tag ok">校内免费</span>
        </div>
        <div class="divider"></div>
        <div class="hint" style="margin-bottom:8px">可预约日期（仅次日及以后，不可预约当天）</div>
        <div class="date-strip">${dates}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>${current ? `${dateLabel(current.date)} ${current.weekday} · 可预约时段` : '可预约时段'}</h2>
          <span class="small muted">管理员配置：${avail.config.morning_start}-${avail.config.morning_end} / ${avail.config.afternoon_start}-${avail.config.afternoon_end}</span>
        </div>
        <div class="slot-grid">${slots || empty('该日暂无可预约时段')}</div>
      </div>

      <form class="card" data-form="booking">
        <h2 class="section-title">预约信息</h2>
        <div class="field">
          <label>已选时段</label>
          <div class="row">
            <span class="tag" style="font-size:13px;padding:6px 12px">${bk.start ? `${dateLabel(bk.date)} ${current?.weekday || ''} ${bk.start}-${current?.slots.find((s) => s.start === bk.start)?.end || ''}` : '尚未选择时段'}</span>
            <span class="small muted">请先在上方选择可预约的时段块</span>
          </div>
        </div>
        <div class="field">
          <label>咨询形式</label>
          <div class="mode-options">
            <div class="mode-option ${bk.mode === 'online_text' ? 'active' : ''}" data-action="pick-mode" data-mode="online_text">
              <b>线上文字咨询</b><span>在预约详情页内文字沟通，支持上传图片</span>
            </div>
            <div class="mode-option ${bk.mode === 'offline' ? 'active' : ''}" data-action="pick-mode" data-mode="offline">
              <b>线下会谈</b><span>到校内咨询室面谈，仅作记录标记</span>
            </div>
          </div>
        </div>
        <div class="field">
          <label>预约备注</label>
          <textarea class="textarea" name="note" maxlength="500" placeholder="简单描述你想聊的内容，帮助老师提前了解（选填）"></textarea>
        </div>
        <div class="row spread">
          <span class="small muted">提交后老师需在站内确认，确认成功才会生效</span>
          <button class="btn btn-primary" type="submit" ${bk.start ? '' : 'disabled'}>提交预约申请</button>
        </div>
      </form>`,
  };
}

/* ---------------- 学生：我的预约 ---------------- */

async function pageAppointments() {
  const status = state.tab.appts;
  const { appointments, counts } = await api(`/appointments?status=${status}&includeArchived=${status === 'archived' ? '1' : '0'}`);
  const tabs = [
    ['all', '全部'], ['pending', '待处理'], ['approved', '预约成功'], ['in_progress', '进行中'],
    ['completed', '已完成'], ['archived', '历史归档'],
  ];
  const tabsHtml = tabs.map(([value, label]) =>
    `<button class="tab ${status === value ? 'active' : ''}" data-action="tab" data-group="appts" data-value="${value}">${label}${counts && counts[value] != null ? ` ${counts[value]}` : ''}</button>`
  ).join('');

  return {
    title: '我的预约',
    subtitle: '查看预约状态、进入咨询会话、发起结束与评价',
    html: `
      <div class="card">
        <div class="tabs">${tabsHtml}</div>
        ${appointments.length ? appointments.map((a) => `
          <div class="appt-row">
            <div class="appt-when">
              <b>${dateLabel(a.date)} ${a.weekday}</b>
              <span>${a.start}-${a.end}${a.extendMinutes ? `（已延 ${a.extendMinutes} 分钟）` : ''}</span>
            </div>
            <div class="appt-main">
              <div class="who">${esc(a.teacher.name)} 老师 · ${esc(a.modeText)}</div>
              <div class="note">${esc(a.note || '未填写备注')}</div>
              ${a.cancelRequested ? '<div class="small" style="color:var(--warn);margin-top:4px">取消申请已提交，等待老师确认</div>' : ''}
              ${a.endRequested ? '<div class="small" style="color:var(--warn);margin-top:4px">结束咨询申请已提交，等待老师确认</div>' : ''}
            </div>
            <div class="row">${statusBadge(a)}</div>
            <div class="appt-actions">
              <a class="btn btn-sm" href="#/appointment/${a.id}">查看详情</a>
              ${a.status === 'approved' && !a.cancelRequested ? `<button class="btn btn-sm btn-danger" data-action="cancel-request" data-id="${a.id}">申请取消</button>` : ''}
              ${a.status === 'in_progress' ? `<a class="btn btn-sm btn-primary" href="#/appointment/${a.id}">进入咨询</a>` : ''}
              ${a.status === 'completed' ? `<a class="btn btn-sm btn-soft" href="#/appointment/${a.id}">评价</a>` : ''}
            </div>
          </div>`).join('') : empty('暂无该状态下的预约记录')}
      </div>

      <div class="card">
        <div class="card-head"><h2>取消规则</h2></div>
        <div class="hint">
          · 距开始 ≥ 2 小时：可在预约详情发起取消申请，经老师确认后生效；<br />
          · 距开始 &lt; 2 小时：无法直接取消，请给老师留言说明特殊情况，由老师手动取消；<br />
          · 所有状态的预约记录统一保存 3 个月，到期自动归档隐藏。
        </div>
      </div>`,
  };
}

/* ---------------- 预约详情 ---------------- */

async function pageAppointmentDetail(id) {
  const data = await api(`/appointments/${id}`);
  const a = data.appointment;
  const isStudent = state.user.role === 'student';
  const isTeacher = state.user.role === 'teacher';

  const canChat = a.mode === 'online_text' && ['approved', 'in_progress', 'completed'].includes(a.status);
  const chatHtml = canChat ? chatPanel(data.messages, a) : `
    <div class="notice">${a.mode === 'offline' ? '线下会谈无线上会话窗口，仅作记录标记，请按约定到校内咨询室面谈。' : '预约确认后开放线上会话入口。'}</div>`;

  const reviewHtml = data.review ? `
    <div class="card">
      <div class="card-head"><h2>我的评价</h2><span class="tag ${data.review.status === 'approved' ? 'ok' : 'warn'}">${{ approved: '已公开', pending: '待管理员审核', rejected: '未通过审核' }[data.review.status]}</span></div>
      <div class="rating">${stars(data.review.rating)}</div>
      <div class="teacher-bio" style="margin-top:8px">${esc(data.review.content)}</div>
    </div>` : '';

  const actions = [];
  if (isStudent) {
    if (a.status === 'approved' && !a.cancelRequested) actions.push(`<button class="btn btn-danger" data-action="cancel-request" data-id="${a.id}">申请取消预约</button>`);
    if (a.status === 'in_progress' && !a.endRequested) actions.push(`<button class="btn btn-primary" data-action="end-request" data-id="${a.id}">发起结束咨询</button>`);
    if (a.status === 'completed' && !data.review) actions.push(`<button class="btn btn-primary" data-action="open-review" data-id="${a.id}">提交评价</button>`);
  }
  if (isTeacher) {
    if (a.status === 'pending') {
      actions.push(`<button class="btn btn-primary" data-action="approve" data-id="${a.id}">同意预约</button>`);
      actions.push(`<button class="btn btn-danger" data-action="open-reject" data-id="${a.id}">拒绝（需填理由）</button>`);
    }
    if (a.status === 'approved' && a.cancelRequested) actions.push(`<button class="btn btn-primary" data-action="cancel-confirm" data-id="${a.id}">确认取消</button>`);
    if (a.status === 'approved') actions.push(`<button class="btn btn-danger" data-action="open-manual-cancel" data-id="${a.id}">手动取消预约</button>`);
    if (a.status === 'in_progress') {
      actions.push(`<button class="btn" data-action="extend" data-id="${a.id}" data-minutes="30">延长 30 分钟</button>`);
      actions.push(`<button class="btn" data-action="extend" data-id="${a.id}" data-minutes="60">延长 60 分钟</button>`);
      if (a.endRequested) actions.push(`<button class="btn btn-primary" data-action="end-confirm" data-id="${a.id}">同意结束咨询</button>`);
      else actions.push(`<span class="small muted">结束咨询需由学生发起</span>`);
    }
  }

  const infoRows = [
    ['预约时间', `${a.date} ${a.weekday} ${a.start}-${a.end}${a.extendMinutes ? `（已延长 ${a.extendMinutes} 分钟）` : ''}`],
    ['咨询形式', a.modeText],
    [isTeacher ? '学生' : '老师', isTeacher ? a.student.name : `${a.teacher.name}（${data.teacherName}）`],
    ['预约备注', a.note || '未填写'],
  ];

  return {
    title: '预约详情',
    subtitle: `预约单号 ${a.id}`,
    html: `
      <div class="card">
        <div class="card-head">
          <h2>${dateLabel(a.date)} ${a.weekday} · ${a.start}-${a.end}</h2>
          ${statusBadge(a)}
        </div>
        ${infoRows.map(([k, v]) => `<div class="row spread" style="padding:7px 0;border-bottom:1px dashed var(--line)"><span class="small muted">${k}</span><span style="text-align:right;max-width:70%">${esc(v)}</span></div>`).join('')}
        ${a.rejectReason ? `<div class="notice" style="margin-top:12px">拒绝理由：${esc(a.rejectReason)}</div>` : ''}
        ${a.cancelRequested ? `<div class="notice" style="margin-top:12px">取消申请：${esc(a.cancelReason || '未填写原因')}（等待老师确认）</div>` : ''}
        ${a.cancelReason && a.status === 'cancelled' ? `<div class="notice" style="margin-top:12px">取消说明：${esc(a.cancelReason)}</div>` : ''}
        ${a.endRequested && a.status === 'in_progress' ? `<div class="notice" style="margin-top:12px">学生已申请结束咨询，等待老师确认。</div>` : ''}
        <div class="row" style="margin-top:16px">${actions.join('')}</div>
      </div>

      ${canChat ? `<div class="card">
        <div class="card-head"><h2>咨询会话</h2><button class="btn btn-sm" data-action="chat-refresh" data-id="${a.id}">刷新</button></div>
        ${chatHtml}
      </div>` : `<div class="card">${chatHtml}</div>`}

      ${reviewHtml}

      <div class="card">
        <div class="hint">
          基础时长 1 小时；超时系统提醒，老师可延长并锁定后续相邻时段；<br />
          结束咨询由学生发起，老师仅可同意；咨询完成后开放评价入口，评价经管理员审核后公开。
        </div>
      </div>`,
  };
}

function chatPanel(messages, a) {
  const canSend = ['approved', 'in_progress'].includes(a.status) && ['student', 'teacher'].includes(state.user.role);
  const list = messages.length ? messages.map((m) => `
    <div class="bubble ${m.mine ? 'mine' : ''}">
      ${m.content ? `<div>${esc(m.content)}</div>` : ''}
      ${m.image ? `<img src="${esc(m.image)}" alt="图片消息" />` : ''}
      <time>${timeOf(m.createdAt)}</time>
    </div>`).join('') : '<div class="chat-empty">还没有消息，先打个招呼吧</div>';
  return `
    <div class="chat" id="chat-box">${list}</div>
    ${canSend ? `<form class="chat-input" data-form="chat-send" data-id="${a.id}">
      <input type="file" accept="image/png,image/jpeg,image/webp" id="chat-file" style="display:none" />
      <button class="btn" type="button" data-action="pick-image" title="上传图片">图片</button>
      <textarea class="textarea" name="content" rows="1" placeholder="输入消息，Enter 发送"></textarea>
      <button class="btn btn-primary" type="submit">发送</button>
    </form>` : '<div class="hint" style="margin-top:10px">该预约当前状态不可发送消息</div>'}`;
}

/* ---------------- 学生：匿名留言列表 ---------------- */

async function pageMessages() {
  const { messages } = await api('/anon-messages');
  const groups = new Map();
  for (const m of messages) {
    if (!groups.has(m.teacherId)) groups.set(m.teacherId, { name: m.teacherName, avatar: m.teacherAvatar, items: [] });
    groups.get(m.teacherId).items.push(m);
  }
  const cards = [...groups.entries()].map(([teacherId, g]) => `
    <div class="card">
      <div class="card-head">
        <div class="row">
          <span class="avatar">${esc(g.avatar || g.name[0])}</span>
          <h2>${esc(g.name)} 老师</h2>
        </div>
        <div class="row">
          <button class="btn btn-sm" data-action="open-anon" data-id="${teacherId}">继续留言</button>
          <a class="btn btn-sm btn-soft" href="#/teacher/${teacherId}">查看老师</a>
        </div>
      </div>
      <div class="msg-thread">${g.items.map((m) => msgItem(m)).join('')}</div>
    </div>`).join('');

  return {
    title: '匿名留言',
    subtitle: '纯文字留言，身份对老师保密；预约成功后老师才可见完整信息',
    html: cards || `
      <div class="card">
        ${empty('你还没有匿名留言，去老师列表选择一位老师开始吧')}
        <div style="text-align:center"><a class="btn btn-primary" href="#/teachers">浏览老师</a></div>
      </div>`,
  };
}

/* ---------------- 老师端 ---------------- */

async function pageTeacherAppointments() {
  const status = state.tab.tappts;
  const { appointments, counts } = await api(`/appointments?status=${status}`);
  const tabs = [['pending', '待处理'], ['approved', '已确认'], ['in_progress', '进行中'], ['completed', '已完成'], ['all', '全部']];
  const tabsHtml = tabs.map(([v, l]) =>
    `<button class="tab ${status === v ? 'active' : ''}" data-action="tab" data-group="tappts" data-value="${v}">${l}${counts && counts[v] != null ? ` ${counts[v]}` : ''}</button>`
  ).join('');

  return {
    title: '预约工作台',
    subtitle: '处理学生预约、接待咨询、延长时长与确认结束',
    html: `
      <div class="card">
        <div class="tabs">${tabsHtml}</div>
        ${appointments.length ? appointments.map((a) => `
          <div class="appt-row">
            <div class="appt-when">
              <b>${dateLabel(a.date)} ${a.weekday}</b>
              <span>${a.start}-${a.end}${a.extendMinutes ? `（+${a.extendMinutes} 分钟）` : ''}</span>
            </div>
            <div class="appt-main">
              <div class="who">${esc(a.student.name)}${a.student.className ? ` · ${esc(a.student.className)}` : ''} · ${esc(a.modeText)}</div>
              <div class="note">${esc(a.note || '未填写备注')}</div>
              ${a.cancelRequested ? '<div class="small" style="color:var(--warn);margin-top:4px">学生申请取消，待你确认</div>' : ''}
              ${a.endRequested ? '<div class="small" style="color:var(--warn);margin-top:4px">学生申请结束咨询</div>' : ''}
            </div>
            <div class="row">${statusBadge(a)}</div>
            <div class="appt-actions">
              <a class="btn btn-sm ${a.status === 'pending' ? 'btn-primary' : ''}" href="#/t/appointment/${a.id}">${a.status === 'pending' ? '处理预约' : '查看详情'}</a>
            </div>
          </div>`).join('') : empty('暂无该状态的预约')}
      </div>`,
  };
}

async function pageTeacherMessages() {
  const { messages } = await api('/anon-messages');
  const groups = new Map();
  for (const m of messages) {
    const key = m.studentId || `anon_${m.id}`;
    if (!groups.has(key)) groups.set(key, { name: m.studentName, items: [] });
    groups.get(key).items.push(m);
    if (m.studentId) groups.get(key).name = m.studentName;
  }
  const cards = [...groups.entries()].map(([key, g]) => {
    const visible = !key.startsWith('anon_');
    return `
      <div class="card">
        <div class="card-head">
          <h2>${esc(g.name)}${visible ? ' <span class="tag ok">预约成功，可见身份</span>' : ' <span class="tag gray">身份保密中</span>'}</h2>
          <button class="btn btn-sm" data-action="open-reply" data-id="${g.items[g.items.length - 1].id}" data-name="${esc(g.name)}">回复</button>
        </div>
        <div class="msg-thread">${g.items.map((m) => `
          <div class="msg-item ${m.isReply ? 'reply' : ''}">
            <b>${m.isReply ? '我（老师）' : esc(g.name)}</b>
            <div>${esc(m.content)}</div>
            <time>${dateTimeText(m.createdAt)}</time>
          </div>`).join('')}</div>
      </div>`;
  }).join('');

  return {
    title: '匿名留言',
    subtitle: '学生身份默认保密，预约成功后显示完整信息；仅支持纯文字',
    html: cards || `<div class="card">${empty('暂无学生留言')}</div>`,
  };
}

/* ---------------- 管理员 ---------------- */

async function pageAdminOverview() {
  const [stats, reviews] = await Promise.all([
    api('/admin/stats'),
    api('/admin/reviews?status=pending'),
  ]);
  return {
    title: '工作台总览',
    subtitle: '排班、审核与记录一览',
    html: `
      <div class="stat-grid">
        <div class="stat"><b>${stats.total}</b><span>预约单总数</span></div>
        <div class="stat"><b>${stats.pending}</b><span>待老师处理</span></div>
        <div class="stat"><b>${stats.approved}</b><span>已确认待进行</span></div>
        <div class="stat"><b>${stats.completed}</b><span>已完成咨询</span></div>
        <div class="stat"><b>${stats.reviewsPending}</b><span>待审核评价</span></div>
        <div class="stat"><b>${stats.archived}</b><span>已归档（3个月）</span></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>待审核评价</h2><a class="btn btn-sm" href="#/a/reviews">前往审核</a></div>
        ${reviews.reviews.length ? reviews.reviews.slice(0, 3).map((r) => `
          <div class="review">
            <div class="row spread"><b>${esc(r.student_name)} → ${esc(r.teacher_name)} 老师</b><span class="rating">${stars(r.rating)}</span></div>
            <div style="margin-top:4px">${esc(r.content)}</div>
            <div class="row" style="margin-top:8px">
              <button class="btn btn-sm btn-primary" data-action="review-decide" data-id="${r.id}" data-decide="approve">通过并公开</button>
              <button class="btn btn-sm btn-danger" data-action="review-decide" data-id="${r.id}" data-decide="reject">驳回</button>
            </div>
          </div>`).join('') : empty('没有待审核的评价')}
      </div>

      <div class="card">
        <div class="card-head"><h2>快捷操作</h2></div>
        <div class="row">
          <a class="btn" href="#/a/schedule">配置排班时段</a>
          <a class="btn" href="#/a/records">查看与导出记录</a>
          <a class="btn" href="#/a/reviews">评价审核</a>
        </div>
      </div>`,
  };
}

async function pageAdminSchedule() {
  const { schedules } = await api('/admin/schedule');
  const cards = schedules.map((s) => `
    <form class="card" data-form="schedule-save" data-teacher="${s.user_id}">
      <div class="card-head">
        <div class="row"><span class="avatar">${esc(s.avatar || s.name[0])}</span><h2>${esc(s.name)} 老师</h2></div>
        <span class="small muted">仅管理员可配置，老师不可自行排班</span>
      </div>
      <div class="row" style="align-items:flex-end;gap:14px">
        <div class="field" style="margin:0;flex:1">
          <label>上午时段</label>
          <div class="row">
            <input class="input" type="time" name="morningStart" value="${esc(s.morning_start)}" />
            <span class="muted">至</span>
            <input class="input" type="time" name="morningEnd" value="${esc(s.morning_end)}" />
          </div>
        </div>
        <div class="field" style="margin:0;flex:1">
          <label>下午时段</label>
          <div class="row">
            <input class="input" type="time" name="afternoonStart" value="${esc(s.afternoon_start)}" />
            <span class="muted">至</span>
            <input class="input" type="time" name="afternoonEnd" value="${esc(s.afternoon_end)}" />
          </div>
        </div>
        <button class="btn btn-primary" type="submit">保存</button>
      </div>
      <div class="hint" style="margin-top:10px">预约按 1 小时基础块拆分展示；如 14:00-17:30 会拆为 14:00-15:00、15:00-16:00、16:00-17:00、17:00-17:30。</div>
    </form>`).join('');
  return {
    title: '排班配置',
    subtitle: '统一配置每位老师的可预约时段，学生端实时生效',
    html: cards,
  };
}

async function pageAdminReviews() {
  const status = state.tab.reviews;
  const { reviews } = await api(`/admin/reviews?status=${status}`);
  const tabs = [['pending', '待审核'], ['approved', '已通过'], ['rejected', '已驳回'], ['all', '全部']];
  return {
    title: '评价审核',
    subtitle: '学生评价需审核通过后才会公开展示在老师详情页',
    html: `
      <div class="card">
        <div class="tabs">${tabs.map(([v, l]) => `<button class="tab ${status === v ? 'active' : ''}" data-action="tab" data-group="reviews" data-value="${v}">${l}</button>`).join('')}</div>
        ${reviews.length ? reviews.map((r) => `
          <div class="appt-row" style="align-items:flex-start">
            <div class="appt-main">
              <div class="who">${esc(r.student_name)} → ${esc(r.teacher_name)} 老师</div>
              <div class="rating" style="margin-top:4px">${stars(r.rating)}</div>
              <div class="note">${esc(r.content)}</div>
              <div class="small muted" style="margin-top:4px">${dateTimeText(r.created_at)}</div>
            </div>
            <div class="row">
              <span class="badge ${r.status === 'approved' ? 'completed' : r.status === 'rejected' ? 'rejected' : 'pending'}">${{ pending: '待审核', approved: '已公开', rejected: '已驳回' }[r.status]}</span>
              ${r.status === 'pending' ? `
                <button class="btn btn-sm btn-primary" data-action="review-decide" data-id="${r.id}" data-decide="approve">通过</button>
                <button class="btn btn-sm btn-danger" data-action="review-decide" data-id="${r.id}" data-decide="reject">驳回</button>` : ''}
            </div>
          </div>`).join('') : empty('暂无评价记录')}
      </div>`,
  };
}

async function pageAdminRecords() {
  const tab = state.tab.records;
  const tabs = [['appointments', '预约记录'], ['reviews', '评价记录'], ['messages', '留言记录']];
  let body = '';
  if (tab === 'appointments') {
    const { appointments } = await api('/admin/appointments');
    body = appointments.length ? appointments.map((a) => `
      <div class="appt-row">
        <div class="appt-when"><b>${a.date}</b><span>${a.start}-${a.end}</span></div>
        <div class="appt-main">
          <div class="who">${esc(a.student.name)}${a.student.className ? ` · ${esc(a.student.className)}` : ''} → ${esc(a.teacher.name)} 老师</div>
          <div class="note">${esc(a.modeText)}${a.note ? ` · ${esc(a.note)}` : ''}</div>
        </div>
        <div class="row">${statusBadge(a)}</div>
        <div class="appt-actions"><a class="btn btn-sm" href="#/appointment/${a.id}">查看</a></div>
      </div>`).join('') : empty('暂无预约记录');
  } else if (tab === 'reviews') {
    const { reviews } = await api('/admin/reviews?status=all');
    body = reviews.length ? reviews.map((r) => `
      <div class="appt-row">
        <div class="appt-main">
          <div class="who">${esc(r.student_name)} → ${esc(r.teacher_name)} 老师</div>
          <div class="note">${stars(r.rating)} · ${esc(r.content)}</div>
        </div>
        <div class="row"><span class="badge ${r.status === 'approved' ? 'completed' : r.status === 'rejected' ? 'rejected' : 'pending'}">${{ pending: '待审核', approved: '已公开', rejected: '已驳回' }[r.status]}</span></div>
      </div>`).join('') : empty('暂无评价记录');
  } else {
    const { messages } = await api('/anon-messages');
    body = messages.length ? messages.map((m) => `
      <div class="appt-row">
        <div class="appt-main">
          <div class="who">${esc(m.studentName)} → ${esc(m.teacherName)} 老师${m.isReply ? '（老师回复）' : ''}</div>
          <div class="note">${esc(m.content)}</div>
        </div>
        <div class="small muted">${dateTimeText(m.createdAt)}</div>
      </div>`).join('') : empty('暂无留言记录');
  }

  return {
    title: '记录与导出',
    subtitle: '管理员可查看全部预约、评价与留言，并按类型单独导出',
    html: `
      <div class="card">
        <div class="row spread">
          <div class="tabs" style="margin:0">${tabs.map(([v, l]) => `<button class="tab ${tab === v ? 'active' : ''}" data-action="tab" data-group="records" data-value="${v}">${l}</button>`).join('')}</div>
          <button class="btn btn-sm btn-primary" data-action="export" data-type="${tab}">导出${tab === 'appointments' ? '预约' : tab === 'reviews' ? '评价' : '留言'} CSV</button>
        </div>
        <div class="divider"></div>
        ${body}
      </div>
      <div class="card"><div class="hint">导出为 CSV（UTF-8 BOM），可直接用 Excel / WPS 打开。所有状态记录统一保存 3 个月，到期自动归档。</div></div>`,
  };
}

/* ---------------- 通知 ---------------- */

async function pageNotifications() {
  const { notifications } = await api('/notifications');
  return {
    title: '消息通知',
    subtitle: '全部为站内通知',
    html: `
      <div class="card">
        <div class="card-head"><h2>通知列表</h2><button class="btn btn-sm" data-action="mark-read">全部标为已读</button></div>
        ${notifications.length ? notifications.map((n) => `
          <div class="notif ${n.read ? 'read' : ''}">
            <span class="dot"></span>
            <div style="flex:1">
              <b>${esc(n.title)}</b>
              <p>${esc(n.body)}</p>
            </div>
            <time>${shortTime(n.createdAt)}</time>
          </div>`).join('') : empty('暂无通知')}
      </div>`,
  };
}

/* ---------------- 路由与渲染 ---------------- */

function pageForPath(pathParts) {
  const [p1, p2, p3] = pathParts;
  if (p1 === 'teachers') return pageTeachers();
  if (p1 === 'teacher' && p2) return pageTeacherDetail(p2);
  if (p1 === 'book' && p2) return pageBook(p2);
  if (p1 === 'appointments') return pageAppointments();
  if (p1 === 'appointment' && p2) return pageAppointmentDetail(p2);
  if (p1 === 'messages') return pageMessages();
  if (p1 === 'notifications') return pageNotifications();
  if (p1 === 't' && p2 === 'appointments') return pageTeacherAppointments();
  if (p1 === 't' && p2 === 'appointment' && p3) return pageAppointmentDetail(p3);
  if (p1 === 't' && p2 === 'messages') return pageTeacherMessages();
  if (p1 === 'a' && p2 === 'overview') return pageAdminOverview();
  if (p1 === 'a' && p2 === 'schedule') return pageAdminSchedule();
  if (p1 === 'a' && p2 === 'reviews') return pageAdminReviews();
  if (p1 === 'a' && p2 === 'records') return pageAdminRecords();
  throw new Error('页面不存在');
}

function roleAllowsDetailed(parts) {
  const [p1] = parts;
  if (!state.user) return false;
  if (state.user.role === 'student') return !['t', 'a'].includes(p1);
  if (state.user.role === 'teacher') return p1 === 't' || p1 === 'notifications';
  return true;
}

async function render() {
  if (!state.user) return renderLogin();
  let parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) { location.hash = defaultHash(); return; }
  if (!roleAllowsDetailed(parts)) {
    location.hash = defaultHash();
    return;
  }
  document.body.classList.remove('login-mode');
  const seq = ++state.renderSeq;
  let page;
  try {
    page = await pageForPath(parts);
  } catch (err) {
    if (seq !== state.renderSeq) return;
    page = {
      title: '出错了',
      subtitle: '',
      html: `<div class="card"><div class="error-text">${esc(err.message)}</div><div style="margin-top:12px"><a class="btn" href="${defaultHash()}">返回</a></div></div>`,
    };
  }
  if (seq !== state.renderSeq) return;
  root.innerHTML = layout(page.title, page.subtitle, page.html);
  loadUnread();
  if (location.hash.includes('/appointment/') || location.hash.startsWith('#/appointment/')) {
    const box = document.getElementById('chat-box');
    if (box) box.scrollTop = box.scrollHeight;
  }
}

/* ---------------- 事件处理 ---------------- */

const handlers = {
  async login(el) { await doLogin(el.dataset.username); },
  logout() { logout(); },
  'close-modal'() { closeModal(); },

  'filter-specialty'(el) {
    state.specialty = el.dataset.value === '全部' ? '' : el.dataset.value;
    render();
  },

  'teacher-detail'(el) { location.hash = `#/teacher/${el.dataset.id}`; },

  'pick-date'(el) {
    state.book.date = el.dataset.date;
    state.book.start = '';
    render();
  },
  'pick-slot'(el) {
    if (el.hasAttribute('disabled')) return;
    state.book.start = el.dataset.start;
    render();
  },
  'pick-mode'(el) {
    state.book.mode = el.dataset.mode;
    render();
  },

  'tab'(el) {
    state.tab[el.dataset.group] = el.dataset.value;
    render();
  },

  'open-anon'(el) {
    const id = el.dataset.id;
    openModal('匿名留言', `
      <div class="notice" style="margin-bottom:14px">留言仅支持纯文字；身份对老师保密，预约成功后老师才可见你的完整信息。请勿在留言中填写可识别个人身份的信息。</div>
      <form data-form="anon-send" data-id="${id}">
        <div class="field">
          <label>留言内容</label>
          <textarea class="textarea" name="content" maxlength="1000" placeholder="写下你想说的话…"></textarea>
        </div>
        <div class="row spread">
          <span class="small muted">老师会收到站内通知</span>
          <button class="btn btn-primary" type="submit">发送留言</button>
        </div>
      </form>`);
  },

  'open-reply'(el) {
    const id = el.dataset.id;
    openModal(`回复 ${el.dataset.name}`, `
      <form data-form="anon-reply" data-id="${id}">
        <div class="field">
          <label>回复内容</label>
          <textarea class="textarea" name="content" maxlength="1000" placeholder="回复学生的留言…"></textarea>
        </div>
        <div class="row spread">
          <span class="small muted">学生将收到站内通知</span>
          <button class="btn btn-primary" type="submit">发送回复</button>
        </div>
      </form>`);
  },

  'cancel-request'(el) {
    const id = el.dataset.id;
    openModal('申请取消预约', `
      <div class="notice" style="margin-bottom:14px">距开始 ≥ 2 小时可发起取消申请，需老师确认后生效；不足 2 小时请改为给老师留言，由老师手动取消。</div>
      <form data-form="cancel-request" data-id="${id}">
        <div class="field">
          <label>取消原因</label>
          <textarea class="textarea" name="reason" maxlength="300" placeholder="请说明取消原因"></textarea>
        </div>
        <div class="row spread">
          <button class="btn" type="button" data-action="close-modal">再想想</button>
          <button class="btn btn-danger" type="submit">提交取消申请</button>
        </div>
      </form>`);
  },

  'open-reject'(el) {
    const id = el.dataset.id;
    openModal('拒绝预约', `
      <form data-form="reject" data-id="${id}">
        <div class="field">
          <label>拒绝理由（必填，将随通知发送给学生）</label>
          <textarea class="textarea" name="reason" maxlength="300" placeholder="例如：该时段已安排团体辅导，请改约其他时间"></textarea>
        </div>
        <div class="row spread">
          <button class="btn" type="button" data-action="close-modal">取消</button>
          <button class="btn btn-danger" type="submit">确认拒绝</button>
        </div>
      </form>`);
  },

  'open-manual-cancel'(el) {
    const id = el.dataset.id;
    openModal('手动取消预约', `
      <div class="notice" style="margin-bottom:14px">适用于距开始不足 2 小时、学生已留言说明特殊情况的情形。取消后双方将收到站内通知。</div>
      <form data-form="manual-cancel" data-id="${id}">
        <div class="field">
          <label>取消说明（必填）</label>
          <textarea class="textarea" name="reason" maxlength="300" placeholder="请填写取消说明"></textarea>
        </div>
        <div class="row spread">
          <button class="btn" type="button" data-action="close-modal">取消</button>
          <button class="btn btn-danger" type="submit">确认取消</button>
        </div>
      </form>`);
  },

  'open-review'(el) {
    const id = el.dataset.id;
    openModal('提交评价', `
      <form data-form="review" data-id="${id}">
        <div class="field">
          <label>评分</label>
          <select class="select" name="rating">
            <option value="5">5 星 · 非常满意</option>
            <option value="4">4 星 · 满意</option>
            <option value="3">3 星 · 一般</option>
            <option value="2">2 星 · 不太满意</option>
            <option value="1">1 星 · 不满意</option>
          </select>
        </div>
        <div class="field">
          <label>评价内容</label>
          <textarea class="textarea" name="content" maxlength="600" placeholder="写下你的咨询感受（评价人信息不可见）"></textarea>
        </div>
        <div class="hint" style="margin-bottom:12px">评价需管理员审核通过后才会公开展示在老师详情页。</div>
        <div class="row spread">
          <button class="btn" type="button" data-action="close-modal">取消</button>
          <button class="btn btn-primary" type="submit">提交评价</button>
        </div>
      </form>`);
  },

  async approve(el) {
    try {
      await api(`/appointments/${el.dataset.id}/action`, { method: 'POST', body: { action: 'approve' } });
      toast('已同意预约，学生将收到站内通知');
      await render();
    } catch (err) { toast(err.message, true); }
  },

  async 'cancel-confirm'(el) {
    if (!confirm('确认取消该预约？双方将收到站内通知。')) return;
    try {
      await api(`/appointments/${el.dataset.id}/action`, { method: 'POST', body: { action: 'cancel-confirm' } });
      toast('预约已取消');
      await render();
    } catch (err) { toast(err.message, true); }
  },

  async 'end-request'(el) {
    if (!confirm('确认发起结束咨询申请？老师同意后本次咨询完成。')) return;
    try {
      await api(`/appointments/${el.dataset.id}/action`, { method: 'POST', body: { action: 'end-request' } });
      toast('结束申请已提交，等待老师确认');
      await render();
    } catch (err) { toast(err.message, true); }
  },

  async 'end-confirm'(el) {
    if (!confirm('同意结束本次咨询？状态将变更为已完成并开放评价。')) return;
    try {
      await api(`/appointments/${el.dataset.id}/action`, { method: 'POST', body: { action: 'end-confirm' } });
      toast('咨询已完成');
      await render();
    } catch (err) { toast(err.message, true); }
  },

  async extend(el) {
    const minutes = Number(el.dataset.minutes);
    if (!confirm(`确认延长 ${minutes} 分钟？后续相邻时段将置灰锁定，不可被其他学生预约。`)) return;
    try {
      await api(`/appointments/${el.dataset.id}/action`, { method: 'POST', body: { action: 'extend', minutes } });
      toast(`已延长 ${minutes} 分钟，相邻时段已锁定`);
      await render();
    } catch (err) { toast(err.message, true); }
  },

  async 'review-decide'(el) {
    const decide = el.dataset.decide;
    if (decide === 'reject' && !confirm('驳回该评价？学生将收到未通过通知。')) return;
    try {
      await api(`/admin/reviews/${el.dataset.id}`, { method: 'POST', body: { action: decide } });
      toast(decide === 'approve' ? '评价已通过并公开展示' : '评价已驳回');
      await render();
    } catch (err) { toast(err.message, true); }
  },

  async 'mark-read'() {
    try {
      await api('/notifications/read', { method: 'POST', body: {} });
      toast('已全部标为已读');
      await render();
    } catch (err) { toast(err.message, true); }
  },

  'chat-refresh'() { render(); },

  'pick-image'() {
    const input = document.getElementById('chat-file');
    if (input) input.click();
  },

  async export(el) {
    const type = el.dataset.type;
    try {
      const res = await fetch(`/api/admin/export?type=${type}`, { headers: { 'x-user-id': state.user.id } });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast('CSV 已开始下载');
    } catch (err) { toast(err.message, true); }
  },
};

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) {
    const overlay = event.target.closest('[data-overlay]');
    if (overlay && event.target === overlay) closeModal();
    return;
  }
  const fn = handlers[el.dataset.action];
  if (!fn) return;
  event.preventDefault();
  try {
    await fn(el);
  } catch (err) {
    toast(err.message || '操作失败', true);
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  const id = form.dataset.id || form.dataset.teacher;
  const fd = new FormData(form);

  try {
    if (kind === 'anon-send') {
      const content = (fd.get('content') || '').toString().trim();
      if (!content) throw new Error('留言内容不能为空');
      await api(`/teachers/${id}/anon-messages`, { method: 'POST', body: { content } });
      closeModal();
      toast('留言已发送，老师将收到站内通知');
      await render();
    } else if (kind === 'anon-reply') {
      const content = (fd.get('content') || '').toString().trim();
      if (!content) throw new Error('回复内容不能为空');
      await api(`/anon-messages/${id}/reply`, { method: 'POST', body: { content } });
      closeModal();
      toast('回复已发送，学生将收到站内通知');
      await render();
    } else if (kind === 'booking') {
      if (!state.book.start) throw new Error('请先选择可预约时段');
      await api('/appointments', {
        method: 'POST',
        body: {
          teacherId: state.book.teacherId,
          date: state.book.date,
          start: state.book.start,
          mode: state.book.mode,
          note: (fd.get('note') || '').toString(),
        },
      });
      state.book = null;
      toast('预约申请已提交，等待老师确认');
      location.hash = '#/appointments';
      await render();
    } else if (kind === 'chat-send') {
      const content = (fd.get('content') || '').toString().trim();
      const fileInput = document.getElementById('chat-file');
      let image = null;
      if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        if (file.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5MB');
        image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const { url } = await api('/upload', { method: 'POST', body: { dataUrl: image } });
        image = url;
      }
      if (!content && !image) throw new Error('请输入消息或选择图片');
      await api(`/appointments/${id}/messages`, { method: 'POST', body: { content, image } });
      await render();
    } else if (kind === 'cancel-request') {
      const reason = (fd.get('reason') || '').toString().trim();
      if (!reason) throw new Error('请填写取消原因');
      await api(`/appointments/${id}/action`, { method: 'POST', body: { action: 'cancel-request', reason } });
      closeModal();
      toast('取消申请已提交，等待老师确认');
      await render();
    } else if (kind === 'reject') {
      const reason = (fd.get('reason') || '').toString().trim();
      if (!reason) throw new Error('拒绝预约必须填写理由');
      await api(`/appointments/${id}/action`, { method: 'POST', body: { action: 'reject', reason } });
      closeModal();
      toast('已拒绝预约，学生将收到理由');
      await render();
    } else if (kind === 'manual-cancel') {
      const reason = (fd.get('reason') || '').toString().trim();
      if (!reason) throw new Error('请填写取消说明');
      await api(`/appointments/${id}/action`, { method: 'POST', body: { action: 'cancel-manual', reason } });
      closeModal();
      toast('预约已取消，学生将收到通知');
      await render();
    } else if (kind === 'review') {
      const content = (fd.get('content') || '').toString().trim();
      if (!content) throw new Error('请填写评价内容');
      await api('/reviews', {
        method: 'POST',
        body: { appointmentId: id, rating: Number(fd.get('rating')), content },
      });
      closeModal();
      toast('评价已提交，等待管理员审核');
      await render();
    } else if (kind === 'schedule-save') {
      await api('/admin/schedule', {
        method: 'PUT',
        body: {
          teacherId: id,
          morningStart: fd.get('morningStart'),
          morningEnd: fd.get('morningEnd'),
          afternoonStart: fd.get('afternoonStart'),
          afternoonEnd: fd.get('afternoonEnd'),
        },
      });
      toast('排班已保存');
      await render();
    }
  } catch (err) {
    toast(err.message || '操作失败', true);
  }
});

// Enter 发送消息
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
  const ta = event.target;
  if (event.key === 'Enter' && !event.shiftKey && ta.matches && ta.matches('[data-form="chat-send"] textarea')) {
    event.preventDefault();
    ta.closest('form').requestSubmit();
  }
});

window.addEventListener('hashchange', () => { render(); });

setInterval(loadUnread, 30000);

if (state.user) {
  if (!location.hash || location.hash === '#/') location.hash = defaultHash();
  render();
} else {
  renderLogin();
}
