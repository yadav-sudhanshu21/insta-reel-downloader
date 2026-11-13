// Create a folder named "api" in your main project folder in VS Code
// and save this file as: api/instagram.js
// Vercel automatically turns this into a live backend API at /api/instagram!

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
  // Forces the browser to save the .mp4/.jpg file instead of opening a tab
  // =========================================================================
  if (downloadUrl) {
    try {
      const response = await fetch(downloadUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
  // MODE 2: EXTRACT DIRECT MP4 & PHOTO URLS FROM INSTAGRAM SERVERS
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

  const targetUrl = `https://www.instagram.com/reel/${shortcode}/`;

  try {
    // =====================================================================
    // ENGINE 1: Instagram Embed Captioned HTML + Context JSON Parser
    // =====================================================================
    try {
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      const embedRes = await fetch(embedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      if (embedRes.ok) {
        const html = await embedRes.text();
        const videos = [];
        const images = [];

        // Extract from escaped contextJSON inside embed page
        for (const m of html.matchAll(/\\?"video_url\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
          videos.push(decodeEscapes(m[1]));
        }
        for (const m of html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
          videos.push(decodeEscapes(m[1]));
        }
        for (const m of html.matchAll(/\\?"display_url\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
          images.push(decodeEscapes(m[1]));
        }
        for (const m of html.matchAll(/\\?" display_src\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
          images.push(decodeEscapes(m[1]));
        }
        for (const m of html.matchAll(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/g)) {
          images.push(decodeEscapes(m[1]));
        }

        const uniqueVideos = [...new Set(videos)].filter((u) => u.startsWith('http'));
        const uniqueImages = [...new Set(images)].filter((u) => u.startsWith('http'));

        // Only return immediately if we found a video (or if it's strictly a photo post)
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
                  thumbnail: uniqueImages[i] || uniqueImages[0] || v,
                  width: 1080,
                  height: 1920
                }))
              : uniqueImages.map((img, i) => ({
                  index: i,
                  type: 'photo',
                  imageUrl: img,
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
      // Continue to Engine 2
    }

    // =====================================================================
    // ENGINE 2: Authenticated CSRF + LSD Handshake -> Instagram GraphQL API
    // =====================================================================
    try {
      // First grab a real CSRF cookie & LSD token from the post page
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

      const docIds = ['10015901848480474', '8845758582119845', '7153636648076595'];

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
            shortcode: shortcode,
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

          if (media) {
            const authorHandle = media.owner?.username || 'instagram_creator';
            const authorName = media.owner?.full_name || `@${authorHandle}`;
            const authorAvatar = media.owner?.profile_pic_url || '';
            const caption =
              media.edge_media_to_caption?.edges?.[0]?.node?.text ||
              `Instagram Reel (#${shortcode})`;

            const items = [];
            const edges = media.edge_sidecar_to_children?.edges;

            if (edges && edges.length > 0) {
              edges.forEach((edge, idx) => {
                const node = edge.node;
                if (node.is_video && node.video_url) {
                  items.push({
                    index: idx,
                    type: 'video',
                    videoUrl: node.video_url,
                    thumbnail: node.display_url,
                    width: node.dimensions?.width || 1080,
                    height: node.dimensions?.height || 1920
                  });
                } else {
                  items.push({
                    index: idx,
                    type: 'photo',
                    imageUrl: node.display_url,
                    thumbnail: node.display_url,
                    width: node.dimensions?.width || 1080,
                    height: node.dimensions?.height || 1350
                  });
                }
              });
            } else if (media.is_video && media.video_url) {
              items.push({
                index: 0,
                type: 'video',
                videoUrl: media.video_url,
                thumbnail: media.display_url,
                width: media.dimensions?.width || 1080,
                height: media.dimensions?.height || 1920
              });
            } else if (media.display_url) {
              items.push({
                index: 0,
                type: 'photo',
                imageUrl: media.display_url,
                thumbnail: media.display_url,
                width: media.dimensions?.width || 1080,
                height: media.dimensions?.height || 1350
              });
            }

            if (items.length > 0) {
              return res.status(200).json({
                status: 'ok',
                shortcode,
                authorName,
                authorHandle,
                authorAvatar,
                caption,
                items
              });
            }
          }
        }
      }
    } catch (e) {
      // Continue to Engine 3
    }

    // =====================================================================
    // ENGINE 3: Public Worker & Telegram/Discord Bot Unfurl Nodes
    // =====================================================================
    const botProxies = [
      `https://www.vxinstagram.com/reel/${shortcode}`,
      `https://www.instagramez.com/reel/${shortcode}`,
      `https://kkinstagram.com/reel/${shortcode}`
    ];

    for (const botUrl of botProxies) {
      try {
        const botRes = await fetch(botUrl, {
          headers: {
            'User-Agent': 'TelegramBot (like TwitterBot)'
          },
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
              authorName: 'Instagram Creator',
              authorHandle: 'instagram_reel',
              authorAvatar: rawImage || '',
              caption: `Instagram ${type.toUpperCase()} (#${shortcode})`,
              items: [
                {
                  index: 0,
                  type: 'video',
                  videoUrl: rawVideo,
                  thumbnail: rawImage || rawVideo,
                  width: 1080,
                  height: 1920
                }
              ]
            });
          }
        }
      } catch (e) {
        // try next bot node
      }
    }

    // =====================================================================
    // ENGINE 4: FastDL / SnapSave Public Extraction API Fallback
    // =====================================================================
    try {
      const formBody = new URLSearchParams({
        url: targetUrl,
        lang: 'en'
      });
      const snapRes = await fetch('https://igram.world/api/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        },
        body: formBody.toString()
      });

      if (snapRes.ok) {
        const snapData = await snapRes.json();
        const firstUrl = snapData?.url?.[0]?.url || snapData?.media?.[0]?.url;
        if (firstUrl) {
          return res.status(200).json({
            status: 'ok',
            shortcode,
            authorName: snapData?.meta?.username || 'Instagram Creator',
            authorHandle: snapData?.meta?.username || 'instagram_reel',
            authorAvatar: snapData?.thumb || '',
            caption: snapData?.meta?.title || `Instagram Reel (#${shortcode})`,
            items: [
              {
                index: 0,
                type: 'video',
                videoUrl: firstUrl,
                thumbnail: snapData?.thumb || firstUrl,
                width: 1080,
                height: 1920
              }
            ]
          });
        }
      }
    } catch (e) {
      // ignore
    }

    return res.status(404).json({
      error: 'Direct stream not found in anonymous mode'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server extraction error' });
  }
}