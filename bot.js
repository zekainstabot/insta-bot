[9/17/2026 11:02 PM] DEVIL: const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ================================
// Environment Variables
// ================================

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

// ================================
// Telegram Bot
// ================================

const bot = new Telegraf(BOT_TOKEN);

// ================================
// PostgreSQL
// ================================

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ================================
// Settings
// ================================

const DAILY_LIMIT = 12;
const REFERRAL_BONUS = 12;

// ================================
// Keyboard
// ================================

const mainKeyboard = Markup.keyboard([
  ['▶️ شروع'],
  ['📥 دانلود پست / ریلز'],
  ['👤 دانلود از پروفایل'],
  ['📊 سهمیه من'],
  ['🎁 دعوت دوستان'],
  ['ℹ️ راهنما']
]).resize();

// ================================
// Database
// ================================

async function initDatabase() {
  await pool.query(
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      daily_used INTEGER DEFAULT 0,
      period_start TIMESTAMP DEFAULT NOW(),
      bonus_downloads INTEGER DEFAULT 0,
      referrals INTEGER DEFAULT 0,
      referred_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  );

  console.log('✅ Database آماده است.');
}

// ================================
// User
// ================================

async function getUser(userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE user_id = $1',
    [String(userId)]
  );

  return result.rows[0] || null;
}

async function createUser(ctx, referredBy = null) {
  const userId = String(ctx.from.id);

  const result = await pool.query(
    
    INSERT INTO users
    (
      user_id,
      username,
      first_name,
      referred_by
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING *
    ,
    [
      userId,
      ctx.from.username || null,
      ctx.from.first_name || null,
      referredBy
    ]
  );

  return result.rows[0] || await getUser(userId);
}

// ================================
// Daily Limit
// ================================

async function refreshDailyLimit(userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE user_id = $1',
    [String(userId)]
  );

  const user = result.rows[0];

  if (!user) {
    return null;
  }

  const now = new Date();
  const periodStart = new Date(user.period_start);

  const difference = now.getTime() - periodStart.getTime();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  if (difference >= twentyFourHours) {
    await pool.query(
      
      UPDATE users
      SET daily_used = 0,
          period_start = NOW()
      WHERE user_id = $1
      ,
      [String(userId)]
    );

    return {
      ...user,
      daily_used: 0
    };
  }

  return user;
}

// ================================
// Ensure User
// ================================

async function ensureUser(ctx) {
  let user = await getUser(ctx.from.id);

  if (!user) {
    user = await createUser(ctx);
  }

  user = await refreshDailyLimit(ctx.from.id);

  return user;
}

// ================================
// Quota
// ================================

async function getQuota(userId) {
  const user = await refreshDailyLimit(userId);

  if (!user) {
    return null;
  }

  const dailyRemaining = Math.max(
    0,
    DAILY_LIMIT - user.daily_used
  );

  return {
    dailyRemaining,
    bonusRemaining: user.bonus_downloads,
    totalRemaining: dailyRemaining + user.bonus_downloads
  };
}
[9/17/2026 11:02 PM] DEVIL: // ================================
// Consume Download
// ================================

async function consumeDownload(userId) {
  const user = await refreshDailyLimit(userId);

  if (!user) {
    return false;
  }

  const dailyRemaining = DAILY_LIMIT - user.daily_used;

  // اول از سهمیه روزانه استفاده می‌کنیم
  if (dailyRemaining > 0) {
    await pool.query(
      
      UPDATE users
      SET daily_used = daily_used + 1
      WHERE user_id = $1
      ,
      [String(userId)]
    );

    return true;
  }

  // بعد از بونوس استفاده می‌کنیم
  if (user.bonus_downloads > 0) {
    await pool.query(
      
      UPDATE users
      SET bonus_downloads = bonus_downloads - 1
      WHERE user_id = $1
      ,
      [String(userId)]
    );

    return true;
  }

  return false;
}

