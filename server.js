import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, STATUS } from './db.js';
import { nowParts, toTs, addDays, addMonths, weekdayCN, minutesOf, minutesNow } from './lib/time.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const uploadDir = path.join(root, 'data', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const BASE = process.env.PUBLIC_BASE || '';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '请求内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------- 通用查询 ---------------- */

function getUser(req) {
  const id = req.headers['x-user-id'];
  if (!id) throw new HttpError(401, '请先登录');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new HttpError(401, '登录状态无效，请重新登录');
  return user;
}

function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) throw new HttpError(403, '当前角色无权执行该操作');
}

function teacherRow(id) {
  return db.prepare(
    `SELECT u.id, u.name, u.avatar, t.title, t.years, t.specialties, t.bio
     FROM users u JOIN teachers t ON t.user_id = u.id WHERE u.id = ?`
  ).get(id);
}

function studentRow(id) {
  return db.prepare('SELECT id, name, class_name FROM users WHERE id = ?').get(id);
}

function getSchedule(teacherId) {
  const row = db.prepare('SELECT * FROM schedules WHERE teacher_id = ?').get(teacherId);
  return row || { morning_start: '10:00', morning_end: '12:00', afternoon_start: '14:00', afternoon_end: '17:30' };
}

function pad(n) {
  return String(n).padStart(2, '0');
}
function fmtMin(m) {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function scheduleBlocks(sched) {
  const blocks = [];
  const push = (s, e) => {
    let cur = minutesOf(s);
    const end = minutesOf(e);
    while (cur < end) {
      const nxt = Math.min(cur + 60, end);
      blocks.push({ start: fmtMin(cur), end: fmtMin(nxt) });
      cur = nxt;
    }
  };
  push(sched.morning_start, sched.morning_end);
  push(sched.afternoon_start, sched.afternoon_end);
  return blocks;
}

function teacherRating(teacherId) {
  const row = db.prepare(
    "SELECT AVG(rating) AS avg, COUNT(*) AS c FROM reviews WHERE teacher_id = ? AND status = 'approved'"
  ).get(teacherId);
  return { rating: row.avg ? Number(row.avg.toFixed(1)) : null, reviewCount: row.c };
}

const STATUS_TEXT = {
  pending: '待处理',
  approved: '预约成功',
  rejected: '已拒绝',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  archived: '已归档',
};

const MODE_TEXT = { online_text: '线上文字', offline: '线下会谈' };

function statusCounts(user) {
  let sql = "SELECT status, COUNT(*) AS c FROM appointments WHERE status != 'archived'";
  const params = [];
  if (user.role === 'student') { sql += ' AND student_id=?'; params.push(user.id); }
  else if (user.role === 'teacher') { sql += ' AND teacher_id=?'; params.push(user.id); }
  sql += ' GROUP BY status';
  const counts = { all: 0 };
  for (const row of db.prepare(sql).all(...params)) {
    counts[row.status] = row.c;
    counts.all += row.c;
  }
  return counts;
}

function appointmentView(a, viewer) {
  const teacher = teacherRow(a.teacher_id);
  const student = studentRow(a.student_id);
  const hidden = viewer.role === 'teacher' && !['approved', 'in_progress', 'completed'].includes(a.status);
  return {
    id: a.id,
    date: a.date,
    weekday: weekdayCN(a.date),
    start: a.start,
    end: a.end,
    mode: a.mode,
    modeText: MODE_TEXT[a.mode],
    note: a.note,
    status: a.status,
    statusText: STATUS_TEXT[a.status] || a.status,
    rejectReason: a.reject_reason,
    cancelRequested: !!a.cancel_requested,
    cancelReason: a.cancel_reason,
    endRequested: !!a.end_requested,
    extendMinutes: a.extend_minutes,
    teacher: { id: teacher.id, name: teacher.name, avatar: teacher.avatar },
    student: hidden
      ? { id: null, name: '匿名同学', className: '' }
      : { id: student.id, name: student.name, className: student.class_name },
    createdAt: a.created_at,
    completedAt: a.completed_at,
  };
}

function appointmentById(id) {
  return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
}

function canAccessAppointment(user, a) {
  if (!a) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'student') return a.student_id === user.id;
  return a.teacher_id === user.id;
}

function notifyUser(userId, type, title, body) {
  db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, read, created_at) VALUES (?,?,?,?,0,?)'
  ).run(userId, type, title, body, new Date().toISOString());
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/* ---------------- 状态自动流转 ---------------- */

