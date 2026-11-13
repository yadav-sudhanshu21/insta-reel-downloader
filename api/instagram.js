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

  try {
    // 1. Try Instagram's Official GraphQL doc_id Query (Most reliable for Reels)
    try {
      const gqlBody = new URLSearchParams({
        av: '0',
        __d: 'www',
        __user: '0',
        __a: '1',
        __req: '3',
        dpr: '1',
        __ccg: 'GOOD',
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
        doc_id: '10015901848480474'
      });

      const gqlRes = await fetch('https://www.instagram.com/api/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-IG-App-ID': '936619743392459',
          'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
          'X-ASBD-ID': '129477',
          'X-CSRFToken': 'missing',
          Origin: 'https://www.instagram.com',
          Referer: `https://www.instagram.com/reel/${shortcode}/`
        },
        body: gqlBody.toString()
      });

      if (gqlRes.ok) {
        const gqlJson = await gqlRes.json();
        const media = gqlJson?.data?.xdt_shortcode_media;

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
    } catch (e) {
      // Fall through to Embed Page Parser
    }

    // 2. Fallback: Fetch Instagram Captioned Embed HTML directly from Vercel Server
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const embedRes = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (embedRes.ok) {
      const html = await embedRes.text();

      const videos = [];
      const images = [];

      for (const m of html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
        videos.push(decodeEscapes(m[1]));
      }
      for (const m of html.matchAll(/\\?"video_url\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
        videos.push(decodeEscapes(m[1]));
      }
      for (const m of html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)) {
        images.push(decodeEscapes(m[1]));
      }
      for (const m of html.matchAll(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/g)) {
        images.push(decodeEscapes(m[1]));
      }

      const uniqueVideos = [...new Set(videos)].filter((u) => u.startsWith('http'));
      const uniqueImages = [...new Set(images)].filter((u) => u.startsWith('http'));

      if (uniqueVideos.length > 0 || uniqueImages.length > 0) {
        const userMatch =
          html.match(/"username"\s*:\s*"([^"]+)"/) ||
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

    // 3. Fallback: Kwik /VXInstagram OpenGraph Crawler User-Agent
    const vxRes = await fetch(`https://www.vxinstagram.com/${type}/${shortcode}`, {
      headers: {
        'User-Agent': 'TelegramBot (like TwitterBot)'
      }
    });

    if (vxRes.ok) {
      const vxHtml = await vxRes.text();
      const ogVid =
        vxHtml.match(/property="og:video(?::secure_url)?"\s+content="([^"]+)"/i) ||
        vxHtml.match(/content="([^"]+)"\s+property="og:video(?::secure_url)?"/i);
      const ogImg =
        vxHtml.match(/property="og:image"\s+content="([^"]+)"/i) ||
        vxHtml.match(/content="([^"]+)"\s+property="og:image"/i);

      if (ogVid?.[1] || ogImg?.[1]) {
        const videoUrl = ogVid?.[1] ? decodeEscapes(ogVid[1]) : null;
        const imageUrl = ogImg?.[1] ? decodeEscapes(ogImg[1]) : null;

        return res.status(200).json({
          status: 'ok',
          shortcode,
          authorName: 'Instagram Creator',
          authorHandle: 'instagram_reel',
          authorAvatar: imageUrl || '',
          caption: `Instagram ${type.toUpperCase()} (#${shortcode})`,
          items: [
            videoUrl
              ? {
                  index: 0,
                  type: 'video',
                  videoUrl,
                  thumbnail: imageUrl || videoUrl,
                  width: 1080,
                  height: 1920
                }
              : {
                  index: 0,
                  type: 'photo',
                  imageUrl,
                  thumbnail: imageUrl,
                  width: 1080,
                  height: 1350
                }
          ]
        });
      }
    }

    return res.status(404).json({
      error: 'Direct stream not found in anonymous mode'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server extraction error' });
  }
}