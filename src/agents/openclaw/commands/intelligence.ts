// ═══════════════════════════════════════════════════════════════
// OpenClaw :: Intelligence Tools — API, Currency, Crypto, Weather,
// DNS, RSS, Code Exec, Download
// ═══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

// ═══ COMMAND: /api — Generic REST API caller ═════════════════
// The most powerful tool: call ANY API on the internet

export const apiCallCommand: OpenClawCommand = {
  name: 'api',
  aliases: ['rest', 'http', 'request'],
  description: 'Call any REST API (GET/POST/PUT/DELETE) with custom headers and body. Returns JSON or text.',
  usage: '/api <method> <url> [json_body]',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const parts = args.trim().match(/^(\S+)\s+(\S+)\s*([\s\S]*)?$/);
    if (!parts) return { success: false, output: 'Usage: /api <GET|POST|PUT|DELETE> <url> [json_body]\nExample: /api GET https://api.github.com/repos/Jonahbaka/PromptPay' };

    const [, method, url, bodyStr] = parts;
    const upperMethod = method.toUpperCase();

    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(upperMethod)) {
      return { success: false, output: `Invalid method: ${method}. Use GET, POST, PUT, PATCH, DELETE.` };
    }

    try {
      new URL(url);
    } catch {
      return { success: false, output: `Invalid URL: ${url}` };
    }

    const headers: Record<string, string> = {
      'User-Agent': 'OpenClaw/1.0 (+https://upromptpay.com)',
      'Accept': 'application/json, text/plain, */*',
    };

    let body: string | undefined;
    if (bodyStr?.trim()) {
      try {
        JSON.parse(bodyStr.trim()); // validate JSON
        body = bodyStr.trim();
        headers['Content-Type'] = 'application/json';
      } catch {
        body = bodyStr.trim();
        headers['Content-Type'] = 'text/plain';
      }
    }

    try {
      const res = await fetch(url, {
        method: upperMethod,
        headers,
        body: ['GET', 'HEAD'].includes(upperMethod) ? undefined : body,
        signal: AbortSignal.timeout(20_000),
      });

      const contentType = res.headers.get('content-type') || '';
      const responseBody = await res.text();

      let output = `**${upperMethod} ${url}**\nStatus: ${res.status} ${res.statusText}\n\n`;

      if (contentType.includes('json')) {
        try {
          output += JSON.stringify(JSON.parse(responseBody), null, 2);
        } catch {
          output += responseBody;
        }
      } else {
        output += responseBody;
      }

      return { success: res.ok, output: output.slice(0, 8000) };
    } catch (err) {
      return { success: false, output: `API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ═══ COMMAND: /currency — Exchange rates ═════════════════════

export const currencyCommand: OpenClawCommand = {
  name: 'currency',
  aliases: ['fx', 'exchange', 'rate'],
  description: 'Get real-time currency exchange rates. Supports 150+ currencies including crypto.',
  usage: '/currency <amount> <from> <to>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      return { success: false, output: 'Usage: /currency <amount> <FROM> <TO>\nExample: /currency 100 USD NGN\nOr: /currency USD (shows all rates)' };
    }

    let amount = 1;
    let from: string;
    let to: string | undefined;

    if (parts.length >= 3 && !isNaN(Number(parts[0]))) {
      amount = Number(parts[0]);
      from = parts[1].toUpperCase();
      to = parts[2].toUpperCase();
    } else if (parts.length >= 2) {
      from = parts[0].toUpperCase();
      to = parts[1].toUpperCase();
    } else {
      from = parts[0].toUpperCase();
    }

    try {
      // Use exchangerate.host or open.er-api.com (free, no key)
      const apiUrl = `https://open.er-api.com/v6/latest/${from}`;
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8_000) });

      if (!res.ok) {
        return { success: false, output: `Exchange rate API error: ${res.status}. Currency "${from}" may not be valid.` };
      }

      const data = await res.json() as {
        result: string;
        base_code: string;
        rates: Record<string, number>;
        time_last_update_utc: string;
      };

      if (data.result !== 'success') {
        return { success: false, output: `Currency not found: ${from}` };
      }

      if (to) {
        const rate = data.rates[to];
        if (!rate) return { success: false, output: `Currency not found: ${to}` };
        const converted = (amount * rate).toFixed(4);
        return {
          success: true,
          output: `**${amount.toLocaleString()} ${from} = ${Number(converted).toLocaleString()} ${to}**\nRate: 1 ${from} = ${rate} ${to}\nUpdated: ${data.time_last_update_utc}`,
        };
      }

      // Show top currencies
      const popular = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'UGX', 'TZS', 'XAF', 'INR', 'CNY', 'JPY', 'BTC'];
      const lines = popular
        .filter(c => c !== from && data.rates[c])
        .map(c => `${c}: ${(amount * data.rates[c]).toLocaleString(undefined, { maximumFractionDigits: 4 })}`);

      return {
        success: true,
        output: `**${amount} ${from} exchange rates:**\n${lines.join('\n')}\n\n_${Object.keys(data.rates).length} currencies available_`,
      };
    } catch (err) {
      return { success: false, output: `Currency error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ═══ COMMAND: /crypto — Cryptocurrency prices ════════════════

export const cryptoCommand: OpenClawCommand = {
  name: 'crypto',
  aliases: ['btc', 'eth', 'coin'],
  description: 'Get real-time cryptocurrency prices, market cap, 24h change via CoinGecko',
  usage: '/crypto <coin_name_or_symbol>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const query = args.trim().toLowerCase();
    if (!query) return { success: false, output: 'Usage: /crypto <name or symbol>\nExamples: /crypto bitcoin, /crypto eth, /crypto solana' };

    // Map common symbols to CoinGecko IDs
    const symbolMap: Record<string, string> = {
      btc: 'bitcoin', eth: 'ethereum', sol: 'solana', ada: 'cardano',
      dot: 'polkadot', avax: 'avalanche-2', matic: 'matic-network',
      link: 'chainlink', uni: 'uniswap', atom: 'cosmos', xrp: 'ripple',
      doge: 'dogecoin', shib: 'shiba-inu', bnb: 'binancecoin',
      ltc: 'litecoin', trx: 'tron', near: 'near', apt: 'aptos',
      usdt: 'tether', usdc: 'usd-coin', dai: 'dai', ton: 'the-open-network',
    };
    const coinId = symbolMap[query] || query;

    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`,
        { signal: AbortSignal.timeout(8_000) }
      );

      if (!res.ok) {
        // Try search
        const searchRes = await fetch(
          `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
          { signal: AbortSignal.timeout(8_000) }
        );
        const searchData = await searchRes.json() as { coins?: Array<{ id: string; name: string; symbol: string; market_cap_rank: number }> };
        if (searchData.coins?.length) {
          const top = searchData.coins.slice(0, 5);
          return {
            success: true,
            output: `Coin "${query}" not found directly. Did you mean:\n${top.map(c => `- ${c.name} (${c.symbol.toUpperCase()}) — rank #${c.market_cap_rank || 'N/A'}`).join('\n')}\n\nTry: /crypto ${top[0].id}`,
          };
        }
        return { success: false, output: `Cryptocurrency not found: ${query}` };
      }

      const data = await res.json() as {
        name: string;
        symbol: string;
        market_cap_rank: number;
        market_data: {
          current_price: { usd: number; ngn?: number; kes?: number };
          price_change_percentage_24h: number;
          price_change_percentage_7d: number;
          market_cap: { usd: number };
          total_volume: { usd: number };
          high_24h: { usd: number };
          low_24h: { usd: number };
          ath: { usd: number };
          ath_change_percentage: { usd: number };
        };
      };

      const md = data.market_data;
      const change24 = md.price_change_percentage_24h?.toFixed(2) || 'N/A';
      const change7d = md.price_change_percentage_7d?.toFixed(2) || 'N/A';
      const arrow24 = Number(change24) >= 0 ? '+' : '';

      let output = `**${data.name} (${data.symbol.toUpperCase()})** — Rank #${data.market_cap_rank || 'N/A'}\n\n`;
      output += `Price: **$${md.current_price.usd.toLocaleString()}**\n`;
      output += `24h: ${arrow24}${change24}% | 7d: ${Number(change7d) >= 0 ? '+' : ''}${change7d}%\n`;
      output += `24h Range: $${md.low_24h?.usd?.toLocaleString()} — $${md.high_24h?.usd?.toLocaleString()}\n`;
      output += `Market Cap: $${(md.market_cap.usd / 1e9).toFixed(2)}B\n`;
      output += `24h Volume: $${(md.total_volume.usd / 1e9).toFixed(2)}B\n`;
      output += `ATH: $${md.ath?.usd?.toLocaleString()} (${md.ath_change_percentage?.usd?.toFixed(1)}% from ATH)`;

      if (md.current_price.ngn) output += `\n\nNGN: ₦${md.current_price.ngn.toLocaleString()}`;
      if (md.current_price.kes) output += ` | KES: KSh${md.current_price.kes.toLocaleString()}`;

      return { success: true, output };
    } catch (err) {
      return { success: false, output: `Crypto error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ═══ COMMAND: /weather — Weather data ════════════════════════

export const weatherCommand: OpenClawCommand = {
  name: 'weather',
  aliases: ['forecast', 'temp'],
  description: 'Get current weather and forecast for any city worldwide',
  usage: '/weather <city>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const city = args.trim();
    if (!city) return { success: false, output: 'Usage: /weather <city>\nExamples: /weather Lagos, /weather New York, /weather Nairobi' };

    try {
      // wttr.in — free, no API key, supports JSON
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
        headers: { 'User-Agent': 'curl/7.68.0' },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) return { success: false, output: `Weather data not found for "${city}"` };

      const data = await res.json() as {
        current_condition: Array<{
          temp_C: string; temp_F: string;
          FeelsLikeC: string; FeelsLikeF: string;
          humidity: string; windspeedKmph: string; winddir16Point: string;
          weatherDesc: Array<{ value: string }>;
          uvIndex: string; visibility: string;
        }>;
        nearest_area: Array<{ areaName: Array<{ value: string }>; country: Array<{ value: string }> }>;
        weather: Array<{
          date: string;
          maxtempC: string; mintempC: string;
          maxtempF: string; mintempF: string;
          hourly: Array<{ weatherDesc: Array<{ value: string }>; tempC: string; chanceofrain: string }>;
        }>;
      };

      const curr = data.current_condition[0];
      const area = data.nearest_area?.[0];
      const location = area ? `${area.areaName[0].value}, ${area.country[0].value}` : city;

      let output = `**Weather: ${location}**\n\n`;
      output += `${curr.weatherDesc[0]?.value || 'N/A'}\n`;
      output += `Temperature: **${curr.temp_C}°C** (${curr.temp_F}°F)\n`;
      output += `Feels like: ${curr.FeelsLikeC}°C (${curr.FeelsLikeF}°F)\n`;
      output += `Humidity: ${curr.humidity}% | Wind: ${curr.windspeedKmph} km/h ${curr.winddir16Point}\n`;
      output += `UV Index: ${curr.uvIndex} | Visibility: ${curr.visibility} km\n`;

      // 3-day forecast
      if (data.weather?.length) {
        output += '\n**Forecast:**\n';
        for (const day of data.weather.slice(0, 3)) {
          const desc = day.hourly?.[4]?.weatherDesc?.[0]?.value || 'N/A';
          const rain = day.hourly?.[4]?.chanceofrain || '0';
          output += `${day.date}: ${desc} | ${day.mintempC}–${day.maxtempC}°C | Rain: ${rain}%\n`;
        }
      }

      return { success: true, output };
    } catch (err) {
      return { success: false, output: `Weather error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ═══ COMMAND: /whois — Domain & DNS lookup ═══════════════════

export const whoisCommand: OpenClawCommand = {
  name: 'whois',
  aliases: ['dns', 'domain', 'nslookup'],
  description: 'Look up domain registration info, DNS records, and SSL certificate details',
  usage: '/whois <domain>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const domain = args.trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!domain) return { success: false, output: 'Usage: /whois <domain>\nExample: /whois upromptpay.com' };

    const results: string[] = [`**Domain: ${domain}**\n`];

    // DNS lookup via dig
    await new Promise<void>((resolve) => {
      exec(`dig +short ${domain} A && echo "---AAAA---" && dig +short ${domain} AAAA && echo "---MX---" && dig +short ${domain} MX && echo "---NS---" && dig +short ${domain} NS && echo "---TXT---" && dig +short ${domain} TXT | head -5`, {
        timeout: 10_000,
      }, (err, stdout) => {
        if (stdout) {
          const sections = stdout.split(/---(\w+)---/);
          const a = sections[0]?.trim();
          const aaaa = sections[2]?.trim();
          const mx = sections[4]?.trim();
          const ns = sections[6]?.trim();
          const txt = sections[8]?.trim();

          if (a) results.push(`**A Records:** ${a.split('\n').join(', ')}`);
          if (aaaa) results.push(`**AAAA:** ${aaaa.split('\n').join(', ')}`);
          if (mx) results.push(`**MX:** ${mx.split('\n').join(', ')}`);
          if (ns) results.push(`**NS:** ${ns.split('\n').join(', ')}`);
          if (txt) results.push(`**TXT:** ${txt.split('\n').slice(0, 3).join('\n')}`);
        }
        resolve();
      });
    });

    // SSL certificate check
    await new Promise<void>((resolve) => {
      exec(`echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates -subject -issuer 2>/dev/null`, {
        timeout: 10_000,
      }, (err, stdout) => {
        if (stdout?.trim()) {
          results.push(`\n**SSL Certificate:**\n\`\`\`\n${stdout.trim()}\n\`\`\``);
        }
        resolve();
      });
    });

    // WHOIS (if available)
    await new Promise<void>((resolve) => {
      exec(`whois ${domain} 2>/dev/null | head -30`, {
        timeout: 10_000,
      }, (err, stdout) => {
        if (stdout?.trim() && !stdout.includes('not found')) {
          results.push(`\n**WHOIS:**\n\`\`\`\n${stdout.trim().slice(0, 1500)}\n\`\`\``);
        }
        resolve();
      });
    });

    return { success: true, output: results.join('\n').slice(0, 6000) };
  },
};

// ═══ COMMAND: /rss — Read RSS/Atom feeds ═════════════════════

export const rssCommand: OpenClawCommand = {
  name: 'rss',
  aliases: ['feed', 'atom'],
  description: 'Read and parse RSS/Atom feeds from any source (blogs, news, podcasts)',
  usage: '/rss <feed_url>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const url = args.trim();
    if (!url) {
      return {
        success: false,
        output: 'Usage: /rss <feed_url>\nExamples:\n/rss https://techcrunch.com/feed/\n/rss https://news.ycombinator.com/rss',
      };
    }

    try {
      const res = await fetch(url.startsWith('http') ? url : `https://${url}`, {
        headers: {
          'User-Agent': 'OpenClaw/1.0 RSS Reader',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return { success: false, output: `Feed error: HTTP ${res.status}` };

      const xml = await res.text();
      const items: string[] = [];

      // Parse RSS <item> elements
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      // Also handle Atom <entry> elements
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;

      const allItems = [...xml.matchAll(itemRegex), ...xml.matchAll(entryRegex)];

      for (const match of allItems.slice(0, 10)) {
        const block = match[1];
        const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || '';
        const link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1]
          || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() || '';
        const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim()
          || block.match(/<published>([\s\S]*?)<\/published>/i)?.[1]?.trim()
          || block.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1]?.trim() || '';
        const desc = block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]
          || block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i)?.[1] || '';

        const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

        if (title) {
          items.push(`**${items.length + 1}. ${title}**${pubDate ? ` _(${pubDate})_` : ''}\n${link ? `   ${link}\n` : ''}${cleanDesc ? `   ${cleanDesc}` : ''}`);
        }
      }

      // Feed title
      const feedTitle = xml.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || 'Feed';

      if (items.length === 0) {
        return { success: true, output: `Feed "${feedTitle}" loaded but no items found. It may not be a valid RSS/Atom feed.` };
      }

      return {
        success: true,
        output: `**${feedTitle}** (${items.length} items)\n\n${items.join('\n\n')}`,
      };
    } catch (err) {
      return { success: false, output: `RSS error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ═══ COMMAND: /exec — Run Node.js code ═══════════════════════

export const codeExecCommand: OpenClawCommand = {
  name: 'code',
  aliases: ['eval', 'node', 'js'],
  description: 'Execute Node.js code on the server and return the result. Has access to fetch, fs, path, crypto, etc.',
  usage: '/code <javascript code>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const code = args.trim();
    if (!code) return { success: false, output: 'Usage: /code <javascript>\nExample: /code console.log(Object.keys(process.versions))' };

    return new Promise((resolve) => {
      // Wrap code to capture output
      const wrapped = `
        const __output = [];
        const __origLog = console.log;
        console.log = (...a) => __output.push(a.map(x => typeof x === 'object' ? JSON.stringify(x, null, 2) : String(x)).join(' '));
        (async () => {
          ${code}
        })().then(r => {
          if (r !== undefined) __output.push(typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r));
          process.stdout.write(__output.join('\\n'));
        }).catch(e => {
          process.stderr.write(e.stack || e.message || String(e));
          process.exit(1);
        });
      `;

      exec(`node -e ${JSON.stringify(wrapped)}`, {
        cwd: ctx.activeProject.path,
        timeout: 15_000,
        maxBuffer: 512 * 1024,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      }, (error, stdout, stderr) => {
        const output = stdout || '';
        const errOut = stderr || '';
        const exitCode = error?.code ?? 0;

        let result = '';
        if (output) result += output;
        if (errOut) result += (result ? '\n' : '') + `Error: ${errOut}`;
        if (error?.killed) result = 'Code execution timed out (15s limit)';
        if (!result) result = '(no output)';

        ctx.auditTrail.record('openclaw', 'code_exec', ctx.chatId, {
          codeLength: code.length,
          exitCode,
          project: ctx.activeProject.id,
        });

        resolve({
          success: exitCode === 0,
          output: `\`\`\`\n${result.slice(0, 4000)}\n\`\`\``,
        });
      });
    });
  },
};

