const { Telegraf, Markup } = require('telegraf');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ===============================
// محدودیت دانلود
// هر کاربر: ۱۲ دانلود در هر ۲۴ ساعت
// ===============================

const userDownloads = new Map();

const DOWNLOAD_LIMIT = 12;
const LIMIT_WINDOW = 24 * 60 * 60 * 1000;

function checkDownloadLimit(userId) {
  const now = Date.now();

  let data = userDownloads.get(userId);

  if (!data) {
    data = {
      count: 0,
      firstDownload: now
    };

    userDownloads.set(userId, data);
  }

  // اگر ۲۴ ساعت گذشته باشد، محدودیت ریست می‌شود
  if (now - data.firstDownload >= LIMIT_WINDOW) {
    data.count = 0;
    data.firstDownload = now;
  }

  if (data.count >= DOWNLOAD_LIMIT) {
    const remaining =
      LIMIT_WINDOW - (now - data.firstDownload);

    return {
      allowed: false,
      remaining
    };
  }

  return {
    allowed: true,
    remaining: 0
  };
}

function registerDownload(userId) {
  const now = Date.now();

  let data = userDownloads.get(userId);

  if (!data) {
    data = {
      count: 0,
      firstDownload: now
    };
  }

  if (now - data.firstDownload >= LIMIT_WINDOW) {
    data.count = 0;
    data.firstDownload = now;
  }

  data.count++;

  userDownloads.set(userId, data);

  return data.count;
}

// ===============================
// منوی اصلی
// ===============================

function mainMenu() {
  return Markup.keyboard([
    ['▶️ شروع', '📥 دانلود پست / ریلز'],
    ['👤 دانلود از پروفایل'],
    ['ℹ️ راهنما']
  ]).resize();
}

// ===============================
// Start
// ===============================

bot.start(async (ctx) => {
  await ctx.reply(
    '🤖 Zeka Downloader\n\n' +
    'به زکا خوش آمدی 👋\n\n' +
    '📥 دانلود پست و ریلز اینستاگرام\n' +
    '👤 دانلود از پروفایل\n\n' +
    '⚠️ هر کاربر در هر ۲۴ ساعت حداکثر ۱۲ دانلود دارد.\n\n' +
    'یکی از گزینه‌های زیر را انتخاب کن:',
    mainMenu()
  );
});

// ===============================
// دکمه شروع
// ===============================

bot.hears('▶️ شروع', async (ctx) => {
  await ctx.reply(
    '🤖 Zeka Downloader\n\n' +
    'یکی از گزینه‌ها را انتخاب کن:',
    mainMenu()
  );
});

// ===============================
// دانلود پست / ریلز
// ===============================

bot.hears('📥 دانلود پست / ریلز', async (ctx) => {
  await ctx.reply(
    '📥 لینک پست یا ریلز اینستاگرام را بفرست.\n\n' +
    '⚠️ سقف دانلود هر کاربر: ۱۲ عدد در هر ۲۴ ساعت.',
    mainMenu()
  );
});

// ===============================
// دانلود از پروفایل
// ===============================

bot.hears('👤 دانلود از پروفایل', async (ctx) => {
  await ctx.reply(
    '👤 لینک پروفایل یا @username اینستاگرام را بفرست.\n\n' +
    '⚠️ فعلاً دانلود پروفایل در حال آماده‌سازی است.',
    mainMenu()
  );
});

// ===============================
// راهنما
// ===============================

bot.hears('ℹ️ راهنما', async (ctx) => {
  await ctx.reply(
    'ℹ️ راهنمای Zeka\n\n' +
    '📥 لینک پست یا ریلز عمومی را بفرست.\n\n' +
    '👤 لینک یا @username پروفایل عمومی را بفرست.\n\n' +
    '🔒 پروفایل خصوصی قابل دانلود نیست.\n\n' +
    '📊 محدودیت هر کاربر: ۱۲ دانلود در هر ۲۴ ساعت.',
    mainMenu()
  );
});
// ===============================
// دریافت لینک اینستاگرام
// ===============================

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // دکمه‌های منو
  if (
    text === '▶️ شروع' ||
    text === '📥 دانلود پست / ریلز' ||
    text === '👤 دانلود از پروفایل' ||
    text === 'ℹ️ راهنما' ||
    text.startsWith('/')
  ) {
    return;
  }

  // بررسی لینک اینستاگرام
  if (
    !text.includes('instagram.com')
  ) {
    await ctx.reply(
      '❌ لطفاً لینک معتبر اینستاگرام بفرست.',
      mainMenu()
    );

    return;
  }

  // ===============================
  // بررسی محدودیت کاربر
  // ===============================

  const userId = ctx.from.id;

  const limitStatus =
    checkDownloadLimit(userId);

  if (!limitStatus.allowed) {
    const hours = Math.floor(
      limitStatus.remaining /
      (60 * 60 * 1000)
    );

    const minutes = Math.floor(
      (limitStatus.remaining %
        (60 * 60 * 1000)) /
        (60 * 1000)
    );

    await ctx.reply(
      '🚫 سقف دانلود شما تمام شده است.\n\n' +
      'حداکثر ۱۲ دانلود در هر ۲۴ ساعت مجاز است.\n\n' +
      '⏳ زمان تقریبی تا باز شدن مجدد:\n' +
      ${hours} ساعت و ${minutes} دقیقه,
      mainMenu()
    );

    return;
  }

  // ===============================
  // ساخت فایل
  // ===============================

  const fileName =
    'instagram_' + Date.now() + '.mp4';

  const filePath =
    path.join('/tmp', fileName);

  try {
    await ctx.reply(
      '⏳ در حال دانلود...'
    );

    // ===============================
    // yt-dlp
    // ===============================

    await ytDlp(text, {
      noPlaylist: true,
      format: 'best[ext=mp4]/best',
      output: filePath
    });

    // ===============================
    // بررسی فایل
    // ===============================

    if (!fs.existsSync(filePath)) {
      await ctx.reply(
        '❌ فایل پیدا نشد.',
        mainMenu()
      );

      return;
    }

    await ctx.reply(
      '📤 در حال ارسال...'
    );

    // ===============================
    // ارسال فایل به تلگرام
    // ===============================

    await ctx.replyWithVideo({
      source: filePath
    });

    // ===============================
    // ثبت دانلود
    // فقط دانلود موفق حساب می‌شود
    // ===============================

    const downloadNumber =
      registerDownload(userId);

    // ===============================
    // حذف فایل موقت
    // ===============================

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await ctx.reply(
      '✅ دانلود انجام شد.\n\n' +
      📊 دانلود امروز شما: ${downloadNumber} از ${DOWNLOAD_LIMIT},
      mainMenu()
    );

  } catch (error) {

    console.error(
      'DOWNLOAD ERROR:',
      error
    );

    // حذف فایل در صورت خطا
    if (fs.existsSync(filePath)) {
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
      'ممکن است لینک خصوصی باشد، ' +
      'پست حذف شده باشد یا اینستاگرام اجازه دانلود ندهد.',
      mainMenu()
    );
  }
});
// ===============================
// سرور HTTP برای Render
// ===============================

const PORT =
  process.env.PORT || 3000;

const server = http.createServer(
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
  }
);

// ===============================
// روشن کردن ربات
// ===============================

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

// ===============================
// خاموش کردن صحیح ربات
// ===============================

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
