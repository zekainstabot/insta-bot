const { Telegraf, Markup } = require('telegraf');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ==========================================
// SQLite
// ==========================================

const DATA_DIR = '/data';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'zeka.db');

const db = new DatabaseSync(DB_PATH);

// ==========================================
// ساخت جدول کاربران
// ==========================================

db.exec(
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    remaining_bonus INTEGER DEFAULT 0,
    daily_used INTEGER DEFAULT 0,
    period_start INTEGER,
    referrals INTEGER DEFAULT 0,
    referred_by TEXT,
    created_at INTEGER
  )
);

// ==========================================
// تنظیمات
// ==========================================

const DAILY_LIMIT = 12;
const REFERRAL_BONUS = 12;
const LIMIT_WINDOW = 24 * 60 * 60 * 1000;

// ==========================================
// گرفتن کاربر
// ==========================================

function getUser(userId) {
  return db.prepare(
    'SELECT * FROM users WHERE user_id = ?'
  ).get(String(userId));
}

// ==========================================
// ساخت کاربر جدید
// ==========================================

function createUser(ctx) {
  const userId = String(ctx.from.id);
  const now = Date.now();

  let user = getUser(userId);

  if (!user) {
    db.prepare(
      INSERT INTO users (
        user_id,
        username,
        first_name,
        remaining_bonus,
        daily_used,
        period_start,
        referrals,
        referred_by,
        created_at
      )
      VALUES (?, ?, ?, 0, 0, ?, 0, NULL, ?)
    ).run(
      userId,
      ctx.from.username || '',
      ctx.from.first_name || '',
      now,
      now
    );

    user = getUser(userId);
  }

  return user;
}

// ==========================================
// بروزرسانی اطلاعات کاربر
// ==========================================

function updateUserInfo(ctx) {
  const userId = String(ctx.from.id);

  db.prepare(
    UPDATE users
    SET username = ?,
        first_name = ?
    WHERE user_id = ?
  ).run(
    ctx.from.username || '',
    ctx.from.first_name || '',
    userId
  );
}

// ==========================================
// ریست سهمیه ۲۴ ساعته
// ==========================================

function refreshDailyLimit(userId) {
  let user = getUser(userId);

  if (!user) {
    return null;
  }

  const now = Date.now();

  if (
    now - Number(user.period_start) >=
    LIMIT_WINDOW
  ) {
    db.prepare(
      UPDATE users
      SET daily_used = 0,
          period_start = ?
      WHERE user_id = ?
    ).run(
      now,
      String(userId)
    );

    user = getUser(userId);
  }

  return user;
}
// ==========================================
// محاسبه سهمیه
// ==========================================

function getQuota(userId) {
  const user =
    refreshDailyLimit(userId);

  if (!user) {
    return {
      dailyRemaining: 0,
      bonusRemaining: 0,
      totalRemaining: 0
    };
  }

  const dailyRemaining = Math.max(
    0,
    DAILY_LIMIT -
    Number(user.daily_used)
  );

  const bonusRemaining =
    Number(user.remaining_bonus);

  return {
    dailyRemaining,
    bonusRemaining,
    totalRemaining:
      dailyRemaining +
      bonusRemaining
  };
}

// ==========================================
// مصرف دانلود
// ==========================================

function consumeDownload(userId) {
  const user =
    refreshDailyLimit(userId);

  if (!user) {
    return false;
  }

  const dailyRemaining =
    Math.max(
      0,
      DAILY_LIMIT -
      Number(user.daily_used)
    );

  // اول سهمیه روزانه
  if (dailyRemaining > 0) {

    db.prepare(
      UPDATE users
      SET daily_used = daily_used + 1
      WHERE user_id = ?
    ).run(String(userId));

    return true;
  }

  // سپس اعتبار Referral
  if (
    Number(user.remaining_bonus) > 0
  ) {

    db.prepare(
      UPDATE users
      SET remaining_bonus =
          remaining_bonus - 1
      WHERE user_id = ?
    ).run(String(userId));

    return true;
  }

  return false;
}

// ==========================================
// Referral
// ==========================================

function processReferral(ctx, referrerId) {

  const newUserId =
    String(ctx.from.id);

  referrerId =
    String(referrerId);

  // دعوت خودش
  if (newUserId === referrerId) {
    return false;
  }

  const newUser =
    getUser(newUserId);

  const referrer =
    getUser(referrerId);

  // معرف وجود ندارد
  if (!referrer) {
    return false;
  }

  // کاربر قبلاً معرف داشته
  if (
    newUser.referred_by &&
    String(newUser.referred_by).length > 0
  ) {
    return false;
  }

  // ثبت معرف
  db.prepare(
    UPDATE users
    SET referred_by = ?
    WHERE user_id = ?
  ).run(
    referrerId,
    newUserId
  );

  // پاداش معرف
  db.prepare(
    UPDATE users
    SET remaining_bonus =
        remaining_bonus + ?,
        referrals =
        referrals + 1
    WHERE user_id = ?
  ).run(
    REFERRAL_BONUS,
    referrerId
  );

  console.log(
    Referral: ${referrerId} invited ${newUserId}
  );

  return true;
}

