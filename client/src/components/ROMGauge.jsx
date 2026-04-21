import { forwardRef, useImperativeHandle, useRef } from 'react';

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  if (endAngle - startAngle <= 0) return '';
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}

const BG_ARC = describeArc(80, 80, 60, 0, 270);

const ROMGauge = forwardRef(function ROMGauge({ isHe }, ref) {
  const arcRef = useRef(null);
  const pctRef = useRef(null);

  useImperativeHandle(ref, () => ({
    updateGauge(romPct) {
      const clamped = Math.max(0, Math.min(romPct, 1));
      if (arcRef.current) {
        const arc = describeArc(80, 80, 60, 0, clamped * 270);
        arcRef.current.setAttribute('d', arc || 'M 0 0');
        // Red(0) → Yellow(60) → Green(120)
        const hue = Math.round(clamped * 120);
        arcRef.current.setAttribute('stroke', `hsl(${hue}, 80%, 50%)`);
      }
      if (pctRef.current) {
        pctRef.current.textContent = `${Math.round(clamped * 100)}%`;
      }
    },
    reset() {
      if (arcRef.current) {
        arcRef.current.setAttribute('d', 'M 0 0');
        arcRef.current.setAttribute('stroke', 'hsl(0, 80%, 50%)');
      }
      if (pctRef.current) {
        pctRef.current.textContent = '0%';
      }
    }
  }));

  return (
    <svg width="120" height="120" viewBox="0 0 160 160" className="drop-shadow-lg">
      {/* Background arc */}
      <path
        d={BG_ARC}
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="12"
        strokeLinecap="round"
      />
      {/* Active ROM arc */}
      <path
        ref={arcRef}
        d="M 0 0"
        fill="none"
        stroke="hsl(0, 80%, 50%)"
        strokeWidth="12"
        strokeLinecap="round"
      />
      {/* Percentage */}
      <text
        ref={pctRef}
        x="80"
        y="78"
        textAnchor="middle"
        fill="white"
        fontSize="28"
        fontWeight="bold"
      >
        0%
      </text>
      {/* Label */}
      <text
        x="80"
        y="100"
        textAnchor="middle"
        fill="rgba(255,255,255,0.7)"
        fontSize="13"
      >
        {isHe ? 'טווח תנועה' : 'ROM'}
      </text>
    </svg>
  );
});

export default ROMGauge;
