// 获取 ngrok 公网地址，等待直到就绪
const http = require('http');

function fetchUrl(attempt) {
  http.get('http://localhost:4040/api/tunnels', (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      try {
        const tunnels = JSON.parse(data).tunnels || [];
        const url = tunnels.find(t => t.public_url)?.public_url;
        if (url) {
          console.log(url);
          process.exit(0);
        } else if (attempt < 15) {
          setTimeout(() => fetchUrl(attempt + 1), 2000);
        } else {
          process.exit(1);
        }
      } catch {
        if (attempt < 15) {
          setTimeout(() => fetchUrl(attempt + 1), 2000);
        } else {
          process.exit(1);
        }
      }
    });
  }).on('error', () => {
    if (attempt < 30) {
      setTimeout(() => fetchUrl(attempt + 1), 2000);
    } else {
      process.exit(1);
    }
  });
}

fetchUrl(0);
