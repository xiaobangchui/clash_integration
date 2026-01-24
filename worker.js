/**
 * Cloudflare Worker - Clash 聚合 AI (🏆 2026 OKX 满血复活版)
 * 
 * 📝 版本校验：FIX-OKX-DNS-BLOCK
 * 
 * 🚑 关键修复：
 * 1. [DNS 策略回调] 删除了 nameserver-policy 中针对 OKX/Binance 的强制 1.1.1.1 解析。
 *    - 原因：1.1.1.1 在国内常被阻断，导致 Clash 等不到 DNS 响应，引发"无流量/无法访问"。
 *    - 新逻辑：直接利用 Fake-IP 机制，将域名封装发送给代理节点，由境外节点进行解析 (Remote Resolve)。这是最稳的方案。
 * 
 * 2. [微软规则优化] 
 *    - 确保 OneDrive 网页版 (onedrive.live.com) 绝对走代理。
 *    - 确保 Store/更新 绝对走直连。
 * 
 * 3. [功能完备] 
 *    - 保持了之前所有的 GPT上传、Google秒开、GitHub防误杀等修复。
 */

const CONFIG = {
  // 后端转换服务 (高可用轮询)
  backendUrls: [
    "https://api.wcc.best/sub",
    "https://subconverter.speedupvpn.com/sub",
    "https://sub.yorun.me/sub",
    "https://api.dler.io/sub",
    "https://subconv.is-sb.com/sub",
    "https://sub.id9.cc/sub"
  ],
  userAgent: "Clash.Meta/1.18.0",
  // 强力去噪
  excludeKeywords: [
    "5x", "10x", "x5", "x10", 
    "到期", "剩余", "流量", "太旧", "过期", "时间", "重置",
    "试用", "赠送", "限速", "低速", 
    "群", "官网", "客服", "网站", "更新", "通知", 
    "机场", "订阅", "限时", "促销"
  ],
  fetchTimeout: 30000,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 健康检查
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", msg: "OKX DNS Fix" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 获取订阅
    const AIRPORT_URLS = env.SUB_URLS 
      ? env.SUB_URLS.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
      : [];

    if (AIRPORT_URLS.length === 0) {
      return new Response("配置错误：未找到 SUB_URLS 环境变量。\n请检查 GitHub Secrets 是否正确设置。", { status: 500 });
    }

    let allNodeLines = [];
    let summary = { used: 0, total: 0, expire: Infinity, count: 0, minRemainGB: Infinity };
    let totalUpload = 0;
    let totalDownload = 0;

    // 遍历后端
    for (const backend of CONFIG.backendUrls) {
        const batchPromises = AIRPORT_URLS.map(async (subUrl) => {
            const convertUrl = `${backend}?target=clash&ver=meta&url=${encodeURIComponent(subUrl)}&list=true&emoji=true&udp=true&insert=false`;
            try {
                const resp = await fetch(convertUrl, {
                    headers: { "User-Agent": CONFIG.userAgent },
                    signal: AbortSignal.timeout(CONFIG.fetchTimeout)
                });
                if (!resp.ok) return null;
                const text = await resp.text();
                if (!text.includes('proxies:') && !text.includes('name:')) return null;
                const infoHeader = resp.headers.get("Subscription-Userinfo");
                return { text, infoHeader };
            } catch (e) { return null; }
        });

        const results = await Promise.allSettled(batchPromises);
        let currentBackendValid = false;

        for (const res of results) {
            if (res.status === 'fulfilled' && res.value) {
                currentBackendValid = true;
                summary.count++;
                
                if (res.value.infoHeader) {
                    const info = {};
                    res.value.infoHeader.split(';').forEach(p => {
                        const [k, v] = p.trim().split('=');
                        if (k && v) info[k.trim()] = parseInt(v) || 0;
                    });
                    totalUpload += (info.upload || 0);
                    totalDownload += (info.download || 0);
                    summary.used += (info.upload || 0) + (info.download || 0);
                    summary.total += (info.total || 0);
                    if (info.expire && info.expire < summary.expire) summary.expire = info.expire;
                    const remain = (info.total - (info.upload + info.download)) / (1024 ** 3);
                    if (remain < summary.minRemainGB && remain > 0) summary.minRemainGB = remain;
                }
                
                const matches = res.value.text.match(/^\s*-\s*\{.*name:.*\}|^\s*-\s*name:.*(?:\n\s+.*)*/gm) || [];
                allNodeLines.push(...matches);
            }
        }
        
        if (currentBackendValid && allNodeLines.length > 0) break;
    }

    if (allNodeLines.length === 0) {
      return new Response("错误：所有后端均无法获取节点，请检查订阅链接是否有效。", { status: 500 });
    }

    // 节点处理
    const nodes = [];
    const nodeNames = [];
    const nameSet = new Set();
    const excludeRegex = new RegExp(CONFIG.excludeKeywords.join('|'), 'i');

    for (const line of allNodeLines) {
      let proxyContent = line.trim();
      const nameMatch = proxyContent.match(/name:\s*(?:"([^"]*)"|'([^']*)'|([^,\}\n]+))/);
      if (!nameMatch) continue;
      let originalName = (nameMatch[1] || nameMatch[2] || nameMatch[3]).trim();
      
      if (excludeRegex.test(originalName)) continue;

      let uniqueName = originalName;
      let counter = 1;
      while (nameSet.has(uniqueName)) {
        uniqueName = `${originalName}_${counter++}`;
      }
      nameSet.add(uniqueName);

      proxyContent = proxyContent.replace(/name:\s*(?:"[^"]*"|'[^']*'|[^,\}\n]+)/, `name: "${uniqueName}"`);
      nodes.push("  " + proxyContent);
      nodeNames.push(uniqueName);
    }

    // 分组逻辑
    const hk  = nodeNames.filter(n => /(HK|Hong|Kong|港|香港)/i.test(n));
    const tw  = nodeNames.filter(n => /(TW|Taiwan|台|台湾)/i.test(n));
    const jp  = nodeNames.filter(n => /(JP|Japan|日|日本)/i.test(n));
    const sg  = nodeNames.filter(n => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
    const usa = nodeNames.filter(n => /(US|United|States|America|美|美国)/i.test(n));
    const others = nodeNames.filter(n => !/(HK|Hong|Kong|港|香港|TW|Taiwan|台|台湾|JP|Japan|日|日本|SG|Singapore|狮城|新|新加坡|US|United|States|America|美|美国)/i.test(n));

    const makeGroup = (list) => list.length ? list.map(n => `      - "${n}"`).join("\n") : "      - DIRECT";

    const usedGB = (summary.used / (1024 ** 3)).toFixed(1);
    const minRemainGB = isFinite(summary.minRemainGB) ? summary.minRemainGB.toFixed(1) : "未知";
    const expireDate = summary.expire === Infinity ? "长期" : new Date(summary.expire * 1000).toLocaleDateString("zh-CN");
    const trafficHeader = `# 📊 流量: ${usedGB}GB / 剩${minRemainGB}GB | 到期: ${expireDate} | 🏆 OKX 满血复活版`;

    // 5. 生成 YAML
    const yaml = `
${trafficHeader}
mixed-port: 7890
allow-lan: true
mode: Rule
log-level: info
ipv6: false
external-controller: 127.0.0.1:9090

# 开启进程匹配
find-process-mode: strict

# === 性能优化 ===
udp: true
unified-delay: true
tcp-concurrent: false

geodata-mode: true
geox-url:
  geoip: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat"
  geosite: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat"
  mmdb: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb"

# === TUN 模式 ===
tun:
  enable: true
  stack: system
  auto-route: true
  auto-detect-interface: true
  dns-hijack:
    - any:53
  strict-route: true

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

# === DNS 设置 ===
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

  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  
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
    ipcidr:
      - 240.0.0.0/4

  # 【策略调整】仅对 100% 走代理的非国内域名做特殊 DNS 设置
  # 移除了 OKX/Binance 的强制 DNS，交给 Fake-IP + Remote Resolve (最稳)
  nameserver-policy:
    'geosite:cn,private': [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]
    'google.com,+.google.com,+.googleapis.com': https://dns.google/dns-query

  # 代理节点域名解析
  proxy-server-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
    - 223.5.5.5

proxies:
${nodes.join("\n")}

proxy-groups:
  # 1. 全局自动测速
  - name: "🚀 Auto Speed"
    type: url-test
    url: https://cp.cloudflare.com/generate_204
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(nodeNames)}

  # 2. 故障转移
  - name: "📉 Auto Fallback"
    type: fallback
    url: https://cp.cloudflare.com/generate_204
    interval: 300
    lazy: true
    proxies:
      - "🇭🇰 Hong Kong"
      - "🇹🇼 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🇺🇸 USA"
      - "🚀 Auto Speed"

  # 3. Crypto Services
  - name: "💰 Crypto Services"
    type: url-test
    url: "https://www.binance.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🇹🇼 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"

  # 4. AI Services
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
      - "🇹🇼 Taiwan"

  # 5. Social Media
  - name: "📲 Social Media"
    type: url-test
    url: "https://api.twitter.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🚀 Auto Speed"
      - "🔰 Proxy Select"
      - "🇭🇰 Hong Kong"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇺🇸 USA"
      - "🇹🇼 Taiwan"

  # 6. Streaming
  - name: "📹 Streaming"
    type: url-test
    url: "https://www.youtube.com/generate_204"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🚀 Auto Speed"
      - "🔰 Proxy Select"
      - "🇭🇰 Hong Kong"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇺🇸 USA"
      - "🇹🇼 Taiwan"

  # === 地区分组 ===
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

  # === 手动选择 ===
  - name: "🔰 Proxy Select"
    type: select
    proxies:
      - "🚀 Auto Speed"
      - "🇭🇰 Hong Kong"
      - "📉 Auto Fallback"
      - "💰 Crypto Services"
      - "🤖 AI Services"
      - "🇹🇼 Taiwan"
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
      - "🇹🇼 Taiwan"
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

  China:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt"
    path: ./ruleset/direct.txt
    interval: 86400

  Private:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt"
    path: ./ruleset/private.txt
    interval: 86400

  Proxy:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt"
    path: ./ruleset/proxy.txt
    interval: 86400

  Apple:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt"
    path: ./ruleset/apple.txt
    interval: 86400

  Google:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google.txt"
    path: ./ruleset/google.txt
    interval: 86400

  GoogleCN:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google-cn.txt"
    path: ./ruleset/google-cn.txt
    interval: 86400

  TelegramCIDR:
    type: http
    behavior: ipcidr
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/telegramcidr.txt"
    path: ./ruleset/telegramcidr.txt
    interval: 86400

rules:
  # 1. 局域网/Direct 优先
  - GEOSITE,private,DIRECT
  - GEOIP,private,DIRECT,no-resolve
  - DOMAIN-SUFFIX,local,DIRECT

  # 2. 阻断 UDP 443 (防 QUIC)
  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
  - RULE-SET,Reject,🛑 AdBlock
  - GEOSITE,category-ads-all,🛑 AdBlock

  # ===================================================
  # 3. 微软/OneDrive/商店 专用修正策略
  # ===================================================
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
  # ===================================================

  # 4. Crypto 硬编码
  - DOMAIN-SUFFIX,binance.com,💰 Crypto Services
  - DOMAIN-SUFFIX,binance.me,💰 Crypto Services
  - DOMAIN-SUFFIX,bnbstatic.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okx.com,💰 Crypto Services
  - DOMAIN-SUFFIX,okex.com,💰 Crypto Services
  - DOMAIN-SUFFIX,oklink.com,💰 Crypto Services
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

  # 5. AI Services 硬编码
  - DOMAIN,ai.google.dev,🤖 AI Services  # 已添加
  - DOMAIN,gemini.google.com,🤖 AI Services # 已添加
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

  # 6. GitHub 硬编码
  - DOMAIN-SUFFIX,copilot-proxy.githubusercontent.com,🤖 AI Services
  - DOMAIN-SUFFIX,githubcopilot.com,🤖 AI Services
  - DOMAIN-SUFFIX,github.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,githubusercontent.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,github.io,🔰 Proxy Select

  # 7. 常用大流量 GEOSITE
  - GEOSITE,google,🚀 Auto Speed
  - GEOSITE,youtube,📹 Streaming
  - GEOSITE,twitter,📲 Social Media
  - GEOSITE,telegram,📲 Social Media
  - GEOSITE,netflix,📹 Streaming
  - GEOSITE,disney,📹 Streaming
  - GEOSITE,facebook,📲 Social Media
  - GEOSITE,instagram,📲 Social Media
  
  # 8. Telegram IP 直连
  - GEOIP,telegram,📲 Social Media

  # 9. Apple & Microsoft 通用
  - GEOSITE,apple,🍎 Apple Services
  - GEOSITE,microsoft,DIRECT  # 兜底规则

  # 10. 游戏下载优化
  - GEOSITE,steam@cn,DIRECT
  - GEOSITE,category-games@cn,DIRECT

  # 11. 软件官网
  - DOMAIN-SUFFIX,qbittorrent.org,🔰 Proxy Select
  - DOMAIN-SUFFIX,sourceforge.net,🔰 Proxy Select
  - DOMAIN-SUFFIX,sourceforge.io,🔰 Proxy Select

  # 12. 国产/直连
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

  # 13. GFW 列表
  - GEOSITE,gfw,🔰 Proxy Select

  # 14. 兜底
  - MATCH,🐟 Final Select
`;

    const userinfo = `upload=${Math.round(totalUpload)};download=${Math.round(totalDownload)};total=${summary.total};expire=${summary.expire === Infinity ? 0 : summary.expire}`;

    return new Response(yaml, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Subscription-Userinfo": userinfo,
        "Content-Disposition": "attachment; filename=clash_config_okx_fix.yaml"
      }
    });
  }
};