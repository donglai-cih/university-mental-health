# 大学生心理健康咨询平台

面向高校学生的心理健康咨询预约系统，包含 **Web 管理端（v1.0）** 与 **移动端 App H5（v2.0）**，覆盖「找老师 → 预约 → 老师审批 → 在线咨询 → 结束 → 评价审核」全流程，并遵循 PRD 中的时段、取消、延时、归档规则。

- Web 端入口：`/`
- App 端入口：`/app`
- 两套前端共用同一个后端与同一份 SQLite 数据

## 环境要求

- **Node.js 22.5 及以上，推荐 24 LTS**（使用了内置模块 `node:sqlite`，无需安装任何第三方依赖）
- 无需 `npm install`

## 下载代码

仓库为私有，需要登录自己的 GitHub 账号：

**方式一：命令行（推荐）**

```bash
gh repo clone donglai-cih/university-mental-health
cd university-mental-health
```

**方式二：浏览器下载**

仓库首页 → 绿色 `Code` 按钮 → `Download ZIP` → 解压后进入目录。

下载 ZIP 时得到的是最新 `main` 分支代码，已包含 Web 端与 App 端。

## 运行

```bash
npm start
```

看到 `校园心理健康咨询平台已启动: http://localhost:3000` 即成功：

- 电脑访问 Web 端：http://localhost:3000
- 手机/电脑访问 App 端：http://localhost:3000/app
  （手机上可与电脑同一局域网，用 `http://电脑IP:3000/app` 打开）

首次启动会自动创建 `data/app.db` 并写入演示数据。

### 常用命令

| 命令 | 说明 |
|---|---|
| `npm start` | 启动服务（默认 3000 端口） |
| `npm run reset` | 清空并重建演示数据 |
| `PORT=8080 npm start` | 指定端口（Windows PowerShell：`$env:PORT=8080; npm start`） |
| `Ctrl + C` | 停止服务 |

### 演示账号

登录页可直接点选，无需密码：

| 角色 | 账号 |
|---|---|
| 学生 | `linxiaoyu`、`zhaoyiming`、`sunyue` |
| 心理老师 | `lijing`、`wanghai`、`zhangmin`、`chenchen` |
| 管理员 | `admin` |

### 数据说明

- 数据保存在 `data/app.db`，图片上传到 `data/uploads/`，这两个目录都已被 `.gitignore` 排除，不会提交到仓库。
- 预约记录满 3 个月自动归档隐藏，可通过管理员导出历史记录。
- 重置演示数据：`npm run reset`（会清空已有数据）。

## 功能概览

**学生端（Web / App）**
- 老师列表按擅长方向筛选、老师详情与公开评价
- 预约：仅次日及以后可约 → 1 小时时段块 → 线上文字 / 线下会谈 → 备注
- 我的预约：状态筛选、申请取消（距开始 ≥2 小时）、进入会话、发起结束、提交评价
- 线上文字会话支持文字与图片；线下会谈仅记录
- 匿名留言（身份对老师保密）与站内消息通知

**老师端**
- 待处理 / 预约成功 / 进行中 / 已完成工作台
- 同意、拒绝（必填理由）、确认取消、距开始 <2 小时手动取消
- 延长 30 / 60 分钟，自动锁定后续相邻时段
- 只能同意学生发起的结束申请

**管理员端（Web）**
- 排班配置、评价审核、预约/评价/留言记录查看与 CSV 导出、数据统计

## 目录结构

```
├── server.js          # 入口：HTTP 服务、API 路由、状态流转、静态文件分发
├── db.js              # 数据库：建表与演示数据
├── package.json       # 脚本与 Node 版本要求
├── lib/
│   └── time.js        # 时区、日期、星期、月份计算
├── public/            # 前端静态资源（浏览器可直接访问）
│   ├── index.html     # Web 端页面
│   ├── app.js         # Web 端逻辑
│   ├── styles.css     # Web 端样式
│   ├── mobile.html    # App 端页面（/app）
│   ├── mobile.js      # App 端逻辑
│   └── mobile.css     # App 端样式
└── scripts/
    └── reset-db.js    # 重置演示数据
```

`data/` 为运行时生成的数据库与上传图片，不纳入版本管理。

## 版本

| 标签 | 内容 |
|---|---|
| `v1.0` | Web 端预约咨询全链路 |
| `v2.0` | 移动端 App（H5）预约咨询全流程 |

## 常见问题

**启动报错 `node:sqlite` / `Cannot find module 'node:sqlite'`**
Node 版本过低，升级到 Node 24（至少 22.5）。

**端口被占用**
用 `PORT=8080 npm start` 换端口。

**页面打不开 / 样式错乱**
确认访问的是 `http://localhost:3000`（Web）或 `/app`（App），而不是直接双击 HTML 文件。

**想恢复初始演示数据**
执行 `npm run reset` 后重启服务。
