var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var CONFIG = {
  userAgent: "ClashMeta",
  fetchTimeout: 15e3,
  excludeKeywords: ["5x"],
  defaultToken: "25698"
};
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const accessToken = env.TOKEN || CONFIG.defaultToken;
    if (url.searchParams.get("token") !== accessToken) {
      return new Response("Forbidden: Access Token Required.", { status: 403 });
    }
    if (url.pathname === "/health")
      return new Response("OK");
    const AIRPORT_URLS = env.SUB_URLS ? env.SUB_URLS.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) : [];
    if (AIRPORT_URLS.length === 0) {
      return new Response("Error: SUB_URLS is empty.", { status: 500 });
    }
    let nodes = [];
    let nodeNames = [];
    let nameCountMap = /* @__PURE__ */ new Map();
    let airportDetails = [];
    let summary = { used: 0, total: 0, expire: Infinity, minRemainGB: Infinity };
    const excludeRegex = new RegExp(CONFIG.excludeKeywords.join("|"), "i");
    const fetchPromises = AIRPORT_URLS.map(async (subUrl, index) => {
      try {
        const resp = await fetch(subUrl, {
          headers: { "User-Agent": CONFIG.userAgent },
          signal: AbortSignal.timeout(CONFIG.fetchTimeout)
        });
        if (!resp.ok)
          return null;
        const infoHeader = resp.headers.get("Subscription-Userinfo");
        if (infoHeader) {
          const info = {};
          infoHeader.split(";").forEach((p) => {
            const [k, v] = p.trim().split("=");
            if (k && v)
              info[k.trim()] = parseInt(v) || 0;
          });
          const remain = ((info.total - (info.upload + info.download)) / 1024 ** 3).toFixed(1);
          const exp = info.expire ? new Date(info.expire * 1e3).toLocaleDateString() : "\u957F\u671F";
          airportDetails.push(`# [\u673A\u573A${index + 1}] \u5269 ${remain}GB | \u5230\u671F: ${exp}`);
          summary.used += info.upload + info.download;
          summary.total += info.total;
          if (info.expire && info.expire < summary.expire && info.expire > 0)
            summary.expire = info.expire;
        }
        const text = await resp.text();
        return { text };
      } catch (e) {
        return null;
      }
    });
    const results = await Promise.allSettled(fetchPromises);
    for (const res of results) {
      if (res.status === "fulfilled" && res.value) {
        const { text } = res.value;
        const proxySection = text.split(/proxies:\s*\n/i)[1]?.split(/proxy-groups:|rules:|rule-providers:|dns:|tun:|sniffer:/i)[0];
        if (proxySection) {
          const lines = proxySection.split("\n");
          let currentNode = "";
          for (let line of lines) {
            const trimmed = line.trimEnd();
            if (!trimmed || trimmed.trimStart().startsWith("#"))
              continue;
            if (trimmed.trimStart().startsWith("-")) {
              if (currentNode)
                processNodeBlock(currentNode);
              currentNode = trimmed;
            } else {
              if (currentNode)
                currentNode += "\n" + trimmed;
            }
          }
          if (currentNode)
            processNodeBlock(currentNode);
        }
      }
    }
    function processNodeBlock(raw) {
      const nameMatch = raw.match(/name:\s*(?:"([^"]*)"|'([^']*)'|([^,\}\n]+))/);
      if (nameMatch) {
        let originalName = (nameMatch[1] || nameMatch[2] || nameMatch[3]).trim();
        if (excludeRegex.test(originalName))
          return;
        let finalName = originalName;
        let count = nameCountMap.get(originalName) || 0;
        if (count > 0) {
          finalName = `${originalName} [${count}]`;
          raw = raw.replace(new RegExp(originalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), finalName);
        }
        nameCountMap.set(originalName, count + 1);
        nodes.push("  " + raw.trim());
        nodeNames.push(finalName);
      }
    }
    __name(processNodeBlock, "processNodeBlock");
    const makeGroup = /* @__PURE__ */ __name((list) => list.length ? list.map((n) => `      - "${n}"`).join("\n") : "      - DIRECT", "makeGroup");
    const hk = nodeNames.filter((n) => /(HK|Hong|Kong|港|香港)/i.test(n));
    const tw = nodeNames.filter((n) => /(TW|Taiwan|台|台湾)/i.test(n));
    const jp = nodeNames.filter((n) => /(JP|Japan|日|日本)/i.test(n));
    const sg = nodeNames.filter((n) => /(SG|Singapore|狮城|新|新加坡)/i.test(n));
    const usa = nodeNames.filter((n) => /(US|United|States|America|美|美国)/i.test(n));
    const others = nodeNames.filter((n) => !/(HK|Hong|Kong|港|香港|TW|Taiwan|台|台湾|JP|Japan|日|日本|SG|Singapore|狮城|新|新加坡|US|United|States|America|美|美国)/i.test(n));
    const usedGB = (summary.used / 1024 ** 3).toFixed(1);
    const totalGB = (summary.total / 1024 ** 3).toFixed(1);
    const expireDate = summary.expire === Infinity ? "\u957F\u671F" : new Date(summary.expire * 1e3).toLocaleDateString("zh-CN");
    const yaml = `
# \u{1F4CA} \u6D41\u91CF\u6C47\u603B: ${usedGB}GB / ${totalGB}GB | \u{1F4C5} \u5230\u671F: ${expireDate}
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
  # \u589E\u52A0\u4E0B\u9762\u8FD9\u6BB5\uFF1A\u8DF3\u8FC7\u5BF9 OKX \u57DF\u540D\u7684\u55C5\u63A2
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
  - name: "\u{1F680} Auto Speed"
    type: url-test
    url: https://cp.cloudflare.com/generate_204
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
${makeGroup(nodeNames)}

  - name: "\u{1F4C9} Auto Fallback"
    type: fallback
    url: https://cp.cloudflare.com/generate_204
    interval: 300
    lazy: true
    proxies:
      - "\u{1F1ED}\u{1F1F0} Hong Kong"
      - "\u{1F1F9}\u{1F1FC} Taiwan"
      - "\u{1F1EF}\u{1F1F5} Japan"
      - "\u{1F1F8}\u{1F1EC} Singapore"
      - "\u{1F1FA}\u{1F1F8} USA"
      - "\u{1F680} Auto Speed"

  - name: "\u{1F4B0} Crypto Services"
    type: url-test
    url: "https://www.binance.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "\u{1F1F9}\u{1F1FC} Taiwan"
      - "\u{1F1EF}\u{1F1F5} Japan"
      - "\u{1F1F8}\u{1F1EC} Singapore"

  - name: "\u{1F916} AI Services"
    type: url-test
    url: "https://alkalimakersuite-pa.clients6.google.com/"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "\u{1F1EF}\u{1F1F5} Japan"
      - "\u{1F1F8}\u{1F1EC} Singapore"
      - "\u{1F1FA}\u{1F1F8} USA"
      - "\u{1F1F9}\u{1F1FC} Taiwan"

  - name: "\u{1F4F2} Social Media"
    type: url-test
    url: "https://api.twitter.com"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "\u{1F680} Auto Speed"
      - "\u{1F1ED}\u{1F1F0} Hong Kong"
      - "\u{1F1F8}\u{1F1EC} Singapore"
      - "\u{1F1FA}\u{1F1F8} USA"
      - "\u{1F1F9}\u{1F1FC} Taiwan"

  - name: "\u{1F4F9} Streaming"
    type: url-test
    url: "https://www.youtube.com/generate_204"
    interval: 600
    tolerance: 100
    lazy: true
    proxies:
      - "\u{1F680} Auto Speed"
      - "\u{1F1ED}\u{1F1F0} Hong Kong"
      - "\u{1F1F8}\u{1F1EC} Singapore"
      - "\u{1F1EF}\u{1F1F5} Japan"
      - "\u{1F1FA}\u{1F1F8} USA"
      - "\u{1F1F9}\u{1F1FC} Taiwan"

  - name: "\u{1F1ED}\u{1F1F0} Hong Kong"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(hk)}

  - name: "\u{1F1F9}\u{1F1FC} Taiwan"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(tw)}

  - name: "\u{1F1EF}\u{1F1F5} Japan"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(jp)}

  - name: "\u{1F1F8}\u{1F1EC} Singapore"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(sg)}

  - name: "\u{1F1FA}\u{1F1F8} USA"
    type: url-test
    url: https://www.google.com/generate_204
    interval: 600
    proxies:
${makeGroup(usa)}

  - name: "\u{1F30D} Others"
    type: select
    proxies:
${makeGroup(others)}

  - name: "\u{1F530} Proxy Select"
    type: select
    proxies:
      - "\u{1F680} Auto Speed"
      - "\u{1F1ED}\u{1F1F0} Hong Kong"
      - "\u{1F4C9} Auto Fallback"
      - "\u{1F4B0} Crypto Services"
      - "\u{1F916} AI Services"
      - "\u{1F1F9}\u{1F1FC} Taiwan"
      - "\u{1F1EF}\u{1F1F5} Japan"
      - "\u{1F1F8}\u{1F1EC} Singapore"
      - "\u{1F1FA}\u{1F1F8} USA"
      - "\u{1F30D} Others"
      - DIRECT

  - name: "\u{1F6D1} AdBlock"
    type: select
    proxies:
      - REJECT
      - DIRECT

  - name: "\u{1F34E} Apple Services"
    type: select
    proxies:
      - DIRECT
      - "\u{1F1FA}\u{1F1F8} USA"
      - "\u{1F680} Auto Speed"

  - name: "\u{1F41F} Final Select"
    type: select
    proxies:
      - "\u{1F530} Proxy Select"
      - "\u{1F680} Auto Speed"
      - "\u{1F4C9} Auto Fallback"
      - DIRECT
      - "\u{1F1ED}\u{1F1F0} Hong Kong"
      - "\u{1F1F9}\u{1F1FC} Taiwan"
      - "\u{1F1EF}\u{1F1F5} Japan"
      - "\u{1F1F8}\u{1F1EC} Singapore"
      - "\u{1F1FA}\u{1F1F8} USA"

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

  # 2. \u963B\u65AD UDP 443 (\u9632 QUIC)
  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
  - RULE-SET,Reject,\u{1F6D1} AdBlock
  - GEOSITE,category-ads-all,\u{1F6D1} AdBlock

  # ===================================================
  # 3. \u5FAE\u8F6F/OneDrive/\u5546\u5E97 \u4E13\u7528\u4FEE\u6B63\u7B56\u7565 (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
  # ===================================================
  - DOMAIN,graph.microsoft.com,\u{1F530} Proxy Select
  - DOMAIN,login.microsoftonline.com,\u{1F530} Proxy Select
  - DOMAIN,login.live.com,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,onedrive.live.com,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,onedrive.com,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,1drv.ms,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,sharepoint.com,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,neat-reader.com,\u{1F530} Proxy Select

  - PROCESS-NAME,OneDrive.exe,DIRECT
  - PROCESS-NAME,OneDriveStandaloneUpdater.exe,DIRECT
  - PROCESS-NAME,WinStore.App.exe,DIRECT
  - PROCESS-NAME,Store.exe,DIRECT
  - DOMAIN-SUFFIX,windowsupdate.com,DIRECT
  - DOMAIN-SUFFIX,delivery.mp.microsoft.com,DIRECT
  - DOMAIN-SUFFIX,tlu.dl.delivery.mp.microsoft.com,DIRECT
  - DOMAIN-SUFFIX,assets.msn.com,DIRECT

  # 4. Crypto (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
  - DOMAIN-SUFFIX,binance.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,binance.me,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,bnbstatic.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okx.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okxcdn.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okx-dns.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okx-doh.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okx-httpdns.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okx.cab,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okex.org,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okex.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,oklink.com,\u{1F4B0} Crypto Services
  - GEOSITE,okx,\u{1F4B0} Crypto Services
  - GEOSITE,binance,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okx-dns.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,okcdn.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,bybit.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,gate.io,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,huobi.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,htx.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,kucoin.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,mexc.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,kraken.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,coinbase.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,coinmarketcap.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,coingecko.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,tradingview.com,\u{1F4B0} Crypto Services
  - DOMAIN-SUFFIX,metamask.io,\u{1F4B0} Crypto Services

  # 5. AI Services (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
  - DOMAIN,ai.google.dev,\u{1F916} AI Services
  - DOMAIN,gemini.google.com,\u{1F916} AI Services
  - DOMAIN,aistudio.google.com,\u{1F916} AI Services
  - DOMAIN,makersuite.google.com,\u{1F916} AI Services
  - DOMAIN,grok.x.com,\u{1F916} AI Services
  - DOMAIN,alkalimakersuite-pa.clients6.google.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,generativelanguage.googleapis.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,openai.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,chatgpt.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,oaiusercontent.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,oaistatic.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,auth0.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,anthropic.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,claude.ai,\u{1F916} AI Services
  - DOMAIN-SUFFIX,gemini.google.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,bard.google.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,grok.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,x.ai,\u{1F916} AI Services
  - DOMAIN-SUFFIX,perplexity.ai,\u{1F916} AI Services

  # 6. GitHub (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
  - DOMAIN-SUFFIX,copilot-proxy.githubusercontent.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,githubcopilot.com,\u{1F916} AI Services
  - DOMAIN-SUFFIX,github.com,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,githubusercontent.com,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,github.io,\u{1F530} Proxy Select

  # 7. GEOSITE (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
  - GEOSITE,google,\u{1F680} Auto Speed
  - GEOSITE,youtube,\u{1F4F9} Streaming
  - GEOSITE,twitter,\u{1F4F2} Social Media
  - GEOSITE,telegram,\u{1F4F2} Social Media
  - GEOSITE,netflix,\u{1F4F9} Streaming
  - GEOSITE,disney,\u{1F4F9} Streaming
  - GEOSITE,facebook,\u{1F4F2} Social Media
  - GEOSITE,instagram,\u{1F4F2} Social Media
  
  - GEOIP,telegram,\u{1F4F2} Social Media

  # 9. Apple & Microsoft (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
  - GEOSITE,apple,\u{1F34E} Apple Services
  - GEOSITE,microsoft,DIRECT

  # 10. \u6E38\u620F\u4E0B\u8F7D (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
  - GEOSITE,steam@cn,DIRECT
  - GEOSITE,category-games@cn,DIRECT

  # 11. \u8F6F\u4EF6\u5B98\u7F51 (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
  - DOMAIN-SUFFIX,qbittorrent.org,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,sourceforge.net,\u{1F530} Proxy Select
  - DOMAIN-SUFFIX,sourceforge.io,\u{1F530} Proxy Select

  # 12. \u76F4\u8FDE (\u5B8C\u5168\u6062\u590D\u539F\u59CB)
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

  - GEOSITE,gfw,\u{1F530} Proxy Select
  - MATCH,\u{1F41F} Final Select
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
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
