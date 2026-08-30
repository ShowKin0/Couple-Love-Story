import 'dotenv/config';

const appUrl = process.env.APP_URL?.trim();

if (!appUrl) {
  throw new Error('缺少 APP_URL。请先在 .env 中设置 APK 要打开的网站 HTTPS 地址。');
}

let normalizedAppUrl: string;
try {
  const url = new URL(appUrl);
  if (url.protocol !== 'https:') {
    throw new Error('APP_URL 必须使用 HTTPS。');
  }
  normalizedAppUrl = url.toString().replace(/\/$/, '');
} catch (error) {
  throw new Error(`APP_URL 无效：${error instanceof Error ? error.message : '未知错误'}`);
}

export default {
  appId: 'top.showkin.lovestory',
  appName: 'LoveStory',
  webDir: 'mobile-web',
  server: {
    url: normalizedAppUrl,
    cleartext: false
  }
};