// ================================
// Refund Download
// ================================

async function refundDownload(userId) {
  const user = await refreshDailyLimit(userId);

  if (!user) {
    return;
  }

  if (user.daily_used > 0) {
    await pool.query(
      
      UPDATE users
      SET daily_used = daily_used - 1
      WHERE user_id = $1
      ,
      [String(userId)]
    );
  }
}

// ================================
// Referral
// ================================

async function processReferral(ctx, referralCode) {
  if (!referralCode) {
    return;
  }

  const newUserId = String(ctx.from.id);
  const referrerId = String(referralCode);

  // دعوت کردن خودش ممنوع
  if (newUserId === referrerId) {
    return;
  }

  const newUser = await getUser(newUserId);

  if (!newUser) {
    return;
  }

  // اگر قبلاً کسی معرف بوده، دوباره پاداش نده
  if (newUser.referred_by) {
    return;
  }

  const referrer = await getUser(referrerId);

  if (!referrer) {
    return;
  }

  await pool.query(
    
    UPDATE users
    SET referred_by = $1
    WHERE user_id = $2
      AND referred_by IS NULL
    ,
    [referrerId, newUserId]
  );

  await pool.query(
    
    UPDATE users
    SET
      bonus_downloads = bonus_downloads + $1,
      referrals = referrals + 1
    WHERE user_id = $2
    ,
    [REFERRAL_BONUS, referrerId]
  );

  console.log(
    🎁 Referral: ${referrerId} invited ${newUserId}
  );
}

// ================================
// /start
// ================================

bot.start(async (ctx) => {
  try {
    const payload = ctx.startPayload || null;

    const existingUser = await getUser(ctx.from.id);

    if (!existingUser) {
      await createUser(ctx, payload);
      await processReferral(ctx, payload);
    }

    await ctx.reply(
      سلام ${ctx.from.first_name || ''} 👋

به ربات دانلود اینستاگرام خوش اومدی.

لینک پست یا ریلز اینستاگرام رو بفرست تا برات دانلود کنم. 📥,
      mainKeyboard
    );

  } catch (error) {
    console.error('Start error:', error);

    await ctx.reply(
      '❌ مشکلی پیش آمد. دوباره تلاش کن.'
    );
  }
});

// ================================
// شروع
// ================================

bot.hears('▶️ شروع', async (ctx) => {
  await ctx.reply(
    سلام 👋

لینک پست یا ریلز اینستاگرام رو بفرست.,
    mainKeyboard
  );
});

// ================================
// دانلود پست / ریلز
// ================================

bot.hears('📥 دانلود پست / ریلز', async (ctx) => {
  await ctx.reply(
    📥 لینک پست یا ریلز اینستاگرام رو بفرست.

مثال:
https://www.instagram.com/reel/...
  );
});

// ================================
// سهمیه
// ================================

bot.hears('📊 سهمیه من', async (ctx) => {
  try {
    const user = await ensureUser(ctx);
    const quota = await getQuota(user.user_id);

    await ctx.reply(
      📊 سهمیه شما

🔹 سهمیه روزانه باقی‌مانده: ${quota.dailyRemaining}
🎁 دانلود هدیه باقی‌مانده: ${quota.bonusRemaining}

📥 مجموع قابل استفاده: ${quota.totalRemaining}
    );

  } catch (error) {
    console.error('Quota error:', error);

    await ctx.reply(
      '❌ دریافت سهمیه انجام نشد.'
    );
  }
});

// ================================
// دعوت دوستان
// ================================
[9/17/2026 11:02 PM] DEVIL: bot.hears('🎁 دعوت دوستان', async (ctx) => {
  try {
    const botInfo = await ctx.telegram.getMe();

    const link =
      https://t.me/${botInfo.username}?start=${ctx.from.id};

    await ctx.reply(
      🎁 دعوت دوستان

با دعوت هر نفر، ${REFERRAL_BONUS} دانلود هدیه می‌گیری.

🔗 لینک دعوت شما:

${link}

👥 لینک رو برای دوستات بفرست.
    );

  } catch (error) {
    console.error('Referral error:', error);

    await ctx.reply(
      '❌ ساخت لینک دعوت انجام نشد.'
    );
  }
});

