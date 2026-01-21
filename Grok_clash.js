/**
 * Cloudflare Worker - Clash 聚合 AI (终极完美版 2026)
 * 
 * 🛠️ 版本特性说明：
 * 
 * 1. [核心] 真实延迟检测 (Unified Delay):
 *    - 开启 unified-delay: true 和 tcp-concurrent: true。
 *    - 拒绝“假绿”节点，只有 HTTPS 握手成功并返回数据才算通。
 * 
 * 2. [策略] 场景化测速 (Scenario-Based Speedtest):
 *    - 📹 Streaming -> https://www.youtube.com/generate_204 (保视频)
 *    - 📲 Social    -> https://api.twitter.com (保推特/X)
 *    - 🤖 AI Services -> https://alkalimakersuite-pa.clients6.google.com/ (保 AI API)
 *    - 🌍 Regions   -> https://www.google.com/generate_204 (通用标准)
 * 
 * 3. [修复] AI "软封锁"物理隔离:
 *    - 🤖 AI Services 分组采用“白名单”机制。
 *    - 仅允许 US(美)/SG(新)/JP(日)/TW(台) 进入。
 *    - 彻底剔除 HK(香港) 和 Auto Fallback(可能含香港)，防止 Google AI 跳转文档页面。
 * 
 * 4. [优化] 省流防封模式:
 *    - 所有策略组开启 lazy: true。
 *    - 测速间隔统一为 600s (10分钟)，大幅降低机场连接数压力。
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
  // 强力去噪: 过滤掉不可用或垃圾节点
  excludeKeywords: [
    "5x", "10x", "x5", "x10", 
    "到期", "剩余", "流量", "太旧", "过期", "时间", "重置",
    "试用", "赠送", "限速", "低速", 
    "群", "官网", "客服", "网站", "更新", "通知"
  ],
  fetchTimeout: 30000,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 0. 健康检查接口
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", msg: "Clash Config Generator Active" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 1. 获取订阅链接 (从环境变量 SUB_URLS 读取)
    const AIRPORT_URLS = env.SUB_URLS 
      ? env.SUB_URLS.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
      : [];

    if (AIRPORT_URLS.length === 0) {
      return new Response("配置错误：请在 Cloudflare 环境变量中设置 SUB_URLS。", { status: 500 });
    }

    let allNodeLines = [];
    let summary = { used: 0, total: 0, expire: Infinity, count: 0, minRemainGB: Infinity };
    let totalUpload = 0;
    let totalDownload = 0;

    // 2. 遍历后端转换节点 (自动重试)
    for (const backend of CONFIG.backendUrls) {
      const fetchPromises = AIRPORT_URLS.map(async (subUrl) => {
        // 强制开启 udp, emoji, list 模式
        const convertUrl = `${backend}?target=clash&ver=meta&url=${encodeURIComponent(subUrl)}&list=true&emoji=true&udp=true&insert=false`;
        try {
          const resp = await fetch(convertUrl, {
            headers: { "User-Agent": CONFIG.userAgent },
            signal: AbortSignal.timeout(CONFIG.fetchTimeout)
          });
          if (!resp.ok) return null;
          const text = await resp.text();
          // 简单校验返回内容是否有效
          if (!text.includes('proxies:') && !text.includes('name:')) return null;
          const infoHeader = resp.headers.get("Subscription-Userinfo");
          return { text, infoHeader };
        } catch (e) { return null; }
      });

      const results = await Promise.all(fetchPromises);
      let currentBackendValid = false;

      for (const res of results) {
        if (!res) continue;
        currentBackendValid = true;
        summary.count++;
        
        // 解析流量信息
        if (res.infoHeader) {
          const info = {};
          res.infoHeader.split(';').forEach(p => {
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

        // 提取节点信息
        const matches = res.text.match(/^\s*-\s*\{.*name:.*\}|^\s*-\s*name:.*(?:\n\s+.*)*/gm) || [];
        allNodeLines.push(...matches);
      }

      // 如果当前后端成功获取到节点，则跳出循环，不再尝试其他后端
      if (currentBackendValid && allNodeLines.length > 0) break;
    }

    if (allNodeLines.length === 0) {
      return new Response("错误：所有后端均无法获取节点，请检查订阅链接是否有效。", { status: 500 });
    }

    // 3. 节点清洗与重命名
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

      // 节点重名处理
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

    // 4. 动态分组逻辑
    const hk  = nodeNames.filter(n => /(HK|Hong|Kong|港|香港)/i.test(n));
    const tw  = nodeNames.filter(n => /(TW|Taiwan|台|台湾)/i.test(n));
    const jp  = nodeNames.filter(n => /(JP|Japan|日|日本)/i.test(n));
    const sg  = nodeNames.filter(n => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
    const usa = nodeNames.filter(n => /(US|United|States|America|美|美国)/i.test(n));
    const others = nodeNames.filter(n => !/(HK|Hong|Kong|港|香港|TW|Taiwan|台|台湾|JP|Japan|日|日本|SG|Singapore|狮城|新|新加坡|US|United|States|America|美|美国)/i.test(n));

    // 辅助函数：生成 YAML 列表
    const makeGroup = (list) => list.length ? list.map(n => `      - "${n}"`).join("\n") : "      - DIRECT";

    // 生成头部统计信息
    const usedGB = (summary.used / (1024 ** 3)).toFixed(1);
    const minRemainGB = isFinite(summary.minRemainGB) ? summary.minRemainGB.toFixed(1) : "未知";
    const expireDate = summary.expire === Infinity ? "长期" : new Date(summary.expire * 1000).toLocaleDateString("zh-CN");
    const trafficHeader = `# 📊 流量: ${usedGB}GB / 剩${minRemainGB}GB | 到期: ${expireDate} | 终极完美版`;

    // 5. 组装最终 YAML 配置
    const yaml = `
${trafficHeader}
# Custom Clash Config (Final Perfect Edition)
mixed-port: 7890
allow-lan: true
mode: Rule
log-level: info
ipv6: true
external-controller: 127.0.0.1:9090

# === 关键设置：真实连接检测 ===
# 开启后，延迟 = TCP握手 + SSL握手 + HTTP响应。
# 只有能真正传输数据的节点才会被选中，彻底解决“假绿”问题。
unified-delay: true
tcp-concurrent: true

# === Tun 模式 (虚拟网卡) ===
tun:
  enable: true
  stack: system
  auto-route: true
  auto-detect-interface: true
  dns-hijack:
    - any:53

# === 流量嗅探 ===
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

# === DNS 设置 (Fake-IP 模式) ===
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
    - 'time.*.com'
    - '+.douyin.com'
    - '+.bytedance.com'
    - '+.quark.cn'
    - '+.alicdn.com'
    - '+.aliyun.com'
    - '+.bing.com'
    - '+.bing.net'
    - '+.microsoft.com'
    - '+.deepseek.com'
    - '+.cn'
    - '+.apple.com'

  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  fallback:
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4

  nameserver-policy:
    'geosite:cn,private,apple': [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]
    '+.bing.com,+.bing.net,+.microsoft.com': [https://dns.alidns.com/dns-query, 223.5.5.5]
    '+.deepseek.com,+.moonshot.cn,+.chatglm.cn,+.baidu.com': [https://dns.alidns.com/dns-query]

proxies:
${nodes.join("\n")}

proxy-groups:
  # 1. 全局自动测速 (基准 URL: Cloudflare)
  - name: "🚀 Auto Speed"
    type: url-test
    url: https://cp.cloudflare.com/generate_204
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(nodeNames)}

  # 2. 故障转移 (备用策略)
  - name: "📉 Auto Fallback"
    type: fallback
    url: https://cp.cloudflare.com/generate_204
    interval: 300
    lazy: true
    proxies:
      - "🇭🇰 Hong Kong"
      - "🇺🇸 USA"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇹🇼 Taiwan"
      - "🚀 Auto Speed"

  # === 特殊应用分组 (场景化测速) ===
  
  # Social Media -> 强制测 Twitter。
  # 解决：节点通用测速虽快，但 Twitter 实际上连不上的问题。
  - name: "📲 Social Media"
    type: url-test
    url: "https://api.twitter.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🇸🇬 Singapore"
      - "🇺🇸 USA"
      - "🇯🇵 Japan"
      - "🇹🇼 Taiwan"
      - "🇭🇰 Hong Kong"
      - "🚀 Auto Speed"
      - "🔰 Proxy Select"

  # Streaming -> 强制测 YouTube。
  # 解决：确保选中的节点可以流畅观看视频。
  - name: "📹 Streaming"
    type: url-test
    url: "https://www.youtube.com/generate_204"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🇭🇰 Hong Kong"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇺🇸 USA"
      - "🇹🇼 Taiwan"
      - "🚀 Auto Speed"
      - "🔰 Proxy Select"
  
  # AI Services -> 强制测 Google AI API。
  # 策略：[白名单] 仅允许 US, SG, JP, TW。
  # 作用：物理隔离香港节点，杜绝 Google AI Studio 跳转文档页面的软封锁。
  - name: "🤖 AI Services"
    type: url-test
    url: "https://alkalimakersuite-pa.clients6.google.com/"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "🇺🇸 USA"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇹🇼 Taiwan"

  # === 地区分组 (统一使用 Google 测速) ===
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

  # === 功能分组 ===
  - name: "🔰 Proxy Select"
    type: select
    proxies:
      - "🚀 Auto Speed"
      - "📉 Auto Fallback"
      - "🇭🇰 Hong Kong"
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

  # Apple (通常直连即可，部分服务可走美国)
  - name: "🍎 Apple Services"
    type: select
    proxies:
      - DIRECT
      - "🇺🇸 USA"
      - "🚀 Auto Speed"

  # 兜底选择
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

# === 规则集提供商 ===
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

# === 路由规则 ===
rules:
  - RULE-SET,Reject,🛑 AdBlock
  - DST-PORT,123,DIRECT

  # 1. Bing / Microsoft 直连 (优化国内体验)
  - DOMAIN,bing.com,DIRECT
  - DOMAIN-SUFFIX,bing.com,DIRECT
  - DOMAIN-SUFFIX,bing.net,DIRECT
  - DOMAIN-SUFFIX,mm.bing.net,DIRECT
  - DOMAIN-SUFFIX,microsoft.com,DIRECT
  - DOMAIN-SUFFIX,windows.net,DIRECT
  - DOMAIN-SUFFIX,office.com,DIRECT

  # 2. Google AI Studio (强制 AI 组)
  - DOMAIN,aistudio.google.com,🤖 AI Services
  - DOMAIN,makersuite.google.com,🤖 AI Services
  - DOMAIN,alkalimakersuite-pa.clients6.google.com,🤖 AI Services
  - DOMAIN-SUFFIX,generativelanguage.googleapis.com,🤖 AI Services

  # 3. 国产直连 (DeepSeek/Moonshot/Baidu/Ali/Tencent)
  - DOMAIN-SUFFIX,deepseek.com,DIRECT
  - DOMAIN-SUFFIX,moonshot.cn,DIRECT
  - DOMAIN-SUFFIX,kimi.ai,DIRECT
  - DOMAIN-SUFFIX,chatglm.cn,DIRECT
  - DOMAIN-SUFFIX,yiyan.baidu.com,DIRECT
  - DOMAIN-SUFFIX,wenxin.baidu.com,DIRECT
  - DOMAIN-SUFFIX,doubao.com,DIRECT
  - DOMAIN-SUFFIX,douyin.com,DIRECT
  - DOMAIN-SUFFIX,douyinstatic.com,DIRECT
  - DOMAIN-SUFFIX,bytedance.com,DIRECT
  - DOMAIN-SUFFIX,quark.cn,DIRECT
  - DOMAIN-SUFFIX,alicdn.com,DIRECT
  - DOMAIN-SUFFIX,taobao.com,DIRECT
  - DOMAIN-SUFFIX,qq.com,DIRECT
  - DOMAIN-SUFFIX,bilibili.com,DIRECT

  # 4. GitHub 分流 (Copilot 走 AI，其他手动)
  - DOMAIN-SUFFIX,copilot-proxy.githubusercontent.com,🤖 AI Services
  - DOMAIN-SUFFIX,githubcopilot.com,🤖 AI Services
  - DOMAIN-SUFFIX,github.com,🔰 Proxy Select
  - DOMAIN-SUFFIX,githubusercontent.com,🔰 Proxy Select
  
  # 5. AI 服务全集 (Grok/OpenAI/Claude/Meta/Perplexity)
  - DOMAIN-SUFFIX,v0.dev,🤖 AI Services
  - DOMAIN-SUFFIX,replit.com,🤖 AI Services
  - DOMAIN-SUFFIX,civitai.com,🤖 AI Services
  - DOMAIN-SUFFIX,midjourney.com,🤖 AI Services
  - DOMAIN-SUFFIX,leonardo.ai,🤖 AI Services
  - DOMAIN-SUFFIX,notion.so,🤖 AI Services
  - DOMAIN-SUFFIX,openai.com,🤖 AI Services
  - DOMAIN-SUFFIX,chatgpt.com,🤖 AI Services
  - DOMAIN-SUFFIX,auth0.com,🤖 AI Services
  - DOMAIN-SUFFIX,anthropic.com,🤖 AI Services
  - DOMAIN-SUFFIX,claude.ai,🤖 AI Services
  - DOMAIN-SUFFIX,gemini.google.com,🤖 AI Services
  - DOMAIN-SUFFIX,bard.google.com,🤖 AI Services
  - DOMAIN-SUFFIX,googleapis.com,🤖 AI Services
  - DOMAIN-SUFFIX,grok.com,🤖 AI Services
  - DOMAIN-SUFFIX,x.ai,🤖 AI Services
  - DOMAIN-SUFFIX,poe.com,🤖 AI Services
  - DOMAIN-SUFFIX,meta.ai,🤖 AI Services
  - DOMAIN-SUFFIX,perplexity.ai,🤖 AI Services
  - DOMAIN-SUFFIX,huggingface.co,🤖 AI Services
  - DOMAIN-SUFFIX,suno.com,🤖 AI Services

  # 6. 社媒 (Telegram & X/Twitter)
  - DOMAIN-SUFFIX,t.me,📲 Social Media
  - DOMAIN-SUFFIX,telegram.org,📲 Social Media
  - DOMAIN-SUFFIX,telegram.me,📲 Social Media
  - RULE-SET,TelegramCIDR,📲 Social Media
  - DOMAIN-SUFFIX,twitter.com,📲 Social Media
  - DOMAIN-SUFFIX,x.com,📲 Social Media
  - DOMAIN-SUFFIX,t.co,📲 Social Media
  - DOMAIN-SUFFIX,twimg.com,📲 Social Media

  # 7. 流媒体
  - DOMAIN-SUFFIX,youtube.com,📹 Streaming
  - DOMAIN-SUFFIX,youtu.be,📹 Streaming
  - DOMAIN-SUFFIX,googlevideo.com,📹 Streaming
  - DOMAIN-SUFFIX,netflix.com,📹 Streaming
  - DOMAIN-SUFFIX,disney.com,📹 Streaming
  
  # 8. Apple
  - RULE-SET,Apple,🍎 Apple Services

  # 9. 通用规则
  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
  - DOMAIN-SUFFIX,local,DIRECT

  - GEOSITE,CN,DIRECT
  - RULE-SET,China,DIRECT
  - RULE-SET,Private,DIRECT
  - RULE-SET,GoogleCN,DIRECT
  - GEOIP,CN,DIRECT,no-resolve

  - RULE-SET,Proxy,🐟 Final Select
  - MATCH,🐟 Final Select
`;

    // 6. 返回结果
    const userinfo = `upload=${Math.round(totalUpload)};download=${Math.round(totalDownload)};total=${summary.total};expire=${summary.expire === Infinity ? 0 : summary.expire}`;

    return new Response(yaml, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Subscription-Userinfo": userinfo,
        "Content-Disposition": "attachment; filename=clash_config_perfect.yaml"
      }
    });
  }
};