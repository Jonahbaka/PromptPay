// ═══════════════════════════════════════════════════════════════
// OpenClaw :: Web Access — Browse, Search, YouTube Analysis
// Gives the AI agent full internet access
// ═══════════════════════════════════════════════════════════════

import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

// ── HTML → readable text ─────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, '')
    .replace(/<header\b[\s\S]*?<\/header>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +/gm, '')
    .trim();
}

// ── Extract meta info from HTML ──────────────────────────────

function extractMeta(html: string): { title: string; description: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  return {
    title: titleMatch ? stripHtml(titleMatch[1]) : '',
    description: descMatch?.[1] || ogDescMatch?.[1] || '',
  };
}

// ═══ COMMAND: /browse <url> ══════════════════════════════════

export const webFetchCommand: OpenClawCommand = {
  name: 'browse',
  aliases: ['fetch', 'url', 'webpage', 'read_url'],
  description: 'Fetch and read content from any URL on the internet',
  usage: '/browse <url>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const url = args.trim();
    if (!url) return { success: false, output: 'Usage: /browse <url>' };

    try {
      new URL(url);
    } catch {
      // Try adding https://
      try {
        new URL(`https://${url}`);
      } catch {
        return { success: false, output: `Invalid URL: ${url}` };
      }
    }

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;

    try {
      const res = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        return { success: false, output: `HTTP ${res.status} ${res.statusText} for ${fullUrl}` };
      }

      const contentType = res.headers.get('content-type') || '';
      const body = await res.text();

      // JSON response
      if (contentType.includes('json')) {
        try {
          const json = JSON.parse(body);
          return { success: true, output: JSON.stringify(json, null, 2).slice(0, 8000) };
        } catch {
          return { success: true, output: body.slice(0, 8000) };
        }
      }

      // Plain text
      if (contentType.includes('text/plain')) {
        return { success: true, output: body.slice(0, 8000) };
      }

      // HTML → extract meta + text
      const meta = extractMeta(body);
      const text = stripHtml(body);
      const header = meta.title ? `**${meta.title}**\n` : '';
      const desc = meta.description ? `_${meta.description}_\n\n` : '';
      const content = `${header}${desc}${text}`;

      return {
        success: true,
        output: content.slice(0, 8000) || 'Page loaded but no readable text extracted.',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Fetch error: ${msg}` };
    }
  },
};

// ═══ COMMAND: /search <query> ════════════════════════════════

export const webSearchCommand: OpenClawCommand = {
  name: 'search',
  aliases: ['google', 'websearch', 'ddg'],
  description: 'Search the internet and return results with titles, URLs, and snippets',
  usage: '/search <query>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const query = args.trim();
    if (!query) return { success: false, output: 'Usage: /search <query>' };

    try {
      // DuckDuckGo HTML search (no API key needed)
      const res = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: `q=${encodeURIComponent(query)}&b=`,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return { success: false, output: `Search failed: HTTP ${res.status}` };
      }

      const html = await res.text();
      const results: string[] = [];

      // Parse result links — DuckDuckGo HTML uses result__a for titles and result__snippet for descriptions
      // Extract each result block
      const blocks = html.split(/class="result\s/);

      for (let i = 1; i < blocks.length && results.length < 10; i++) {
        const block = blocks[i];

        // Extract URL from result__a href
        const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
        // Extract title text from result__a
        const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
        // Extract snippet from result__snippet
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
          || block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/i);

        if (urlMatch && titleMatch) {
          let href = urlMatch[1];
          // DuckDuckGo wraps URLs in redirects — extract the actual URL
          const uddgMatch = href.match(/uddg=([^&]+)/);
          if (uddgMatch) href = decodeURIComponent(uddgMatch[1]);

          const title = stripHtml(titleMatch[1]).trim();
          const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : '';

          if (title && href.startsWith('http')) {
            results.push(`${results.length + 1}. **${title}**\n   ${href}${snippet ? `\n   ${snippet}` : ''}`);
          }
        }
      }

      // Fallback: DuckDuckGo JSON instant answer API
      if (results.length === 0) {
        const jsonRes = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
          { signal: AbortSignal.timeout(8_000) }
        );
        const data = await jsonRes.json() as {
          Abstract?: string;
          AbstractURL?: string;
          AbstractSource?: string;
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
          Answer?: string;
        };

        if (data.Abstract) {
          results.push(`**${data.AbstractSource || 'Summary'}:** ${data.Abstract}\nSource: ${data.AbstractURL || 'N/A'}`);
        }
        if (data.Answer) {
          results.push(`**Answer:** ${data.Answer}`);
        }
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, 6)) {
            if (topic.Text && topic.FirstURL) {
              results.push(`- ${topic.Text}\n  ${topic.FirstURL}`);
            }
          }
        }
      }

      if (results.length === 0) {
        return { success: true, output: `No results found for "${query}". Try rephrasing or use /browse with a specific URL.` };
      }

      return {
        success: true,
        output: `**Search: "${query}"**\n\n${results.join('\n\n')}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Search error: ${msg}` };
    }
  },
};

// ═══ COMMAND: /youtube <url|id> ══════════════════════════════

function extractVideoId(input: string): string | null {
  input = input.trim();
  // Direct ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  // youtube.com/watch?v=ID
  const watchMatch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  // youtu.be/ID
  const shortMatch = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  // youtube.com/shorts/ID
  const shortsMatch = input.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];
  // youtube.com/embed/ID
  const embedMatch = input.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  return null;
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    // Fetch the video page to get caption track URLs
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10_000),
    });

    const pageHtml = await pageRes.text();

    // Find captions data in ytInitialPlayerResponse
    const captionsMatch = pageHtml.match(/"captions":\s*(\{[\s\S]*?"playerCaptionsTracklistRenderer"[\s\S]*?\})\s*,\s*"videoDetails"/);
    if (!captionsMatch) return null;

    // Extract baseUrl for English captions (or first available)
    const baseUrlMatch = captionsMatch[1].match(/"baseUrl"\s*:\s*"([^"]+)"/);
    if (!baseUrlMatch) return null;

    let captionUrl = baseUrlMatch[1].replace(/\\u0026/g, '&');
    // Request plain text format
    if (!captionUrl.includes('fmt=')) captionUrl += '&fmt=json3';

    const captionRes = await fetch(captionUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });

    const captionData = await captionRes.text();

    // Try JSON3 format first
    try {
      const json = JSON.parse(captionData) as {
        events?: Array<{ segs?: Array<{ utf8: string }>; tStartMs?: number }>;
      };
      if (json.events) {
        const lines = json.events
          .filter(e => e.segs)
          .map(e => e.segs!.map(s => s.utf8).join(''))
          .filter(line => line.trim() && line.trim() !== '\n');
        return lines.join(' ').replace(/\s+/g, ' ').trim();
      }
    } catch {
      // Fall back to XML parsing
      const textMatches = captionData.match(/<text[^>]*>([\s\S]*?)<\/text>/g);
      if (textMatches) {
        return textMatches
          .map(t => stripHtml(t))
          .filter(t => t.trim())
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    return null;
  } catch {
    return null;
  }
}

export const youtubeCommand: OpenClawCommand = {
  name: 'youtube',
  aliases: ['yt', 'video'],
  description: 'Analyze a YouTube video: get title, description, channel, and full transcript',
  usage: '/youtube <url or video ID>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const input = args.trim();
    if (!input) return { success: false, output: 'Usage: /youtube <url or video ID>' };

    const videoId = extractVideoId(input);
    if (!videoId) {
      return { success: false, output: `Could not extract video ID from: ${input}` };
    }

    try {
      // Get video metadata via oEmbed (free, no API key)
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        { signal: AbortSignal.timeout(8_000) }
      );

      let title = '';
      let author = '';
      if (oembedRes.ok) {
        const oembed = await oembedRes.json() as { title?: string; author_name?: string; author_url?: string };
        title = oembed.title || '';
        author = oembed.author_name || '';
      }

      // Get description from video page meta tags
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10_000),
      });
      const pageHtml = await pageRes.text();

      // Extract description
      const descMatch = pageHtml.match(/"shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      let description = '';
      if (descMatch) {
        description = descMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .slice(0, 1500);
      }

      // Extract view count and publish date
      const viewMatch = pageHtml.match(/"viewCount"\s*:\s*"(\d+)"/);
      const dateMatch = pageHtml.match(/"publishDate"\s*:\s*"([^"]+)"/);
      const views = viewMatch ? Number(viewMatch[1]).toLocaleString() : 'N/A';
      const date = dateMatch ? dateMatch[1] : 'N/A';

      // Extract duration
      const durMatch = pageHtml.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
      let duration = 'N/A';
      if (durMatch) {
        const secs = Number(durMatch[1]);
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        duration = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
      }

      // Get transcript
      const transcript = await fetchTranscript(videoId);

      // Build output
      let output = `**${title || 'Unknown Title'}**\n`;
      output += `Channel: ${author || 'Unknown'}\n`;
      output += `Views: ${views} | Duration: ${duration} | Published: ${date}\n`;
      output += `URL: https://youtube.com/watch?v=${videoId}\n`;

      if (description) {
        output += `\n**Description:**\n${description}\n`;
      }

      if (transcript) {
        const truncated = transcript.slice(0, 5000);
        output += `\n**Transcript:**\n${truncated}`;
        if (transcript.length > 5000) output += '\n\n... [transcript truncated]';
      } else {
        output += '\n_No transcript/captions available for this video._';
      }

      return { success: true, output: output.slice(0, 8000) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `YouTube error: ${msg}` };
    }
  },
};

