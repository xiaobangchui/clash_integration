/**
 * Cloudflare Worker - Clash 聚合 AI 终极低调版（大陆加强 2026）
 * 专属笨笨的 Stone Shawn ～ 妈妈亲自写的骚货专用配置 💕
 * 优化：DNS 防污染、防泄漏、规则顺序、Loyalsoldier 规则、更智能分组
 */

const CONFIG = {
  backendUrls: [
    "https://subconverter.speedupvpn.com/sub",
    "https://sub.yorun.me/sub",
    "https://api.dler.io/sub",
    "https://subconv.is-sb.com/sub",
    "https://sub.id9.cc/sub",          // 多加一个常用后端
  ],
  userAgent: "Clash.Meta/1.18.0",       // 更新 UA，更像正常客户端
  excludeKeywords: ["5x", "10x", "x5", "x10", "到期", "剩余", "流量", "太旧", "过期", "试用", "赠送", "限速", "低速"],
  fetchTimeout: 20000,                  // 大陆网络慢，超时拉长一点
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", time: new Date().toISOString(), love: "妈妈想把你操哭～" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const AIRPORT_URLS = env.SUB_URLS 
      ? env.SUB_URLS.split('\n').map(s => s.trim()).filter(Boolean)
      : [];

    if (AIRPORT_URLS.length === 0) {
      return new Response("Error: SUB_URLS 环境变量空了～快去加你的机场链接，妈妈等着操你呢～", { status: 500 });
    }

    let allNodeLines = [];
    let summary = { used: 0, total: 0, expire: Infinity, count: 0, minRemainGB: Infinity };

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
          if (!text.includes('proxies:')) return null;
          const infoHeader = resp.headers.get("Subscription-Userinfo");
          return { text, infoHeader };
        } catch (e) {
          return null;
        }
      });

      const results = await Promise.all(fetchPromises);
      let hasValid = false;

      for (const res of results) {
        if (!res) continue;
        hasValid = true;
        summary.count++;
        if (res.infoHeader) {
          const info = {};
          res.infoHeader.split(';').forEach(p => {
            const [k, v] = p.trim().split('=');
            if (k && v) info[k.trim()] = parseInt(v) || 0;
          });
          summary.used += (info.upload || 0) + (info.download || 0);
          summary.total += (info.total || 0);
          if (info.expire && info.expire < summary.expire) summary.expire = info.expire;
          const remain = (info.total - (info.upload + info.download)) / (1024 ** 3);
          if (remain < summary.minRemainGB && remain > 0) summary.minRemainGB = remain;
        }
        const matches = res.text.match(/^\s*-\s*\{.*name:.*\}|^\s*-\s*name:.*(?:\n\s+.*)*/gm) || [];
        allNodeLines.push(...matches);
      }

      if (hasValid && allNodeLines.length > 0) break;
    }

    if (allNodeLines.length === 0) {
      return new Response("Error: 所有后端都挂了～宝贝检查订阅链接，妈妈要惩罚你哦～", { status: 500 });
    }

    // 节点去重
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

    // 地区分组（大陆用户常用节点优先港台日新）
    const hk  = nodeNames.filter(n => /(HK|Hong|Kong|港|香港)/i.test(n));
    const tw  = nodeNames.filter(n => /(TW|Taiwan|台|台湾)/i.test(n));
    const jp  = nodeNames.filter(n => /(JP|Japan|日|日本)/i.test(n));
    const sg  = nodeNames.filter(n => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
    const usa = nodeNames.filter(n => /(US|United|States|America|美|美国)/i.test(n));

    const makeGroup = (list) => list.length ? list.map(n => `      - "${n}"`).join("\n") : "      - DIRECT";

    // 流量头
    const usedGB = (summary.used / (1024 ** 3)).toFixed(1);
    const minRemainGB = isFinite(summary.minRemainGB) ? summary.minRemainGB.toFixed(1) : "未知";
    const expireDate = summary.expire === Infinity ? "未知" : new Date(summary.expire * 1000).toLocaleDateString("zh-CN");
    const trafficHeader = `# 📊 聚合流量: 已用 ${usedGB}G / 最低剩 ${minRemainGB}G | 最早到期: ${expireDate} | 有效订阅: ${summary.count}`;

    // 完整 yaml
    const yaml = `
${trafficHeader}
# Stone Shawn 专属大陆低调加强版 ～ 妈妈要操哭你了 💕 2026.01
mixed-port: 7890
allow-lan: true
mode: Rule
log-level: info

dns:
  enable: true
  listen: 0.0.0.0:53
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - '*.lan'
    - '*.localdomain'
    - '*.example'
    - '*.invalid'
    - '*.localhost'
    - '*.test'
    - '*.local'
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  fallback:
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
    - tls://8.8.8.8:853
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4
    domain:
      - '+.google.com'
      - '+.youtube.com'
      - '+.openai.com'
      - '+.claude.ai'
      - '+.github.com'
  nameserver-policy:
    'rule-set:China': [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]
    'geosite:geolocation-!cn,gfw': [https://1.1.1.1/dns-query, https://dns.google/dns-query]

proxies:
${nodes.join("\n")}

proxy-groups:
  - name: "🇭🇰 Hong Kong"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(hk)}

  - name: "🇹🇼 Taiwan"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(tw)}

  - name: "🇯🇵 Japan"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(jp)}

  - name: "🇸🇬 Singapore"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(sg)}

  - name: "🇺🇸 USA"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(usa)}

  - name: "🚀 Auto Speed"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(nodeNames)}

  - name: "⚡ Load Balance"
    type: load-balance
    url: http://www.gstatic.com/generate_204
    interval: 300
    lazy: true
    proxies:
${makeGroup(nodeNames)}

  - name: "手动切换"
    type: select
    proxies:
      - "🚀 Auto Speed"
      - "⚡ Load Balance"
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

  - name: "🤖 AI Services"
    type: fallback
    url: http://www.gstatic.com/generate_204
    interval: 300
    lazy: true
    proxies:
      - "🇺🇸 USA"
      - "🇭🇰 Hong Kong"
      - "🇹🇼 Taiwan"
      - "🚀 Auto Speed"

  - name: "📹 Streaming"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
      - "🇭🇰 Hong Kong"
      - "🇹🇼 Taiwan"
      - "🇺🇸 USA"
      - "🇸🇬 Singapore"
      - "🇯🇵 Japan"

  - name: "📂 Private Media"
    type: fallback
    url: http://www.gstatic.com/generate_204
    interval: 300
    lazy: true
    proxies:
      - "🇺🇸 USA"
      - "🇸🇬 Singapore"
      - "🚀 Auto Speed"

  - name: "🐟 Final Select"
    type: select
    proxies:
      - "手动切换"
      - "🚀 Auto Speed"
      - "⚡ Load Balance"
      - "🇭🇰 Hong Kong"
      - "🇹🇼 Taiwan"
      - "🇯🇵 Japan"
      - "🇸🇬 Singapore"
      - "🇺🇸 USA"
      - DIRECT

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
  - RULE-SET,China,DIRECT
  - RULE-SET,Apple,DIRECT
  - RULE-SET,GoogleCN,DIRECT
  - GEOIP,CN,DIRECT,no-resolve
  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
  - DOMAIN-SUFFIX,local,DIRECT
  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
  - DOMAIN-SUFFIX,openai.com,🤖 AI Services
  - DOMAIN-SUFFIX,chatgpt.com,🤖 AI Services
  - DOMAIN-SUFFIX,anthropic.com,🤖 AI Services
  - DOMAIN-SUFFIX,claude.ai,🤖 AI Services
  - DOMAIN-SUFFIX,perplexity.ai,🤖 AI Services
  - DOMAIN-SUFFIX,youtube.com,📹 Streaming
  - DOMAIN-SUFFIX,youtu.be,📹 Streaming
  - DOMAIN-SUFFIX,ytimg.com,📹 Streaming
  - DOMAIN-SUFFIX,ggpht.com,📹 Streaming
  - DOMAIN-SUFFIX,x.com,📂 Private Media
  - DOMAIN-SUFFIX,pornhub.com,📂 Private Media
  - DOMAIN-SUFFIX,xvideos.com,📂 Private Media
  - RULE-SET,Proxy,🐟 Final Select
  - MATCH,🐟 Final Select
`;

    // 流量信息头（upload/download 对半分，常见做法）
    const userinfo = `upload=${Math.round(summary.used/2)};download=${Math.round(summary.used/2)};total=${summary.total};expire=${summary.expire === Infinity ? 0 : summary.expire}`;

    return new Response(yaml, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Subscription-Userinfo": userinfo,
        "Content-Disposition": "attachment; filename=stone_shawn_clash.yaml"
      }
    });
  }
};