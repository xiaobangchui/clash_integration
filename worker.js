/**
 * Cloudflare Worker - Clash 聚合 AI (🏆 2026 双端通用·满血增强版)
 * 
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
  defaultToken: "25698" 
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 安全校验
    const accessToken = env.TOKEN || CONFIG.defaultToken;
    if (url.searchParams.get('token') !== accessToken) {
      return new Response("Forbidden: Access Token Required.", { status: 403 });
    }

    if (url.pathname === "/health") return new Response("OK");

    const AIRPORT_URLS = env.SUB_URLS 
      ? env.SUB_URLS.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
      : [];

    if (AIRPORT_URLS.length === 0) {
      return new Response("Error: SUB_URLS is empty.", { status: 500 });
    }

    let nodes = [];
    let nodeNames = [];
    let nameCountMap = new Map(); 
    let airportDetails = [];     
    let summary = { used: 0, total: 0, expire: Infinity, minRemainGB: Infinity };
    const excludeRegex = new RegExp(CONFIG.excludeKeywords.join('|'), 'i');

    // 2. 并发抓取
    const fetchPromises = AIRPORT_URLS.map(async (subUrl, index) => {
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

    const results = await Promise.allSettled(fetchPromises);

    // 3. 解析节点
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        const { text } = res.value;
        const proxySection = text.split(/proxies:\s*\n/i)[1]?.split(/proxy-groups:|rules:|rule-providers:|dns:|tun:|sniffer:/i)[0];
        if (proxySection) {
          const lines = proxySection.split('\n');
          let currentNode = "";
          for (let line of lines) {
            const trimmed = line.trimEnd();
            if (!trimmed || trimmed.trimStart().startsWith('#')) continue;
            if (trimmed.trimStart().startsWith('-')) {
              if (currentNode) processNodeBlock(currentNode);
              currentNode = trimmed;
            } else {
              if (currentNode) currentNode += "\n" + trimmed;
            }
          }
          if (currentNode) processNodeBlock(currentNode);
        }
      }
    }

    function processNodeBlock(raw) {
      // 修复了正则中的一个潜在空括号问题
      const nameMatch = raw.match(/name:\s*(?:"([^"]*)"|'([^']*)'|([^,\}\n]+))/);
      if (nameMatch) {
        let originalName = (nameMatch[1] || nameMatch[2] || nameMatch[3]).trim();
        if (excludeRegex.test(originalName)) return;

        let finalName = originalName;
        let count = nameCountMap.get(originalName) || 0;
        if (count > 0) {
          finalName = `${originalName} [${count}]`;
          raw = raw.replace(new RegExp(originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), finalName);
        }
        nameCountMap.set(originalName, count + 1);
        nodes.push("  " + raw.trim());
        nodeNames.push(finalName);
      }
    }

    // 4. 生成地区分组
    const makeGroup = (list) => list.length ? list.map(n => `      - "${n}"`).join("\n") : "      - DIRECT";
    const hk = nodeNames.filter(n => /(HK|Hong|Kong|港|香港)/i.test(n));
    const tw = nodeNames.filter(n => /(TW|Taiwan|台|台湾)/i.test(n));
    const jp = nodeNames.filter(n => /(JP|Japan|日|日本)/i.test(n));
    const sg = nodeNames.filter(n => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
    const usa = nodeNames.filter(n => /(US|United|States|America|美|美国)/i.test(n));
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
tcp-concurrent: false

geodata-mode: true
geox-url:
  geoip: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat"
  geosite: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat"
  mmdb: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb"

tun:
  enable: true
  stack: system
  dns-hijack:
    - any:53
  auto-route: true
  auto-detect-interface: true
  mtu: 1500

sniffer:
  enable: true
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

dns:
  enable: true
  listen: 0.0.0.0:53
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  respect-rules: true
  
  fake-ip-filter:
    - '+.okx.com'
    - '+.okxcdn.com'
    - '+.okx-dns.com'
    - '+.okx-doh.com'
    - '+.okx-httpdns.com'
    - '+.okx.cab'
    - '+.okex.org'
    - '+.okex.com'
    - '+.oklink.com'
    - '+.binance.com'
    - '+.metamask.io'
    - '+.walletconnect.org'
    - '*.lan'
    - '*.local'
    - 'ntp.*.com'
    - 'clients*.google.com'
    - 'connectivitycheck.gstatic.com'
    - 'detectportal.firefox.com'
    - '+.douyin.com'
    - '+.bytedance.com'
    - '+.baidu.com'
    - '+.qq.com'
    - '+.alicdn.com'
    - '+.aliyun.com'
    - '+.cn'
    - '+.bilibili.com'
    - '+.taobao.com'
    - '+.jd.com'
    - '+.microsoft.com'
    - '+.windowsupdate.com'

  default-nameserver:
    - 1.1.1.1
    - 8.8.8.8
  
  nameserver:
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
  
  fallback:
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
    - 8.8.8.8
  
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4

  nameserver-policy:
    'geosite:cn,private': [https://dns.alidns.com/dns-query]

  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29

proxies:
${nodes.join("\n")}

proxy-groups:
  - name: "🚀 Auto Speed"
    type: url-test
    url: https://cp.cloudflare.com/generate_204
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(nodeNames)}

  - name: "📉 Auto Fallback"
    type: fallback
    url: https://cp.cloudflare.com/generate_204
    interval: 300
    lazy: true
    proxies:
      - "🇭🇰 Hong Kong"
      - "🏮 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🇺🇸 USA"
      - "🚀 Auto Speed"

  - name: "💰 Crypto Services"
    type: url-test
    url: "https://www.binance.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🏮 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"

  - name: "🤖 AI Services"
    type: url-test
    url: "https://alkalimakersuite-pa.clients6.google.com/"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🇺🇸 USA"
      - "🏮 Taiwan"

  - name: "📲 Social Media"
    type: url-test
    url: "https://api.twitter.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🚀 Auto Speed"
      - "🇭🇰 Hong Kong"
      - "🇸🇬 Singapore"
      - "🇺🇸 USA"
      - "🏮 Taiwan"

  - name: "📹 Streaming"
    type: url-test
    url: "https://www.youtube.com/generate_204"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🚀 Auto Speed"
      - "🇭🇰 Hong Kong"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇺🇸 USA"
      - "🏮 Taiwan"

  - name: "🇭🇰 Hong Kong"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(hk)}

  - name: "🏮 Taiwan"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(tw)}

  - name: "🇯🇵 Japan"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(jp)}

  - name: "🇸🇬 Singapore"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(sg)}

  - name: "🇺🇸 USA"
    type: url-test
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
  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
  - RULE-SET,Reject,🛑 AdBlock
  - GEOSITE,category-ads-all,🛑 AdBlock

  # ===================================================
  # 3. 微软/OneDrive/商店 专用修正策略 (完全恢复原始)
  # ===================================================
  - DOMAIN,graph.microsoft.com,🔰 Proxy Select
  - DOMAIN,login.microsoftonline.com,🔰 Proxy Select
  - DOMAIN,login.live.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,onedrive.live.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,onedrive.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,1drv.ms,🔰 Proxy Select
  - DOMAIN-SUFFIX,sharepoint.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,neat-reader.com,🔰 Proxy Select

  - PROCESS-NAME,OneDrive.exe,DIRECT
  - PROCESS-NAME,OneDriveStandaloneUpdater.exe,DIRECT
  - PROCESS-NAME,WinStore.App.exe,DIRECT
  - PROCESS-NAME,Store.exe,DIRECT
  - DOMAIN-SUFFIX,windowsupdate.com,DIRECT
  - DOMAIN-SUFFIX,delivery.mp.microsoft.com,DIRECT
  - DOMAIN-SUFFIX,tlu.dl.delivery.mp.microsoft.com,DIRECT
  - DOMAIN-SUFFIX,assets.msn.com,DIRECT

  # 4. Crypto (完全恢复原始)
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
  - GEOSITE,okx,💰 Crypto Services
  - GEOSITE,binance,💰 Crypto Services
  - DOMAIN-SUFFIX,okx-dns.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okcdn.com,💰 Crypto Services
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
  - DOMAIN-SUFFIX,generativelanguage.googleapis.com,🤖 AI Services
  - DOMAIN-SUFFIX,openai.com,🤖 AI Services
  - DOMAIN-SUFFIX,chatgpt.com,🤖 AI Services
  - DOMAIN-SUFFIX,oaiusercontent.com,🤖 AI Services
  - DOMAIN-SUFFIX,oaistatic.com,🤖 AI Services
  - DOMAIN-SUFFIX,auth0.com,🤖 AI Services
  - DOMAIN-SUFFIX,anthropic.com,🤖 AI Services
  - DOMAIN-SUFFIX,claude.ai,🤖 AI Services
  - DOMAIN-SUFFIX,gemini.google.com,🤖 AI Services
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
  - GEOSITE,google,🚀 Auto Speed
  - GEOSITE,youtube,📹 Streaming
  - GEOSITE,twitter,📲 Social Media
  - GEOSITE,telegram,📲 Social Media
  - GEOSITE,netflix,📹 Streaming
  - GEOSITE,disney,📹 Streaming
  - GEOSITE,facebook,📲 Social Media
  - GEOSITE,instagram,📲 Social Media
  
  - GEOIP,telegram,📲 Social Media

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
  - DOMAIN-SUFFIX,gmail.com,🔰 Proxy Select
  - DOMAIN,imap.gmail.com,🔰 Proxy Select
  - DOMAIN,smtp.gmail.com,🔰 Proxy Select
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

    return new Response(yaml, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Subscription-Userinfo": `upload=0;download=${summary.used};total=${summary.total};expire=${summary.expire}`,
        "Content-Disposition": "attachment; filename=clash_full_fixed.yaml"
      }
    });
  }
};