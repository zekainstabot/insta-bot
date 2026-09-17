const { Telegraf } = require('telegraf');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const http = require('http');

// توکن را از Environment Variable می‌خوانیم
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN تنظیم نشده است.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// --------------------
// Telegram Bot
// --------------------

bot.start(async (ctx) => {
  await ctx.reply('سلام 👋\nلینک اینستاگرامت رو بفرست.');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (!text.includes('instagram.com')) {
    return ctx.reply('لطفاً لینک اینستاگرام بفرست.');
  }

  const fileName = instagram_${Date.now()}.mp4;
  const filePath = path.join(__dirname, fileName);

  try {
    await ctx.reply('در حال دانلود... ⏳');

    await ytDlp(text, {
      noPlaylist: true,
      format: 'best[ext=mp4]/best',
      output: filePath
    });

    if (!fs.existsSync(filePath)) {
      return ctx.reply('فایل پیدا نشد ❌');
    }

    await ctx.replyWithVideo({
      source: filePath
    });

    // حذف فایل بعد از ارسال
    fs.unlinkSync(filePath);

  } catch (error) {
    console.error('Download error:', error);

    // اگر فایل ناقص ایجاد شده بود، حذفش می‌کنیم
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('File delete error:', e);
      }
    }

    await ctx.reply('دانلود انجام نشد ❌');
  }
});

// --------------------
// HTTP Server برای Render
// --------------------

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Instagram Downloader Bot is running ✅');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(HTTP server running on port ${PORT});
});

// --------------------
// Start Bot
// --------------------

bot.launch()
  .then(() => {
    console.log('ربات روشن شد ✅');
  })
  .catch((error) => {
    console.error('❌ Telegram bot error:', error);
  });

// خاموش شدن صحیح برنامه
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
