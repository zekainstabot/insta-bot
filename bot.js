const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN تنظیم نشده است.');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL تنظیم نشده است.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

function isAdmin(ctx) {
  return String(ctx.from?.id) === String(ADMIN_ID);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const DAILY_LIMIT = 12;
const REFERRAL_BONUS = 12;

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      daily_used INTEGER DEFAULT 0,
      period_start TIMESTAMP DEFAULT NOW(),
      bonus_downloads INTEGER DEFAULT 0,
      blocked BOOLEAN DEFAULT FALSE,
      referrals INTEGER DEFAULT 0,
      referred_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE
  `);

  console.log('✅ Database آماده است.');
}

async function getUser(userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE user_id = $1',
    [String(userId)]
  );

  return result.rows[0] || null;
}

async function createUser(ctx) {
  const userId = String(ctx.from.id);

  const result = await pool.query(
    `
    INSERT INTO users (
      user_id,
      username,
      first_name
    )
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING *
    `,
    [
      userId,
      ctx.from.username || null,
      ctx.from.first_name || null
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

  const difference =
    now.getTime() - periodStart.getTime();

  const twentyFourHours =
    24 * 60 * 60 * 1000;

  if (difference >= twentyFourHours) {
    await pool.query(
      `
      UPDATE users
      SET daily_used = 0,
          period_start = NOW()
      WHERE user_id = $1
      `,
      [String(userId)]
    );

    return {
      ...user,
      daily_used: 0
    };
  }

  return user;
}

async function ensureUser(ctx) {
  let user = await getUser(ctx.from.id);

  if (!user) {
    user = await createUser(ctx);
  }

  return await refreshDailyLimit(ctx.from.id);
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
    totalRemaining:
      dailyRemaining + user.bonus_downloads
  };
}

// مقدار مصرف‌شده را مشخص می‌کنیم
// daily یا bonus
async function consumeDownload(userId) {
  const user = await refreshDailyLimit(userId);

  if (!user) {
    return false;
  }

  const dailyRemaining =
    DAILY_LIMIT - user.daily_used;

  if (dailyRemaining > 0) {
    await pool.query(
      `
      UPDATE users
      SET daily_used = daily_used + 1
      WHERE user_id = $1
      `,
      [String(userId)]
    );

    return 'daily';
  }

  if (user.bonus_downloads > 0) {
    await pool.query(
      `
      UPDATE users
      SET bonus_downloads = bonus_downloads - 1
      WHERE user_id = $1
      `,
      [String(userId)]
    );

    return 'bonus';
  }

  return false;
}

// اگر دانلود شکست خورد، همان سهمیه برگردانده می‌شود
async function refundDownload(userId, type) {
  if (type === 'daily') {
    await pool.query(
      `
      UPDATE users
      SET daily_used = GREATEST(daily_used - 1, 0)
      WHERE user_id = $1
      `,
      [String(userId)]
    );

    return;
  }

  if (type === 'bonus') {
    await pool.query(
      `
      UPDATE users
      SET bonus_downloads = bonus_downloads + 1
      WHERE user_id = $1
      `,
      [String(userId)]
    );
  }
}

// ================================
// Referral System
// ================================

async function processReferral(ctx, referralCode) {
  if (!referralCode) {
    return;
  }

  const newUserId = String(ctx.from.id);
  const referrerId = String(referralCode);

  if (newUserId === referrerId) {
    return;
  }

  const referrer = await getUser(referrerId);

  if (!referrer) {
    return;
  }

  // فقط وقتی referred_by خالی است، ثبت می‌شود
  // RETURNING باعث می‌شود فقط در صورت موفقیت پاداش بدهیم
  const result = await pool.query(
    `
    UPDATE users
    SET referred_by = $1
    WHERE user_id = $2
      AND referred_by IS NULL
    RETURNING user_id
    `,
    [referrerId, newUserId]
  );

  if (result.rowCount === 0) {
    return;
  }

  await pool.query(
    `
    UPDATE users
    SET
      bonus_downloads = bonus_downloads + $1,
      referrals = referrals + 1
    WHERE user_id = $2
    `,
    [REFERRAL_BONUS, referrerId]
  );

  console.log(
    `🎁 Referral: ${referrerId} invited ${newUserId}`
  );
}

// ================================
// /start
// ================================

bot.start(async (ctx) => {
  try {
    const payload = ctx.startPayload || null;

    let user = await getUser(ctx.from.id);

    if (!user) {
      // اول کاربر ساخته می‌شود
      // بعد سیستم دعوت اجرا می‌شود
      user = await createUser(ctx);

      if (payload) {
        await processReferral(ctx, payload);
      }
    }

    await ctx.reply(
      `سلام ${ctx.from.first_name || ''} 👋

به ربات دانلود اینستاگرام خوش اومدی.

لینک پست یا ریلز اینستاگرام رو بفرست تا برات دانلود کنم. 📥`,
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
// پنل ادمین
// ================================

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔️ شما دسترسی به پنل ادمین ندارید.');
  }

  await ctx.reply(
    '👑 پنل مدیریت\n\nیکی از گزینه‌ها را انتخاب کنید.',
    Markup.keyboard([
      ['📊 آمار ربات', '👥 کاربران'],
      ['🎁 مدیریت سهمیه', '🚫 مدیریت کاربران'],
      ['📢 پیام همگانی'],
      ['🔙 بازگشت']
    ]).resize()
  );
});
//// ================================
// آمار ربات
// ================================

bot.hears('📊 آمار ربات', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔️ دسترسی ندارید.');
  }

  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_users,
        COUNT(*) FILTER (
          WHERE created_at >= NOW() - INTERVAL '24 hours'
        ) AS new_users_24h
      FROM users
    `);

    const stats = result.rows[0];

    await ctx.reply(
      `📊 آمار ربات

👥 کل کاربران: ${stats.total_users}
🆕 کاربران جدید در ۲۴ ساعت اخیر: ${stats.new_users_24h}`
    );

  } catch (error) {
    console.error('Admin stats error:', error);
    await ctx.reply('❌ دریافت آمار با خطا مواجه شد.');
  }
});
// ================================
// کاربران
// ================================

