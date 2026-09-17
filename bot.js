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
  console.error('❌ BOT_TOKEN تنظیم نشده است');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL تنظیم نشده است');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const DAILY_LIMIT = 12;
const REFERRAL_BONUS = 12;

// ====================
// منوی اصلی
// ====================

const mainKeyboard = Markup.keyboard([
  ['▶️ شروع'],
  ['📥 دانلود پست / ریلز', '👤 دانلود از پروفایل'],
  ['📊 سهمیه من', '🎁 دعوت دوستان'],
  ['ℹ️ راهنما']
]).resize();

// ====================
// ساخت جدول
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
// کاربران
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
// بررسی سهمیه روزانه
// ====================

async function refreshDailyLimit(userId) {
  const user = await getUser(userId);

  if (!user) {
    return null;
  }

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

async function ensureUser(ctx) {
  await createUser(ctx);
  return refreshDailyLimit(ctx.from.id);
}

// ====================
// محاسبه سهمیه
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
    DAILY_LIMIT - Number(user.daily_used)
  );

  const bonusRemaining = Math.max(
    0,
    Number(user.bonus_downloads)
  );

  return {
    dailyRemaining,
    bonusRemaining,
    totalRemaining: dailyRemaining + bonusRemaining
  };
}
// ====================
// مصرف سهمیه
// ====================

async function consumeDownload(userId) {
  const result = await pool.query(
    
    UPDATE users
    SET daily_used = daily_used + 1
    WHERE user_id = $1
      AND daily_used < $2
    RETURNING *
    ,
    [String(userId), DAILY_LIMIT]
  );

  if (result.rows.length > 0) {
    return 'daily';
  }

  const bonusResult = await pool.query(
    
    UPDATE users
    SET bonus_downloads = bonus_downloads - 1
    WHERE user_id = $1
      AND bonus_downloads > 0
    RETURNING *
    ,
    [String(userId)]
  );

  if (bonusResult.rows.length > 0) {
    return 'bonus';
  }

  return false;
}

// ====================
// برگرداندن سهمیه اگر دانلود شکست خورد
// ====================

async function refundDownload(userId, type) {
  if (type === 'daily') {
    await pool.query(
      
      UPDATE users
      SET daily_used = GREATEST(daily_used - 1, 0)
      WHERE user_id = $1
      ,
      [String(userId)]
    );
  }

  if (type === 'bonus') {
    await pool.query(
      
      UPDATE users
      SET bonus_downloads = bonus_downloads + 1
      WHERE user_id = $1
      ,
      [String(userId)]
    );
  }
}

// ====================
// سیستم دعوت
// ====================

async function processReferral(ctx) {
  const newUserId = String(ctx.from.id);
  const payload = ctx.startPayload;

  if (!payload) {
    return false;
  }

  const referrerId = String(payload);

  if (referrerId === newUserId) {
    return false;
  }

  const result = await pool.query(
    
    UPDATE users
    SET referred_by = $1
    WHERE user_id = $2
      AND referred_by IS NULL
    RETURNING user_id
    ,
    [referrerId, newUserId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const referrer = await getUser(referrerId);

  if (!referrer) {
    return false;
  }

  await pool.query(
    
    UPDATE users
    SET bonus_downloads = bonus_downloads + $1,
        referrals = referrals + 1
    WHERE user_id = $2
    ,
    [REFERRAL_BONUS, referrerId]
  );

  return true;
}
// ====================
// شروع ربات
// ====================

bot.start(async (ctx) => {
  try {
    const existingUser = await getUser(ctx.from.id);
    const isNewUser = !existingUser;

    await ensureUser(ctx);

    if (isNewUser) {
      const referralAccepted = await processReferral(ctx);

      if (referralAccepted) {
        await ctx.reply(
          🎁 دعوت با موفقیت ثبت شد!\n\n +
          دوست شما ${REFERRAL_BONUS} دانلود هدیه گرفت.
        );
      }
    }

    await ctx.reply(
      '🤖 Zeka Downloader\n\n' +
      'یکی از گزینه‌ها را انتخاب کن:',
      mainKeyboard
    );

  } catch (error) {
    console.error('Start error:', error);
    await ctx.reply('❌ خطایی رخ داد.');
  }
});

// ====================
// شروع
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
  const user = await ensureUser(ctx);
  const quota = await getQuota(ctx.from.id);

  await ctx.reply(
    📊 سهمیه شما\n\n +
    🔹 روزانه: ${quota.dailyRemaining}\n +
    🎁 هدیه: ${quota.bonusRemaining}\n +
    📥 مجموع: ${quota.totalRemaining}\n\n +
    👥 تعداد دعوت موفق: ${user.referrals},
    mainKeyboard
  );
});

