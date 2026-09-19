const ytDlp = require('yt-dlp-exec');

async function downloadInstagram(url, outputPath) {
  await ytDlp(url, {
    output: outputPath,
    format: 'mp4/best',
  });

  return outputPath;
}

module.exports = { downloadInstagram };
