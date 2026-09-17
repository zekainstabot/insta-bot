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

function mainMenu() {
  return Markup.keyboard([
    ['📥 دانلود پست / ریلز'],
    ['👤 دانلود از پروفایل'],
    ['ℹ️ راهنما']
  ])
    .resize()
    .persistent();
}

bot.start(async (ctx) => {
  await ctx.reply(
    '🤖 Zeka Downloader\n\n' +
    'یکی از گزینه‌ها را انتخاب کن:',
    mainMenu()
  );
});

bot.hears('📥 دانلود پست / ریلز', async (ctx) => {
  await ctx.reply(
    '📥 لینک پست یا ریلز اینستاگرام را بفرست.'
  );
});

bot.hears('👤 دانلود از پروفایل', async (ctx) => {
  await ctx.reply(
    '👤 لینک پروفایل یا @username را بفرست.'
  );
});

bot.hears('ℹ️ راهنما', async (ctx) => {
  await ctx.reply(
    'ℹ️ راهنمای Zeka\n\n' +
    '📥 برای دانلود پست یا ریلز، لینک آن را بفرست.\n\n' +
    '👤 برای دانلود از پروفایل، لینک یا نام کاربری را بفرست.\n\n' +
    '🔒 پروفایل خصوصی قابل دانلود نیست.'
  );
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (
    text === '📥 دانلود پست / ریلز' ||
    text === '👤 دانلود از پروفایل' ||
    text === 'ℹ️ راهنما'
  ) {
    return;
  }

  if (text.startsWith('/')) {
    return;
  }

  if (!text.includes('instagram.com')) {
    await ctx.reply(
      '❌ لطفاً یک لینک معتبر اینستاگرام بفرست.',
      mainMenu()
    );
    return;
  }

  const fileName =
    'instagram_' + Date.now() + '.mp4';

  const filePath =
    path.join('/tmp', fileName);

  try {
    await ctx.reply('⏳ در حال دانلود...');

    await ytDlp(text, {
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

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await ctx.reply(
      '✅ دانلود انجام شد.',
      mainMenu()
    );

  } catch (error) {
    console.error('DOWNLOAD ERROR:', error);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('DELETE ERROR:', e);
      }
    }

    await ctx.reply(
      '❌ دانلود انجام نشد.',
      mainMenu()
    );
  }
});
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Zeka Downloader is running');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    'HTTP server running on port ' + PORT
  );
});

bot.launch()
  .then(() => {
    console.log('ربات روشن شد');
  })
  .catch((error) => {
    console.error(
      'BOT ERROR:',
      error
    );
  });

process.once('SIGINT', () => {
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});