bot.hears('👥 کاربران', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔️ دسترسی ندارید.');
  }

  try {
    const result = await pool.query(`
      SELECT
        user_id,
        username,
        first_name,
        daily_used,
        bonus_downloads,
        referrals,
        created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 20
    `);

    if (result.rows.length === 0) {
      return ctx.reply('👥 هنوز کاربری ثبت نشده است.');
    }

    let message = '👥 آخرین کاربران:\n\n';

    result.rows.forEach((user, index) => {
      message += `${index + 1}. ${user.first_name || 'بدون نام'}`;
      message += `\n🆔 ${user.user_id}`;
      message += `\n👤 @${user.username || 'ندارد'}`;
      message += `\n📥 مصرف امروز: ${user.daily_used}`;
      message += `\n🎁 هدیه: ${user.bonus_downloads}`;
      message += `\n🤝 دعوت‌ها: ${user.referrals}`;
      message += `\n────────────\n`;
    });

    await ctx.reply(message);

  } catch (error) {
    console.error('Admin users error:', error);
    await ctx.reply('❌ دریافت کاربران با خطا مواجه شد.');
  }
});
// ================================
// مدیریت سهمیه
// ================================

bot.hears('🎁 مدیریت سهمیه', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔️ دسترسی ندارید.');
  }

  await ctx.reply(
    '🎁 مدیریت سهمیه\n\n' +
    'فرمت:\n' +
    'آیدی کاربر تعداد\n\n' +
    'مثال:\n' +
    '123456789 5'
  );
});