// ====================
// دعوت دوستان
// ====================

bot.hears('🎁 دعوت دوستان', async (ctx) => {
  await ensureUser(ctx);

  const me = await bot.telegram.getMe();

  const referralLink =
    https://t.me/${me.username}?start=${ctx.from.id};

  await ctx.reply(
    🎁 دعوت دوستان\n\n +
    با هر دعوت موفق، ${REFERRAL_BONUS} دانلود هدیه می‌گیری.\n\n +
    🔗 لینک اختصاصی شما:\n\n +
    ${referralLink},
    mainKeyboard
  );
});

// ====================
// راهنما
// ====================

bot.hears('ℹ️ راهنما', async (ctx) => {
  await ctx.reply(
    ℹ️ راهنمای Zeka\n\n +
    📥 دانلود پست / ریلز:\n +
    لینک اینستاگرام را ارسال کن.\n\n +
    👤 دانلود از پروفایل:\n +
    به‌زودی فعال می‌شود.\n\n +
    📊 سهمیه من:\n +
    تعداد دانلودهای باقی‌مانده را نشان می‌دهد.\n\n +
    🎁 دعوت دوستان:\n +
    با هر دعوت موفق، ${REFERRAL_BONUS} دانلود هدیه می‌گیری.,
    mainKeyboard
  );
});

// ====================
// دکمه دانلود
// ====================

bot.hears('📥 دانلود پست / ریلز', async (ctx) => {
  await ctx.reply(
    '📥 لینک پست یا ریلز اینستاگرام را بفرست.',
    mainKeyboard
  );
});

// ====================
// پروفایل
// ====================

bot.hears('👤 دانلود از پروفایل', async (ctx) => {
  await ctx.reply(
    '👤 دانلود از پروفایل هنوز فعال نشده است.',
    mainKeyboard
  );
});
// ====================
// دریافت لینک
// ====================

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

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

  if (!/https?:\/\/(www\.)?instagram\.com\//i.test(text)) {
    return ctx.reply(
      '❌ لطفاً لینک معتبر اینستاگرام بفرست.',
      mainKeyboard
    );
  }

  await ensureUser(ctx);

  const quota = await getQuota(ctx.from.id);

  if (quota.totalRemaining <= 0) {
    return ctx.reply(
      '❌ سهمیه شما تمام شده است.\n\n' +
      '🎁 از «دعوت دوستان» برای دریافت سهمیه هدیه استفاده کن.',
      mainKeyboard
    );
  }

  let consumedType = false;
  let filePath = null;

  try {
    await ctx.reply('⏳ در حال دانلود...');

    consumedType = await consumeDownload(ctx.from.id);

    if (!consumedType) {
      return ctx.reply(
        '❌ سهمیه کافی نیست.',
        mainKeyboard
      );
    }

    const fileName = instagram_${ctx.from.id}_${Date.now()}.mp4;
    filePath = path.join('/tmp', fileName);

    await ytDlp(text, {
      noPlaylist: true,
      format: 'best[ext=mp4]/best',
      output: filePath
    });

    if (!fs.existsSync(filePath)) {
      throw new Error('Downloaded file not found');
    }

    await ctx.replyWithVideo({
      source: filePath
    });

    const newQuota = await getQuota(ctx.from.id);

    await ctx.reply(
      ✅ دانلود با موفقیت انجام شد.\n\n +
      📥 باقی‌مانده: ${newQuota.totalRemaining},
      mainKeyboard
    );

  } catch (error) {
    console.error('Download error:', error);

    // سهمیه برگردانده می‌شود
    if (consumedType) {
      try {
        await refundDownload(ctx.from.id, consumedType);
      } catch (refundError) {
        console.error('Refund error:', refundError);
      }
    }

    await ctx.reply(
      '❌ دانلود انجام نشد.\n\n' +
      'ممکن است لینک خصوصی، حذف‌شده یا نامعتبر باشد.',
      mainKeyboard
    );

  } finally {
    // حذف فایل موقت
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error('File cleanup error:', error);
      }
    }
  }
});

// ====================
// HTTP Server برای Render
// ====================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Zeka Downloader is running ✅');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(🌐 HTTP server running on port ${PORT});
});

// ====================
// اجرای ربات
// ====================

async function startBot() {
  try {
    await initDatabase();

    await bot.launch();

    console.log('🤖 Zeka Downloader started ✅');

  } catch (error) {
    console.error('❌ Startup error:', error);
    process.exit(1);
  }
}

startBot();

// ====================
// خاموش شدن صحیح
// ====================

process.once('SIGINT', () => {
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});
