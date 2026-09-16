const { Telegraf } = require('telegraf');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');

// توکن جدیدی که از BotFather می‌گیری را اینجا قرار بده
const bot = new Telegraf('توکن_جدید_ربات');

bot.start((ctx) => {
  ctx.reply('سلام 👋 لینک اینستاگرامت رو بفرست.');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (!text.includes('instagram.com')) {
    return ctx.reply('لطفاً لینک اینستاگرام بفرست.');
  }

  const fileName = 'instagram_' + Date.now() + '.mp4';
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

    fs.unlinkSync(filePath);

  } catch (error) {
    console.log('yt-dlp error:', error);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await ctx.reply('دانلود انجام نشد ❌');
  }
});

bot.launch();

console.log('ربات روشن شد ✅');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