// دریافت سهمیه با username
bot.on('text', async (ctx) => {
  if (!isAdmin(ctx)) {
    return;
  }

  const text = ctx.message.text.trim();
  const match = text.match(/^@([A-Za-z0-9_]+)\s+(\d+)$/);

  if (!match) {
    return;
  }

  const username = match[1];
  const amount = parseInt(match[2], 10);

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET bonus_downloads = bonus_downloads + $1
      WHERE LOWER(username) = LOWER($2)
      RETURNING user_id, username, bonus_downloads
      `,
      [amount, username]
    );

    if (result.rows.length === 0) {
      return ctx.reply('❌ کاربری با این username پیدا نشد.');
    }

    await ctx.reply(
      `✅ سهمیه با موفقیت اضافه شد.

👤 @${result.rows[0].username}
🎁 سهمیه اضافه‌شده: ${amount}
📥 سهمیه هدیه فعلی: ${result.rows[0].bonus_downloads}`
    );

  } catch (error) {
    console.error('Admin quota error:', error);
    await ctx.reply('❌ هنگام تغییر سهمیه خطایی رخ داد.');
  }
});

// ================================
// مدیریت کاربران
// ================================

bot.hears('🚫 مدیریت کاربران', async (ctx) => {
  console.log('🚫 مدیریت کاربران clicked');

  if (!isAdmin(ctx)) {
    return ctx.reply('⛔️ دسترسی ندارید.');
  }

  return ctx.reply(
    '🚫 مدیریت کاربران\n\n' +
    'برای مسدود کردن:\n' +
    'مسدود @username\n\n' +
    'برای رفع مسدودی:\n' +
    'رفع @username\n\n' +
    'مثال:\n' +
    'مسدود @ali'
  );
});

// ================================
// شروع
// ================================

bot.hears(
  '▶️ شروع',
  async (ctx) => {
    await ctx.reply(
      `سلام 👋

لینک پست یا ریلز اینستاگرام رو بفرست.`,
      mainKeyboard
    );
  }
);

// ================================
// دانلود پست / ریلز
// ================================

bot.hears(
  '📥 دانلود پست / ریلز',
  async (ctx) => {
    await ctx.reply(
      `📥 لینک پست یا ریلز اینستاگرام رو بفرست.

مثال:
https://www.instagram.com/reel/...`
    );
  }
);

// ================================
// سهمیه من
// ================================

bot.hears(
  '📊 سهمیه من',
  async (ctx) => {
    try {
      const user = await ensureUser(ctx);

      if (!user) {
        await ctx.reply(
          '❌ اطلاعات کاربر پیدا نشد.'
        );
        return;
      }

      const quota = await getQuota(user.user_id);

      if (!quota) {
        await ctx.reply(
          '❌ دریافت سهمیه انجام نشد.'
        );
        return;
      }

      await ctx.reply(
        `📊 سهمیه شما

🔹 سهمیه روزانه باقی‌مانده: ${quota.dailyRemaining}
🎁 دانلود هدیه باقی‌مانده: ${quota.bonusRemaining}

📥 مجموع قابل استفاده: ${quota.totalRemaining}`
      );

    } catch (error) {
      console.error('Quota error:', error);

      await ctx.reply(
        '❌ دریافت سهمیه انجام نشد.'
      );
    }
  }
);

// ================================
// دعوت دوستان
// ================================

bot.hears(
  '🎁 دعوت دوستان',
  async (ctx) => {
    try {
      const botInfo =
        await ctx.telegram.getMe();

      const link =
        `https://t.me/${botInfo.username}?start=${ctx.from.id}`;

      await ctx.reply(
        `🎁 دعوت دوستان

با دعوت هر نفر، ${REFERRAL_BONUS} دانلود هدیه می‌گیری.

🔗 لینک دعوت شما:

${link}

👥 لینک رو برای دوستات بفرست.`
      );

    } catch (error) {
      console.error('Referral error:', error);

      await ctx.reply(
        '❌ ساخت لینک دعوت انجام نشد.'
      );
    }
  }
);

// ================================
// راهنما
// ================================

bot.hears(
  'ℹ️ راهنما',
  async (ctx) => {
    await ctx.reply(
      `ℹ️ راهنمای ربات

📥 برای دانلود:
لینک پست یا ریلز اینستاگرام رو ارسال کن.

📊 سهمیه:
هر کاربر روزانه ${DAILY_LIMIT} دانلود رایگان دارد.

🎁 دعوت دوستان:
با دعوت هر کاربر ${REFERRAL_BONUS} دانلود هدیه می‌گیری.

👤 دانلود از پروفایل:
این قابلیت فعلاً در حال توسعه است.`
    );
  }
);

// ================================
// دانلود از پروفایل
// ================================

