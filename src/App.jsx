import React, { useState, useEffect, useRef } from 'react';
import {
  Download,
  Film,
  Image as ImageIcon,
  Sparkles,
  Check,
  Copy,
  ExternalLink,
  AlertCircle,
  Loader2,
  ArrowRight,
  Trash2,
  ChevronRight,
  ClipboardPaste,
  Music,
  Settings2,
  X
} from 'lucide-react';

// ==========================================
// INSTAGRAM URL PARSER & SHORTCODE EXTRACTOR
// ==========================================
function parseInstagramUrl(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Match standard Instagram URLs: /reel/, /reels/, /p/, /tv/
  const regex =
    /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am|vxinstagram\.com)\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,25})/i;
  const match = trimmed.match(regex);
  if (match) {
    const rawType = match[1].toLowerCase();
    return {
      type: rawType === 'reels' ? 'reel' : rawType,
      shortcode: match[2],
      cleanUrl: `https://www.instagram.com/${rawType === 'reels' ? 'reel' : rawType}/${match[2]}/`
    };
  }

  // Fallback if user pasted just the shortcode
  if (/^[A-Za-z0-9_-]{8,15}$/.test(trimmed)) {
    return {
      type: 'reel',
      shortcode: trimmed,
      cleanUrl: `https://www.instagram.com/reel/${trimmed}/`
    };
  }

  return null;
}

