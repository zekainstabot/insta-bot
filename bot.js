const { Telegraf } = require('telegraf');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN تنظیم نشده است.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply(
    'سلام 👋\n\nلینک پست یا ریلز اینستاگرام را بفرست تا دانلودش کنم.'
  );
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (!text.includes('instagram.com')) {
    await ctx.reply('❌ لطفاً یک لینک معتبر اینستاگرام بفرست.');
    return;
  }

  const fileName = instagram_${Date.now()}.mp4;
  const filePath = path.join(__dirname, fileName);

  try {
    await ctx.reply('⏳ در حال دانلود...');

    await ytDlp(text, {
      noPlaylist: true,
      format: 'best[ext=mp4]/best',
      output: filePath
    });

    if (!fs.existsSync(filePath)) {
      await ctx.reply('❌ فایل دانلود نشد.');
      return;
    }

    await ctx.reply('📤 در حال ارسال فایل...');

    await ctx.replyWithVideo({
      source: filePath
    });

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    console.log('✅ فایل با موفقیت دانلود و ارسال شد.');

  } catch (error) {
    console.error('❌ Download error:', error);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (deleteError) {
        console.error('❌ File delete error:', deleteError);
      }
    }

    await ctx.reply(
      '❌ دانلود انجام نشد.\n\nممکن است لینک خصوصی باشد یا اینستاگرام اجازه دانلود ندهد.'
    );
  }
});

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

bot.launch()
  .then(() => {
    console.log('ربات روشن شد ✅');
  })
  .catch((error) => {
    console.error('❌ Telegram bot error:', error);
  });

process.once('SIGINT', () => {
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});
