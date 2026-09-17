const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ====================
// تنظیمات
// ====================

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN تنظیم نشده است.');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL تنظیم نشده است.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const pool = new Pool({
  connectionString: DATABASE_URL
});

const DAILY_LIMIT = 12;
const REFERRAL_BONUS = 12;

// ====================
// دکمه‌های اصلی
// ====================

const mainKeyboard = Markup.keyboard([
  ['▶️ شروع'],
  ['📥 دانلود پست / ریلز', '👤 دانلود از پروفایل'],
  ['📊 سهمیه من', '🎁 دعوت دوستان'],
  ['ℹ️ راهنما']
]).resize();

// ====================
// اتصال و ساخت جدول
// ====================

async function initDatabase() {
  await pool.query(
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      daily_used INTEGER NOT NULL DEFAULT 0,
      period_start BIGINT NOT NULL,
      bonus_downloads INTEGER NOT NULL DEFAULT 0,
      referrals INTEGER NOT NULL DEFAULT 0,
      referred_by TEXT,
      created_at BIGINT NOT NULL
    )
  );

  console.log('✅ PostgreSQL connected');
  console.log('✅ Database table ready');
}
// ====================
// مدیریت کاربران
// ====================

async function getUser(userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE user_id = $1',
    [String(userId)]
  );

  return result.rows[0] || null;
}

async function createUser(ctx) {
  const userId = String(ctx.from.id);
  const now = Date.now();

  const result = await pool.query(
    
    INSERT INTO users (
      user_id,
      username,
      first_name,
      daily_used,
      period_start,
      bonus_downloads,
      referrals,
      referred_by,
      created_at
    )
    VALUES ($1, $2, $3, 0, $4, 0, 0, NULL, $4)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING *
    ,
    [
      userId,
      ctx.from.username || null,
      ctx.from.first_name || null,
      now
    ]
  );

  if (result.rows[0]) {
    return result.rows[0];
  }

  return getUser(userId);
}

// ====================
// ریست سهمیه روزانه
// ====================

async function refreshDailyLimit(userId) {
  const user = await getUser(userId);

  if (!user) return null;

  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  if (now - Number(user.period_start) >= oneDay) {
    await pool.query(
      
      UPDATE users
      SET daily_used = 0,
          period_start = $1
      WHERE user_id = $2
      ,
      [now, String(userId)]
    );

    return getUser(userId);
  }

  return user;
}

// ====================
// اطلاعات کاربر
// ====================

async function ensureUser(ctx) {
  await createUser(ctx);
  return refreshDailyLimit(ctx.from.id);
}
// ====================
// سهمیه دانلود
// ====================

async function getQuota(userId) {
  const user = await refreshDailyLimit(userId);

  if (!user) {
    return {
      dailyRemaining: 0,
      bonusRemaining: 0,
      totalRemaining: 0
    };
  }

  const dailyRemaining = Math.max(
    0,
    DAILY_LIMIT - user.daily_used
  );

  const bonusRemaining = Math.max(
    0,
    user.bonus_downloads
  );

  return {
    dailyRemaining,
    bonusRemaining,
    totalRemaining: dailyRemaining + bonusRemaining
  };
}

// ====================
// مصرف یک دانلود
// ====================

async function consumeDownload(userId) {
  const user = await refreshDailyLimit(userId);

  if (!user) return false;

  // اول از سهمیه روزانه مصرف می‌شود
  if (user.daily_used < DAILY_LIMIT) {
    await pool.query(
      
      UPDATE users
      SET daily_used = daily_used + 1
      WHERE user_id = $1
      ,
      [String(userId)]
    );

    return true;
  }

  // بعد از تمام شدن سهمیه روزانه،
  // از سهمیه هدیه استفاده می‌شود
  if (user.bonus_downloads > 0) {
    await pool.query(
      
      UPDATE users
      SET bonus_downloads = bonus_downloads - 1
      WHERE user_id = $1
        AND bonus_downloads > 0
      ,
      [String(userId)]
    );

    return true;
  }

  return false;
}

// ====================
// ====================
// /start
// ====================

bot.start(async (ctx) => {
  const isNewUser = !(await getUser(ctx.from.id));

  await ensureUser(ctx);

  if (isNewUser) {
    const referralAccepted = await processReferral(ctx);

    if (referralAccepted) {
      await ctx.reply(
        '🎁 یک نفر شما را دعوت کرده است.\n' +
        'خودتان هم می‌توانید دوستانتان را دعوت کنید و سهمیه هدیه بگیرید.'
      );
    }
  }

  await ctx.reply(
    '🤖 Zeka Downloader\n\n' +
    'یکی از گزینه‌ها را انتخاب کن:',
    mainKeyboard
  );
});

// ====================
// دکمه شروع
// ====================

bot.hears('▶️ شروع', async (ctx) => {
  await ensureUser(ctx);

  await ctx.reply(
    '🤖 Zeka Downloader\n\n' +
    'لینک پست یا ریلز اینستاگرام را بفرست.',
    mainKeyboard
  );
});

// ====================
// سهمیه من
// ====================

bot.hears('📊 سهمیه من', async (ctx) => {
  const
    // ====================
// دریافت لینک اینستاگرام
// ====================

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // پیام‌های مربوط به دکمه‌ها
  const buttons = [
    '▶️ شروع',
    '📥 دانلود پست / ریلز',
    '👤 دانلود از پروفایل',
    '📊 سهمیه من',
    '🎁 دعوت دوستان',
    'ℹ️ راهنما'
  ];

  if (buttons.includes(text)) {
    return;
  }

  // فقط لینک اینستاگرام
  if (!text.includes('instagram.com')) {
    return ctx.reply(
      '❌ لطفاً لینک معتبر اینستاگرام بفرست.',
      mainKeyboard
    );
  }

  await ensureUser(ctx);

  // بررسی سهمیه
  const quota = await getQuota(ctx.from.id);

  if (quota.totalRemaining <= 0) {
    return ctx.reply(
      '❌ سهمیه دانلود شما تمام شده است.\n\n' +
      '🎁 از بخش «دعوت دوستان» می‌توانید با دعوت دوستان سهمیه هدیه بگیرید.',
      mainKeyboard
    );
  }

  let consumed
