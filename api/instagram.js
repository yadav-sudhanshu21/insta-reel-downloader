function decodeSnapSaveEval(encodedHtml) {
  try {
    const match = encodedHtml.match(
      /\(\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/
    );
    if (!match) return null;

    const h = match[1];
    const n = match[3];
    const t = parseInt(match[4], 10);
    const e = parseInt(match[5], 10);

    const baseConvert = (d, eBase, fBase) => {
      const g = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/'.split('');
      const hArr = g.slice(0, eBase);
      const iArr = g.slice(0, fBase);
      let j = d
        .split('')
        .reverse()
        .reduce((a, b, c) => {
          const idx = hArr.indexOf(b);
          return idx !== -1 ? a + idx * Math.pow(eBase, c) : a;
        }, 0);
      let k = '';
      while (j > 0) {
        k = iArr[j % fBase] + k;
        j = (j - (j % fBase)) / fBase;
      }
      return k || '0';
    };

    let result = '';
    for (let i = 0, len = h.length; i < len; i++) {
      let s = '';
      while (i < len && h[i] !== n[e]) {
        s += h[i];
        i++;
      }
      for (let j = 0; j < n.length; j++) {
        s = s.replace(new RegExp(n[j], 'g'), j.toString());
      }
      const charCode = parseInt(baseConvert(s, e, 10), 10) - t;
      if (!isNaN(charCode) && charCode > 0) {
        result += String.fromCharCode(charCode);
      }
    }
    try {
      return decodeURIComponent(escape(result));
    } catch {
      return result;
    }
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { shortcode, type = 'reel', downloadUrl, filename } = req.query;

  // =========================================================================
  // MODE 1: DIRECT FILE DOWNLOAD STREAM PROXY (/api/instagram?downloadUrl=...)
  // Forces the browser to save the .mp4/.jpg file directly to the device
  // =========================================================================
  if (downloadUrl) {
    try {
      const response = await fetch(downloadUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Referer: 'https://www.instagram.com/'
        }
      });

      if (!response.ok) {
        return res.redirect(downloadUrl);
      }

      const contentType = response.headers.get('content-type') || 'video/mp4';
      const cleanName = filename || 'Instagram_Reel_HD.mp4';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${cleanName}"`);

      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (err) {
      return res.redirect(downloadUrl);
    }
  }

  // =========================================================================
  // MODE 2: MULTI-SERVER INSTAGRAM REEL & POST EXTRACTOR
  // =========================================================================
  if (!shortcode) {
    return res.status(400).json({ error: 'Missing Instagram shortcode' });
  }

  const decodeEscapes = (str) => {
    if (!str) return '';
    return str
      .replace(/\\u0026/g, '&')
      .replace(/\\u0025/g, '%')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&');
  };

  const targetUrl = `https://www.instagram.com/${type === 'p' ? 'p' : 'reel'}/${shortcode}/`;

  try {
    // =====================================================================
    // SERVER ENGINE 1: FastDL / SaveF AjaxSearch API (Used by top downloaders)
    // =====================================================================
    const ajaxEndpoints = [
      'https://fastdl.to/api/ajaxSearch',
      'https://savef.app/api/ajaxSearch',
      'https://v3.saveinsta.app/api/ajaxSearch'
    ];

    for (const endpoint of ajaxEndpoints) {
      try {
        const originUrl = new URL(endpoint).origin;
        const body = new URLSearchParams({
          q: targetUrl,
          t: 'media',
          lang: 'en'
        });

        const ajaxRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            Accept: '*/*',
            Origin: originUrl,
            Referer: `${originUrl}/en`
          },
          body: body.toString()
        });

        if (ajaxRes.ok) {
          const json = await ajaxRes.json();
          let rawHtml = json?.data || '';
          if (rawHtml.includes('eval(function')) {
            const unpacked = decodeSnapSaveEval(rawHtml);
            if (unpacked) rawHtml = unpacked;
          }

          if (rawHtml && rawHtml.length > 50) {
            const dlLinks = [];
            for (const m of rawHtml.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
              const link = decodeEscapes(m[1]);
              if (
                link.includes('rapidcdn') ||
                link.includes('snapcdn') ||
                link.includes('cdninstagram') ||
                link.includes('fbcdn') ||
                link.includes('dl.snap') ||
                link.includes('token=')
              ) {
                dlLinks.push(link);
              }
            }

            const thumbs = [];
            for (const m of rawHtml.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
              thumbs.push(decodeEscapes(m[1]));
            }

            if (dlLinks.length > 0) {
              const primaryVideo = dlLinks[0];
              const secondaryVideo = dlLinks[1] || dlLinks[0];
              const thumb = thumbs[0] || primaryVideo;

              return res.status(200).json({
                status: 'ok',
                shortcode,
                authorName: 'Instagram Reel',
                authorHandle: 'instagram',
                authorAvatar: thumb,
                caption: `Instagram ${type.toUpperCase()} (#${shortcode})`,
                items: [
                  {
                    index: 0,
                    type: 'video',
                    videoUrl: primaryVideo,
                    server2Url: secondaryVideo,
                    thumbnail: thumb,
                    width: 1080,
                    height: 1920
                  }
                ]
              });
            }
          }
        }
      } catch (e) {
        // Continue to next endpoint
      }
    }

    // =====================================================================
    // SERVER ENGINE 2: SnapSave Action Obfuscated Token Unpacker
    // =====================================================================
    try {
      const snapBody = new URLSearchParams({
        url: targetUrl,
        lang: 'en'
      });

      const snapRes = await fetch('https://snapsave.app/action.php?lang=en', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Origin: 'https://snapsave.app',
          Referer: 'https://snapsave.app/en'
        },
        body: snapBody.toString()
      });

      if (snapRes.ok) {
        const snapText = await snapRes.text();
        const unpacked = decodeSnapSaveEval(snapText) || snapText;
        const urls = [];
        for (const m of unpacked.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
          const u = decodeEscapes(m[1]);
          if (
            u.includes('rapidcdn') ||
            u.includes('snapcdn') ||
            u.includes('cdninstagram') ||
            u.includes('token=')
          ) {
            urls.push(u);
          }
        }
        const imgs = [];
        for (const m of unpacked.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
          imgs.push(decodeEscapes(m[1]));
        }

        if (urls.length > 0) {
          return res.status(200).json({
            status: 'ok',
            shortcode,
            authorName: 'Instagram Reel',
            authorHandle: 'instagram',
            authorAvatar: imgs[0] || '',
            caption: `Instagram ${type.toUpperCase()} (#${shortcode})`,
            items: [
              {
                index: 0,
                type: 'video',
                videoUrl: urls[0],
                server2Url: urls[1] || urls[0],
                thumbnail: imgs[0] || urls[0],
                width: 1080,
                height: 1920
              }
            ]
          });
        }
      }
    } catch (e) {
      // Continue to Engine 3
    }

    // =====================================================================
    // SERVER ENGINE 3: Instagram Embed Captioned HTML + Context JSON Parser
    // =====================================================================
    try {
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      const embedRes = await fetch(embedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (embedRes.ok) {
        const html = await embedRes.text();
        const videos = [];
        const images = [];

        for (const m of html.matchAll(/\\?"video_url\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
          videos.push(decodeEscapes(m[1]));
        }
        for (const m of html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
          videos.push(decodeEscapes(m[1]));
        }
        for (const m of html.matchAll(/\\?"display_url\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
          images.push(decodeEscapes(m[1]));
        }
        for (const m of html.matchAll(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/g)) {
          images.push(decodeEscapes(m[1]));
        }

        const uniqueVideos = [...new Set(videos)].filter((u) => u.startsWith('http'));
        const uniqueImages = [...new Set(images)].filter((u) => u.startsWith('http'));

        if (uniqueVideos.length > 0 || (type === 'p' && uniqueImages.length > 0)) {
          const userMatch =
            html.match(/\\?"username\\?"\s*:\s*\\?"([^"\\]+)\\?"/) ||
            html.match(/class="UsernameText"[^>]*>([^<]+)</);
          const authorHandle = userMatch ? userMatch[1].trim() : 'instagram_creator';

          const items =
            uniqueVideos.length > 0
              ? uniqueVideos.map((v, i) => ({
                  index: i,
                  type: 'video',
                  videoUrl: v,
                  server2Url: v,
                  thumbnail: uniqueImages[i] || uniqueImages[0] || v,
                  width: 1080,
                  height: 1920
                }))
              : uniqueImages.map((img, i) => ({
                  index: i,
                  type: 'photo',
                  imageUrl: img,
                  server2Url: img,
                  thumbnail: img,
                  width: 1080,
                  height: 1350
                }));

          return res.status(200).json({
            status: 'ok',
            shortcode,
            authorName: `@${authorHandle}`,
            authorHandle,
            authorAvatar: uniqueImages[0] || '',
            caption: `Instagram ${type.toUpperCase()} (#${shortcode})`,
            items
          });
        }
      }
    } catch (e) {
      // Continue to Engine 4
    }

    // =====================================================================
    // SERVER ENGINE 4: Authenticated CSRF + LSD Handshake -> GraphQL API
    // =====================================================================
    try {
      const pageRes = await fetch(`https://www.instagram.com/reel/${shortcode}/`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      const pageHtml = pageRes.ok ? await pageRes.text() : '';
      const setCookieHeader = pageRes.headers.get('set-cookie') || '';
      const csrfMatch =
        setCookieHeader.match(/csrftoken=([^;]+)/) ||
        pageHtml.match(/"csrf_token":"([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : 'missing';
      const lsdMatch =
        pageHtml.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/) ||
        pageHtml.match(/name="lsd"\s+value="([^"]+)"/);
      const lsdToken = lsdMatch ? lsdMatch[1] : 'AVqbxe3J_YA';

      const docIds = ['10015901848480474', '8845758582119845'];

      for (const docId of docIds) {
        const gqlBody = new URLSearchParams({
          av: '0',
          __d: 'www',
          __user: '0',
          __a: '1',
          __req: '3',
          lsd: lsdToken,
          fb_api_caller_class: 'RelayModern',
          fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
          variables: JSON.stringify({
            shortcode,
            fetch_comment_count: 2,
            fetch_related_profile_media_count: 0,
            parent_comment_count: 0,
            child_comment_count: 0,
            fetch_like_count: 10,
            fetch_tagged_user_count: null,
            fetch_preview_comment_count: 2,
            has_threaded_comments: true,
            hoisted_comment_id: null,
            hoisted_reply_id: null
          }),
          server_timestamps: 'true',
          doc_id: docId
        });

        const gqlRes = await fetch('https://www.instagram.com/api/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'X-IG-App-ID': '936619743392459',
            'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
            'X-FB-LSD': lsdToken,
            'X-ASBD-ID': '129477',
            'X-CSRFToken': csrfToken,
            Cookie: `csrftoken=${csrfToken}`,
            Origin: 'https://www.instagram.com',
            Referer: `https://www.instagram.com/reel/${shortcode}/`
          },
          body: gqlBody.toString()
        });

        if (gqlRes.ok) {
          const text = await gqlRes.text();
          const cleanJsonText = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;/, '');
          const gqlJson = JSON.parse(cleanJsonText);
          const media =
            gqlJson?.data?.xdt_shortcode_media || gqlJson?.data?.shortcode_media;

          if (media && (media.video_url || media.display_url)) {
            const isVid = Boolean(media.video_url);
            const stream = media.video_url || media.display_url;
            return res.status(200).json({
              status: 'ok',
              shortcode,
              authorName: media.owner?.full_name || `@${media.owner?.username || 'instagram'}`,
              authorHandle: media.owner?.username || 'instagram',
              authorAvatar: media.owner?.profile_pic_url || media.display_url || '',
              caption:
                media.edge_media_to_caption?.edges?.[0]?.node?.text ||
                `Instagram Reel (#${shortcode})`,
              items: [
                {
                  index: 0,
                  type: isVid ? 'video' : 'photo',
                  videoUrl: isVid ? stream : null,
                  imageUrl: !isVid ? stream : null,
                  server2Url: stream,
                  thumbnail: media.display_url || stream,
                  width: media.dimensions?.width || 1080,
                  height: media.dimensions?.height || 1920
                }
              ]
            });
          }
        }
      }
    } catch (e) {
      // Continue to Engine 5
    }

    // =====================================================================
    // SERVER ENGINE 5: TelegramBot / DiscordBot Unfurl Proxies
    // =====================================================================
    const botProxies = [
      `https://kkinstagram.com/reel/${shortcode}`,
      `https://www.vxinstagram.com/reel/${shortcode}`,
      `https://www.instagramez.com/reel/${shortcode}`
    ];

    for (const botUrl of botProxies) {
      try {
        const botRes = await fetch(botUrl, {
          headers: { 'User-Agent': 'TelegramBot (like TwitterBot)' },
          redirect: 'follow'
        });

        if (botRes.ok) {
          const botHtml = await botRes.text();
          const ogVid =
            botHtml.match(/property="og:video(?::secure_url)?"\s+content="([^"]+)"/i) ||
            botHtml.match(/content="([^"]+)"\s+property="og:video(?::secure_url)?"/i) ||
            botHtml.match(/name="twitter:player:stream"\s+content="([^"]+)"/i);
          const ogImg =
            botHtml.match(/property="og:image"\s+content="([^"]+)"/i) ||
            botHtml.match(/content="([^"]+)"\s+property="og:image"/i);

          const rawVideo = ogVid?.[1] ? decodeEscapes(ogVid[1]) : null;
          const rawImage = ogImg?.[1] ? decodeEscapes(ogImg[1]) : null;

          if (rawVideo && rawVideo.startsWith('http')) {
            return res.status(200).json({
              status: 'ok',
              shortcode,
              authorName: 'Instagram Reel',
              authorHandle: 'instagram',
              authorAvatar: rawImage || '',
              caption: `Instagram ${type.toUpperCase()} (#${shortcode})`,
              items: [
                {
                  index: 0,
                  type: 'video',
                  videoUrl: rawVideo,
                  server2Url: rawVideo,
                  thumbnail: rawImage || rawVideo,
                  width: 1080,
                  height: 1920
                }
              ]
            });
          }
        }
      } catch (e) {
        // next
      }
    }

    return res.status(404).json({
      error: 'Direct stream not found in anonymous mode'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server extraction error' });
  }
}