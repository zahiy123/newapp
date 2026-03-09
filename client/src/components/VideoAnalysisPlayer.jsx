import { useRef, useState, useEffect } from 'react';
import { GAME_EVENT_TYPES } from '../utils/gameRules';

export default function VideoAnalysisPlayer({ videoFile, events, sport, isHe }) {
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeEvent, setActiveEvent] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);

  const eventTypes = GAME_EVENT_TYPES[sport] || GAME_EVENT_TYPES.football;

  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [videoFile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => setCurrentTime(video.currentTime);
    const onMeta = () => setDuration(video.duration);

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
    };
  }, [videoUrl]);

  // Find active event based on current time
  useEffect(() => {
    if (!events.length) return;
    const current = events.find(e =>
      Math.abs(e.timestamp - currentTime) < 2
    );
    setActiveEvent(current || null);
  }, [currentTime, events]);

  function seekToEvent(event) {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, event.timestamp - 1);
      videoRef.current.play();
    }
  }

  function getEventColor(type) {
    return eventTypes[type]?.color || '#6b7280';
  }

  function getEventLabel(event) {
    const def = eventTypes[event.type];
    if (!def) return event.type;
    return isHe ? def.he : def.en;
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  return (
    <div className="space-y-3">
      {/* Video Player */}
      <div className="relative bg-black rounded-xl overflow-hidden">
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="w-full"
            style={{ maxHeight: '400px' }}
          />
        )}

        {/* Active event overlay */}
        {activeEvent && (
          <div className="absolute top-3 left-3 right-3">
            <div className="bg-black/80 text-white rounded-lg px-4 py-2 flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: getEventColor(activeEvent.type) }}
              />
              <span className="font-medium">{getEventLabel(activeEvent)}</span>
              <span className="text-white/60 text-sm">
                {isHe ? `קבוצה ${activeEvent.team === 'A' ? "א'" : "ב'"}` : `Team ${activeEvent.team}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Timeline with event markers */}
      {duration > 0 && events.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="text-sm font-medium text-gray-600 mb-2">
            {isHe ? 'ציר זמן' : 'Timeline'}
          </h3>
          <div className="relative h-8 bg-gray-100 rounded-full overflow-visible">
            {/* Progress indicator */}
            <div
              className="absolute top-0 left-0 h-full bg-blue-100 rounded-full"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
            {/* Event markers */}
            {events.map((event, i) => {
              const left = (event.timestamp / duration) * 100;
              return (
                <button
                  key={i}
                  onClick={() => seekToEvent(event)}
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md hover:scale-150 transition-transform cursor-pointer z-10"
                  style={{
                    left: `${Math.min(98, Math.max(2, left))}%`,
                    backgroundColor: getEventColor(event.type),
                  }}
                  title={`${formatTime(event.timestamp)} - ${getEventLabel(event)}`}
                />
              );
            })}
          </div>
          {/* Time labels */}
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0:00</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