function runTick() {
  const { date: today, time } = nowParts();
  const now = Date.now();

  const started = db.prepare(
    "SELECT * FROM appointments WHERE status = 'approved'"
  ).all();
  for (const a of started) {
    const startTs = toTs(a.date, a.start);
    if (startTs <= now && a.date === today) {
      db.prepare("UPDATE appointments SET status='in_progress', updated_at=? WHERE id=?").run(new Date().toISOString(), a.id);
      if (!a.reminded) {
        notifyUser(a.teacher_id, 'appointment_start', '咨询即将开始', `你与学生的${a.mode === 'offline' ? '线下会谈' : '线上文字咨询'}已到预约时间。`);
        notifyUser(a.student_id, 'appointment_start', '咨询即将开始', '已到预约时间，请进入预约详情开始咨询。');
        db.prepare('UPDATE appointments SET reminded=1 WHERE id=?').run(a.id);
      }
    }
  }

  const running = db.prepare("SELECT * FROM appointments WHERE status='in_progress'").all();
  for (const a of running) {
    if (a.overtime_notified) continue;
    const endTs = toTs(a.date, a.end) + a.extend_minutes * 60000;
    if (now >= endTs) {
      notifyUser(a.teacher_id, 'appointment_overtime', '咨询已超时', '本次咨询已达基础时长，可选择延长或等待学生发起结束。');
      notifyUser(a.student_id, 'appointment_overtime', '咨询已超时', '本次咨询已达基础时长，老师可延长咨询时间。');
      db.prepare('UPDATE appointments SET overtime_notified=1 WHERE id=?').run(a.id);
    }
  }

  const cutoff = addMonths(today, -3);
  const stale = db.prepare(
    "SELECT id, status FROM appointments WHERE status IN ('completed','cancelled','rejected') AND date < ?"
  ).all(cutoff);
  for (const a of stale) {
    db.prepare("UPDATE appointments SET status='archived', updated_at=? WHERE id=?").run(new Date().toISOString(), a.id);
  }
}

setInterval(() => {
  try {
    runTick();
  } catch (err) {
    console.error('tick error', err);
  }
}, 30 * 1000).unref();

/* ---------------- 业务处理 ---------------- */

function listTeachers() {
  const rows = db.prepare(
    `SELECT u.id, u.name, u.avatar, t.title, t.years, t.specialties, t.bio
     FROM users u JOIN teachers t ON t.user_id = u.id ORDER BY u.id`
  ).all();
  return rows.map((t) => {
    const rating = teacherRating(t.id);
    return {
      id: t.id,
      name: t.name,
      avatar: t.avatar,
      title: t.title,
      years: t.years,
      specialties: JSON.parse(t.specialties),
      bio: t.bio,
      rating: rating.rating,
      reviewCount: rating.reviewCount,
    };
  });
}

function teacherDetail(id) {
  const t = teacherRow(id);
  if (!t) throw new HttpError(404, '老师不存在');
  const rating = teacherRating(id);
  const reviews = db.prepare(
    `SELECT rating, content, created_at FROM reviews
     WHERE teacher_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 20`
  ).all(id);
  return {
    id: t.id,
    name: t.name,
    avatar: t.avatar,
    title: t.title,
    years: t.years,
    specialties: JSON.parse(t.specialties),
    bio: t.bio,
    rating: rating.rating,
    reviewCount: rating.reviewCount,
    reviews: reviews.map((r) => ({
      rating: r.rating,
      content: r.content,
      createdAt: r.created_at,
    })),
  };
}

function availability(teacherId, days = 14) {
  const sched = getSchedule(teacherId);
  const blocks = scheduleBlocks(sched);
  const { date: today, time: nowTime } = nowParts();
  const appts = db.prepare(
    "SELECT date, start, end, status, extend_minutes FROM appointments WHERE teacher_id = ? AND status IN ('pending','approved','in_progress')"
  ).all(teacherId);
  const locks = db.prepare('SELECT date, start FROM slot_locks WHERE teacher_id = ?').all(teacherId);
  const out = [];

  for (let i = 1; i <= days; i += 1) {
    const date = addDays(today, i);
    const slots = blocks.map((b) => {
      const occupied = appts.find((a) => a.date === date && a.start === b.start);
      const locked = locks.some((l) => l.date === date && l.start === b.start);
      const past = date === today && b.start <= nowTime;
      let status = 'available';
      if (occupied) status = 'booked';
      else if (locked) status = 'locked';
      else if (past) status = 'past';
      return { start: b.start, end: b.end, status, appointmentId: occupied ? undefined : null };
    });
    const availableCount = slots.filter((s) => s.status === 'available').length;
    out.push({ date, weekday: weekdayCN(date), slots, availableCount });
  }
  return { config: sched, days: out };
}

