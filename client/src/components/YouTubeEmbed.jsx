import { useState } from 'react';

const SIZE_CLASSES = {
  sm: 'w-full max-w-[200px] aspect-video',
  md: 'w-full max-w-[360px] aspect-video',
  lg: 'w-full max-w-[480px] aspect-video',
};

export default function YouTubeEmbed({ videoId, start = 0, end, size = 'md' }) {
  const [active, setActive] = useState(false);

  if (!videoId) return null;

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  const iframeSrc = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0${
    start ? `&start=${start}` : ''
  }${end ? `&end=${end}` : ''}`;

  if (active) {
    return (
      <div className={`${sizeClass} max-w-full rounded-lg overflow-hidden mx-auto`}>
        <iframe
          src={iframeSrc}
          className="w-full h-full"
          allow="autoplay; encrypted-media"
          allowFullScreen
          title="Exercise demo"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setActive(true)}
      className={`${sizeClass} max-w-full rounded-lg overflow-hidden mx-auto relative group cursor-pointer block`}
    >
      <img
        src={thumbUrl}
        alt="Exercise demo"
        className="w-full h-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition flex items-center justify-center">
        <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
          <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.5 5.5v9l7-4.5-7-4.5z" />
          </svg>
        </div>
      </div>
    </button>
  );
}