bot.hears(
  '👤 دانلود از پروفایل',
  async (ctx) => {
    await ctx.reply(
      '👤 قابلیت دانلود کامل پروفایل هنوز فعال نشده است.'
    );
  }
);

// ================================
// Instagram URL Handler
// ================================

bot.on('text', async (ctx) => {
  try {
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

    if (!text.includes('instagram.com')) {
      await ctx.reply(
        '❌ لطفاً یک لینک معتبر از اینستاگرام ارسال کن.'
      );
      return;
    }

    const user = await ensureUser(ctx);

    if (!user) {
      await ctx.reply(
        '❌ اطلاعات کاربر پیدا نشد.'
      );
      return;
    }

    // مشخص می‌کند از سهمیه روزانه یا هدیه استفاده شده
    const consumedType =
      await consumeDownload(user.user_id);

    if (!consumedType) {
      await ctx.reply(
        `❌ سهمیه دانلود شما تمام شده است.

📊 برای دیدن سهمیه:
روی «📊 سهمیه من» بزن.

🎁 برای دریافت دانلود بیشتر:
از «🎁 دعوت دوستان» استفاده کن.`
      );

      return;
    }

    const fileName = `instagram_${Date.now()}.mp4`;
    const filePath =
      path.join('/tmp', fileName);

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
        throw new Error(
          'Downloaded file not found'
        );
      }

      const stats =
        fs.statSync(filePath);

      if (stats.size === 0) {
        throw new Error(
          'Downloaded file is empty'
        );
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
      console.error(
        'Download error:',
        error
      );

      // فقط همان سهمیه‌ای که مصرف شده برمی‌گردد
      await refundDownload(
        user.user_id,
        consumedType
      );

      await ctx.reply(
        `❌ دانلود انجام نشد.

ممکنه لینک خصوصی باشه، پست حذف شده باشه یا اینستاگرام دسترسی دانلود رو محدود کرده باشه.`
      );

    } finally {
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

  } catch (error) {
    console.error(
      'Instagram handler error:',
      error
    );

    await ctx.reply(
      '❌ خطایی هنگام پردازش درخواست رخ داد.'
    );
  }
});

// ================================
// HTTP Server
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
    `HTTP server running on port ${PORT}`
  );
});

// ================================
// مدیریت مسدود کردن کاربران
// ================================

bot.hears(/^مسدود @([A-Za-z0-9_]+)$/i, async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔️ دسترسی ندارید.');
  }

  const username = ctx.match[1];

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET blocked = TRUE
      WHERE LOWER(username) = LOWER($1)
      RETURNING user_id, username, first_name
      `,
      [username]
    );

    if (result.rows.length === 0) {
      return ctx.reply('❌ کاربری با این username پیدا نشد.');
    }

    const user = result.rows[0];

    await ctx.reply(
      `🚫 کاربر مسدود شد.

👤 @${user.username}
🆔 ${user.user_id}
📛 نام: ${user.first_name || 'بدون نام'}`
    );

  } catch (error) {
    console.error('Block user error:', error);
    await ctx.reply('❌ هنگام مسدود کردن کاربر خطایی رخ داد.');
  }
});

// ================================
// مدیریت رفع مسدودی کاربران
// ================================

bot.hears(/^رفع @([A-Za-z0-9_]+)$/i, async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔️ دسترسی ندارید.');
  }

  const username = ctx.match[1];

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET blocked = FALSE
      WHERE LOWER(username) = LOWER($1)
      RETURNING user_id, username, first_name
      `,
      [username]
    );

    if (result.rows.length === 0) {
      return ctx.reply('❌ کاربری با این username پیدا نشد.');
    }

    const user = result.rows[0];

    await ctx.reply(
      `✅ مسدودی کاربر برداشته شد.

👤 @${user.username}
🆔 ${user.user_id}
📛 نام: ${user.first_name || 'بدون نام'}`
    );

  } catch (error) {
    console.error('Unblock user error:', error);
    await ctx.reply('❌ هنگام رفع مسدودی کاربر خطایی رخ داد.');
  }
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

// ================================
// Shutdown
// ================================

process.once('SIGINT', () => {
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});
