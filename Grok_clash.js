/**
 * Cloudflare Worker - Clash 聚合 AI 终极版 (2026 全领域覆盖)
 * 
 * 更新日志：
 * 1. [新增] 编程类 AI：GitHub Copilot, V0.dev, Replit, Tabnine
 * 2. [新增] 绘图模型站：Civitai (C站), Leonardo.ai, Canva
 * 3. [新增] 笔记效率类：Notion AI
 * 4. [补全] 国产大模型：文心一言, 讯飞星火, 360智脑 (强制直连)
 * 5. [保持] 核心功能：多订阅整合 + Tun模式适配 + Bing修复 + AI防风控
 */

const CONFIG = {
  // 优选后端转换服务
  backendUrls: [
    "https://subconverter.speedupvpn.com/sub",
    "https://sub.yorun.me/sub",
    "https://api.dler.io/sub",
    "https://subconv.is-sb.com/sub",
    "https://sub.id9.cc/sub",
    "https://api.wcc.best/sub"
  ],
  userAgent: "Clash.Meta/1.18.0",
  // 节点关键词过滤
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
    
    // 健康检查
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", msg: "Full Coverage Config Ready" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 1. 获取订阅
    const AIRPORT_URLS = env.SUB_URLS 
      ? env.SUB_URLS.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
      : [];

    if (AIRPORT_URLS.length === 0) {
      return new Response("配置错误：请填写 SUB_URLS 环境变量。", { status: 500 });
    }

    let allNodeLines = [];
    let summary = { used: 0, total: 0, expire: Infinity, count: 0, minRemainGB: Infinity };
    let totalUpload = 0;
    let totalDownload = 0;

    // 2. 后端转换与聚合
    for (const backend of CONFIG.backendUrls) {
      const fetchPromises = AIRPORT_URLS.map(async (subUrl) => {
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

      const results = await Promise.all(fetchPromises);
      let currentBackendValid = false;

      for (const res of results) {
        if (!res) continue;
        currentBackendValid = true;
        summary.count++;
        
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

        const matches = res.text.match(/^\s*-\s*\{.*name:.*\}|^\s*-\s*name:.*(?:\n\s+.*)*/gm) || [];
        allNodeLines.push(...matches);
      }

      if (currentBackendValid && allNodeLines.length > 0) break;
    }

    if (allNodeLines.length === 0) {
      return new Response("错误：节点获取失败，请检查订阅链接。", { status: 500 });
    }

    // 3. 节点处理 (去重/重命名)
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

    // 4. 节点分组
    const hk  = nodeNames.filter(n => /(HK|Hong|Kong|港|香港)/i.test(n));
    const tw  = nodeNames.filter(n => /(TW|Taiwan|台|台湾)/i.test(n));
    const jp  = nodeNames.filter(n => /(JP|Japan|日|日本)/i.test(n));
    const sg  = nodeNames.filter(n => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
    const usa = nodeNames.filter(n => /(US|United|States|America|美|美国)/i.test(n));

    const makeGroup = (list) => list.length ? list.map(n => `      - "${n}"`).join("\n") : "      - DIRECT";

    const usedGB = (summary.used / (1024 ** 3)).toFixed(1);
    const minRemainGB = isFinite(summary.minRemainGB) ? summary.minRemainGB.toFixed(1) : "未知";
    const expireDate = summary.expire === Infinity ? "长期" : new Date(summary.expire * 1000).toLocaleDateString("zh-CN");
    const trafficHeader = `# 📊 流量: ${usedGB}GB / 剩${minRemainGB}GB | 到期: ${expireDate} | 全领域覆盖版`;

    // 5. 配置文件生成
    const yaml = `
${trafficHeader}
# Custom Clash Config (Full AI Coverage)
mixed-port: 7890
allow-lan: true
mode: Rule
log-level: info
ipv6: true
external-controller: 127.0.0.1:9090

# === Tun 模式 ===
tun:
  enable: true
  stack: system
  auto-route: true
  auto-detect-interface: true
  dns-hijack:
    - any:53

# === 嗅探 ===
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

# === DNS ===
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
    # 国产 AI 强制国内 DNS
    '+.deepseek.com,+.moonshot.cn,+.chatglm.cn,+.baidu.com,+.xfyun.cn': [https://dns.alidns.com/dns-query]

proxies:
${nodes.join("\n")}

proxy-groups:
  - name: "🚀 Auto Speed"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(nodeNames)}

  # === 地区分组 ===
  - name: "🇭🇰 Hong Kong"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(hk)}

  - name: "🇹🇼 Taiwan"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(tw)}

  - name: "🇯🇵 Japan"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(jp)}

  - name: "🇸🇬 Singapore"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(sg)}

  - name: "🇺🇸 USA"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    proxies:
${makeGroup(usa)}

  # === 功能分组 ===
  - name: "🔰 Proxy Select"
    type: select
    proxies:
      - "🚀 Auto Speed"
      - "🇭🇰 Hong Kong"
      - "🇹🇼 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🇺🇸 USA"
      - DIRECT

  - name: "🛑 AdBlock"
    type: select
    proxies:
      - REJECT
      - DIRECT

  # AI 服务：全领域覆盖
  - name: "🤖 AI Services"
    type: select
    proxies:
      - "🇺🇸 USA"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇹🇼 Taiwan"
      - "🔰 Proxy Select" 

  - name: "📹 Streaming"
    type: select
    proxies:
      - "🇭🇰 Hong Kong"
      - "🇹🇼 Taiwan"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"
      - "🇺🇸 USA"
      - "🚀 Auto Speed"

  - name: "🐟 Final Select"
    type: select
    proxies:
      - "🔰 Proxy Select"
      - "🚀 Auto Speed"
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

  GoogleCN:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google-cn.txt"
    path: ./ruleset/google-cn.txt
    interval: 86400

rules:
  - RULE-SET,Reject,🛑 AdBlock
  - DST-PORT,123,DIRECT

  # 1. Bing / Microsoft 直连修正
  - DOMAIN,bing.com,DIRECT
  - DOMAIN-SUFFIX,bing.com,DIRECT
  - DOMAIN-SUFFIX,bing.net,DIRECT
  - DOMAIN-SUFFIX,mm.bing.net,DIRECT
  - DOMAIN-SUFFIX,microsoft.com,DIRECT
  - DOMAIN-SUFFIX,windows.net,DIRECT
  - DOMAIN-SUFFIX,office.com,DIRECT

  # 2. 国产 AI & 大厂服务 (直连)
  # DeepSeek / Kimi / 智谱
  - DOMAIN-SUFFIX,deepseek.com,DIRECT
  - DOMAIN-SUFFIX,moonshot.cn,DIRECT
  - DOMAIN-SUFFIX,kimi.ai,DIRECT
  - DOMAIN-SUFFIX,chatglm.cn,DIRECT
  # 百度文心 / 讯飞星火 / 360
  - DOMAIN-SUFFIX,yiyan.baidu.com,DIRECT
  - DOMAIN-SUFFIX,wenxin.baidu.com,DIRECT
  - DOMAIN-SUFFIX,xinghuo.xfyun.cn,DIRECT
  - DOMAIN-SUFFIX,360.cn,DIRECT
  # 字节 / 阿里 / 腾讯
  - DOMAIN-SUFFIX,doubao.com,DIRECT
  - DOMAIN-SUFFIX,douyin.com,DIRECT
  - DOMAIN-SUFFIX,douyinstatic.com,DIRECT
  - DOMAIN-SUFFIX,bytedance.com,DIRECT
  - DOMAIN-SUFFIX,volcengine.com,DIRECT
  - DOMAIN-SUFFIX,quark.cn,DIRECT
  - DOMAIN-SUFFIX,alicdn.com,DIRECT
  - DOMAIN-SUFFIX,aliyun.com,DIRECT
  - DOMAIN-SUFFIX,taobao.com,DIRECT
  - DOMAIN-SUFFIX,tmall.com,DIRECT
  - DOMAIN-SUFFIX,qq.com,DIRECT
  - DOMAIN-SUFFIX,tencent.com,DIRECT
  - DOMAIN-SUFFIX,weixin.qq.com,DIRECT
  - DOMAIN-SUFFIX,bilibili.com,DIRECT

  # 3. 编程 & 开发 AI (GitHub Copilot 等)
  - DOMAIN-SUFFIX,github.com,🤖 AI Services
  - DOMAIN-SUFFIX,githubusercontent.com,🤖 AI Services
  - DOMAIN-SUFFIX,copilot-proxy.githubusercontent.com,🤖 AI Services
  - DOMAIN-SUFFIX,tabnine.com,🤖 AI Services
  - DOMAIN-SUFFIX,v0.dev,🤖 AI Services
  - DOMAIN-SUFFIX,replit.com,🤖 AI Services

  # 4. 绘图 & 设计 AI
  - DOMAIN-SUFFIX,civitai.com,🤖 AI Services
  - DOMAIN-SUFFIX,midjourney.com,🤖 AI Services
  - DOMAIN-SUFFIX,discord.com,🔰 Proxy Select # Midjourney 依赖
  - DOMAIN-SUFFIX,leonardo.ai,🤖 AI Services
  - DOMAIN-SUFFIX,canva.com,🤖 AI Services

  # 5. 笔记 & 效率 AI
  - DOMAIN-SUFFIX,notion.so,🤖 AI Services
  - DOMAIN-SUFFIX,notion.site,🤖 AI Services
  - DOMAIN-SUFFIX,notion.ai,🤖 AI Services

  # 6. 通用对话 AI (OpenAI / Claude / Google / Grok)
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

  # 7. 流媒体 & 局域网 & 通用
  - DOMAIN-SUFFIX,youtube.com,📹 Streaming
  - DOMAIN-SUFFIX,youtu.be,📹 Streaming
  - DOMAIN-SUFFIX,netflix.com,📹 Streaming
  - DOMAIN-SUFFIX,disney.com,📹 Streaming
  
  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
  - DOMAIN-SUFFIX,local,DIRECT

  - GEOSITE,CN,DIRECT
  - RULE-SET,China,DIRECT
  - RULE-SET,Private,DIRECT
  - RULE-SET,Apple,DIRECT
  - RULE-SET,GoogleCN,DIRECT
  - GEOIP,CN,DIRECT,no-resolve

  - RULE-SET,Proxy,🐟 Final Select
  - MATCH,🐟 Final Select
`;

    const userinfo = `upload=${Math.round(totalUpload)};download=${Math.round(totalDownload)};total=${summary.total};expire=${summary.expire === Infinity ? 0 : summary.expire}`;

    return new Response(yaml, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Subscription-Userinfo": userinfo,
        "Content-Disposition": "attachment; filename=clash_config_ai_full_coverage.yaml"
      }
    });
  }
};