// ==========================================
// منوی اصلی
// ==========================================

function mainMenu() {
  return Markup.keyboard([
    ['▶️ شروع', '📥 دانلود پست / ریلز'],
    ['👤 دانلود از پروفایل', '📊 سهمیه من'],
    ['🎁 دعوت دوستان', 'ℹ️ راهنما']
  ]).resize();
}

// ==========================================
// /start
// ==========================================

bot.start(async (ctx) => {

  createUser(ctx);
  updateUserInfo(ctx);

  const payload =
    ctx.startPayload || '';

  let referralAccepted = false;

  if (
    payload &&
    payload !== String(ctx.from.id)
  ) {
    referralAccepted =
      processReferral(
        ctx,
        payload
      );
  }

  const quota =
    getQuota(ctx.from.id);

  let message =
    '🤖 Zeka Downloader\n\n' +
    'به زکا خوش آمدی 👋\n\n';

  if (referralAccepted) {
    message +=
      '🎉 دعوت با موفقیت ثبت شد!\n\n';
  }

  message +=
    📥 سهمیه امروز: ${quota.dailyRemaining}\n +
    🎁 اعتبار دعوت: ${quota.bonusRemaining}\n +
    📊 مجموع قابل استفاده: ${quota.totalRemaining}\n\n +
    'یکی از گزینه‌های زیر را انتخاب کن:';

  await ctx.reply(
    message,
    mainMenu()
  );
});
// ==========================================
// ▶️ شروع
// ==========================================

bot.hears(
  '▶️ شروع',
  async (ctx) => {

    createUser(ctx);
    updateUserInfo(ctx);

    const quota =
      getQuota(ctx.from.id);

    await ctx.reply(
      '🤖 Zeka Downloader\n\n' +
      📥 سهمیه امروز: ${quota.dailyRemaining}\n +
      🎁 اعتبار دعوت: ${quota.bonusRemaining}\n +
      📊 مجموع: ${quota.totalRemaining},
      mainMenu()
    );
  }
);

// ==========================================
// 📥 دانلود پست / ریلز
// ==========================================

bot.hears(
  '📥 دانلود پست / ریلز',
  async (ctx) => {

    createUser(ctx);

    await ctx.reply(
      '📥 لینک پست یا ریلز عمومی اینستاگرام را بفرست.\n\n' +
      '⚠️ هر کاربر هر ۲۴ ساعت ۱۲ دانلود پایه دارد.',
      mainMenu()
    );
  }
);

// ==========================================
// 👤 دانلود پروفایل
// ==========================================

bot.hears(
  '👤 دانلود از پروفایل',
  async (ctx) => {

    createUser(ctx);

    await ctx.reply(
      '👤 لینک پروفایل یا @username اینستاگرام را بفرست.\n\n' +
      '⚠️ دانلود کامل پروفایل را در مرحله بعد فعال می‌کنیم.',
      mainMenu()
    );
  }
);

// ==========================================
// 📊 سهمیه من
// ==========================================

bot.hears(
  '📊 سهمیه من',
  async (ctx) => {

    createUser(ctx);

    const quota =
      getQuota(ctx.from.id);

    const user =
      getUser(ctx.from.id);

    await ctx.reply(
      '📊 سهمیه من\n\n' +
      📥 سهمیه پایه باقی‌مانده: ${quota.dailyRemaining}\n +
      🎁 اعتبار Referral: ${quota.bonusRemaining}\n +
      📊 مجموع دانلود قابل استفاده: ${quota.totalRemaining}\n\n +
      👥 دعوت موفق: ${user.referrals},
      mainMenu()
    );
  }
);

// ==========================================
// 🎁 دعوت دوستان
// ==========================================

bot.hears(
  '🎁 دعوت دوستان',
  async (ctx) => {

    createUser(ctx);

    const user =
      getUser(ctx.from.id);

    const botInfo =
      await bot.telegram.getMe();

    const referralLink =
      https://t.me/${botInfo.username}?start=${ctx.from.id};

    await ctx.reply(
      '🎁 دعوت دوستان\n\n' +
      'دوستت را با لینک زیر وارد ربات کن.\n\n' +
      🎁 هر دعوت موفق = ${REFERRAL_BONUS} دانلود جایزه\n\n +
      👥 دعوت موفق تو: ${user.referrals}\n +
      🎁 اعتبار دعوت: ${user.remaining_bonus}\n\n +
      '🔗 لینک اختصاصی تو:\n' +
      referralLink,
      mainMenu()
    );
  }
);

// ==========================================
// ℹ️ راهنما
// ==========================================