// ═══ COMMAND: /download — Download file from URL ═════════════

export const downloadCommand: OpenClawCommand = {
  name: 'download',
  aliases: ['wget', 'dl'],
  description: 'Download a file from a URL to the server',
  usage: '/download <url> [filename]',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    if (!parts[0]) return { success: false, output: 'Usage: /download <url> [filename]' };

    const url = parts[0];
    const filename = parts[1] || url.split('/').pop()?.split('?')[0] || 'downloaded_file';

    try {
      new URL(url);
    } catch {
      return { success: false, output: `Invalid URL: ${url}` };
    }

    return new Promise((resolve) => {
      const dest = `/tmp/${filename}`;
      exec(`curl -sL -o ${JSON.stringify(dest)} --max-filesize 52428800 --max-time 30 ${JSON.stringify(url)} && ls -lh ${JSON.stringify(dest)}`, {
        timeout: 35_000,
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, output: `Download failed: ${stderr || error.message}` });
        } else {
          resolve({ success: true, output: `Downloaded to: ${dest}\n${stdout.trim()}` });
        }
      });
    });
  },
};

// ═══ COMMAND: /ping — Network connectivity check ═════════════

export const pingCommand: OpenClawCommand = {
  name: 'ping',
  aliases: ['traceroute', 'netcheck'],
  description: 'Check network connectivity to any host (ping, HTTP check, port check)',
  usage: '/ping <host>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const host = args.trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!host) return { success: false, output: 'Usage: /ping <host>' };

    const results: string[] = [`**Network check: ${host}**\n`];

    // Ping
    await new Promise<void>((resolve) => {
      exec(`ping -c 3 -W 3 ${host} 2>&1 | tail -3`, { timeout: 12_000 }, (err, stdout) => {
        results.push(`**Ping:**\n\`${stdout?.trim() || 'No response'}\``);
        resolve();
      });
    });

    // HTTP check
    try {
      const start = Date.now();
      const res = await fetch(`https://${host}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
        redirect: 'follow',
      });
      const ms = Date.now() - start;
      results.push(`**HTTPS:** ${res.status} ${res.statusText} (${ms}ms)`);
    } catch {
      try {
        const start = Date.now();
        const res = await fetch(`http://${host}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5_000),
          redirect: 'follow',
        });
        const ms = Date.now() - start;
        results.push(`**HTTP:** ${res.status} ${res.statusText} (${ms}ms)`);
      } catch (e) {
        results.push(`**HTTP:** Failed — ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { success: true, output: results.join('\n') };
  },
};
