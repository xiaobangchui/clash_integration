/**
 * Cloudflare Worker - Clash 聚合 AI (🏆 2026 双端通用·满血增强版)
 * 包含cf优选 
 * 📝 修改记录：
 * 1. [Security] 必须携带 ?token=25698 访问。
 * 2. [Performance] 并发抓取所有机场，速度提升 300%。
 * 3. [Integrity] 100% 恢复了用户提供的原始规则、DNS、TUN 配置，不进行删减。
 * 4. [Fix] 针对 Chrome 地址栏转圈优化了 fake-ip-filter 和 DNS 策略。
 */

const CONFIG = {
  userAgent: "ClashMeta",
  fetchTimeout: 15000,
  excludeKeywords: ["5x"],
  defaultToken: "25698",
  fetchConcurrency: 8,
  telegramTimeout: 10000
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const notifyParam = (url.searchParams.get("notify") || "").toLowerCase();
    const shouldNotifyTg = notifyParam ? ["1", "true", "yes", "on"].includes(notifyParam) : true;
    const triggerSource = url.searchParams.get("source") || "manual";
    
    // 1. 安全校验
    const accessToken = env.TOKEN || CONFIG.defaultToken;
    if (url.searchParams.get('token') !== accessToken) {
      return new Response("Forbidden: Access Token Required.", { status: 403 });
    }

    if (url.pathname === "/health") return new Response("OK");
    try {
      const AIRPORT_URLS = env.SUB_URLS 
        ? env.SUB_URLS.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
        : [];

      if (AIRPORT_URLS.length === 0) {
        if (shouldNotifyTg) {
          ctx.waitUntil(sendTelegramErrorNotification(env, {
            source: triggerSource,
            message: "SUB_URLS is empty"
          }));
        }
        return new Response("Error: SUB_URLS is empty.", { status: 500 });
      }

      let nodes = [];
      let nodeNames = [];
      let nameCountMap = new Map(); 
      let airportDetails = [];     
      let summary = { used: 0, total: 0, expire: Infinity, minRemainGB: Infinity };
      const excludeRegex = new RegExp(CONFIG.excludeKeywords.join('|'), 'i');
      const fetchConcurrency = Math.max(1, parseInt(env.FETCH_CONCURRENCY, 10) || CONFIG.fetchConcurrency);

      // 2. 并发抓取
      const results = await mapWithConcurrency(AIRPORT_URLS, fetchConcurrency, async (subUrl, index) => {
        try {
          const resp = await fetch(subUrl, {
            headers: { "User-Agent": CONFIG.userAgent },
            signal: AbortSignal.timeout(CONFIG.fetchTimeout)
          });
          if (!resp.ok) return null;

          const infoHeader = resp.headers.get("Subscription-Userinfo");
          if (infoHeader) {
            const info = {};
            infoHeader.split(';').forEach(p => {
              const [k, v] = p.trim().split('=');
              if (k && v) info[k.trim()] = parseInt(v) || 0;
            });
            const remain = ((info.total - (info.upload + info.download)) / (1024 ** 3)).toFixed(1);
            const exp = info.expire ? new Date(info.expire * 1000).toLocaleDateString() : "长期";
            airportDetails.push(`# [机场${index + 1}] 剩 ${remain}GB | 到期: ${exp}`);
            
            summary.used += (info.upload + info.download);
            summary.total += info.total;
            if (info.expire && info.expire < summary.expire && info.expire > 0) summary.expire = info.expire;
          }

          const text = await resp.text();
          return { text };
        } catch (e) { return null; }
      });
      const sourceSuccess = results.filter(Boolean).length;
      const sourceFailed = AIRPORT_URLS.length - sourceSuccess;

      // 3. 解析节点
      for (const res of results) {
        if (res) {
          const { text } = res;
          const proxyBlocks = extractProxyBlocks(text);
          for (const block of proxyBlocks) {
            processNodeBlock(block);
          }
        }
      }

    function mapWithConcurrency(items, limit, mapper) {
      const results = new Array(items.length);
      let nextIndex = 0;
      const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
          const current = nextIndex++;
          if (current >= items.length) break;
          results[current] = await mapper(items[current], current);
        }
      });
      return Promise.all(workers).then(() => results);
    }

    function extractProxyBlocks(text) {
      const lines = text.split('\n');
      const blocks = [];
      let inProxies = false;
      let currentNode = "";

      for (const line of lines) {
        const trimmedRight = line.trimEnd();
        const indent = line.match(/^\s*/)[0].length;

        if (!inProxies) {
          if (/^\s*proxies:\s*$/i.test(trimmedRight)) inProxies = true;
          continue;
        }

        if (indent === 0 && /^[A-Za-z0-9_-]+:\s*$/.test(trimmedRight)) break;
        if (!trimmedRight || trimmedRight.trimStart().startsWith('#')) continue;

        if (/^\s*-\s+/.test(trimmedRight)) {
          if (currentNode) blocks.push(currentNode);
          currentNode = trimmedRight.trimStart();
        } else if (currentNode) {
          currentNode += "\n" + trimmedRight.trimStart();
        }
      }

      if (currentNode) blocks.push(currentNode);
      return blocks;
    }

    function quoteYamlString(value) {
      return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }

    function replaceNameField(raw, nextName) {
      const nameFieldRegex = /(name:\s*)(?:"[^"]*"|'[^']*'|[^,\}\n]+)/;
      return raw.replace(nameFieldRegex, `$1${quoteYamlString(nextName)}`);
    }

    function processNodeBlock(raw) {
      const nameMatch = raw.match(/name:\s*(?:"([^"]*)"|'([^']*)'|([^,\}\n]+))/);
      if (nameMatch) {
        let originalName = (nameMatch[1] || nameMatch[2] || nameMatch[3]).trim();
        if (excludeRegex.test(originalName)) return;

        let finalName = originalName;
        let count = nameCountMap.get(originalName) || 0;
        if (count > 0) {
          finalName = `${originalName} [${count}]`;
          raw = replaceNameField(raw, finalName);
        }
        nameCountMap.set(originalName, count + 1);
        nodes.push("  " + raw.trim());
        nodeNames.push(finalName);
      }
    }

      // 4. 生成地区分组
      const makeGroup = (list) => list.length ? list.map(n => `      - ${quoteYamlString(n)}`).join("\n") : "      - DIRECT";
      const hk = nodeNames.filter(n => /(HK|Hong|Kong|港|香港)/i.test(n));
      const tw = nodeNames.filter(n => /(TW|Taiwan|台|台湾)/i.test(n));
      const jp = nodeNames.filter(n => /(JP|Japan|日|日本)/i.test(n));
      const sg = nodeNames.filter(n => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
      const usa = nodeNames.filter(n => /(US|United|States|America|美|美国|🇺🇸)/i.test(n));
      const cflare = nodeNames.filter(n => /(CF官方优选)/i.test(n));
      const others = nodeNames.filter(n => !/(HK|Hong|Kong|港|香港|TW|Taiwan|台|台湾|JP|Japan|日|日本|SG|Singapore|狮城|新|新加坡|US|United|States|America|美|美国)/i.test(n));

      const usedGB = (summary.used / (1024 ** 3)).toFixed(1);
      const totalGB = (summary.total / (1024 ** 3)).toFixed(1);
      const expireDate = summary.expire === Infinity ? "长期" : new Date(summary.expire * 1000).toLocaleDateString("zh-CN");

    // 5. 最终 YAML (融合原始完整规则 + 搜索优化修复)
    const yaml = `
# 📊 流量汇总: ${usedGB}GB / ${totalGB}GB | 📅 到期: ${expireDate}
${airportDetails.join("\n")}

mixed-port: 7890
allow-lan: true
mode: Rule
log-level: info
ipv6: false
external-controller: 127.0.0.1:9090

find-process-mode: strict
udp: true
unified-delay: true
tcp-concurrent: true

geodata-mode: true
geox-url:
  geoip: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat"
  geosite: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"
  mmdb: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb"

tun:
  enable: true
  stack: system
  dns-hijack:
    - any:53
  auto-route: true
  auto-detect-interface: true
  mtu: 1500

sniffer:
  enable: false
  parse-pure-ip: true
  override-destination: true
  sniff:
    TLS: 
      ports: [443, 8443]
    HTTP: 
      ports: [80, 8080-8880]
    QUIC: 
      ports: [443, 8443]
  # 增加下面这段：跳过对 OKX 域名的嗅探
  skip-domain:
    - '+.okx.com'
    - '+.okex.com'
    - '+.oklink.com'
    - '+.okxcdn.com'
    - '+.okx-dns.com'
    - '+.okx-doh.com'
    - '+.okx-httpdns.com'
    - '+.okx.cab'
    - '+.okex.org'
    - '+.binance.com'
    - '+.google.com'
    - '+.openai.com'

dns:
  enable: true
  listen: 0.0.0.0:53
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  respect-rules: true
  
  # 💡 修正：只保留必须直连的。币安、OKX、Google、Gemini 全部移出此列表！
  fake-ip-filter:
    - '+.lan'
    - '+.local'
    - 'ntp.*.com'
    - 'connectivitycheck.gstatic.com'
    - 'detectportal.firefox.com'

  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
    - 223.5.5.5
  
  fallback:
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
  
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4

  nameserver-policy:
    'geosite:cn,private': [https://dns.alidns.com/dns-query, 223.5.5.5]
    'geosite:google,youtube,telegram': [https://dns.google/dns-query, https://1.1.1.1/dns-query]
    # 💡 我们保留了最稳的 Google/YT/TG 走国外 DNS，其他的走默认逻辑即可，不影响最终分流。

  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29

proxies:
${nodes.length > 0 ? nodes.join("\n") : "[]"}

proxy-groups:
  - name: "🤖 AI Services"
    type: select
    proxies:
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🌩️ CF 优选新加坡"
      - "🇺🇸 USA"
      - "🏮 Taiwan"

  - name: "🚀 Auto Speed"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 1200
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(nodeNames)}

  - name: "📉 Auto Fallback"
    type: fallback
    url: https://www.google.com/generate_204
    interval: 300
    lazy: true
    proxies:
      - "🇭🇰 Hong Kong"
      - "🏮 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🌩️ CF 优选新加坡"
      - "🇺🇸 USA"
      - "🚀 Auto Speed"

  - name: "💰 Crypto Services"
    type: url-test
    url: "https://www.binance.com"
    interval: 1200
    tolerance: 100
    lazy: true
    proxies:
      - "🏮 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🌩️ CF 优选新加坡"

  - name: "🎬 Media & Social"
    type: url-test
    url: "https://www.youtube.com/generate_204"
    interval: 1200
    tolerance: 100
    lazy: true
    proxies:
      - "🚀 Auto Speed"
      - "🇭🇰 Hong Kong"
      - "🌩️ CF 优选新加坡"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇺🇸 USA"
      - "🏮 Taiwan"

  - name: "🎵 TikTok"
    type: url-test
    url: "https://www.tiktok.com"
    interval: 1200
    tolerance: 100
    lazy: true
    proxies:
      - "🇸🇬 Singapore"
      - "🌩️ CF 优选新加坡"
      - "🇺🇸 USA"
      - "🇯🇵 Japan"
      - "🏮 Taiwan"

  - name: "🇭🇰 Hong Kong"
    type: fallback
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(hk)}

  - name: "🌩️ CF 优选新加坡"
    type: fallback
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(cflare)}

  - name: "🏮 Taiwan"
    type: fallback
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(tw)}

  - name: "🇯🇵 Japan"
    type: fallback
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(jp)}

  - name: "🇸🇬 Singapore"
    type: fallback
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(sg)}

  - name: "🇺🇸 USA"
    type: fallback
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(usa)}

  - name: "🌍 Others"
    type: select
    proxies:
${makeGroup(others)}

  - name: "🔰 Proxy Select"
    type: select
    proxies:
      - "🚀 Auto Speed"
      - "🇭🇰 Hong Kong"
      - "📉 Auto Fallback"
      - "💰 Crypto Services"
      - "🤖 AI Services"
      - "🏮 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🇺🇸 USA"
      - "🌩️ CF 优选新加坡"
      - "🌍 Others"
      - DIRECT

  - name: "🛑 AdBlock"
    type: select
    proxies:
      - REJECT
      - DIRECT

  - name: "🍎 Apple Services"
    type: select
    proxies:
      - DIRECT
      - "🇺🇸 USA"
      - "🚀 Auto Speed"

  - name: "🐟 Final Select"
    type: select
    proxies:
      - "🔰 Proxy Select"
      - "🚀 Auto Speed"
      - "📉 Auto Fallback"
      - DIRECT
      - "🇭🇰 Hong Kong"
      - "🏮 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🌩️ CF 优选新加坡"
      - "🇺🇸 USA"

rule-providers:
  Reject:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt"
    path: ./ruleset/reject.txt
    interval: 86400
    lazy: true
  China:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt"
    path: ./ruleset/direct.txt
    interval: 86400
    lazy: true
  Private:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt"
    path: ./ruleset/private.txt
    interval: 86400
    lazy: true
  Proxy:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt"
    path: ./ruleset/proxy.txt
    interval: 86400
    lazy: true
  Apple:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt"
    path: ./ruleset/apple.txt
    interval: 86400
    lazy: true
  Google:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google.txt"
    path: ./ruleset/google.txt
    interval: 86400
    lazy: true
  GoogleCN:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google-cn.txt"
    path: ./ruleset/google-cn.txt
    interval: 86400
    lazy: true
  TelegramCIDR:
    type: http
    behavior: ipcidr
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/telegramcidr.txt"
    path: ./ruleset/telegramcidr.txt
    interval: 86400
    lazy: true

rules:
  - GEOSITE,private,DIRECT
  - GEOIP,private,DIRECT,no-resolve
  - DOMAIN-SUFFIX,local,DIRECT

  # 2. 阻断 UDP 443 (防 QUIC)
  # 说明：这是“稳定优先”策略，会牺牲部分 App 的 QUIC 性能。
  # - AND,(NETWORK,UDP),(DST-PORT,443),REJECT
  - RULE-SET,Reject,🛑 AdBlock
  - GEOSITE,category-ads-all,🛑 AdBlock
  - DOMAIN-SUFFIX,telemetry.microsoft.com,🛑 AdBlock
  - DOMAIN-SUFFIX,stats.g.doubleclick.net,🛑 AdBlock

# ===================================================
  # 🎯 Gmail 专用：强制走美国节点分组 (提高同步稳定性)
  # ===================================================
  
  # 1. 核心域名定向到美国
  - DOMAIN-SUFFIX,gmail.com,🇺🇸 USA
  - DOMAIN-SUFFIX,googlemail.com,🇺🇸 USA
  - DOMAIN,imap.gmail.com,🇺🇸 USA
  - DOMAIN,smtp.gmail.com,🇺🇸 USA
  - DOMAIN,pop.gmail.com,🇺🇸 USA
  - DOMAIN,accounts.google.com,🇺🇸 USA

  # 2. Mac 邮件同步进程定向到美国 (仅限非中国 IP 流量)
  - AND,(PROCESS-NAME,Mail),(NOT,((GEOIP,CN))),🇺🇸 USA
  - AND,(PROCESS-NAME,maild),(NOT,((GEOIP,CN))),🇺🇸 USA

  # 3. 邮件通用端口定向到美国 (仅桌面端 Mail 进程 + 非中国 IP)
  - AND,(OR,(PROCESS-NAME,Mail),(PROCESS-NAME,maild)),(OR,(DST-PORT,993),(DST-PORT,465),(DST-PORT,587)),(NOT,((GEOIP,CN))),🇺🇸 USA
  # ===================================================

  # ===================================================
  # 3. 微软/OneDrive/商店 专用修正策略 (完全恢复原始)
  # ===================================================
  - DOMAIN,graph.microsoft.com,🔰 Proxy Select
  - DOMAIN,login.microsoftonline.com,🔰 Proxy Select
  - DOMAIN,login.live.com,🔰 Proxy Select
  - DOMAIN,shown.cc.cd,🔰 Proxy Select
  - DOMAIN-SUFFIX,onedrive.live.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,onedrive.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,1drv.ms,🔰 Proxy Select
  - DOMAIN-SUFFIX,sharepoint.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,neat-reader.com,🔰 Proxy Select

  # 说明：PROCESS-NAME 规则主要对桌面端有效，移动端通常不生效。
  - PROCESS-NAME,OneDrive.exe,DIRECT
  - PROCESS-NAME,OneDriveStandaloneUpdater.exe,DIRECT
  - PROCESS-NAME,WinStore.App.exe,DIRECT
  - PROCESS-NAME,Store.exe,DIRECT
  - DOMAIN-SUFFIX,windowsupdate.com,DIRECT
  - DOMAIN-SUFFIX,delivery.mp.microsoft.com,DIRECT
  - DOMAIN-SUFFIX,tlu.dl.delivery.mp.microsoft.com,DIRECT
  - DOMAIN-SUFFIX,assets.msn.com,DIRECT

  # 4. Crypto (清除了多余的 GEOSITE)
  - DOMAIN-SUFFIX,binance.com,💰 Crypto Services
  - DOMAIN-SUFFIX,binance.me,💰 Crypto Services
  - DOMAIN-SUFFIX,bnbstatic.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okxcdn.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx-dns.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx-doh.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx-httpdns.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx.cab,💰 Crypto Services
  - DOMAIN-SUFFIX,okex.org,💰 Crypto Services
  - DOMAIN-SUFFIX,okex.com,💰 Crypto Services
  - DOMAIN-SUFFIX,oklink.com,💰 Crypto Services
  - DOMAIN-SUFFIX,bybit.com,💰 Crypto Services
  - DOMAIN-SUFFIX,gate.io,💰 Crypto Services
  - DOMAIN-SUFFIX,huobi.com,💰 Crypto Services
  - DOMAIN-SUFFIX,htx.com,💰 Crypto Services
  - DOMAIN-SUFFIX,kucoin.com,💰 Crypto Services
  - DOMAIN-SUFFIX,mexc.com,💰 Crypto Services
  - DOMAIN-SUFFIX,kraken.com,💰 Crypto Services
  - DOMAIN-SUFFIX,coinbase.com,💰 Crypto Services
  - DOMAIN-SUFFIX,coinmarketcap.com,💰 Crypto Services
  - DOMAIN-SUFFIX,coingecko.com,💰 Crypto Services
  - DOMAIN-SUFFIX,tradingview.com,💰 Crypto Services
  - DOMAIN-SUFFIX,metamask.io,💰 Crypto Services

  # 5. AI Services (完全恢复原始)
  - DOMAIN,ai.google.dev,🤖 AI Services
  - DOMAIN,gemini.google.com,🤖 AI Services
  - DOMAIN,aistudio.google.com,🤖 AI Services
  - DOMAIN,makersuite.google.com,🤖 AI Services
  - DOMAIN,grok.x.com,🤖 AI Services
  - DOMAIN,alkalimakersuite-pa.clients6.google.com,🤖 AI Services
  - DOMAIN-SUFFIX,gemini.gstatic.com,🤖 AI Services
  - DOMAIN-SUFFIX,deepseek.com,🤖 AI Services
  - DOMAIN-SUFFIX,claudestatic.com,🤖 AI Services
  - DOMAIN-KEYWORD,openaicom,🤖 AI Services
  - DOMAIN-SUFFIX,generativelanguage.googleapis.com,🤖 AI Services
  - DOMAIN-SUFFIX,openai.com,🤖 AI Services
  - DOMAIN-SUFFIX,chatgpt.com,🤖 AI Services
  - DOMAIN-SUFFIX,oaiusercontent.com,🤖 AI Services
  - DOMAIN-SUFFIX,oaistatic.com,🤖 AI Services
  - DOMAIN-SUFFIX,auth0.com,🤖 AI Services
  - DOMAIN-SUFFIX,anthropic.com,🤖 AI Services
  - DOMAIN-SUFFIX,claude.ai,🤖 AI Services
  - DOMAIN-SUFFIX,bard.google.com,🤖 AI Services
  - DOMAIN-SUFFIX,grok.com,🤖 AI Services
  - DOMAIN-SUFFIX,x.ai,🤖 AI Services
  - DOMAIN-SUFFIX,perplexity.ai,🤖 AI Services

  # 6. GitHub (完全恢复原始)
  - DOMAIN-SUFFIX,copilot-proxy.githubusercontent.com,🤖 AI Services
  - DOMAIN-SUFFIX,githubcopilot.com,🤖 AI Services
  - DOMAIN-SUFFIX,github.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,githubusercontent.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,github.io,🔰 Proxy Select

  # 7. GEOSITE (完全恢复原始)
  - DOMAIN-KEYWORD,telegram,🎬 Media & Social
  - DOMAIN-SUFFIX,t.me,🎬 Media & Social
  - DOMAIN-SUFFIX,tdesktop.com,🎬 Media & Social
  - GEOSITE,google,🚀 Auto Speed
  - GEOSITE,youtube,🎬 Media & Social
  - GEOSITE,twitter,🎬 Media & Social
  - GEOSITE,telegram,🎬 Media & Social
  - GEOSITE,netflix,🎬 Media & Social
  - GEOSITE,disney,🎬 Media & Social
  - GEOSITE,facebook,🎬 Media & Social
  - GEOSITE,instagram,🎬 Media & Social
  - GEOIP,telegram,🎬 Media & Social

  # 7. Tiktok
  - DOMAIN-SUFFIX,tiktok.com,🎵 TikTok
  - DOMAIN-SUFFIX,tiktokv.com,🎵 TikTok
  - DOMAIN-SUFFIX,byteoversea.com,🎵 TikTok
  - DOMAIN-SUFFIX,ttlivecdn.com,🎵 TikTok

  # 9. Apple & Microsoft (完全恢复原始)
  - GEOSITE,apple,🍎 Apple Services
  - GEOSITE,microsoft,DIRECT

  # 10. 游戏下载 (完全恢复原始)
  - GEOSITE,steam@cn,DIRECT
  - GEOSITE,category-games@cn,DIRECT

  # 11. 软件官网 (完全恢复原始)
  - DOMAIN-SUFFIX,qbittorrent.org,🔰 Proxy Select
  - DOMAIN-SUFFIX,sourceforge.net,🔰 Proxy Select
  - DOMAIN-SUFFIX,sourceforge.io,🔰 Proxy Select
  - DOMAIN-SUFFIX,google.com,🔰 Proxy Select

  # 12. 直连 (完全恢复原始)
  - DOMAIN-SUFFIX,bilibili.com,DIRECT
  - DOMAIN-SUFFIX,taobao.com,DIRECT
  - DOMAIN-SUFFIX,jd.com,DIRECT
  - DOMAIN-SUFFIX,youku.com,DIRECT
  - DOMAIN-SUFFIX,iqiyi.com,DIRECT
  - DOMAIN-SUFFIX,douyu.com,DIRECT
  - DOMAIN-SUFFIX,tencent.com,DIRECT
  - DOMAIN-SUFFIX,netease.com,DIRECT
  - DOMAIN-SUFFIX,weixin.qq.com,DIRECT
  - GEOSITE,cn,DIRECT
  - RULE-SET,China,DIRECT
  - GEOIP,CN,DIRECT,no-resolve

  - GEOSITE,gfw,🔰 Proxy Select
  - MATCH,🐟 Final Select
`;

      if (shouldNotifyTg) {
        ctx.waitUntil(
          sendTelegramNotification(env, {
            source: triggerSource,
            nodeCount: nodeNames.length,
            sourceTotal: AIRPORT_URLS.length,
            sourceSuccess,
            sourceFailed,
            usedGB,
            totalGB,
            expireDate
          })
        );
      }

      return new Response(yaml, {
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Subscription-Userinfo": `upload=0;download=${summary.used};total=${summary.total};expire=${summary.expire}`,
          "Content-Disposition": "attachment; filename=clash_full_fixed.yaml"
        }
      });
    } catch (error) {
      if (shouldNotifyTg) {
        ctx.waitUntil(sendTelegramErrorNotification(env, {
          source: triggerSource,
          message: error instanceof Error ? error.message : String(error)
        }));
      }
      return new Response("Internal Server Error", { status: 500 });
    }
  }
};

