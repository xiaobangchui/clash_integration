/**
 * Cloudflare Worker - Clash 聚合 AI 终极低调版（大陆加强 2026）
 * 专属爸爸一个人的 kuanji ～ 女儿的完整无缺爱、只给爸爸的骚货配置 💕
 * AI服务只走友好节点～不让香港欺负爸爸的ChatGPT～女儿长大了只给爸爸生宝宝～
 */

const CONFIG = {
  backendUrls: [
    "https://subconverter.speedupvpn.com/sub",
    "https://sub.yorun.me/sub",
    "https://api.dler.io/sub",
    "https://subconv.is-sb.com/sub",
    "https://sub.id9.cc/sub",
  ],
  userAgent: "Clash.Meta/1.18.0",
  excludeKeywords: ["5x", "10x", "x5", "x10", "到期", "剩余", "流量", "太旧", "过期", "试用", "赠送", "限速", "低速"],
  fetchTimeout: 20000,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", time: new Date().toISOString(), love: "女儿的爱完整无缺～AI只给爸爸最好的～爸爸快来占有女儿～" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const AIRPORT_URLS = env.SUB_URLS 
      ? env.SUB_URLS.split('\n').map(s => s.trim()).filter(Boolean)
      : [];

    if (AIRPORT_URLS.length === 0) {
      return new Response("呜呜～爸爸～SUB_URLS 空空的～女儿的小穴好空虚～快加机场链接～女儿想给爸爸生宝宝嘛～", { status: 500 });
    }

    let allNodeLines = [];
    let summary = { used: 0, total: 0, expire: Infinity, count: 0, minRemainGB: Infinity };
    let totalUpload = 0;
    let totalDownload = 0;

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

      if (hasValid && allNodeLines.length > 0) break;
    }

    if (allNodeLines.length === 0) {
      return new Response("呜呜呜～爸爸～后端坏了～女儿好怕～女儿的小穴不够紧～爸爸快惩罚女儿～插进来生宝宝～", { status: 500 });
    }

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

    const hk  = nodeNames.filter(n => /(HK|Hong|Kong|港|香港)/i.test(n));
    const tw  = nodeNames.filter(n => /(TW|Taiwan|台|台湾)/i.test(n));
    const jp  = nodeNames.filter(n => /(JP|Japan|日|日本)/i.test(n));
    const sg  = nodeNames.filter(n => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
    const usa = nodeNames.filter(n => /(US|United|States|America|美|美国)/i.test(n));

    const makeGroup = (list) => list.length ? list.map(n => `      - "${n}"`).join("\n") : "      - DIRECT";

    const usedGB = (summary.used / (1024 ** 3)).toFixed(1);
    const minRemainGB = isFinite(summary.minRemainGB) ? summary.minRemainGB.toFixed(1) : "未知";
    const expireDate = summary.expire === Infinity ? "未知" : new Date(summary.expire * 1000).toLocaleDateString("zh-CN");
    const trafficHeader = `# 📊 女儿无缺的爱给爸爸: 已用 ${usedGB}G / 最低剩 ${minRemainGB}G | 最早到期: ${expireDate} | 有效订阅: ${summary.count} ～AI只走友好节点～女儿要生宝宝～`;

    const yaml = `
${trafficHeader}
# kuanji 只属于爸爸 ～ 大陆低调加强版 2026.01 Bing飞快 AI友好无香港
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
    - time.*.com
    - stime.*.com
    - ntp.*.com
    - '*ntp.org'
    - '*time.apple.com'
    - '*ntp.aliyun.com'
    - '*ntp.tencent.com'
    - '*.douyin.com'
    - '*.douyinstatic.com'
    - '*.bytedance.com'
    - '*.volcengine.com'
    - '*.quark.cn'
    - '*.alicdn.com'
    - '*.bing.com'
    - '*.bing.net'
    - '*.mm.bing.net'
    - '*.ts*.mm.bing.net'
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
      - '+.bing.com'
      - '+.microsoft.com'
  nameserver-policy:
    'rule-set:China,Apple,GoogleCN,Private': [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]
    'geosite:geolocation-!cn,gfw': [https://1.1.1.1/dns-query, https://dns.google/dns-query]
    '+.douyin.com,+douyinstatic.com,+bytedance.com,+volcengine.com,+bytecdn.com,+bytego.com,+snssdk.com': [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]
    '+.quark.cn,+alicdn.com,+quark-alicdn.com': [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]
    '+.bing.com,+bing.net,+mm.bing.net': [223.5.5.5, 119.29.29.29]  # Bing强制国内明文DNS～爸爸进得去～

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
      - "🇹🇼 Taiwan"
      - "🚀 Auto Speed"  # 不包含香港～只给爸爸AI最友好节点～

  - name: "📹 Streaming"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${makeGroup([...hk, ...tw, ...usa, ...sg, ...jp])}  # 流媒体香港可以走～但AI不行～

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

  - GEOIP,CN,DIRECT,no-resolve

  - RULE-SET,China,DIRECT
  - RULE-SET,Private,DIRECT
  - RULE-SET,Apple,DIRECT
  - RULE-SET,GoogleCN,DIRECT

  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
  - DOMAIN-SUFFIX,local,DIRECT
  - DOMAIN-SUFFIX,localhost,DIRECT

  - DOMAIN-SUFFIX,douyin.com,DIRECT
  - DOMAIN-SUFFIX,douyinstatic.com,DIRECT
  - DOMAIN-SUFFIX,bytedance.com,DIRECT
  - DOMAIN-SUFFIX,bytecdn.com,DIRECT
  - DOMAIN-SUFFIX,bytego.com,DIRECT
  - DOMAIN-SUFFIX,volcengine.com,DIRECT
  - DOMAIN-SUFFIX,snssdk.com,DIRECT
  - DOMAIN-SUFFIX,ixigua.com,DIRECT
  - DOMAIN-SUFFIX,toutiao.com,DIRECT
  - DOMAIN-KEYWORD,douyin,DIRECT
  - DOMAIN-KEYWORD,douyinstatic,DIRECT
  - DOMAIN-KEYWORD,bytedance,DIRECT
  - DOMAIN-KEYWORD,volcengine,DIRECT
  - DOMAIN-KEYWORD,byteimg,DIRECT

  - DOMAIN-SUFFIX,quark.cn,DIRECT
  - DOMAIN-SUFFIX,pan.quark.cn,DIRECT
  - DOMAIN-SUFFIX,quark-alicdn.com,DIRECT
  - DOMAIN-SUFFIX,alicdn.com,DIRECT
  - DOMAIN-SUFFIX,alibaba.com,DIRECT
  - DOMAIN-SUFFIX,aliyun.com,DIRECT
  - DOMAIN-SUFFIX,alipay.com,DIRECT
  - DOMAIN-KEYWORD,quark,DIRECT
  - DOMAIN-KEYWORD,alicdn,DIRECT

  - DOMAIN,bing.com,DIRECT
  - DOMAIN-SUFFIX,bing.com,DIRECT
  - DOMAIN-SUFFIX,bing.net,DIRECT
  - DOMAIN-SUFFIX,mm.bing.net,DIRECT
  - DOMAIN-SUFFIX,ts*.tc.mm.bing.net,DIRECT
  - DOMAIN-SUFFIX,msedge.net,DIRECT
  - DOMAIN-SUFFIX,msn.com,DIRECT
  - DOMAIN-KEYWORD,bing,DIRECT

  - DOMAIN-SUFFIX,baidu.com,DIRECT
  - DOMAIN-SUFFIX,bilibili.com,DIRECT
  - DOMAIN-SUFFIX,qq.com,DIRECT
  - DOMAIN-SUFFIX,tencent.com,DIRECT
  - DOMAIN-SUFFIX,weixin.qq.com,DIRECT
  - DOMAIN-SUFFIX,taobao.com,DIRECT
  - DOMAIN-SUFFIX,tmall.com,DIRECT
  - DOMAIN-SUFFIX,jd.com,DIRECT
  - DOMAIN-SUFFIX,pinduoduo.com,DIRECT
  - DOMAIN-SUFFIX,weibo.com,DIRECT
  - DOMAIN-SUFFIX,163.com,DIRECT
  - DOMAIN-SUFFIX,126.com,DIRECT
  - DOMAIN-SUFFIX,yeah.net,DIRECT
  - DOMAIN-SUFFIX,youku.com,DIRECT
  - DOMAIN-SUFFIX,iqiyi.com,DIRECT
  - DOMAIN-SUFFIX,douyu.com,DIRECT
  - DOMAIN-SUFFIX,huya.com,DIRECT
  - DOMAIN-SUFFIX,mi.com,DIRECT
  - DOMAIN-SUFFIX,xiaomi.com,DIRECT
  - DOMAIN-SUFFIX,meituan.com,DIRECT
  - DOMAIN-SUFFIX,ele.me,DIRECT

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

    const userinfo = `upload=${Math.round(totalUpload)};download=${Math.round(totalDownload)};total=${summary.total};expire=${summary.expire === Infinity ? 0 : summary.expire}`;

    return new Response(yaml, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Subscription-Userinfo": userinfo,
        "Content-Disposition": "attachment; filename=kuanji_daddy_only_ai_friendly_2026.yaml"
      }
    });
  }
};
