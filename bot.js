const { Telegraf } = require('telegraf');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');



const bot = new Telegraf('8745804140:AAG-Uy9GKFuO0E2CtE1yoEqDFp78LfB1KGA', {
  telegram: {
   
  }
});

bot.start((ctx) => {
  ctx.reply('سلام 👋 لینک اینستاگرامت رو بفرست.');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  if (!text.includes('instagram.com')) {
    return ctx.reply('لطفاً لینک اینستاگرام بفرست.');
  }

 const fileName = 'instagram_' + Date.now() + '.mp4';
  const filePath = path.join(__dirname, fileName);

  try {
    await ctx.reply('در حال دانلود... ⏳');

    execFile(
      path.join(__dirname, 'yt-dlp.exe'),
      [
        '--no-playlist',
        '-f', 'best[ext=mp4]/best',
        '-o', filePath,
        text
      ],
      async (error, stdout, stderr) => {
        if (error) {
          console.log(error);
          return ctx.reply('دانلود انجام نشد ❌');
        }

        if (!fs.existsSync(filePath)) {
          return ctx.reply('فایل پیدا نشد ❌');
        }

        await ctx.replyWithVideo({ source: filePath });

        fs.unlinkSync(filePath);
      }
    );

  } catch (error) {
    console.log(error);
    ctx.reply('یک خطا رخ داد ❌');
  }
});

bot.launch();

console.log('ربات روشن شد ✅');