function createAppointment(user, body) {
  requireRole(user, 'student');
  const { teacherId, date, start, mode, note } = body || {};
  if (!teacherId || !date || !start) throw new HttpError(400, '缺少预约参数');
  if (!['online_text', 'offline'].includes(mode)) throw new HttpError(400, '请选择咨询形式');
  const teacher = teacherRow(teacherId);
  if (!teacher) throw new HttpError(404, '老师不存在');

  const { date: today } = nowParts();
  if (date <= today) throw new HttpError(400, '只能预约次日及以后的时段');

  const sched = getSchedule(teacherId);
  const block = scheduleBlocks(sched).find((b) => b.start === start);
  if (!block) throw new HttpError(400, '该时段不在可预约范围内');

  const conflict = db.prepare(
    "SELECT id FROM appointments WHERE teacher_id = ? AND date = ? AND start = ? AND status IN ('pending','approved','in_progress')"
  ).get(teacherId, date, start);
  if (conflict) throw new HttpError(409, '该时段已被预约');

  const locked = db.prepare('SELECT id FROM slot_locks WHERE teacher_id = ? AND date = ? AND start = ?').get(teacherId, date, start);
  if (locked) throw new HttpError(409, '该时段因咨询延长已锁定');

  const id = newId('a');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO appointments (id, student_id, teacher_id, date, start, end, mode, note, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, user.id, teacherId, date, block.start, block.end, mode, note || '', 'pending', now, now);

  notifyUser(teacherId, 'appointment_pending', '新的预约申请', `${user.name}申请 ${date} ${block.start}-${block.end} ${MODE_TEXT[mode]}咨询，请及时处理。`);
  return { id };
}

function extendConsultation(a, minutes) {
  const delta = Number(minutes);
  if (![30, 60].includes(delta)) throw new HttpError(400, '延长时长只能为 30 或 60 分钟');
  if (!['approved', 'in_progress'].includes(a.status)) throw new HttpError(400, '当前状态不可延长');

  const sched = getSchedule(a.teacher_id);
  const blocks = scheduleBlocks(sched);
  const oldEnd = minutesOf(a.end) + a.extend_minutes;
  const newEnd = oldEnd + delta;
  const now = new Date().toISOString();

  db.prepare('UPDATE appointments SET extend_minutes=?, updated_at=? WHERE id=?').run(a.extend_minutes + delta, now, a.id);

  // 与延长区间重叠的时段块，以及紧邻的后续时段块，都需要置灰锁定
  const targets = blocks.filter((b) => minutesOf(b.end) > oldEnd && minutesOf(b.start) < newEnd);
  const nextBlock = blocks.find((b) => minutesOf(b.start) >= oldEnd);
  if (nextBlock) targets.push(nextBlock);
  for (const b of targets) {
    if (minutesOf(b.start) < minutesOf(a.start)) continue;
    const exists = db.prepare(
      'SELECT id FROM slot_locks WHERE teacher_id=? AND date=? AND start=?'
    ).get(a.teacher_id, a.date, b.start);
    if (!exists) {
      db.prepare(
        'INSERT INTO slot_locks (teacher_id, date, start, end, appointment_id) VALUES (?,?,?,?,?)'
      ).run(a.teacher_id, a.date, b.start, b.end, a.id);
    }
  }
  const student = studentRow(a.student_id);
  notifyUser(a.student_id, 'consultation_extended', '咨询时长已延长', `${student.name}，老师将本次咨询延长了 ${delta} 分钟。`);
  return { extendMinutes: a.extend_minutes + delta };
}