bot.hears(
  'ℹ️ راهنما',
  async (ctx) => {

    createUser(ctx);

    await ctx.reply(
      'ℹ️ راهنمای Zeka\n\n' +
      '📥 لینک پست یا ریلز عمومی را بفرست.\n\n' +
      '📊 هر کاربر هر ۲۴ ساعت ۱۲ دانلود پایه دارد.\n\n' +
      🎁 هر دعوت موفق = ${REFERRAL_BONUS} دانلود جایزه.\n\n +
      '👤 دانلود پروفایل در مرحله بعد فعال می‌شود.\n\n' +
      '🔒 محتوای خصوصی قابل دانلود نیست.',
      mainMenu()
    );
  }
);
// ==========================================
// دریافت لینک اینستاگرام
// ==========================================

bot.on('text', async (ctx) => {

  const text =
    ctx.message.text.trim();

  // ========================================
  // دکمه‌های منو
  // ========================================

  if (
    text === '▶️ شروع' ||
    text === '📥 دانلود پست / ریلز' ||
    text === '👤 دانلود از پروفایل' ||
    text === '📊 سهمیه من' ||
    text === '🎁 دعوت دوستان' ||
    text === 'ℹ️ راهنما' ||
    text.startsWith('/')
  ) {
    return;
  }

  // ========================================
  // بررسی لینک
  // ========================================

  if (
    !text.includes('instagram.com')
  ) {

    await ctx.reply(
      '❌ لطفاً لینک معتبر اینستاگرام بفرست.',
      mainMenu()
    );

    return;
  }

  createUser(ctx);
  updateUserInfo(ctx);

  const userId =
    String(ctx.from.id);

  // ========================================
  // بررسی سهمیه
  // ========================================

  const quota =
    getQuota(userId);

  if (
    quota.totalRemaining <= 0
  ) {

    await ctx.reply(
      '🚫 سهمیه دانلود شما تمام شده است.\n\n' +
      '📥 سهمیه پایه: ۱۲ دانلود در هر ۲۴ ساعت\n' +
      '🎁 برای دریافت دانلود بیشتر، دوستانت را دعوت کن.',
      mainMenu()
    );

    return;
  }

  // ========================================
  // ساخت فایل
  // ========================================

  const fileName =
    'instagram_' +
    Date.now() +
    '.mp4';

  const filePath =
    path.join('/tmp', fileName);

  try {

    await ctx.reply(
      '⏳ در حال دانلود...'
    );

    // ======================================
    // yt-dlp
    // ======================================

    await ytDlp(text, {
      noPlaylist: true,
      format: 'best[ext=mp4]/best',
      output: filePath
    });

    // ======================================
    // بررسی فایل
    // ======================================

    if (
      !fs.existsSync(filePath)
    ) {

      await ctx.reply(
        '❌ فایل پیدا نشد.',
        mainMenu()
      );

      return;
    }

    await ctx.reply(
      '📤 در حال ارسال...'
    );

    // ======================================
    // ارسال به تلگرام
    // ======================================

    await ctx.replyWithVideo({
      source: filePath
    });

    // ======================================
    // کم کردن سهمیه
    // ======================================

    consumeDownload(userId);

    const newQuota =
      getQuota(userId);

    // ======================================
    // حذف فایل موقت
    // ======================================

    if (
      fs.existsSync(filePath)
    ) {
      fs.unlinkSync(filePath);
    }

    await ctx.reply(
      '✅ دانلود انجام شد.\n\n' +
      📥 سهمیه پایه: ${newQuota.dailyRemaining}\n +
      🎁 اعتبار دعوت: ${newQuota.bonusRemaining}\n +
      📊 مجموع باقی‌مانده: ${newQuota.totalRemaining},
      mainMenu()
    );

  } catch (error) {

    console.error(
      'DOWNLOAD ERROR:',
      error
    );

    // حذف فایل در صورت خطا
    if (
      fs.existsSync(filePath)
    ) {

      try {
        fs.unlinkSync(filePath);
      } catch (deleteError) {

        console.error(
          'DELETE ERROR:',
          deleteError
        );
      }
    }

    await ctx.reply(
      '❌ دانلود انجام نشد.\n\n' +
      'ممکن است لینک خصوصی باشد، پست حذف شده باشد یا اینستاگرام اجازه دانلود ندهد.',
      mainMenu()
    );
  }
});
// ==========================================
// HTTP Server برای Render
// ==========================================

const PORT =
  process.env.PORT || 3000;

const server =
  http.createServer(
    (req, res) => {

      res.writeHead(200, {
        'Content-Type':
          'text/plain; charset=utf-8'
      });

      res.end(
        'Zeka Downloader is running'
      );
    }
  );

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      'HTTP server running on port ' +
      PORT
    );

    console.log(
      'SQLite database: ' +
      DB_PATH
    );
  }
);

// ==========================================
// اجرای ربات
// ==========================================

bot.launch()
  .then(() => {

    console.log(
      'ربات روشن شد ✅'
    );
  })
  .catch((error) => {

    console.error(
      'BOT ERROR:',
      error
    );
  });

// ==========================================
// خاموش شدن صحیح
// ==========================================

process.once(
  'SIGINT',
  () => {
    bot.stop('SIGINT');
  }
);

process.once(
  'SIGTERM',
  () => {
    bot.stop('SIGTERM');
  }
);
