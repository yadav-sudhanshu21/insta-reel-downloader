import React, { useState, useEffect, useRef } from 'react';
import {
  Download,
  Sparkles,
  AlertCircle,
  Loader2,
  Trash2,
  ChevronRight,
  ClipboardPaste,
  RotateCcw,
  Play,
  Check
} from 'lucide-react';

// ==========================================
// INSTAGRAM URL PARSER & SHORTCODE EXTRACTOR
// ==========================================
function parseInstagramUrl(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Extract Instagram link even if pasted with caption text around it
  const urlMatch = trimmed.match(
    /(https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s]+)/i
  );
  const candidate = urlMatch ? urlMatch[1] : trimmed;

  const regex =
    /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am|vxinstagram\.com)\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,25})/i;
  const match = candidate.match(regex);
  if (match) {
    const rawType = match[1].toLowerCase();
    return {
      type: rawType === 'reels' ? 'reel' : rawType,
      shortcode: match[2],
      cleanUrl: `https://www.instagram.com/${rawType === 'reels' ? 'reel' : rawType}/${match[2]}/`
    };
  }

  return null;
}

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [downloadingServer, setDownloadingServer] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [activeNav, setActiveNav] = useState('Reels HD');
  const [history, setHistory] = useState([]);

  const extractorRef = useRef(null);
  const resultSectionRef = useRef(null);
  const howItWorksRef = useRef(null);
  const inputRef = useRef(null);

  // Load saved history and dynamically inject btch-downloader browser bundle for client-side fallback
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('instavault_history_v2');
      if (savedHistory) setHistory(JSON.parse(savedHistory));
    } catch (e) {
      // ignore
    }

    if (!document.getElementById('btch-sdk-script')) {
      const script = document.createElement('script');
      script.id = 'btch-sdk-script';
      script.src = 'https://cdn.jsdelivr.net/npm/btch-downloader@6.4.0/dist/browser/index.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  const saveToHistory = (item) => {
    try {
      setHistory((prev) => {
        const updated = [item, ...prev.filter((h) => h.shortcode !== item.shortcode)].slice(0, 6);
        localStorage.setItem('instavault_history_v2', JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      // ignore
    }
  };

  // ==========================================
  // MULTI-SERVER INSTAGRAM EXTRACTION ENGINE
  // ==========================================
  const fetchLiveInstagramMedia = async (parsed) => {
    const { shortcode, type, cleanUrl } = parsed;

    // 1. PRIMARY ENGINE: Call Your Vercel Backend (/api/instagram)
    try {
      const apiRes = await fetch(
        `/api/instagram?shortcode=${encodeURIComponent(shortcode)}&type=${encodeURIComponent(type)}`
      );
      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data && data.status === 'ok' && Array.isArray(data.items) && data.items.length > 0) {
          const mediaItems = data.items.map((item, idx) => {
            const isVid = item.type === 'video';
            const primaryStream = isVid ? item.videoUrl : item.imageUrl;
            const secondaryStream = item.server2Url || primaryStream;
            return {
              index: idx,
              type: isVid ? 'video' : 'photo',
              isEmbedFallback: false,
              thumbnail: item.thumbnail || primaryStream,
              previewUrl: primaryStream,
              server1Url: primaryStream,
              server2Url: secondaryStream
            };
          });

          return {
            shortcode,
            postType: mediaItems.length > 1 ? 'CAROUSEL' : type.toUpperCase(),
            authorName: data.authorName || `@${data.authorHandle}`,
            authorHandle: data.authorHandle || 'instagram',
            caption: data.caption || `Instagram ${type.toUpperCase()} (#${shortcode})`,
            mediaItems
          };
        }
      }
    } catch (e) {
      // Continue to Engine 2
    }

    // 2. ENGINE 2: Client-Side btch-downloader SDK (if loaded in browser)
    try {
      const btch = window.btch || window.btchDownloader;
      if (btch && typeof btch.igdl === 'function') {
        const res = await btch.igdl(cleanUrl);
        const list = Array.isArray(res) ? res : res?.result || res?.data || [];
        if (Array.isArray(list) && list.length > 0 && list[0]?.url) {
          const mediaItems = list.map((item, idx) => ({
            index: idx,
            type: 'video',
            isEmbedFallback: false,
            thumbnail: item.thumbnail || item.wm || item.url,
            previewUrl: item.url,
            server1Url: item.url,
            server2Url: list[1]?.url || item.url
          }));

          return {
            shortcode,
            postType: type.toUpperCase(),
            authorName: 'Instagram Reel',
            authorHandle: 'instagram',
            caption: `Instagram ${type.toUpperCase()} (#${shortcode})`,
            mediaItems
          };
        }
      }
    } catch (e) {
      // Continue to Engine 3
    }

    // 3. ENGINE 3: Direct Browser Proxies to Embed Captioned & Unfurl Nodes
    const embedCaptionedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const kkUrl = `https://kkinstagram.com/reel/${shortcode}`;

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

    const responses = await Promise.allSettled([
      fetchTextWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(embedCaptionedUrl)}`),
      fetchTextWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(embedCaptionedUrl)}`),
      fetchTextWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(kkUrl)}`)
    ]);

    const decodeEscapes = (str) =>
      str
        .replace(/\\u0026/g, '&')
        .replace(/\\u0025/g, '%')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');

    let fallbackThumbnail = null;
    let fallbackHandle = 'instagram';

    for (const r of responses) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const html = r.value;
      const videos = [];
      const images = [];

      for (const m of html.matchAll(/\\?"video_url\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
        videos.push(decodeEscapes(m[1]));
      }
      for (const m of html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
        videos.push(decodeEscapes(m[1]));
      }
      const ogVideo =
        html.match(/property="og:video(?::secure_url)?"\s+content="([^"]+)"/i) ||
        html.match(/content="([^"]+)"\s+property="og:video(?::secure_url)?"/i);
      if (ogVideo?.[1]) videos.push(decodeEscapes(ogVideo[1]));

      for (const m of html.matchAll(/\\?"display_url\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
        images.push(decodeEscapes(m[1]));
      }
      const embedImgMatch = html.match(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/);
      if (embedImgMatch?.[1]) images.push(decodeEscapes(embedImgMatch[1]));

      const userMatch =
        html.match(/\\?"username\\?"\s*:\s*\\?"([^"\\]+)\\?"/) ||
        html.match(/class="UsernameText"[^>]*>([^<]+)</);
      if (userMatch) fallbackHandle = userMatch[1].trim();

      const uniqueVideos = [...new Set(videos)].filter((u) => u.startsWith('http'));
      const uniqueImages = [...new Set(images)].filter((u) => u.startsWith('http'));

      if (uniqueImages.length > 0 && !fallbackThumbnail) {
        fallbackThumbnail = uniqueImages[0];
      }

      if (uniqueVideos.length > 0 || (type === 'p' && uniqueImages.length > 0)) {
        const primaryUrl = uniqueVideos[0] || uniqueImages[0];
        return {
          shortcode,
          postType: type.toUpperCase(),
          authorName: `@${fallbackHandle}`,
          authorHandle: fallbackHandle,
          caption: `Instagram ${type.toUpperCase()} (#${shortcode})`,
          mediaItems: [
            {
              index: 0,
              type: uniqueVideos.length > 0 ? 'video' : 'photo',
              isEmbedFallback: false,
              thumbnail: uniqueImages[0] || primaryUrl,
              previewUrl: primaryUrl,
              server1Url: primaryUrl,
              server2Url: uniqueVideos[1] || primaryUrl
            }
          ]
        };
      }
    }

    throw new Error('Could not extract this link. Please make sure the Instagram Reel is public and try again.');
  };

  const handleExtract = async (e, customUrl) => {
    if (e) e.preventDefault();
    const targetUrl = customUrl ?? urlInput;
    setError('');

    const parsed = parseInstagramUrl(targetUrl);
    if (!parsed) {
      setError('Please paste a valid Instagram Reel or Video link (e.g. https://www.instagram.com/reel/...)');
      return;
    }

    setLoading(true);
    try {
      const data = await fetchLiveInstagramMedia(parsed);
      setResult(data);
      setActiveSlideIndex(0);
      saveToHistory(data);
      setUrlInput(''); // Auto-clear input once ready, just like fastvideosave.net
      setTimeout(() => {
        resultSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    } catch (err) {
      setError(err.message || "Couldn't download this link. Make sure the Reel is public.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit immediately when user pastes a valid Instagram URL (fastvideosave.net behavior)
  const handleInputChange = (e) => {
    const val = e.target.value;
    setUrlInput(val);
    setError('');
    const parsed = parseInstagramUrl(val);
    if (parsed && val.length > 24 && !loading) {
      handleExtract(null, val);
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

  // ==========================================================
  // SERVER 1 & SERVER 2 DIRECT DOWNLOAD HANDLERS
  // ==========================================================
  const handleServerDownload = async (targetStreamUrl, serverNumber) => {
    if (!targetStreamUrl) return;
    setDownloadingServer(serverNumber);
    setDownloadProgress(25);

    const ext = currentMedia?.type === 'photo' ? 'jpg' : 'mp4';
    const cleanFileName = `Instagram_Reel_${result?.shortcode || 'video'}_Server${serverNumber}.${ext}`;

    // SERVER 2: Direct CDN Stream / Proxy Download Endpoint (Instant Browser File Save)
    if (serverNumber === 2) {
      const directProxyHref = `/api/instagram?downloadUrl=${encodeURIComponent(
        targetStreamUrl
      )}&filename=${encodeURIComponent(cleanFileName)}`;
      const a = document.createElement('a');
      a.href = directProxyHref;
      a.download = cleanFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        setDownloadingServer(null);
        setDownloadProgress(0);
      }, 800);
      return;
    }

    // SERVER 1: Fetch Binary Stream & Save Directly into Device Gallery / Downloads
    try {
      const proxyDownloadUrl = `/api/instagram?downloadUrl=${encodeURIComponent(
        targetStreamUrl
      )}&filename=${encodeURIComponent(cleanFileName)}`;

      let response = await fetch(proxyDownloadUrl);
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        response = await fetch(targetStreamUrl);
      }

      if (!response || !response.ok) throw new Error('Direct link fallback');

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

      const blob = new Blob(chunks, {
        type: ext === 'mp4' ? 'video/mp4' : 'image/jpeg'
      });
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
      // Fallback to direct download anchor
      window.open(
        `/api/instagram?downloadUrl=${encodeURIComponent(targetStreamUrl)}&filename=${encodeURIComponent(
          cleanFileName
        )}`,
        '_blank',
        'noopener,noreferrer'
      );
    } finally {
      setTimeout(() => {
        setDownloadingServer(null);
        setDownloadProgress(0);
      }, 600);
    }
  };

  const currentMedia =
    result?.mediaItems?.[activeSlideIndex] || result?.mediaItems?.[0];

  return (
    <div className="min-h-screen bg-[#1F3D2B] text-[#E8DCC4] font-sans selection:bg-[#8B5CF6] selection:text-white overflow-x-hidden">
      {/* ================================================================= */}
      {/* HERO SECTION WITH FERNWOOD DOT MATRIX + SAND BEIGE HORIZON MIST   */}
      {/* ================================================================= */}
      <section className="relative min-h-[84vh] flex flex-col justify-between overflow-hidden">
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

          <button
            type="button"
            onClick={handlePasteClipboard}
            className="px-4 py-2 rounded-full text-xs font-medium border border-[#E8DCC4]/30 bg-[#1F3D2B]/60 hover:border-[#8B5CF6] hover:bg-[#8B5CF6]/20 text-[#E8DCC4] transition flex items-center gap-1.5 cursor-pointer"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-[#8B5CF6]" />
            <span>Paste link</span>
          </button>
        </header>

        {/* CENTER HERO CONTENT */}
        <div
          ref={extractorRef}
          className="relative z-20 max-w-4xl w-full mx-auto px-6 pt-14 pb-28 text-center flex flex-col items-center"
        >
          <h1 className="text-4xl sm:text-6xl md:text-[64px] font-bold tracking-tight text-[#E8DCC4] leading-[1.08] max-w-3xl">
            Instagram Reel Download.
          </h1>

          <p className="mt-5 text-base sm:text-lg text-[#E8DCC4]/85 max-w-xl leading-relaxed font-normal">
            Download high quality insta reels and videos with one click
          </p>

          {/* FASTVIDEOSAVE-STYLE AUTO-SUBMIT INPUT BAR */}
          <form
            onSubmit={(e) => handleExtract(e)}
            className={`mt-9 w-full max-w-2xl bg-[#162D1F]/95 backdrop-blur-md border ${
              error ? 'border-red-400' : 'border-[#E8DCC4]/25 focus-within:border-[#8B5CF6]'
            } rounded-full p-2 flex items-center shadow-2xl transition-all`}
          >
            <input
              ref={inputRef}
              type="text"
              value={urlInput}
              onChange={handleInputChange}
              placeholder="Paste link here..."
              className="w-full bg-transparent px-5 py-2.5 text-sm text-[#E8DCC4] placeholder-[#E8DCC4]/45 focus:outline-none"
            />

            {loading ? (
              <div className="shrink-0 px-6 py-3 rounded-full bg-[#8B5CF6] text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-md">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (urlInput.trim()) {
                    handleExtract(null, urlInput);
                  } else {
                    handlePasteClipboard();
                  }
                }}
                className="shrink-0 px-6 py-2.5 rounded-full bg-[#E8DCC4] hover:bg-white text-[#1F3D2B] transition flex items-center gap-2.5 shadow-md cursor-pointer"
              >
                <ClipboardPaste className="w-4 h-4 text-[#8B5CF6]" />
                <div className="text-left leading-tight">
                  <div className="font-bold text-xs sm:text-sm">
                    {urlInput.trim() ? 'Download Reel' : 'Paste link'}
                  </div>
                  <div className="text-[10px] text-[#1F3D2B]/70 font-medium">auto-submit</div>
                </div>
              </button>
            )}
          </form>

          {error && (
            <div className="mt-5 max-w-xl w-full px-5 py-3 rounded-2xl bg-[#162D1F]/95 border border-[#8B5CF6]/60 text-[#E8DCC4] text-xs flex items-center justify-center gap-2.5 shadow-lg">
              <AlertCircle className="w-4 h-4 text-[#8B5CF6] shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="h-4" />
      </section>

      {/* ================================================================= */}
      {/* SAND BEIGE SURFACE SECTION: FASTVIDEOSAVE-STYLE RESULT CARD       */}
      {/* ================================================================= */}
      <main className="bg-[#E8DCC4] text-[#1F3D2B] relative z-20 pb-24 pt-4">
        <div ref={resultSectionRef} className="max-w-5xl mx-auto px-6">
          {/* CENTERED VERTICAL VIDEO CARD WITH SERVER 1 & SERVER 2 BUTTONS (EXACT REFERENCE MATCH) */}
          {result && currentMedia && (
            <div className="-mt-20 mb-16 flex justify-center">
              <div className="w-full max-w-[380px] rounded-3xl bg-[#1F3D2B] text-[#E8DCC4] p-5 shadow-2xl border border-[#E8DCC4]/20 flex flex-col items-center">
                {/* Carousel Switcher if multiple slides */}
                {result.mediaItems.length > 1 && (
                  <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5">
                    {result.mediaItems.map((m, idx) => (
                      <button
                        key={m.index}
                        onClick={() => setActiveSlideIndex(idx)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
                          activeSlideIndex === idx
                            ? 'bg-[#8B5CF6] text-white'
                            : 'bg-[#E8DCC4]/10 text-[#E8DCC4]/75 hover:text-[#E8DCC4]'
                        }`}
                      >
                        #{idx + 1}
                      </button>
                    ))}
                  </div>
                )}

                {/* Vertical 9:16 Video / Photo Preview Player */}
                <div className="w-full rounded-2xl overflow-hidden bg-black border border-[#E8DCC4]/15 aspect-[9/15] max-h-[430px] relative flex items-center justify-center shadow-inner">
                  {currentMedia.type === 'video' ? (
                    <video
                      key={currentMedia.previewUrl}
                      src={currentMedia.previewUrl}
                      poster={currentMedia.thumbnail}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={currentMedia.previewUrl}
                      alt="Instagram media preview"
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>

                {/* DOWNLOAD (SERVER 1) BUTTON */}
                <button
                  type="button"
                  onClick={() => handleServerDownload(currentMedia.server1Url, 1)}
                  disabled={downloadingServer !== null}
                  className="mt-4 w-full py-3.5 px-5 rounded-xl bg-[#8B5CF6] hover:bg-[#7c4dff] text-white font-bold text-xs sm:text-sm tracking-wider uppercase transition flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-60"
                >
                  {downloadingServer === 1 ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>DOWNLOADING ({downloadProgress}%)...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>DOWNLOAD (SERVER 1)</span>
                    </>
                  )}
                </button>

                {/* DOWNLOAD (SERVER 2) BUTTON */}
                <button
                  type="button"
                  onClick={() =>
                    handleServerDownload(currentMedia.server2Url || currentMedia.server1Url, 2)
                  }
                  disabled={downloadingServer !== null}
                  className="mt-2.5 w-full py-3.5 px-5 rounded-xl bg-[#E8DCC4] hover:bg-white text-[#1F3D2B] font-bold text-xs sm:text-sm tracking-wider uppercase transition flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-60"
                >
                  {downloadingServer === 2 ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
                      <span>STARTING DOWNLOAD...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 text-[#8B5CF6]" />
                      <span>DOWNLOAD (SERVER 2)</span>
                    </>
                  )}
                </button>

                {/* Download Again Reset Link */}
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setUrlInput('');
                    setError('');
                    extractorRef.current?.scrollIntoView({ behavior: 'smooth' });
                    setTimeout(() => inputRef.current?.focus(), 300);
                  }}
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#E8DCC4]/80 hover:text-[#E8DCC4] underline underline-offset-4 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#8B5CF6]" />
                  <span>Download Again</span>
                </button>
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
                  Steps to Download Reels From Instagram.
                </h2>
              </div>
              <p className="text-sm text-[#1F3D2B]/75 max-w-md">
                Original quality without watermark or logo. Save Reels videos directly to your phone gallery or computer in seconds.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="p-7 rounded-3xl bg-[#1F3D2B] text-[#E8DCC4] flex flex-col justify-between shadow-lg">
                <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 flex items-center justify-center text-[#8B5CF6] font-bold text-sm mb-6">
                  01
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#E8DCC4]">Copy Link of the Video</h3>
                  <p className="text-xs text-[#E8DCC4]/75 mt-2 leading-relaxed">
                    Open Instagram, tap the Share icon on any public Reel or Video, and tap Copy Link.
                  </p>
                </div>
              </div>

              <div className="p-7 rounded-3xl bg-[#1F3D2B] text-[#E8DCC4] flex flex-col justify-between shadow-lg">
                <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 flex items-center justify-center text-[#8B5CF6] font-bold text-sm mb-6">
                  02
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#E8DCC4]">Paste Link (Auto-Submit)</h3>
                  <p className="text-xs text-[#E8DCC4]/75 mt-2 leading-relaxed">
                    Tap Paste link above. Our auto-submit engine fetches the HD video stream right away.
                  </p>
                </div>
              </div>

              <div className="p-7 rounded-3xl bg-[#1F3D2B] text-[#E8DCC4] flex flex-col justify-between shadow-lg">
                <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 flex items-center justify-center text-[#8B5CF6] font-bold text-sm mb-6">
                  03
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#E8DCC4]">Tap Download (Server 1 or 2)</h3>
                  <p className="text-xs text-[#E8DCC4]/75 mt-2 leading-relaxed">
                    Save the original Full HD MP4 directly into your device Downloads or Gallery.
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
                  Recent Instagram Downloads
                </span>
                <button
                  onClick={() => {
                    setHistory([]);
                    localStorage.removeItem('instavault_history_v2');
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
                      resultSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                        Reel #{item.shortcode}
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