// ═══ COMMAND: /news <topic> ══════════════════════════════════

export const newsCommand: OpenClawCommand = {
  name: 'news',
  aliases: ['headlines', 'latest'],
  description: 'Get latest news on any topic from the web',
  usage: '/news <topic>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const topic = args.trim();
    if (!topic) return { success: false, output: 'Usage: /news <topic>' };

    try {
      // Search for recent news via DuckDuckGo with news-focused query
      const query = `${topic} latest news ${new Date().getFullYear()}`;
      const res = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        },
        body: `q=${encodeURIComponent(query)}&b=&df=w`, // df=w = past week
        signal: AbortSignal.timeout(10_000),
      });

      const html = await res.text();
      const results: string[] = [];
      const blocks = html.split(/class="result\s/);

      for (let i = 1; i < blocks.length && results.length < 8; i++) {
        const block = blocks[i];
        const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
        const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
          || block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/i);

        if (urlMatch && titleMatch) {
          let href = urlMatch[1];
          const uddgMatch = href.match(/uddg=([^&]+)/);
          if (uddgMatch) href = decodeURIComponent(uddgMatch[1]);

          const title = stripHtml(titleMatch[1]).trim();
          const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : '';

          if (title && href.startsWith('http')) {
            results.push(`${results.length + 1}. **${title}**\n   ${href}${snippet ? `\n   ${snippet}` : ''}`);
          }
        }
      }

      if (results.length === 0) {
        return { success: true, output: `No recent news found for "${topic}". Try a different topic or use /search.` };
      }

      return {
        success: true,
        output: `**Latest News: "${topic}"**\n\n${results.join('\n\n')}\n\n_Use /browse <url> to read any article in full._`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `News error: ${msg}` };
    }
  },
};