// ================================
// راهنما
// ================================

bot.hears('ℹ️ راهنما', async (ctx) => {
  await ctx.reply(
    ℹ️ راهنمای ربات

📥 برای دانلود:
لینک پست یا ریلز اینستاگرام رو ارسال کن.

📊 سهمیه:
هر کاربر روزانه ${DAILY_LIMIT} دانلود رایگان دارد.

🎁 دعوت دوستان:
با دعوت هر کاربر ${REFERRAL_BONUS} دانلود هدیه می‌گیری.

👤 دانلود از پروفایل:
این قابلیت فعلاً در حال توسعه است.
  );
});

// ================================
// دانلود از پروفایل
// ================================

bot.hears('👤 دانلود از پروفایل', async (ctx) => {
  await ctx.reply(
    '👤 قابلیت دانلود کامل پروفایل هنوز فعال نشده است.'
  );
});

// ================================
// Instagram URL Handler
// ================================

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // اگر پیام یکی از دکمه‌ها بود، اینجا کاری نکن
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

  // بررسی لینک اینستاگرام
  if (!text.includes('instagram.com')) {
    await ctx.reply(
      '❌ لطفاً یک لینک معتبر از اینستاگرام ارسال کن.'
    );

    return;
  }

  const user = await ensureUser(ctx);

  // بررسی سهمیه
  const allowed = await consumeDownload(user.user_id);

  if (!allowed) {
    await ctx.reply(
      ❌ سهمیه دانلود شما تمام شده است.

📊 برای دیدن سهمیه:
روی «📊 سهمیه من» بزن.

🎁 برای دریافت دانلود بیشتر:
از «🎁 دعوت دوستان» استفاده کن.
    );

    return;
  }

  const fileName = instagram_${ctx.from.id}_${Date.now()}.mp4;
  const filePath = path.join('/tmp', fileName);

  try {
    await ctx.reply(
      '⏳ در حال دانلود و آماده‌سازی ویدیو...'
    );

    await ytDlp(text, {
      noPlaylist: true,
      format: 'best[ext=mp4]/best',
      output: filePath
    });

    if (!fs.existsSync(filePath)) {
      throw new Error('Downloaded file not found');
    }

    const stats = fs.statSync(filePath);

    if (stats.size === 0) {
      throw new Error('Downloaded file is empty');
    }

    await ctx.replyWithVideo(
      {
        source: filePath
      },
      {
        caption: '✅ دانلود شد'
      }
    );

  } catch (error) {
    console.error('Download error:', error);

    // برگرداندن سهمیه
    await refundDownload(user.user_id);

    await ctx.reply(
      ❌ دانلود انجام نشد.

ممکنه لینک خصوصی باشه، پست حذف شده باشه یا اینستاگرام دسترسی دانلود رو محدود کرده باشه.
    );

  } finally {
    // حذف فایل
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (deleteError) {
        console.error(
          'File delete error:',
          deleteError
        );
      }
    }
  }
});

// ================================
// HTTP Server - Render
// ================================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end(
    'Zeka Instagram Downloader Bot is running ✅'
  );
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    HTTP server running on port ${PORT}
  );
});

// ================================
// Start Bot
// ================================

async function startBot() {
  try {
    await initDatabase();

    await bot.launch();

    console.log(
      '🤖 Zeka bot is running successfully ✅'
    );

  } catch (error) {
    console.error(
      '❌ BOT ERROR:',
      error
    );

    process.exit(1);
  }
}

startBot();
[9/17/2026 11:02 PM] DEVIL: // ================================
// Shutdown
// ================================

process.once('SIGINT', () => {
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});
