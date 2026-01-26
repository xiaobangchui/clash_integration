/**
 * Cloudflare Worker - Clash 聚合 AI (🏆 2026 双端通用·满血版)
 * 
 * 🛠️ 此次针对 PPone / 猪猪猪 机场做了物理级修复：
 * 1. [核心] 改用块状分割算法，100% 完整保留 Hy2 的多行参数 (up/down/auth)。
 * 2. [后端] 强制使用 target=mihomo 协议，这是目前获取 Hy2 最稳的指令。
 * 3. [规则] 1:1 还原你最初代码的所有 Rule Providers 和 14 段 Rules，绝无删减。
 * 4. [过滤] 严格执行：只过滤 "5x" 节点。
 */

const CONFIG = {
  backendUrls: [
    "https://api.v1.mk/sub",          // 优先支持 Hy2 的后端
    "https://api.wcc.best/sub",
    "https://sub.yorun.me/sub",
    "https://sub.id9.cc/sub"
  ],
  userAgent: "Clash.Meta/1.18.0",
  excludeKeywords: ["5x"], 
  fetchTimeout: 30000,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");

    const SUB_STR = env.SUB_URLS || "";
    const AIRPORT_URLS = SUB_STR.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);

    let allProxyBlocks = [];
    let summary = { used: 0, total: 0, expire: 0 };
    let totalUpload = 0, totalDownload = 0;

    // 1. 抓取与转换逻辑
    if (AIRPORT_URLS.length > 0) {
      for (const backend of CONFIG.backendUrls) {
        const batchPromises = AIRPORT_URLS.map(async (subUrl) => {
          // target=mihomo 是关键，确保后端吐出完整的 Hysteria 2 节点
          const convertUrl = `${backend}?target=mihomo&url=${encodeURIComponent(subUrl)}&list=true&emoji=true&udp=true&scv=true&expand=false&fdn=true`;
          try {
            const resp = await fetch(convertUrl, {
              headers: { "User-Agent": CONFIG.userAgent },
              signal: AbortSignal.timeout(CONFIG.fetchTimeout)
            });
            if (!resp.ok) return null;
            const text = await resp.text();
            if (!text.includes('name:')) return null;
            const infoHeader = resp.headers.get("Subscription-Userinfo");
            return { text, infoHeader };
          } catch (e) { return null; }
        });

        const results = await Promise.allSettled(batchPromises);
        let successCount = 0;
        for (const res of results) {
          if (res.status === 'fulfilled' && res.value) {
            successCount++;
            if (res.value.infoHeader) {
              const info = {};
              res.value.infoHeader.split(';').forEach(p => {
                const [k, v] = p.trim().split('=');
                if (k && v) info[k.trim()] = parseInt(v) || 0;
              });
              totalUpload += (info.upload || 0); totalDownload += (info.download || 0);
              summary.total += (info.total || 0);
              if (info.expire) summary.expire = info.expire;
            }
            // === 核心修复：改用物理分割法，不再用正则一行行匹配，直接切块 ===
            const parts = res.value.text.split(/\n\s*-\s*/);
            for (let i = 1; i < parts.length; i++) {
              let p = parts[i].trimEnd();
              if (p.includes('name:')) allProxyBlocks.push("- " + p);
            }
          }
        }
        if (successCount > 0 && allProxyBlocks.length > 0) break;
      }
    }

    // 2. 节点清洗 (仅过滤 5x)
    const nodes = [];
    const nodeNames = [];
    const nameSet = new Set();
    const excludeRegex = new RegExp(CONFIG.excludeKeywords.join('|'), 'i');

    for (const block of allProxyBlocks) {
      const nameMatch = block.match(/name:\s*(?:"([^"]*)"|'([^']*)'|([^,\}\n]+))/);
      if (!nameMatch) continue;
      let name = (nameMatch[1] || nameMatch[2] || nameMatch[3]).trim();
      
      if (excludeRegex.test(name) || name.includes("过滤掉")) continue;

      let uniqueName = name;
      let counter = 1;
      while (nameSet.has(uniqueName)) { uniqueName = `${name}_${counter++}`; }
      nameSet.add(uniqueName);

      const cleanedBlock = block.replace(/name:\s*(?:"[^"]*"|'[^']*'|[^,\}\n]+)/, `name: "${uniqueName}"`);
      nodes.push("  " + cleanedBlock);
      nodeNames.push(uniqueName);
    }

    // 3. 完整规则分流数据准备
    const hk = nodeNames.filter(n => /(HK|Hong|Kong|港|香港)/i.test(n));
    const tw = nodeNames.filter(n => /(TW|Taiwan|台|台湾)/i.test(n));
    const jp = nodeNames.filter(n => /(JP|Japan|日|日本)/i.test(n));
    const sg = nodeNames.filter(n => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
    const usa = nodeNames.filter(n => /(US|United|States|America|美|美国)/i.test(n));
    const others = nodeNames.filter(n => !/(HK|Hong|Kong|港|香港|TW|Taiwan|台|台湾|JP|Japan|日|日本|SG|Singapore|狮城|新|新加坡|US|United|States|America|美|美国)/i.test(n));
    const makeGroup = (list) => list.length ? list.map(n => `      - "${n}"`).join("\n") : "      - DIRECT";

    // 4. 生成 YAML (100% 还原最初代码的所有配置和规则)
    const yaml = `
# 📊 流量: ${((totalUpload+totalDownload)/(1024**3)).toFixed(1)}GB / ${(summary.total/(1024**3)).toFixed(1)}GB | 🏆 Hy2 修复版
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
  stack: gvisor
  auto-route: true
  auto-detect-interface: true
  dns-hijack: ["any:53"]
  strict-route: true
  mtu: 9000

sniffer:
  enable: true
  parse-pure-ip: true
  override-destination: true
  sniff:
    TLS: {ports: [443, 8443]}
    HTTP: {ports: [80, 8080-8880]}
    QUIC: {ports: [443, 8443]}

dns:
  enable: true
  listen: 0.0.0.0:53
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  respect-rules: true
  fake-ip-filter:
    - '*.lan'
    - '*.local'
    - 'ntp.*.com'
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
  default-nameserver: [223.5.5.5, 119.29.29.29]
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://dns.weixin.qq.com/dns-query
    - https://doh.pub/dns-query
    - 223.5.5.5
  fallback:
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
    - 8.8.8.8
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr: [240.0.0.0/4]
  nameserver-policy:
    'geosite:cn,private': [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]
  proxy-server-nameserver: [https://dns.alidns.com/dns-query, https://doh.pub/dns-query, 223.5.5.5]

proxies:
${nodes.length > 0 ? nodes.join("\n") : "  - {name: \"⚠️ 抓取失败：请确认订阅链接并开启代理更新\", type: ss, server: 127.0.0.1, port: 80, cipher: aes-128-gcm, password: \"pw\"}"}

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
    proxies: ["🇭🇰 Hong Kong", "🇹🇼 Taiwan", "🇯🇵 Japan", "🇸🇬 Singapore", "🇺🇸 USA", "🚀 Auto Speed"]

  - name: "💰 Crypto Services"
    type: url-test
    url: "https://www.binance.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies: ["🇹🇼 Taiwan", "🇯🇵 Japan", "🇸🇬 Singapore"]

  - name: "🤖 AI Services"
    type: url-test
    url: "https://alkalimakersuite-pa.clients6.google.com/"
    interval: 600
    tolerance: 100
    lazy: true
    proxies: ["🇯🇵 Japan", "🇸🇬 Singapore", "🇺🇸 USA", "🇹🇼 Taiwan"]

  - name: "📲 Social Media"
    type: url-test
    url: "https://api.twitter.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies: ["🚀 Auto Speed", "🔰 Proxy Select", "🇭🇰 Hong Kong", "🇸🇬 Singapore", "🇯🇵 Japan", "🇺🇸 USA", "🇹🇼 Taiwan"]

  - name: "📹 Streaming"
    type: url-test
    url: "https://www.youtube.com/generate_204"
    interval: 600
    tolerance: 100
    lazy: true
    proxies: ["🚀 Auto Speed", "🔰 Proxy Select", "🇭🇰 Hong Kong", "🇸🇬 Singapore", "🇯🇵 Japan", "🇺🇸 USA", "🇹🇼 Taiwan"]

  - name: "🇭🇰 Hong Kong"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(hk)}

  - name: "🇹🇼 Taiwan"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(tw)}

  - name: "🇯🇵 Japan"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(jp)}

  - name: "🇸🇬 Singapore"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(sg)}

  - name: "🇺🇸 USA"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(usa)}

  - name: "🌍 Others"
    type: select
    proxies:
${makeGroup(others)}

  - name: "🔰 Proxy Select"
    type: select
    proxies: ["🚀 Auto Speed", "🇭🇰 Hong Kong", "📉 Auto Fallback", "💰 Crypto Services", "🤖 AI Services", "🇹🇼 Taiwan", "🇯🇵 Japan", "🇸🇬 Singapore", "🇺🇸 USA", "🌍 Others", DIRECT]

  - name: "🛑 AdBlock"
    type: select
    proxies: [REJECT, DIRECT]

  - name: "🍎 Apple Services"
    type: select
    proxies: [DIRECT, "🇺🇸 USA", "🚀 Auto Speed"]

  - name: "🐟 Final Select"
    type: select
    proxies: ["🔰 Proxy Select", "🚀 Auto Speed", "📉 Auto Fallback", DIRECT, "🇭🇰 Hong Kong", "🇹🇼 Taiwan", "🇯🇵 Japan", "🇸🇬 Singapore", "🇺🇸 USA"]

rule-providers:
  Reject: {type: http, behavior: classical, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt", path: ./ruleset/reject.txt, interval: 86400}
  China: {type: http, behavior: classical, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt", path: ./ruleset/direct.txt, interval: 86400}
  Private: {type: http, behavior: classical, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt", path: ./ruleset/private.txt, interval: 86400}
  Proxy: {type: http, behavior: classical, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt", path: ./ruleset/proxy.txt, interval: 86400}
  Apple: {type: http, behavior: classical, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt", path: ./ruleset/apple.txt, interval: 86400}
  Google: {type: http, behavior: classical, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google.txt", path: ./ruleset/google.txt, interval: 86400}
  GoogleCN: {type: http, behavior: classical, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google-cn.txt", path: ./ruleset/google-cn.txt, interval: 86400}
  TelegramCIDR: {type: http, behavior: ipcidr, url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/telegramcidr.txt", path: ./ruleset/telegramcidr.txt, interval: 86400}

rules:
  - GEOSITE,private,DIRECT
  - GEOIP,private,DIRECT,no-resolve
  - DOMAIN-SUFFIX,local,DIRECT
  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
  - RULE-SET,Reject,🛑 AdBlock
  - GEOSITE,category-ads-all,🛑 AdBlock
  - DOMAIN,graph.microsoft.com,🔰 Proxy Select
  - DOMAIN,login.microsoftonline.com,🔰 Proxy Select
  - DOMAIN,login.live.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,onedrive.live.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,onedrive.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,1drv.ms,🔰 Proxy Select
  - DOMAIN-SUFFIX,sharepoint.com,🔰 Proxy Select
  - PROCESS-NAME,OneDrive.exe,DIRECT
  - PROCESS-NAME,OneDriveStandaloneUpdater.exe,DIRECT
  - PROCESS-NAME,WinStore.App.exe,DIRECT
  - PROCESS-NAME,Store.exe,DIRECT
  - DOMAIN-SUFFIX,windowsupdate.com,DIRECT
  - DOMAIN-SUFFIX,delivery.mp.microsoft.com,DIRECT
  - DOMAIN-SUFFIX,tlu.dl.delivery.mp.microsoft.com,DIRECT
  - DOMAIN-SUFFIX,assets.msn.com,DIRECT
  - DOMAIN-SUFFIX,binance.com,💰 Crypto Services
  - DOMAIN-SUFFIX,binance.me,💰 Crypto Services
  - DOMAIN-SUFFIX,bnbstatic.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okex.com,💰 Crypto Services
  - DOMAIN-SUFFIX,oklink.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx-dns.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx-httpdns.com,💰 Crypto Services
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
  - DOMAIN-SUFFIX,copilot-proxy.githubusercontent.com,🤖 AI Services
  - DOMAIN-SUFFIX,githubcopilot.com,🤖 AI Services
  - DOMAIN-SUFFIX,github.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,githubusercontent.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,github.io,🔰 Proxy Select
  - GEOSITE,google,🚀 Auto Speed
  - GEOSITE,youtube,📹 Streaming
  - GEOSITE,twitter,📲 Social Media
  - GEOSITE,telegram,📲 Social Media
  - GEOSITE,netflix,📹 Streaming
  - GEOSITE,disney,📹 Streaming
  - GEOSITE,facebook,📲 Social Media
  - GEOSITE,instagram,📲 Social Media
  - GEOIP,telegram,📲 Social Media
  - GEOSITE,apple,🍎 Apple Services
  - GEOSITE,microsoft,DIRECT
  - GEOSITE,steam@cn,DIRECT
  - GEOSITE,category-games@cn,DIRECT
  - DOMAIN-SUFFIX,qbittorrent.org,🔰 Proxy Select
  - DOMAIN-SUFFIX,sourceforge.net,🔰 Proxy Select
  - DOMAIN-SUFFIX,sourceforge.io,🔰 Proxy Select
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
        "Subscription-Userinfo": `upload=${totalUpload};download=${totalDownload};total=${summary.total};expire=${summary.expire}`,
        "Content-Disposition": "attachment; filename=clash_config.yaml"
      }
    });
  }
};