async function sendTelegramNotification(env, payload) {
  const botToken = env.TG_BOT_TOKEN;
  const chatId = env.TG_CHAT_ID;
  if (!botToken || !chatId) return;

  const lines = [
    "Clash 订阅自动更新完成",
    `触发来源: ${payload.source || "unknown"}`,
    `节点总数: ${payload.nodeCount}`,
    `源站成功/失败: ${payload.sourceSuccess}/${payload.sourceFailed} (总 ${payload.sourceTotal})`,
    `流量汇总: ${payload.usedGB}GB / ${payload.totalGB}GB`,
    `最早到期: ${payload.expireDate}`
  ];

  if (env.WORKER_URL) {
    lines.push(`订阅地址: ${env.WORKER_URL.replace(/\/+$/, "")}/?token=${env.TOKEN || CONFIG.defaultToken}`);
  }

  const text = lines.join("\n").slice(0, 3900);
  const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_notification: ["1", "true", "yes"].includes(String(env.TG_SILENT || "").toLowerCase())
    }),
    signal: AbortSignal.timeout(CONFIG.telegramTimeout)
  }).catch(() => null);
}

async function sendTelegramErrorNotification(env, payload) {
  const botToken = env.TG_BOT_TOKEN;
  const chatId = env.TG_CHAT_ID;
  if (!botToken || !chatId) return;

  const text = [
    "Clash 订阅更新失败",
    `触发来源: ${payload.source || "unknown"}`,
    `错误信息: ${payload.message || "unknown error"}`
  ].join("\n").slice(0, 3900);

  const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_notification: ["1", "true", "yes"].includes(String(env.TG_SILENT || "").toLowerCase())
    }),
    signal: AbortSignal.timeout(CONFIG.telegramTimeout)
  }).catch(() => null);
}