function appointmentAction(user, a, body) {
  const { action } = body || {};
  const now = new Date().toISOString();

  if (action === 'approve') {
    requireRole(user, 'teacher');
    if (a.teacher_id !== user.id) throw new HttpError(403, '无权处理该预约');
    if (a.status !== 'pending') throw new HttpError(400, '该预约不在待处理状态');
    db.prepare("UPDATE appointments SET status='approved', updated_at=? WHERE id=?").run(now, a.id);
    notifyUser(a.student_id, 'appointment_approved', '预约成功', `${a.date} ${a.start}-${a.end} 的咨询已确认，请准时参加。`);
    return { ok: true };
  }

  if (action === 'reject') {
    requireRole(user, 'teacher');
    if (a.teacher_id !== user.id) throw new HttpError(403, '无权处理该预约');
    if (a.status !== 'pending') throw new HttpError(400, '该预约不在待处理状态');
    const reason = (body.reason || '').trim();
    if (!reason) throw new HttpError(400, '拒绝预约必须填写理由');
    db.prepare("UPDATE appointments SET status='rejected', reject_reason=?, updated_at=? WHERE id=?").run(reason, now, a.id);
    notifyUser(a.student_id, 'appointment_rejected', '预约未通过', `老师拒绝了你的预约申请。理由：${reason}`);
    return { ok: true };
  }

  if (action === 'cancel-request') {
    requireRole(user, 'student');
    if (a.status !== 'approved') throw new HttpError(400, '当前预约不可取消');
    if (a.cancel_requested) throw new HttpError(400, '已提交过取消申请');
    const leftMs = toTs(a.date, a.start) - Date.now();
    if (leftMs < 2 * 3600 * 1000) throw new HttpError(400, '距开始不足2小时，无法直接取消，请给老师留言说明情况');
    const reason = (body.reason || '').trim();
    if (!reason) throw new HttpError(400, '请填写取消原因');
    db.prepare('UPDATE appointments SET cancel_requested=1, cancel_reason=?, updated_at=? WHERE id=?').run(reason, now, a.id);
    notifyUser(a.teacher_id, 'cancel_request', '取消预约申请', `${studentRow(a.student_id).name}申请取消 ${a.date} ${a.start} 的预约。原因：${reason}`);
    return { ok: true };
  }

  if (action === 'cancel-confirm') {
    requireRole(user, 'teacher');
    if (a.teacher_id !== user.id) throw new HttpError(403, '无权处理该预约');
    if (!a.cancel_requested) throw new HttpError(400, '该预约没有取消申请');
    db.prepare("UPDATE appointments SET status='cancelled', cancel_requested=0, updated_at=? WHERE id=?").run(now, a.id);
    notifyUser(a.student_id, 'appointment_cancelled', '预约已取消', `${a.date} ${a.start} 的预约已取消。`);
    notifyUser(a.teacher_id, 'appointment_cancelled', '取消已确认', `已取消 ${a.date} ${a.start} 的预约。`);
    return { ok: true };
  }

  if (action === 'cancel-manual') {
    requireRole(user, 'teacher');
    if (a.teacher_id !== user.id) throw new HttpError(403, '无权处理该预约');
    if (!['approved'].includes(a.status)) throw new HttpError(400, '当前状态不可取消');
    const reason = (body.reason || '').trim();
    if (!reason) throw new HttpError(400, '请填写取消理由');
    db.prepare("UPDATE appointments SET status='cancelled', cancel_reason=?, updated_at=? WHERE id=?").run(reason, now, a.id);
    notifyUser(a.student_id, 'appointment_cancelled', '预约已取消', `老师取消了 ${a.date} ${a.start} 的预约。说明：${reason}`);
    return { ok: true };
  }

  if (action === 'extend') {
    requireRole(user, 'teacher');
    if (a.teacher_id !== user.id) throw new HttpError(403, '无权处理该预约');
    return extendConsultation(a, body.minutes);
  }

  if (action === 'end-request') {
    requireRole(user, 'student');
    if (a.status !== 'in_progress') throw new HttpError(400, '咨询未在进行中');
    if (a.end_requested) throw new HttpError(400, '已发起结束申请');
    db.prepare('UPDATE appointments SET end_requested=1, updated_at=? WHERE id=?').run(now, a.id);
    notifyUser(a.teacher_id, 'end_request', '学生申请结束咨询', `${studentRow(a.student_id).name}申请结束本次咨询，请确认。`);
    return { ok: true };
  }

  if (action === 'end-confirm') {
    requireRole(user, 'teacher');
    if (a.teacher_id !== user.id) throw new HttpError(403, '无权处理该预约');
    if (!a.end_requested) throw new HttpError(400, '学生尚未发起结束申请');
    db.prepare("UPDATE appointments SET status='completed', completed_at=?, updated_at=? WHERE id=?").run(now, now, a.id);
    notifyUser(a.student_id, 'appointment_completed', '咨询已完成', '本次咨询已结束，可前往预约详情提交评价。');
    return { ok: true };
  }

  throw new HttpError(400, '不支持的操作');
}

