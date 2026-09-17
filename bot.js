const { Telegraf } = require('telegraf');
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

bot.start((ctx) => {
  ctx.reply('سلام 👋\nلینک اینستاگرام را بفرست.');
});

bot.on('text', async (ctx) => {
  const url = ctx.message.text.trim();

  if (!url.includes('instagram.com')) {
    await ctx.reply('لطفاً لینک اینستاگرام بفرست.');
    return;
  }

  const fileName = 'instagram_' + Date.now() + '.mp4';
  const filePath = path.join('/tmp', fileName);

  try {
    await ctx.reply('⏳ در حال دانلود...');

    await ytDlp(url, {
      noPlaylist: true,
      format: 'best[ext=mp4]/best',
      output: filePath
    });

    if (!fs.existsSync(filePath)) {
      await ctx.reply('❌ فایل پیدا نشد.');
      return;
    }

    await ctx.reply('📤 در حال ارسال...');

    await ctx.replyWithVideo({
      source: filePath
    });

    fs.unlinkSync(filePath);

  } catch (error) {
    console.error('DOWNLOAD ERROR:', error);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await ctx.reply('❌ دانلود انجام نشد.');
  }
});

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('HTTP server running on port ' + PORT);
});

bot.launch()
  .then(() => {
    console.log('ربات روشن شد ✅');
  })
  .catch((error) => {
    console.error('BOT ERROR:', error);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