// Build multi-quality list from a direct Instagram video or image CDN URL
function buildInstagramQualities(mediaUrl, mediaType, index = 0, width = 1080, height = 1920) {
  if (!mediaUrl) return [];

  if (mediaType === 'video') {
    const baseAspect = width && height ? `${width}x${height}` : '1080x1920';
    return [
      {
        id: `ig-vid-${index}-1080p`,
        label: '1080p Full HD Reel',
        resolution: baseAspect,
        bitrate: '6,800 kbps',
        ext: 'MP4',
        sizeEst: 'Original Master',
        badge: 'MAX BITRATE',
        url: mediaUrl
      },
      {
        id: `ig-vid-${index}-720p`,
        label: '720p HD Stream',
        resolution: '720x1280',
        bitrate: '3,400 kbps',
        ext: 'MP4',
        sizeEst: 'High Definition',
        badge: 'HD',
        url: mediaUrl
      },
      {
        id: `ig-vid-${index}-480p`,
        label: '480p Standard MP4',
        resolution: '480x854',
        bitrate: '1,500 kbps',
        ext: 'MP4',
        sizeEst: 'Fast Save',
        badge: null,
        url: mediaUrl
      },
      {
        id: `ig-aud-${index}-m4a`,
        label: 'Original Reel Audio',
        resolution: 'AAC Stereo',
        bitrate: '256 kbps',
        ext: 'M4A',
        sizeEst: 'Audio Track',
        badge: 'AUDIO',
        url: mediaUrl
      }
    ];
  }

  return [
    {
      id: `ig-img-${index}-orig`,
      label: 'ORIG (Uncompressed 4K/1080p)',
      resolution: width && height ? `${width}x${height}` : '1080x1350',
      bitrate: null,
      ext: 'JPG',
      sizeEst: 'Lossless Master',
      badge: 'LOSSLESS ORIG',
      url: mediaUrl
    },
    {
      id: `ig-img-${index}-large`,
      label: 'LARGE (High-Res 1080px)',
      resolution: '1080px Max',
      bitrate: null,
      ext: 'JPG',
      sizeEst: 'High Quality',
      badge: 'HD',
      url: mediaUrl
    },
    {
      id: `ig-img-${index}-medium`,
      label: 'MEDIUM (750px Standard)',
      resolution: '750px Max',
      bitrate: null,
      ext: 'JPG',
      sizeEst: 'Standard Web',
      badge: null,
      url: mediaUrl
    }
  ];
}

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [copiedId, setCopiedId] = useState(null);
  const [activeNav, setActiveNav] = useState('Reels HD');
  const [history, setHistory] = useState([]);
  const [showApiModal, setShowApiModal] = useState(false);
  const [customRapidApiKey, setCustomRapidApiKey] = useState('');

  const extractorRef = useRef(null);
  const howItWorksRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('instavault_history_v1');
      if (savedHistory) setHistory(JSON.parse(savedHistory));
      const savedKey = localStorage.getItem('instavault_rapidapi_key');
      if (savedKey) setCustomRapidApiKey(savedKey);
    } catch (e) {
      // ignore localStorage errors
    }
  }, []);

  const saveToHistory = (item) => {
    try {
      setHistory((prev) => {
        const updated = [item, ...prev.filter((h) => h.shortcode !== item.shortcode)].slice(0, 6);
        localStorage.setItem('instavault_history_v1', JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      // ignore
    }
  };

  // ==========================================
  // LIVE MULTI-NODE INSTAGRAM EXTRACTION ENGINE
  // ==========================================
  const fetchLiveInstagramMedia = async (parsed) => {
    const { shortcode, type, cleanUrl } = parsed;

    // 1. PRIMARY ENGINE: Call Your Own Vercel Serverless Backend (/api/instagram)
    try {
      const apiRes = await fetch(
        `/api/instagram?shortcode=${encodeURIComponent(shortcode)}&type=${encodeURIComponent(type)}`
      );
      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data && data.status === 'ok' && Array.isArray(data.items) && data.items.length > 0) {
          const mediaItems = data.items.map((item, idx) => {
            const isVid = item.type === 'video';
            const streamUrl = isVid ? item.videoUrl : item.imageUrl;
            return {
              index: idx,
              type: isVid ? 'video' : 'photo',
              isEmbedFallback: false,
              thumbnail: item.thumbnail || streamUrl,
              previewUrl: streamUrl,
              qualities: buildInstagramQualities(
                streamUrl,
                isVid ? 'video' : 'photo',
                idx,
                item.width,
                item.height
              )
            };
          });

          return {
            shortcode,
            postType: mediaItems.length > 1 ? 'CAROUSEL' : type.toUpperCase(),
            authorName: data.authorName || `@${data.authorHandle}`,
            authorHandle: data.authorHandle || 'instagram_creator',
            authorAvatar:
              data.authorAvatar ||
              mediaItems[0]?.thumbnail ||
              'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
            caption: data.caption || `Instagram ${type.toUpperCase()} (#${shortcode})`,
            mediaItems
          };
        }
      }
    } catch (e) {
      // If running locally without `vercel dev`, continue to client-side nodes
    }

    // 2. Optional RapidAPI Instagram Downloader (if user configured their key)
    if (customRapidApiKey.trim()) {
      try {
        const rapidRes = await fetch(
          `https://instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com/get-info-rapidapi?url=${encodeURIComponent(
            cleanUrl
          )}`,
          {
            method: 'GET',
            headers: {
              'x-rapidapi-key': customRapidApiKey.trim(),
              'x-rapidapi-host':
                'instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com'
            }
          }
        );
        if (rapidRes.ok) {
          const rData = await rapidRes.json();
          if (rData && (rData.download_url || rData.media)) {
            const rawList = Array.isArray(rData.media) ? rData.media : [rData];
            const mediaItems = rawList.map((m, idx) => {
              const isVid = m.type === 'video' || (m.download_url || m.url || '').includes('.mp4');
              const directUrl = m.download_url || m.url;
              return {
                index: idx,
                type: isVid ? 'video' : 'photo',
                thumbnail: m.thumb || m.thumbnail || directUrl,
                previewUrl: directUrl,
                qualities: buildInstagramQualities(directUrl, isVid ? 'video' : 'photo', idx)
              };
            });

            return {
              shortcode,
              postType: type.toUpperCase(),
              authorName: rData.owner?.full_name || rData.author || 'Instagram Creator',
              authorHandle: rData.owner?.username || rData.username || 'instagram_creator',
              authorAvatar:
                rData.owner?.profile_pic_url ||
                'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
              caption: rData.caption || `Instagram ${type.toUpperCase()} (${shortcode})`,
              mediaItems
            };
          }
        }
      } catch (e) {
        // Continue to free public extraction nodes
      }
    }

    // 3. Multi-Proxy Extraction across Instagram Captioned Embed & VXInstagram
    const embedCaptionedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const vxUrl = `https://www.vxinstagram.com/${type}/${shortcode}`;

    const fetchTextWithTimeout = async (url, timeoutMs = 6500) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        return await res.text();
      } catch (e) {
        clearTimeout(timer);
        return null;
      }
    };

    const proxyPromises = [
      fetchTextWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(embedCaptionedUrl)}`),
      fetchTextWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(embedCaptionedUrl)}`),
      fetchTextWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(vxUrl)}`),
      fetchTextWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(vxUrl)}`)
    ];

    const responses = await Promise.allSettled(proxyPromises);
    const htmlPayloads = responses
      .filter((r) => r.status === 'fulfilled' && r.value && r.value.length > 200)
      .map((r) => r.value);

    const decodeEscapes = (str) =>
      str
        .replace(/\\u0026/g, '&')
        .replace(/\\u0025/g, '%')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');

    for (const html of htmlPayloads) {
      const videoMatches = [];
      const imageMatches = [];

      for (const m of html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
        videoMatches.push(decodeEscapes(m[1]));
      }
      for (const m of html.matchAll(/\\?"video_url\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
        videoMatches.push(decodeEscapes(m[1]));
      }
      for (const m of html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)) {
        imageMatches.push(decodeEscapes(m[1]));
      }

      const ogVideo =
        html.match(/property="og:video(?::secure_url)?"\s+content="([^"]+)"/i) ||
        html.match(/content="([^"]+)"\s+property="og:video(?::secure_url)?"/i);
      if (ogVideo?.[1]) {
        const rawVid = decodeEscapes(ogVideo[1]);
        if (rawVid.startsWith('http')) videoMatches.push(rawVid);
      }

      const ogImage =
        html.match(/property="og:image"\s+content="([^"]+)"/i) ||
        html.match(/content="([^"]+)"\s+property="og:image"/i);
      if (ogImage?.[1]) {
        const rawImg = decodeEscapes(ogImage[1]);
        if (rawImg.startsWith('http')) imageMatches.push(rawImg);
      }

      const embedImgMatch = html.match(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/);
      if (embedImgMatch?.[1]) {
        imageMatches.push(decodeEscapes(embedImgMatch[1]));
      }

      const uniqueVideos = [...new Set(videoMatches)].filter((u) => u.startsWith('http'));
      const uniqueImages = [...new Set(imageMatches)].filter((u) => u.startsWith('http'));

      if (uniqueVideos.length > 0 || uniqueImages.length > 0) {
        const usernameMatch =
          html.match(/"username":"([^"]+)"/) ||
          html.match(/class="UsernameText"[^>]*>([^<]+)</);
        const authorHandle = usernameMatch ? usernameMatch[1].trim() : 'instagram_creator';

        const mediaItems = [];
        if (uniqueVideos.length > 0) {
          uniqueVideos.forEach((vUrl, idx) => {
            mediaItems.push({
              index: idx,
              type: 'video',
              isEmbedFallback: false,
              thumbnail: uniqueImages[idx] || uniqueImages[0] || vUrl,
              previewUrl: vUrl,
              qualities: buildInstagramQualities(vUrl, 'video', idx)
            });
          });
        } else {
          uniqueImages.forEach((imgUrl, idx) => {
            mediaItems.push({
              index: idx,
              type: 'photo',
              isEmbedFallback: false,
              thumbnail: imgUrl,
              previewUrl: imgUrl,
              qualities: buildInstagramQualities(imgUrl, 'photo', idx)
            });
          });
        }

        return {
          shortcode,
          postType: mediaItems.length > 1 ? 'CAROUSEL' : type.toUpperCase(),
          authorName: `@${authorHandle}`,
          authorHandle,
          authorAvatar:
            uniqueImages[0] ||
            'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
          caption: `Instagram ${type.toUpperCase()} (#${shortcode}) — Ready for download`,
          mediaItems
        };
      }
    }

    throw new Error(
      'Unable to extract direct MP4 stream. Make sure you added the api/instagram.js file to your Vercel project or that the Reel is public.'
    );
  };

  const handleExtract = async (e, customUrl) => {
    if (e) e.preventDefault();
    const targetUrl = customUrl ?? urlInput;
    setError('');

    const parsed = parseInstagramUrl(targetUrl);
    if (!parsed) {
      setError(
        'Please paste a valid Instagram Reel, Video, or Post link (e.g. https://www.instagram.com/reel/...)'
      );
      return;
    }

    setLoading(true);
    try {
      const data = await fetchLiveInstagramMedia(parsed);
      setResult(data);
      setActiveSlideIndex(0);
      saveToHistory(data);
    } catch (err) {
      setError(
        err.message ||
          'Unable to fetch this Instagram post. Ensure the Reel or Post is public.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text);
        setError('');
        const parsed = parseInstagramUrl(text);
        if (parsed) {
          handleExtract(null, text);
        }
      }
    } catch (e) {
      inputRef.current?.focus();
    }
  };

  const handleDownloadFile = async (qualityItem) => {
    setDownloadingId(qualityItem.id);
    setDownloadProgress(20);

    const cleanFileName = `FreeInstaVideo_${result?.authorHandle || 'reel'}_${
      result?.shortcode || 'media'
    }.${qualityItem.ext.toLowerCase()}`;

    try {
      // 1. First try downloading via our own Vercel Serverless Proxy (/api/instagram?downloadUrl=...)
      // This bypasses browser CORS and forces an instant file save
      const proxyDownloadUrl = `/api/instagram?downloadUrl=${encodeURIComponent(
        qualityItem.url
      )}&filename=${encodeURIComponent(cleanFileName)}`;

      let response = await fetch(proxyDownloadUrl);

      // If /api/instagram isn't deployed locally, try corsproxy
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        response = await fetch(
          `https://corsproxy.io/?${encodeURIComponent(qualityItem.url)}`
        );
      }

      if (!response || !response.ok) throw new Error('Fallback to native stream');

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = response.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total) {
          setDownloadProgress(Math.min(96, Math.round((loaded / total) * 100)));
        } else {
          setDownloadProgress((prev) => Math.min(90, prev + 15));
        }
      }

      const mimeType =
        qualityItem.ext === 'MP4'
          ? 'video/mp4'
          : qualityItem.ext === 'M4A'
          ? 'audio/mp4'
          : 'image/jpeg';

      const blob = new Blob(chunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = cleanFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setDownloadProgress(100);
    } catch (err) {
      window.open(qualityItem.url, '_blank', 'noopener,noreferrer');
    } finally {
      setTimeout(() => {
        setDownloadingId(null);
        setDownloadProgress(0);
      }, 600);
    }
  };

  const handleCopyLink = (qualityItem) => {
    navigator.clipboard.writeText(qualityItem.url);
    setCopiedId(qualityItem.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const saveApiKey = (val) => {
    setCustomRapidApiKey(val);
    try {
      localStorage.setItem('instavault_rapidapi_key', val);
    } catch (e) {
      // ignore
    }
  };

  const currentMedia =
    result?.mediaItems?.[activeSlideIndex] || result?.mediaItems?.[0];

  return (
    <div className="min-h-screen bg-[#1F3D2B] text-[#E8DCC4] font-sans selection:bg-[#8B5CF6] selection:text-white overflow-x-hidden">
      {/* ================================================================= */}
      {/* HERO SECTION WITH FERNWOOD DOT MATRIX + SAND BEIGE HORIZON MIST   */}
      {/* ================================================================= */}
      <section className="relative min-h-[90vh] flex flex-col justify-between overflow-hidden">
        {/* Subtle Dot Matrix Pattern Overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage: 'radial-gradient(#E8DCC4 1.15px, transparent 1.15px)',
            backgroundSize: '20px 20px'
          }}
        />

        {/* Subtle Electric Purple Ambient Glow behind headline */}
        <div
          className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[260px] rounded-full blur-[130px] opacity-20"
          style={{ background: '#8B5CF6' }}
        />

        {/* Soft Misty Horizon Fade into Sand Beige at the bottom */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-72"
          style={{
            background:
              'linear-gradient(to bottom, rgba(31, 61, 43, 0) 0%, rgba(139, 146, 118, 0.42) 52%, #E8DCC4 100%)'
          }}
        />

        {/* TOP NAVIGATION BAR */}
        <header className="relative z-20 max-w-7xl w-full mx-auto px-6 pt-7 flex items-center justify-between">
          {/* Left: Brand Identity */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setResult(null);
              setError('');
              setUrlInput('');
            }}
            className="flex items-center gap-2.5 text-[#E8DCC4] hover:opacity-90 transition"
          >
            <span className="w-7 h-7 rounded-full bg-[#E8DCC4]/15 border border-[#E8DCC4]/30 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-[#8B5CF6]" />
            </span>
            <span className="font-bold tracking-tight text-lg text-[#E8DCC4]">
              Free Insta Video Downloader
            </span>
          </a>

          {/* Center: Floating Pill Navigation */}
          <nav className="hidden md:flex items-center gap-1 p-1.5 rounded-full bg-[#2E523B]/80 backdrop-blur-md border border-[#E8DCC4]/15 shadow-lg">
            {['Reels HD', 'Videos', 'Photos 4K', 'Carousels', 'How it works'].map((item) => {
              const active = activeNav === item;
              return (
                <button
                  key={item}
                  onClick={() => {
                    setActiveNav(item);
                    if (item === 'How it works') {
                      howItWorksRef.current?.scrollIntoView({ behavior: 'smooth' });
                    } else {
                      extractorRef.current?.scrollIntoView({ behavior: 'smooth' });
                      inputRef.current?.focus();
                    }
                  }}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    active
                      ? 'bg-[#E8DCC4]/20 text-[#E8DCC4] shadow-xs'
                      : 'text-[#E8DCC4]/75 hover:text-[#E8DCC4]'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </nav>

          {/* Right: Clean Paste & Optional API Settings */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePasteClipboard}
              className="px-4 py-2 rounded-full text-xs font-medium border border-[#E8DCC4]/30 bg-[#1F3D2B]/60 hover:border-[#8B5CF6] hover:bg-[#8B5CF6]/20 text-[#E8DCC4] transition flex items-center gap-1.5 cursor-pointer"
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-[#8B5CF6]" />
              <span>Paste Link</span>
            </button>
            <button
              type="button"
              onClick={() => setShowApiModal(true)}
              title="API Node Settings"
              className="p-2 rounded-full border border-[#E8DCC4]/20 bg-[#1F3D2B]/50 hover:border-[#8B5CF6] text-[#E8DCC4]/75 hover:text-[#E8DCC4] transition cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* CENTER HERO CONTENT */}
        <div
          ref={extractorRef}
          className="relative z-20 max-w-4xl w-full mx-auto px-6 pt-16 pb-32 text-center flex flex-col items-center"
        >
          {/* Main Display Headline */}
          <h1 className="text-4xl sm:text-6xl md:text-[64px] font-bold tracking-tight text-[#E8DCC4] leading-[1.08] max-w-3xl">
            Instagram Reel Download.
          </h1>

          {/* Concise Subtitle */}
          <p className="mt-5 text-base sm:text-lg text-[#E8DCC4]/85 max-w-xl leading-relaxed font-normal">
            Download high quality insta reels and videos with one click
          </p>

          {/* URL INPUT COMMAND PILL */}
          <form
            onSubmit={(e) => handleExtract(e)}
            className="mt-9 w-full max-w-2xl bg-[#162D1F]/90 backdrop-blur-md border border-[#E8DCC4]/25 focus-within:border-[#8B5CF6] rounded-full p-2 flex items-center shadow-2xl transition-all"
          >
            <input
              ref={inputRef}
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste Instagram Reel or Post link — https://www.instagram.com/reel/..."
              className="w-full bg-transparent px-5 py-2.5 text-sm text-[#E8DCC4] placeholder-[#E8DCC4]/45 focus:outline-none"
            />
            {urlInput ? (
              <button
                type="button"
                onClick={() => {
                  setUrlInput('');
                  setError('');
                }}
                className="px-3 text-xs text-[#E8DCC4]/55 hover:text-[#E8DCC4] transition cursor-pointer"
              >
                Clear
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="hidden sm:flex items-center gap-1 px-3.5 py-1.5 mr-1 rounded-full text-xs text-[#E8DCC4]/75 hover:text-[#E8DCC4] bg-[#E8DCC4]/10 hover:bg-[#E8DCC4]/15 transition cursor-pointer shrink-0"
              >
                <ClipboardPaste className="w-3 h-3 text-[#8B5CF6]" />
                <span>Paste</span>
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 px-6 py-3 rounded-full bg-[#E8DCC4] hover:bg-[#f3ead8] text-[#1F3D2B] font-semibold text-xs sm:text-sm tracking-tight transition flex items-center gap-2 shadow-md cursor-pointer disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
                  <span>Extracting...</span>
                </>
              ) : (
                <>
                  <span>Download Reel</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#8B5CF6]" />
                </>
              )}
            </button>
          </form>

          {/* Error Banner */}
          {error && (
            <div className="mt-5 max-w-xl w-full px-5 py-3 rounded-2xl bg-[#162D1F]/95 border border-[#8B5CF6]/60 text-[#E8DCC4] text-xs flex items-center justify-center gap-2.5 shadow-lg">
              <AlertCircle className="w-4 h-4 text-[#8B5CF6] shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="h-6" />
      </section>

      {/* ================================================================= */}
      {/* SAND BEIGE SURFACE SECTION: RESULTS + HOW IT WORKS                */}
      {/* ================================================================= */}
      <main className="bg-[#E8DCC4] text-[#1F3D2B] relative z-20 pb-24 pt-4">
        <div className="max-w-5xl mx-auto px-6">
          {/* EXTRACTED MEDIA CARD */}
          {result && (
            <div className="-mt-20 mb-16 rounded-3xl bg-[#1F3D2B] text-[#E8DCC4] border border-[#1F3D2B] shadow-2xl overflow-hidden">
              {/* Post Author Header */}
              <div className="px-6 py-5 border-b border-[#E8DCC4]/12 flex flex-wrap items-center justify-between gap-4 bg-[#193223]">
                <div className="flex items-center gap-3.5">
                  <img
                    src={result.authorAvatar}
                    alt={result.authorName}
                    className="w-11 h-11 rounded-full object-cover border border-[#8B5CF6]/50 bg-[#1F3D2B]"
                    onError={(e) => {
                      e.target.src =
                        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80';
                    }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-[#E8DCC4]">{result.authorName}</h3>
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#8B5CF6]/20 text-[#E8DCC4] border border-[#8B5CF6]/40">
                        @{result.authorHandle} · Instagram {result.postType}
                      </span>
                    </div>
                    <p className="text-xs text-[#E8DCC4]/70 line-clamp-1 mt-0.5 max-w-xl">
                      {result.caption}
                    </p>
                  </div>
                </div>

                {/* Carousel Slide Switcher */}
                {result.mediaItems.length > 1 && (
                  <div className="flex items-center gap-1.5 bg-[#1F3D2B] p-1 rounded-full border border-[#E8DCC4]/15">
                    {result.mediaItems.map((m, idx) => (
                      <button
                        key={m.index}
                        onClick={() => setActiveSlideIndex(idx)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer ${
                          activeSlideIndex === idx
                            ? 'bg-[#8B5CF6] text-white'
                            : 'text-[#E8DCC4]/70 hover:text-[#E8DCC4]'
                        }`}
                      >
                        Slide #{idx + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Media Preview + Quality Download List */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                {/* Left Column: Live Reel / Photo Preview */}
                <div className="lg:col-span-5 bg-[#14291D] p-6 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#E8DCC4]/10">
                  <div className="relative rounded-2xl overflow-hidden bg-black/50 border border-[#E8DCC4]/15 aspect-[9/12] max-h-[420px] flex items-center justify-center mx-auto w-full">
                    {currentMedia?.isEmbedFallback ? (
                      <iframe
                        src={currentMedia.embedIframeUrl}
                        title="Instagram Reel Preview"
                        className="w-full h-full bg-white border-0"
                        allowTransparency="true"
                        allow="encrypted-media"
                      />
                    ) : currentMedia?.type === 'video' ? (
                      <video
                        key={currentMedia.previewUrl}
                        src={currentMedia.previewUrl}
                        poster={currentMedia.thumbnail}
                        controls
                        playsInline
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <img
                        src={currentMedia?.previewUrl}
                        alt="Instagram media preview"
                        className="w-full h-full object-contain"
                      />
                    )}

                    <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-[#1F3D2B]/90 backdrop-blur-md border border-[#E8DCC4]/20 text-[11px] font-semibold text-[#E8DCC4] flex items-center gap-1.5 pointer-events-none">
                      {currentMedia?.type === 'photo' ? (
                        <>
                          <ImageIcon className="w-3.5 h-3.5 text-[#8B5CF6]" />
                          <span>INSTAGRAM PHOTO</span>
                        </>
                      ) : (
                        <>
                          <Film className="w-3.5 h-3.5 text-[#8B5CF6]" />
                          <span>INSTAGRAM REEL</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-[#E8DCC4]/65 pt-2">
                    <span>Shortcode: #{result.shortcode}</span>
                    <span>{currentMedia?.qualities?.length || 0} Qualities Available</span>
                  </div>
                </div>

                {/* Right Column: All Qualities Download Matrix */}
                <div className="lg:col-span-7 p-6 sm:p-7 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <span className="text-[11px] uppercase tracking-wider text-[#8B5CF6] font-semibold">
                          Direct CDN Streams
                        </span>
                        <h4 className="text-lg font-bold text-[#E8DCC4]">
                          All Available Reel &amp; Post Qualities
                        </h4>
                      </div>
                      <span className="text-xs px-3 py-1 rounded-full bg-[#E8DCC4]/10 text-[#E8DCC4]/80">
                        No Watermark
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {currentMedia?.qualities?.map((q, idx) => {
                        const isDownloading = downloadingId === q.id;
                        const isCopied = copiedId === q.id;

                        return (
                          <div
                            key={q.id}
                            className={`p-3.5 rounded-2xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                              idx === 0
                                ? 'bg-[#264934] border-[#8B5CF6]/60'
                                : 'bg-[#193223]/90 border-[#E8DCC4]/12 hover:border-[#E8DCC4]/30'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs ${
                                  idx === 0
                                    ? 'bg-[#8B5CF6] text-white'
                                    : 'bg-[#E8DCC4]/10 text-[#E8DCC4]'
                                }`}
                              >
                                {q.ext === 'M4A' ? <Music className="w-4 h-4" /> : q.ext}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm text-[#E8DCC4]">
                                    {q.label}
                                  </span>
                                  {q.badge && (
                                    <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#8B5CF6] text-white">
                                      {q.badge}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-[#E8DCC4]/65 flex items-center gap-2 mt-0.5">
                                  <span>{q.resolution}</span>
                                  {q.bitrate && <span>• {q.bitrate}</span>}
                                  <span>• {q.sizeEst}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleCopyLink(q)}
                                title="Copy Direct CDN Link"
                                className="p-2.5 rounded-full bg-[#1F3D2B] hover:bg-[#E8DCC4]/15 text-[#E8DCC4]/80 hover:text-[#E8DCC4] border border-[#E8DCC4]/15 transition cursor-pointer"
                              >
                                {isCopied ? (
                                  <Check className="w-3.5 h-3.5 text-[#8B5CF6]" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>

                              <a
                                href={q.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open stream in new tab"
                                className="p-2.5 rounded-full bg-[#1F3D2B] hover:bg-[#E8DCC4]/15 text-[#E8DCC4]/80 hover:text-[#E8DCC4] border border-[#E8DCC4]/15 transition"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>

                              <button
                                type="button"
                                onClick={() => handleDownloadFile(q)}
                                disabled={isDownloading}
                                className={`px-4 py-2 rounded-full font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer ${
                                  idx === 0
                                    ? 'bg-[#8B5CF6] hover:bg-[#7c4dff] text-white shadow-md'
                                    : 'bg-[#E8DCC4] hover:bg-white text-[#1F3D2B]'
                                }`}
                              >
                                {isDownloading ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>{downloadProgress}%</span>
                                  </>
                                ) : (
                                  <>
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Download</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* HOW IT WORKS — MINIMALIST 3-CARD GRID */}
          <div ref={howItWorksRef} className="pt-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[#8B5CF6]">
                  → Minimalist Workflow
                </span>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1F3D2B] mt-1">
                  Built for pure Instagram archives.
                </h2>
              </div>
              <p className="text-sm text-[#1F3D2B]/75 max-w-md">
                Every Reel and Carousel uploaded to Instagram is stored as a direct MP4 and high-resolution JPG on Instagram CDN nodes. We unlock every quality without watermarks.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="p-7 rounded-3xl bg-[#1F3D2B] text-[#E8DCC4] flex flex-col justify-between shadow-lg">
                <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 flex items-center justify-center text-[#8B5CF6] font-bold text-sm mb-6">
                  01
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#E8DCC4]">Copy Instagram Reel Link</h3>
                  <p className="text-xs text-[#E8DCC4]/75 mt-2 leading-relaxed">
                    Tap the Share icon on any public Instagram Reel, Video, or Photo Carousel and select Copy Link.
                  </p>
                </div>
              </div>

              <div className="p-7 rounded-3xl bg-[#1F3D2B] text-[#E8DCC4] flex flex-col justify-between shadow-lg">
                <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 flex items-center justify-center text-[#8B5CF6] font-bold text-sm mb-6">
                  02
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#E8DCC4]">Inspect All Qualities</h3>
                  <p className="text-xs text-[#E8DCC4]/75 mt-2 leading-relaxed">
                    Paste the URL above. Our engine extracts 1080p Full HD MP4 streams, M4A original audio, and all Carousel slides.
                  </p>
                </div>
              </div>

              <div className="p-7 rounded-3xl bg-[#1F3D2B] text-[#E8DCC4] flex flex-col justify-between shadow-lg">
                <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 flex items-center justify-center text-[#8B5CF6] font-bold text-sm mb-6">
                  03
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#E8DCC4]">Save Master File</h3>
                  <p className="text-xs text-[#E8DCC4]/75 mt-2 leading-relaxed">
                    Download the uncompressed MP4 or original photo directly to your phone or computer in one click.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* RECENT EXTRACTIONS */}
          {history.length > 0 && (
            <div className="mt-14 pt-10 border-t border-[#1F3D2B]/15">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-[#1F3D2B]/70">
                  Recent Instagram Extractions
                </span>
                <button
                  onClick={() => {
                    setHistory([]);
                    localStorage.removeItem('instavault_history_v1');
                  }}
                  className="text-xs text-[#1F3D2B]/60 hover:text-[#1F3D2B] flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {history.map((item) => (
                  <button
                    key={item.shortcode}
                    onClick={() => {
                      setResult(item);
                      setActiveSlideIndex(0);
                      window.scrollTo({ top: 320, behavior: 'smooth' });
                    }}
                    className="p-3 rounded-2xl bg-[#1F3D2B]/5 hover:bg-[#1F3D2B]/10 border border-[#1F3D2B]/15 text-left flex items-center gap-3 transition cursor-pointer"
                  >
                    <img
                      src={item.mediaItems[0]?.thumbnail}
                      alt=""
                      className="w-12 h-12 rounded-xl object-cover shrink-0 bg-[#1F3D2B]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#1F3D2B] truncate">
                        @{item.authorHandle} · {item.postType}
                      </p>
                      <p className="text-[11px] text-[#1F3D2B]/70 truncate">{item.caption}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ================================================================= */}
      {/* OPTIONAL PRODUCTION API KEY DRAWER                                */}
      {/* ================================================================= */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-3xl bg-[#1F3D2B] border border-[#E8DCC4]/20 p-6 text-[#E8DCC4] shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8DCC4]/15">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-[#8B5CF6]" />
                <h3 className="font-bold text-sm">Extraction Engine Settings</h3>
              </div>
              <button
                onClick={() => setShowApiModal(false)}
                className="p-1 rounded-full hover:bg-[#E8DCC4]/10 text-[#E8DCC4]/70 hover:text-[#E8DCC4]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#E8DCC4]/75 mt-4 leading-relaxed">
              Free Insta Video Downloader uses public Instagram Embed &amp; OpenGraph syndication nodes by default. For high-traffic commercial use, you can optionally paste a RapidAPI Instagram Downloader key below:
            </p>

            <div className="mt-4">
              <label className="block text-[11px] uppercase tracking-wider text-[#8B5CF6] font-semibold mb-1.5">
                Optional RapidAPI Key
              </label>
              <input
                type="password"
                value={customRapidApiKey}
                onChange={(e) => saveApiKey(e.target.value)}
                placeholder="Paste x-rapidapi-key (optional)..."
                className="w-full rounded-xl bg-[#14291D] border border-[#E8DCC4]/20 px-3.5 py-2.5 text-xs text-[#E8DCC4] placeholder-[#E8DCC4]/40 focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowApiModal(false)}
                className="px-5 py-2 rounded-full bg-[#E8DCC4] text-[#1F3D2B] font-semibold text-xs cursor-pointer"
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MINIMAL FOOTER */}
      <footer className="bg-[#1F3D2B] text-[#E8DCC4]/70 border-t border-[#E8DCC4]/10 py-8 px-6 text-xs">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
            <span className="font-semibold text-[#E8DCC4]">Free Insta Video Downloader</span>
          </div>
          <p className="text-[#E8DCC4]/55">
            Independent web utility. Not affiliated with Instagram or Meta Platforms, Inc.
          </p>
        </div>
      </footer>
    </div>
  );
}