/* ---------------- 导出 CSV ---------------- */

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(type) {
  let header = [];
  let rows = [];
  if (type === 'appointments') {
    header = ['预约单号', '日期', '时段', '咨询形式', '学生', '院系专业', '老师', '状态', '备注', '拒绝/取消原因', '创建时间'];
    rows = db.prepare(
      `SELECT a.*, s.name AS student_name, s.class_name, t.name AS teacher_name
       FROM appointments a JOIN users s ON s.id=a.student_id JOIN users t ON t.id=a.teacher_id
       ORDER BY a.date DESC`
    ).all().map((a) => [
      a.id, a.date, `${a.start}-${a.end}`, MODE_TEXT[a.mode], a.student_name, a.class_name,
      a.teacher_name, STATUS_TEXT[a.status], a.note, a.reject_reason || a.cancel_reason || '', a.created_at,
    ]);
  } else if (type === 'reviews') {
    header = ['评价单号', '老师', '评分', '评价内容', '状态', '提交时间'];
    rows = db.prepare(
      `SELECT r.*, t.name AS teacher_name FROM reviews r JOIN users t ON t.id=r.teacher_id ORDER BY r.created_at DESC`
    ).all().map((r) => [r.id, r.teacher_name, r.rating, r.content, STATUS_TEXT[r.status] || r.status, r.created_at]);
  } else if (type === 'messages') {
    header = ['留言编号', '老师', '学生', '内容', '是否老师回复', '时间'];
    rows = db.prepare(
      `SELECT m.*, t.name AS teacher_name, s.name AS student_name
       FROM anon_messages m JOIN users t ON t.id=m.teacher_id JOIN users s ON s.id=m.student_id
       ORDER BY m.created_at DESC`
    ).all().map((m) => [m.id, m.teacher_name, m.student_name, m.content, m.is_reply ? '是' : '否', m.created_at]);
  } else {
    throw new HttpError(400, '不支持的导出类型');
  }
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

/* ---------------- 路由 ---------------- */

async function handleApi(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '');
  const method = req.method;

  // 公开接口
  if (method === 'POST' && p === '/login') {
    return readBody(req).then((body) => {
      const username = (body.username || '').trim();
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user) throw new HttpError(404, '账号不存在，请使用演示账号登录');
      const teacher = user.role === 'teacher' ? teacherRow(user.id) : null;
      sendJson(res, 200, {
        user: {
          id: user.id, name: user.name, role: user.role, className: user.class_name,
          avatar: user.avatar, specialties: teacher ? JSON.parse(teacher.specialties) : [],
        },
      });
    });
  }

  if (method === 'GET' && p === '/bootstrap') {
    const users = db.prepare('SELECT id, username, name, role, avatar FROM users ORDER BY role, id').all();
    const specialties = new Set();
    for (const t of listTeachers()) t.specialties.forEach((s) => specialties.add(s));
    return sendJson(res, 200, {
      demoAccounts: users.map((u) => ({ username: u.username, name: u.name, role: u.role, avatar: u.avatar })),
      specialties: [...specialties],
    });
  }

  return (async () => {
    const user = getUser(req);

    if (method === 'GET' && p === '/me') return sendJson(res, 200, { user });

    /* --- 老师列表 / 详情 / 可约时段 --- */
    if (method === 'GET' && p === '/teachers') {
      const specialty = url.searchParams.get('specialty');
      let list = listTeachers();
      if (specialty && specialty !== '全部') list = list.filter((t) => t.specialties.includes(specialty));
      return sendJson(res, 200, { teachers: list });
    }

    const teacherSlots = p.match(/^\/teachers\/([^/]+)\/slots$/);
    if (method === 'GET' && teacherSlots) {
      return sendJson(res, 200, availability(teacherSlots[1], Number(url.searchParams.get('days') || 14)));
    }

    const teacherDetailMatch = p.match(/^\/teachers\/([^/]+)$/);
    if (method === 'GET' && teacherDetailMatch) {
      return sendJson(res, 200, { teacher: teacherDetail(teacherDetailMatch[1]) });
    }

    /* --- 匿名留言 --- */
    if (method === 'POST' && teacherSlots === null) {
      const anonPost = p.match(/^\/teachers\/([^/]+)\/anon-messages$/);
      if (anonPost) {
        requireRole(user, 'student');
        const body = await readBody(req);
        const content = (body.content || '').trim();
        if (!content) throw new HttpError(400, '留言内容不能为空');
        if (content.length > 1000) throw new HttpError(400, '留言内容过长');
        const teacher = teacherRow(anonPost[1]);
        if (!teacher) throw new HttpError(404, '老师不存在');
        const id = newId('m');
        db.prepare(
          'INSERT INTO anon_messages (id, teacher_id, student_id, content, is_reply, created_at) VALUES (?,?,?,?,0,?)'
        ).run(id, anonPost[1], user.id, content, new Date().toISOString());
        notifyUser(anonPost[1], 'anon_message', '收到新的匿名留言', '有同学给你留了一条匿名留言，请及时查看。');
        return sendJson(res, 200, { id });
      }
    }

    if (method === 'GET' && p === '/anon-messages') {
      if (user.role === 'student') {
        const rows = db.prepare(
          `SELECT m.*, t.name AS teacher_name, t.avatar AS teacher_avatar
           FROM anon_messages m JOIN users t ON t.id=m.teacher_id
           WHERE m.student_id=? ORDER BY m.created_at ASC`
        ).all(user.id);
        return sendJson(res, 200, {
          messages: rows.map((m) => ({
            id: m.id, teacherId: m.teacher_id, teacherName: m.teacher_name, teacherAvatar: m.teacher_avatar,
            content: m.content, isReply: !!m.is_reply, createdAt: m.created_at,
          })),
        });
      }
      if (user.role === 'teacher') {
        const rows = db.prepare(
          'SELECT * FROM anon_messages WHERE teacher_id=? ORDER BY created_at ASC'
        ).all(user.id);
        const nameCache = new Map();
        const messages = rows.map((m) => {
          let displayName = '匿名同学';
          const ok = db.prepare(
            "SELECT 1 FROM appointments WHERE student_id=? AND teacher_id=? AND status IN ('approved','in_progress','completed') LIMIT 1"
          ).get(m.student_id, user.id);
          if (ok) {
            if (!nameCache.has(m.student_id)) nameCache.set(m.student_id, studentRow(m.student_id));
            displayName = nameCache.get(m.student_id).name;
          }
          return {
            id: m.id, studentId: ok ? m.student_id : null, studentName: displayName,
            content: m.content, isReply: !!m.is_reply, createdAt: m.created_at,
          };
        });
        return sendJson(res, 200, { messages });
      }
      if (user.role === 'admin') {
        const rows = db.prepare(
          `SELECT m.*, s.name AS student_name, t.name AS teacher_name
           FROM anon_messages m JOIN users s ON s.id=m.student_id JOIN users t ON t.id=m.teacher_id
           ORDER BY m.created_at ASC`
        ).all();
        return sendJson(res, 200, {
          messages: rows.map((m) => ({
            id: m.id, studentId: m.student_id, studentName: m.student_name,
            teacherName: m.teacher_name, teacherId: m.teacher_id,
            content: m.content, isReply: !!m.is_reply, createdAt: m.created_at,
          })),
        });
      }
      throw new HttpError(403, '当前角色不支持查看留言');
    }

    const anonReply = p.match(/^\/anon-messages\/([^/]+)\/reply$/);
    if (method === 'POST' && anonReply) {
      requireRole(user, 'teacher');
      const body = await readBody(req);
      const content = (body.content || '').trim();
      if (!content) throw new HttpError(400, '回复内容不能为空');
      const msg = db.prepare('SELECT * FROM anon_messages WHERE id=?').get(anonReply[1]);
      if (!msg || msg.teacher_id !== user.id) throw new HttpError(404, '留言不存在');
      db.prepare(
        'INSERT INTO anon_messages (id, teacher_id, student_id, content, is_reply, created_at) VALUES (?,?,?,?,1,?)'
      ).run(newId('m'), msg.teacher_id, msg.student_id, content, new Date().toISOString());
      const student = studentRow(msg.student_id);
      notifyUser(msg.student_id, 'message_reply', '老师回复了你的留言', `${user.name}老师回复了你的匿名留言：${content.slice(0, 40)}${content.length > 40 ? '…' : ''}`);
      return sendJson(res, 200, { ok: true, student: { id: student.id, name: student.name } });
    }

    /* --- 预约 --- */
    if (method === 'POST' && p === '/appointments') {
      const body = await readBody(req);
      return sendJson(res, 200, createAppointment(user, body));
    }

    if (method === 'GET' && p === '/appointments') {
      const includeArchived = url.searchParams.get('includeArchived') === '1';
      const status = url.searchParams.get('status');
      let sql = 'SELECT * FROM appointments WHERE 1=1';
      const params = [];
      if (user.role === 'student') { sql += ' AND student_id=?'; params.push(user.id); }
      else if (user.role === 'teacher') { sql += ' AND teacher_id=?'; params.push(user.id); }
      if (!includeArchived) sql += " AND status != 'archived'";
      if (status && status !== 'all') { sql += ' AND status=?'; params.push(status); }
      sql += ' ORDER BY date DESC, start DESC';
      const rows = db.prepare(sql).all(...params);
      return sendJson(res, 200, {
        appointments: rows.map((a) => appointmentView(a, user)),
        counts: statusCounts(user),
      });
    }

    const apptDetail = p.match(/^\/appointments\/([^/]+)$/);
    if (method === 'GET' && apptDetail) {
      const a = appointmentById(apptDetail[1]);
      if (!canAccessAppointment(user, a)) throw new HttpError(404, '预约不存在');
      const messages = db.prepare(
        'SELECT id, sender_id, content, image, created_at FROM chat_messages WHERE appointment_id=? ORDER BY id ASC'
      ).all(a.id).map((m) => ({
        id: m.id, mine: m.sender_id === user.id,
        sender: m.sender_id === user.id ? '我' : (user.role === 'teacher' ? '学生' : '老师'),
        content: m.content, image: m.image, createdAt: m.created_at,
      }));
      const review = db.prepare('SELECT * FROM reviews WHERE appointment_id=?').get(a.id);
      const teacher = teacherRow(a.teacher_id);
      return sendJson(res, 200, {
        appointment: appointmentView(a, user),
        messages,
        review: review ? { id: review.id, rating: review.rating, content: review.content, status: review.status } : null,
        teacherSchedule: getSchedule(a.teacher_id),
        teacherName: teacher.name,
      });
    }

    const apptAction = p.match(/^\/appointments\/([^/]+)\/action$/);
    if (method === 'POST' && apptAction) {
      const body = await readBody(req);
      const a = appointmentById(apptAction[1]);
      if (!canAccessAppointment(user, a)) throw new HttpError(404, '预约不存在');
      return sendJson(res, 200, appointmentAction(user, a, body));
    }

    const apptMessages = p.match(/^\/appointments\/([^/]+)\/messages$/);
    if (apptMessages) {
      const a = appointmentById(apptMessages[1]);
      if (!canAccessAppointment(user, a)) throw new HttpError(404, '预约不存在');
      if (a.mode !== 'online_text') throw new HttpError(400, '线下会谈无线上会话');
      if (method === 'GET') {
        const rows = db.prepare(
          'SELECT id, sender_id, content, image, created_at FROM chat_messages WHERE appointment_id=? ORDER BY id ASC'
        ).all(a.id);
        return sendJson(res, 200, {
          messages: rows.map((m) => ({ id: m.id, mine: m.sender_id === user.id, content: m.content, image: m.image, createdAt: m.created_at })),
        });
      }
      if (method === 'POST') {
        if (!['approved', 'in_progress', 'completed'].includes(a.status)) throw new HttpError(400, '预约尚未确认，暂不能开始会话');
        const body = await readBody(req);
        const content = (body.content || '').trim();
        const image = body.image || null;
        if (!content && !image) throw new HttpError(400, '消息不能为空');
        db.prepare(
          'INSERT INTO chat_messages (appointment_id, sender_id, content, image, created_at) VALUES (?,?,?,?,?)'
        ).run(a.id, user.id, content, image, new Date().toISOString());
        const other = user.role === 'student' ? a.teacher_id : a.student_id;
        notifyUser(other, 'chat_message', '新的咨询消息', `${user.name}在咨询会话中发来新消息。`);
        return sendJson(res, 200, { ok: true });
      }
    }

    /* --- 评价 --- */
    if (method === 'POST' && p === '/reviews') {
      requireRole(user, 'student');
      const body = await readBody(req);
      const a = appointmentById(body.appointmentId);
      if (!a || a.student_id !== user.id) throw new HttpError(404, '预约不存在');
      if (a.status !== 'completed') throw new HttpError(400, '咨询完成后才能评价');
      if (db.prepare('SELECT id FROM reviews WHERE appointment_id=?').get(a.id)) throw new HttpError(400, '该预约已提交过评价');
      const rating = Number(body.rating);
      if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, '请选择 1-5 星评分');
      const content = (body.content || '').trim();
      if (!content) throw new HttpError(400, '请填写评价内容');
      const id = newId('r');
      db.prepare(
        'INSERT INTO reviews (id, appointment_id, student_id, teacher_id, rating, content, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(id, a.id, user.id, a.teacher_id, rating, content, 'pending', new Date().toISOString());
      notifyUser('u_admin', 'review_pending', '待审核评价', `${studentRow(user.id).name}提交了对${teacherRow(a.teacher_id).name}老师的评价，请审核。`);
      return sendJson(res, 200, { id });
    }

    /* --- 通知 --- */
    if (method === 'GET' && p === '/notifications') {
      const rows = db.prepare(
        'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50'
      ).all(user.id);
      return sendJson(res, 200, {
        notifications: rows.map((n) => ({
          id: n.id, type: n.type, title: n.title, body: n.body, read: !!n.read, createdAt: n.created_at,
        })),
        unread: rows.filter((n) => !n.read).length,
      });
    }
    if (method === 'POST' && p === '/notifications/read') {
      const body = await readBody(req);
      if (body.id) db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(body.id, user.id);
      else db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(user.id);
      return sendJson(res, 200, { ok: true });
    }

    /* --- 图片上传 --- */
    if (method === 'POST' && p === '/upload') {
      const body = await readBody(req);
      const dataUrl = body.dataUrl || '';
      const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
      if (!m) throw new HttpError(400, '仅支持 PNG/JPG/WEBP 图片');
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, '图片不能超过 5MB');
      const name = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(uploadDir, name), buf);
      return sendJson(res, 200, { url: `${BASE}/uploads/${name}` });
    }

    /* --- 管理员 --- */
    if (user.role === 'admin') {
      if (method === 'GET' && p === '/admin/schedule') {
        const rows = db.prepare(
          `SELECT t.user_id, u.name, u.avatar, s.morning_start, s.morning_end, s.afternoon_start, s.afternoon_end
           FROM teachers t JOIN users u ON u.id=t.user_id JOIN schedules s ON s.teacher_id=t.user_id`
        ).all();
        return sendJson(res, 200, { schedules: rows });
      }
      if (method === 'PUT' && p === '/admin/schedule') {
        const body = await readBody(req);
        const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
        const fields = [body.morningStart, body.morningEnd, body.afternoonStart, body.afternoonEnd];
        if (fields.some((f) => !timeRe.test(f || ''))) throw new HttpError(400, '时间格式应为 HH:MM');
        if (minutesOf(body.morningStart) >= minutesOf(body.morningEnd) || minutesOf(body.afternoonStart) >= minutesOf(body.afternoonEnd)) {
          throw new HttpError(400, '开始时间必须早于结束时间');
        }
        db.prepare(
          'UPDATE schedules SET morning_start=?, morning_end=?, afternoon_start=?, afternoon_end=? WHERE teacher_id=?'
        ).run(body.morningStart, body.morningEnd, body.afternoonStart, body.afternoonEnd, body.teacherId);
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'GET' && p === '/admin/reviews') {
        const status = url.searchParams.get('status') || 'pending';
        let sql = `SELECT r.*, t.name AS teacher_name, s.name AS student_name
                   FROM reviews r JOIN users t ON t.id=r.teacher_id JOIN users s ON s.id=r.student_id`;
        const params = [];
        if (status !== 'all') { sql += ' WHERE r.status=?'; params.push(status); }
        sql += ' ORDER BY r.created_at DESC';
        return sendJson(res, 200, { reviews: db.prepare(sql).all(...params) });
      }

      const adminReview = p.match(/^\/admin\/reviews\/([^/]+)$/);
      if (method === 'POST' && adminReview) {
        const body = await readBody(req);
        const r = db.prepare('SELECT * FROM reviews WHERE id=?').get(adminReview[1]);
        if (!r) throw new HttpError(404, '评价不存在');
        if (body.action === 'approve') {
          db.prepare("UPDATE reviews SET status='approved' WHERE id=?").run(r.id);
          notifyUser(r.student_id, 'review_approved', '评价已通过审核', '你的咨询评价已公开展示在老师详情页。');
        } else if (body.action === 'reject') {
          db.prepare("UPDATE reviews SET status='rejected' WHERE id=?").run(r.id);
          notifyUser(r.student_id, 'review_rejected', '评价未通过审核', body.reason ? `原因：${body.reason}` : '评价未通过审核。');
        } else {
          throw new HttpError(400, '不支持的操作');
        }
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'GET' && p === '/admin/appointments') {
        const rows = db.prepare(
          `SELECT a.* FROM appointments a ORDER BY a.date DESC, a.start DESC`
        ).all();
        return sendJson(res, 200, { appointments: rows.map((a) => appointmentView(a, user)) });
      }

      if (method === 'GET' && p === '/admin/stats') {
        const total = db.prepare('SELECT COUNT(*) c FROM appointments').get().c;
        const pending = db.prepare("SELECT COUNT(*) c FROM appointments WHERE status='pending'").get().c;
        const approved = db.prepare("SELECT COUNT(*) c FROM appointments WHERE status='approved'").get().c;
        const completed = db.prepare("SELECT COUNT(*) c FROM appointments WHERE status='completed'").get().c;
        const reviewsPending = db.prepare("SELECT COUNT(*) c FROM reviews WHERE status='pending'").get().c;
        const archived = db.prepare("SELECT COUNT(*) c FROM appointments WHERE status='archived'").get().c;
        return sendJson(res, 200, { total, pending, approved, completed, reviewsPending, archived });
      }

      if (method === 'GET' && p === '/admin/export') {
        const type = url.searchParams.get('type') || 'appointments';
        const csv = exportCsv(type);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${type}-${nowParts().date}.csv"`,
        });
        return res.end(csv);
      }
    }

    throw new HttpError(404, '接口不存在');
  })();
}

/* ---------------- 静态文件 ---------------- */

function serveStatic(req, res, url) {
  if (url.pathname.startsWith('/uploads/')) {
    const file = path.join(uploadDir, path.basename(url.pathname));
    if (!fs.existsSync(file)) return notFound(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    return fs.createReadStream(file).pipe(res);
  }
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(publicDir, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return notFound(res);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  return fs.createReadStream(file).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url)
      .then(() => {})
      .catch((err) => {
        if (res.headersSent) return res.end();
        if (err instanceof HttpError) {
          sendJson(res, err.status, { ok: false, message: err.message, ...err.extra });
        } else {
          console.error(err);
          sendJson(res, 500, { ok: false, message: '服务器内部错误' });
        }
      });
    return;
  }
  serveStatic(req, res, url);
});

runTick();
server.listen(PORT, () => {
  console.log(`校园心理健康咨询平台已启动: http://localhost:${PORT}`);
});
