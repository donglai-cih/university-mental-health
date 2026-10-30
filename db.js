import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowParts, addDays, addMonths } from './lib/time.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  class_name TEXT,
  avatar TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teachers (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  title TEXT,
  years INTEGER,
  specialties TEXT NOT NULL,
  bio TEXT
);

CREATE TABLE IF NOT EXISTS schedules (
  teacher_id TEXT PRIMARY KEY REFERENCES users(id),
  morning_start TEXT NOT NULL DEFAULT '10:00',
  morning_end TEXT NOT NULL DEFAULT '12:00',
  afternoon_start TEXT NOT NULL DEFAULT '14:00',
  afternoon_end TEXT NOT NULL DEFAULT '17:30'
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  mode TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  end_requested INTEGER NOT NULL DEFAULT 0,
  extend_minutes INTEGER NOT NULL DEFAULT 0,
  reminded INTEGER NOT NULL DEFAULT 0,
  overtime_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appt_teacher ON appointments(teacher_id, date);
CREATE INDEX IF NOT EXISTS idx_appt_student ON appointments(student_id, date);

CREATE TABLE IF NOT EXISTS slot_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id TEXT NOT NULL,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  appointment_id TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT,
  image TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anon_messages (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  content TEXT NOT NULL,
  is_reply INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

function insertUser(u) {
  db.prepare(
    'INSERT INTO users (id, username, name, role, class_name, avatar, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(u.id, u.username, u.name, u.role, u.class_name ?? null, u.avatar ?? null, u.created_at);
}

function insertTeacher(userId, title, years, specialties, bio) {
  db.prepare('INSERT INTO teachers (user_id, title, years, specialties, bio) VALUES (?,?,?,?,?)').run(
    userId,
    title,
    years,
    JSON.stringify(specialties),
    bio
  );
  db.prepare('INSERT INTO schedules (teacher_id) VALUES (?)').run(userId);
}

function insertAppt(a) {
  db.prepare(
    `INSERT INTO appointments
     (id, student_id, teacher_id, date, start, end, mode, note, status, reject_reason,
      cancel_requested, cancel_reason, end_requested, extend_minutes, reminded, overtime_notified,
      created_at, updated_at, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    a.id, a.student_id, a.teacher_id, a.date, a.start, a.end, a.mode, a.note ?? null,
    a.status, a.reject_reason ?? null, a.cancel_requested ?? 0, a.cancel_reason ?? null,
    a.end_requested ?? 0, a.extend_minutes ?? 0, a.reminded ?? 0, a.overtime_notified ?? 0,
    a.created_at, a.updated_at, a.completed_at ?? null
  );
}

function notify(userId, type, title, body, createdAt, read = 0) {
  db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, read, created_at) VALUES (?,?,?,?,?,?)'
  ).run(userId, type, title, body, read, createdAt);
}

function seed() {
  const { date: today } = nowParts();
  const now = new Date().toISOString();

  insertUser({ id: 'u_admin', username: 'admin', name: '张老师（管理员）', role: 'admin', avatar: '管', created_at: now });
  insertUser({ id: 'u_stu_lin', username: 'linxiaoyu', name: '林小雨', role: 'student', class_name: '计算机学院 · 软件工程 2023级', avatar: '林', created_at: now });
  insertUser({ id: 'u_stu_zhao', username: 'zhaoyiming', name: '赵一鸣', role: 'student', class_name: '经济管理学院 · 工商管理 2024级', avatar: '赵', created_at: now });
  insertUser({ id: 'u_stu_sun', username: 'sunyue', name: '孙悦', role: 'student', class_name: '外国语学院 · 英语 2022级', avatar: '孙', created_at: now });

  insertUser({ id: 'u_tea_li', username: 'lijing', name: '李静', role: 'teacher', avatar: '李', created_at: now });
  insertTeacher('u_tea_li', '国家二级心理咨询师', 10, ['情绪压力', '焦虑', '抑郁'], '专注大学生情绪困扰与压力管理，擅长用认知行为方法陪伴学生梳理情绪。');
  insertUser({ id: 'u_tea_wang', username: 'wanghai', name: '王海', role: 'teacher', avatar: '王', created_at: now });
  insertTeacher('u_tea_wang', '心理健康教育硕士', 8, ['人际关系', '家庭关系', '人际冲突'], '关注同伴关系与家庭沟通议题，帮助学生建立稳定的人际支持网络。');
  insertUser({ id: 'u_tea_zhang', username: 'zhangmin', name: '张敏', role: 'teacher', avatar: '张', created_at: now });
  insertTeacher('u_tea_zhang', '国家三级心理咨询师', 6, ['学业焦虑', '时间管理', '考试压力'], '擅长学业压力疏导与学习节奏规划，陪伴学生找回掌控感。');
  insertUser({ id: 'u_tea_chen', username: 'chenchen', name: '陈晨', role: 'teacher', avatar: '陈', created_at: now });
  insertTeacher('u_tea_chen', '心理健康教育教师', 5, ['睡眠障碍', '自我认同', '情绪压力'], '关注睡眠与自我认同议题，提供温和稳定的支持。');

  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const day3 = addDays(today, 3);
  const minus4 = addDays(today, -4);
  const minus20 = addDays(today, -20);
  const minus4m = addMonths(today, -4);
  const minus3m = addMonths(today, -3);

  insertAppt({
    id: 'a_pending', student_id: 'u_stu_lin', teacher_id: 'u_tea_li', date: tomorrow,
    start: '10:00', end: '11:00', mode: 'online_text',
    note: '最近考试压力很大，晚上经常睡不着，想找老师聊聊。', status: 'pending',
    created_at: now, updated_at: now,
  });
  insertAppt({
    id: 'a_approved', student_id: 'u_stu_zhao', teacher_id: 'u_tea_li', date: dayAfter,
    start: '14:00', end: '15:00', mode: 'offline',
    note: '和室友相处有些困扰，想线下当面聊一聊。', status: 'approved',
    created_at: now, updated_at: now,
  });
  insertAppt({
    id: 'a_cancel_req', student_id: 'u_stu_sun', teacher_id: 'u_tea_li', date: dayAfter,
    start: '11:00', end: '12:00', mode: 'online_text',
    note: '想聊聊考研前的焦虑。', status: 'approved', cancel_requested: 1,
    cancel_reason: '临时有家庭安排，想取消这次预约。',
    created_at: now, updated_at: now,
  });
  insertAppt({
    id: 'a_completed', student_id: 'u_stu_sun', teacher_id: 'u_tea_zhang', date: minus4,
    start: '15:00', end: '16:00', mode: 'online_text',
    note: '期末结束后状态一直很差。', status: 'completed',
    created_at: addDays(today, -6) + 'T10:00:00+08:00', updated_at: minus4 + 'T16:00:00+08:00',
    completed_at: minus4 + 'T16:00:00+08:00',
  });
  insertAppt({
    id: 'a_old', student_id: 'u_stu_lin', teacher_id: 'u_tea_wang', date: minus4m,
    start: '10:00', end: '11:00', mode: 'offline',
    note: '和父母沟通不畅。', status: 'completed',
    created_at: addMonths(today, -5) + 'T09:00:00+08:00', updated_at: minus4m + 'T11:00:00+08:00',
    completed_at: minus4m + 'T11:00:00+08:00',
  });
  insertAppt({
    id: 'a_historic', student_id: 'u_stu_lin', teacher_id: 'u_tea_li', date: minus20,
    start: '10:00', end: '11:00', mode: 'online_text',
    note: '期末前的焦虑情绪。', status: 'completed',
    created_at: addDays(today, -22) + 'T09:00:00+08:00', updated_at: minus20 + 'T11:00:00+08:00',
    completed_at: minus20 + 'T11:00:00+08:00',
  });
  insertAppt({
    id: 'a_live', student_id: 'u_stu_sun', teacher_id: 'u_tea_zhang', date: today,
    start: '09:00', end: '10:00', mode: 'online_text',
    note: '想聊聊最近的睡眠和学习状态。', status: 'in_progress', reminded: 1,
    created_at: addDays(today, -2) + 'T09:00:00+08:00', updated_at: today + 'T09:00:00+08:00',
  });
  insertAppt({
    id: 'a_cancelled', student_id: 'u_stu_zhao', teacher_id: 'u_tea_chen', date: day3,
    start: '16:00', end: '17:00', mode: 'online_text',
    note: '想聊睡眠问题。', status: 'cancelled',
    created_at: now, updated_at: now,
  });
  insertAppt({
    id: 'a_rejected', student_id: 'u_stu_sun', teacher_id: 'u_tea_chen', date: day3,
    start: '10:00', end: '11:00', mode: 'online_text',
    note: '睡眠问题想咨询。', status: 'rejected',
    reject_reason: '该时段已安排团体辅导，请选择其他时段，抱歉。',
    created_at: now, updated_at: now,
  });

  db.prepare(
    "INSERT INTO chat_messages (appointment_id, sender_id, content, created_at) VALUES (?,?,?,?)"
  ).run('a_completed', 'u_tea_zhang', '你好，我是张老师，今天想聊些什么？', minus4 + 'T15:02:00+08:00');
  db.prepare(
    "INSERT INTO chat_messages (appointment_id, sender_id, content, created_at) VALUES (?,?,?,?)"
  ).run('a_completed', 'u_stu_sun', '最近状态特别差，感觉自己怎么努力都没用。', minus4 + 'T15:05:00+08:00');
  db.prepare(
    "INSERT INTO chat_messages (appointment_id, sender_id, content, created_at) VALUES (?,?,?,?)"
  ).run('a_completed', 'u_tea_zhang', '我们先不急着评价结果，能说说你为此做了哪些努力吗？', minus4 + 'T15:08:00+08:00');

  db.prepare(
    "INSERT INTO chat_messages (appointment_id, sender_id, content, created_at) VALUES (?,?,?,?)"
  ).run('a_live', 'u_tea_zhang', '早上好，今天想从哪里聊起？', today + 'T09:01:00+08:00');
  db.prepare(
    "INSERT INTO chat_messages (appointment_id, sender_id, content, created_at) VALUES (?,?,?,?)"
  ).run('a_live', 'u_stu_sun', '最近总睡不好，白天上课一直犯困，有点撑不住。', today + 'T09:03:00+08:00');
  db.prepare(
    "INSERT INTO chat_messages (appointment_id, sender_id, content, created_at) VALUES (?,?,?,?)"
  ).run('a_live', 'u_tea_zhang', '谢谢你愿意说出来。我们先记录一下最近一周的入睡时间和醒来时间，好吗？', today + 'T09:06:00+08:00');

  db.prepare(
    'INSERT INTO anon_messages (id, teacher_id, student_id, content, is_reply, created_at) VALUES (?,?,?,?,?,?)'
  ).run('m1', 'u_tea_li', 'u_stu_lin', '老师您好，我最近晚上总是睡不着，白天也提不起精神。', 0, addDays(today, -2) + 'T21:30:00+08:00');
  db.prepare(
    'INSERT INTO anon_messages (id, teacher_id, student_id, content, is_reply, created_at) VALUES (?,?,?,?,?,?)'
  ).run('m2', 'u_tea_li', 'u_stu_lin', '谢谢你的信任。可以先把入睡时间和睡眠环境告诉我吗？如果持续两周以上，建议来当面聊一次。', 1, addDays(today, -1) + 'T09:10:00+08:00');
  db.prepare(
    'INSERT INTO anon_messages (id, teacher_id, student_id, content, is_reply, created_at) VALUES (?,?,?,?,?,?)'
  ).run('m3', 'u_tea_li', 'u_stu_zhao', '和室友相处很累，不知道怎么开口沟通。', 0, addDays(today, -1) + 'T22:10:00+08:00');

  db.prepare(
    'INSERT INTO reviews (id, appointment_id, student_id, teacher_id, rating, content, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run('r1', 'a_historic', 'u_stu_lin', 'u_tea_li', 5, '李老师很耐心，帮我把混乱的情绪一条条理清楚了，离开时轻松了很多。', 'approved', minus20 + 'T12:00:00+08:00');
  db.prepare(
    'INSERT INTO reviews (id, appointment_id, student_id, teacher_id, rating, content, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run('r2', 'a_old', 'u_stu_lin', 'u_tea_wang', 5, '王老师帮我梳理了和父母的沟通方式，现在家里氛围好多了。', 'approved', minus4m + 'T12:00:00+08:00');
  db.prepare(
    'INSERT INTO reviews (id, appointment_id, student_id, teacher_id, rating, content, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run('r3', 'a_completed', 'u_stu_sun', 'u_tea_zhang', 4, '张老师给的学习计划很具体，但时间有点紧，希望能再延长一些。', 'pending', minus4 + 'T18:00:00+08:00');

  notify('u_tea_li', 'appointment_pending', '新的预约申请', '林小雨申请 10:00-11:00 线上文字咨询，请及时处理。', addDays(today, -1) + 'T20:00:00+08:00');
  notify('u_tea_li', 'cancel_request', '取消预约申请', '孙悦申请取消 11:00-12:00 的预约，请确认。', now);
  notify('u_admin', 'review_pending', '待审核评价', '孙悦提交了对张敏老师的评价，请审核。', now);
  notify('u_stu_lin', 'appointment_reply', '老师回复了你的留言', '李静老师回复了你的匿名留言。', addDays(today, -1) + 'T09:10:00+08:00', 1);
  notify('u_stu_lin', 'review_approved', '评价已通过审核', '你对李静老师的评价已公开展示。', minus20 + 'T15:00:00+08:00', 1);

  db.prepare('DELETE FROM slot_locks').run();
  console.log('Seeded demo data.');
}

if (count === 0) seed();

export const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ARCHIVED: 'archived',
};
