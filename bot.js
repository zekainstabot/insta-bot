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
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '📥 دانلود پست / ریلز',
        'download_post'
      )
    ],
    [
      Markup.button.callback(
        '👤 دانلود از پروفایل',
        'download_profile'
      )
    ],
    [
      Markup.button.callback(
        'ℹ️ راهنما',
        'help'
      )
    ]
  ]);
}

bot.start(async (ctx) => {
  await ctx.reply(
    '🤖 Zeka Downloader\n\n' +
    'یکی از گزینه‌ها را انتخاب کن:',
    mainMenu()
  );
});

bot.action('download_post', async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.reply(
    '📥 لینک پست یا ریلز اینستاگرام را بفرست.'
  );
});

bot.action('download_profile', async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.reply(
    '👤 لینک پروفایل یا @username اینستاگرام را بفرست.'
  );
});

bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.reply(
    'ℹ️ راهنمای Zeka\n\n' +
    '📥 دانلود پست / ریلز:\n' +
    'لینک پست یا ریلز عمومی اینستاگرام را بفرست.\n\n' +
    '👤 دانلود از پروفایل:\n' +
    'لینک یا نام کاربری پروفایل عمومی را بفرست.\n\n' +
    '🔒 پروفایل خصوصی قابل دانلود نیست.'
  );
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.startsWith('/')) {
    return;
  }

  if (text.startsWith('@') && !text.includes(' ')) {
    await ctx.reply(
      '👤 پروفایل دریافت شد.\n\n' +
      'دانلود کامل پروفایل را در مرحله بعد اضافه می‌کنیم.'
    );
    return;
  }

  if (!text.includes('instagram.com')) {
    await ctx.reply(
      '❌ لطفاً از منوی اصلی یکی از گزینه‌ها را انتخاب کن.',
      mainMenu()
    );
    return;
  }

  const fileName =
    'instagram_' + Date.now() + '.mp4';

  const filePath =
    path.join('/tmp', fileName);

  try {
    await ctx.reply(
      '⏳ در حال دانلود...'
    );

    await ytDlp(text, {
      noPlaylist: true,
      format: 'best[ext=mp4]/best',
      output: filePath
    });

    if (!fs.existsSync(filePath)) {
      await ctx.reply(
        '❌ فایل پیدا نشد.'
      );
      return;
    }

    await ctx.reply(
      '📤 در حال ارسال...'
    );

    await ctx.replyWithVideo({
      source: filePath
    });

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await ctx.reply(
      '✅ انجام شد.',
      mainMenu()
    );

  } catch (error) {
    console.error(
      'DOWNLOAD ERROR:',
      error
    );

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error(
          'DELETE ERROR:',
          e
        );
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
