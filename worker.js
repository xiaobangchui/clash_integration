/**
 * Cloudflare Worker - Clash 聚合 AI (🏆 2026 双端通用·满血无损版)
 * 
 * 📝 版本校验：DUAL-OS-FINAL-MAX (HY-DIRECT-RECOVERY)
 * 
 * 🛡️ 核心功能完全保留：
 * 1. [直连无损] 彻底解决后端过滤 HY/HY2 节点的问题。
 * 2. [双模兼容] 内置 TUN 配置 (gvisor 栈)，同时适配系统代理模式。
 * 3. [流量聚合] 自动抓取并累加多机场流量、到期时间。
 * 4. [微软修复] OneDrive 网页走代理，客户端走直连（完全保留）。
 * 5. [规则全量] 币安/OKX/AI 物理隔离，所有的 rule-providers 完整在位。
 */

const CONFIG = {
  userAgent: "ClashMeta", // 模拟 Meta 标识确保机场返回 HY 节点
  fetchTimeout: 30000,
  // 强力去噪 (保留你的功能)
  excludeKeywords: ["5x"],
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 0. 健康检查
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", msg: "Dual OS Ready" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 1. 获取订阅链接 (环境变量)
    const AIRPORT_URLS = env.SUB_URLS 
      ? env.SUB_URLS.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
      : [];

    if (AIRPORT_URLS.length === 0) {
      return new Response("配置错误：未找到 SUB_URLS 环境变量。", { status: 500 });
    }

    let nodes = [];
    let nodeNames = [];
    let summary = { used: 0, total: 0, expire: Infinity, count: 0, minRemainGB: Infinity };
    let totalUpload = 0;
    let totalDownload = 0;
    const excludeRegex = new RegExp(CONFIG.excludeKeywords.join('|'), 'i');

    // 2. 直接抓取订阅 (核心逻辑修改：不再经过后端，防止过滤 HY 节点)
    for (const subUrl of AIRPORT_URLS) {
        try {
            const resp = await fetch(subUrl, {
                headers: { "User-Agent": "ClashMeta" },
                signal: AbortSignal.timeout(CONFIG.fetchTimeout)
            });
            if (!resp.ok) continue;

            // --- 流量统计 (原汁原味聚合) ---
            const infoHeader = resp.headers.get("Subscription-Userinfo");
            if (infoHeader) {
                const info = {};
                infoHeader.split(';').forEach(p => {
                    const [k, v] = p.trim().split('=');
                    if (k && v) info[k.trim()] = parseInt(v) || 0;
                });
                totalUpload += (info.upload || 0);
                totalDownload += (info.download || 0);
                summary.used += (info.upload || 0) + (info.download || 0);
                summary.total += (info.total || 0);
                if (info.expire && info.expire < summary.expire && info.expire > 0) summary.expire = info.expire;
                const remain = (info.total - (info.upload + info.download)) / (1024 ** 3);
                if (remain < summary.minRemainGB && remain > 0) summary.minRemainGB = remain;
                summary.count++;
            }

            const text = await resp.text();
            // 暴力提取 proxies: 块 (无视后端过滤)
            const proxySection = text.split(/proxies:\s*\n/i)[1]?.split(/proxy-groups:|rules:|rule-providers:|dns:|tun:|sniffer:/i)[0];
            
            if (proxySection) {
                const lines = proxySection.split('\n');
                let currentNode = "";
                for (let line of lines) {
                    const trimmed = line.trimEnd();
                    if (!trimmed || trimmed.trimStart().startsWith('#')) continue;
                    // 识别节点开始 (-)
                    if (trimmed.trimStart().startsWith('-')) {
                        if (currentNode) processNode(currentNode);
                        currentNode = trimmed;
                    } else {
                        if (currentNode) currentNode += "\n" + trimmed;
                    }
                }
                if (currentNode) processNode(currentNode);
            }
        } catch (e) {
            console.log("抓取失败:", subUrl, e);
        }
    }

    function processNode(raw) {
        const nameMatch = raw.match(/name:\s*(?:"([^"]*)"|'([^']*)'|([^,\}\n]+))/);
        if (nameMatch) {
            const name = (nameMatch[1] || nameMatch[2] || nameMatch[3]).trim();
            // 保留你的去噪功能
            if (CONFIG.excludeKeywords.length > 0 && excludeRegex.test(name)) return;
            nodes.push("  " + raw.trim());
            nodeNames.push(name);
        }
    }

    if (nodes.length === 0) {
      return new Response("错误：未能提取到节点，请检查 SUB_URLS 是否为有效 Clash 订阅。", { status: 500 });
    }

    // 3. 地区自动分组逻辑 (保留)
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
    const trafficHeader = `# 📊 流量: ${usedGB}GB / 剩${minRemainGB}GB | 到期: ${expireDate} | 🏆 满血无损版`;

    // 4. 生成 YAML (这里完整保留了你的所有 100% 规则、DNS 和 TUN 配置)
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

# === TUN 模式 (Mac 完美适配，Windows 兼容) ===
tun:
  enable: true
  stack: gvisor
  auto-route: true
  auto-detect-interface: true
  dns-hijack:
    - any:53
  # Mac 下建议开启，Windows 下如果冲突可关闭。这里设为 true 兼容 Mac 最佳体验。
  # 如果 Windows 下 TUN 有问题，软件内切换到"系统代理"即可，不影响使用。
  strict-route: true
  mtu: 9000

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

# === DNS 设置 (Fake-IP 纯净模式) ===
dns:
  enable: true
  listen: 0.0.0.0:53
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  respect-rules: true
  
  # Fake-IP 过滤 (防止回环解析错误)
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
  
  # 核心 DNS: 使用国内 DoH，稳定且防普通污染
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

  # 策略分流：仅保留国内域名走国内解析
  # 国外敏感域名(OKX/Google)全部走 Fake-IP 自动代理，不进行本地 DNS 解析，彻底杜绝污染
  nameserver-policy:
    'geosite:cn,private': [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]

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

  # 3. Crypto Services (防封: 剔除香港，优选台湾)
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

  # 4. AI Services (防封: 剔除香港，优选日本/新加坡)
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
  # [A] 必须走代理的 (Web/API/Auth)
  - DOMAIN,graph.microsoft.com,🔰 Proxy Select
  - DOMAIN,login.microsoftonline.com,🔰 Proxy Select
  - DOMAIN,login.live.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,onedrive.live.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,onedrive.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,1drv.ms,🔰 Proxy Select
  - DOMAIN-SUFFIX,sharepoint.com,🔰 Proxy Select

  # [B] 必须直连的 (客户端/更新/商店/大流量)
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
  - GEOSITE,microsoft,DIRECT

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
        "Content-Disposition": "attachment; filename=clash_config_dual_os.yaml"
      }
    });
  }
};