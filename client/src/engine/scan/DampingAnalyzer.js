// ============================================================
// DampingAnalyzer — Kinetic Frequency Analysis Engine
//
// PURE LOGIC — zero external dependencies except fft.js.
// All data enters as function parameters.
//
// What it does:
//   Takes a time-series of landmark positions (e.g., ankle.y
//   over 5 seconds at 30fps) and computes:
//   1. FFT → frequency spectrum
//   2. Peak detection → dominant oscillation frequencies
//   3. Damping ratio (ξ) → how the limb absorbs energy
//   4. Classification → organic_healthy / organic_weak / mechanical
//
// The damping ratio distinguishes:
//   - Muscle tissue (organic): smooth, non-linear damping
//   - Prosthetic (mechanical): sharp, linear damping
//   - Weak limb: slow, unstable damping with tremor
//
// Classification zones:
//   ξ < 0.15  → organic_healthy (confident)
//   ξ 0.15-0.35 → organic_weak (confident)
//   ξ 0.35-0.50 → INCONCLUSIVE (retry required)
//   ξ > 0.50  → mechanical (confident)
// ============================================================

import FFT from 'fft.js';


// ---- Constants ----

const DAMPING_THRESHOLDS = Object.freeze({
  HEALTHY_MAX: 0.15,
  WEAK_MAX: 0.35,
  INCONCLUSIVE_MAX: 0.50,
  // Above 0.50 → mechanical
});

const MIN_PEAKS_FOR_DAMPING = 2;
const MIN_SAMPLES = 32;        // minimum frames needed
const BANDPASS_LOW_HZ = 0.5;   // filter out DC drift
const BANDPASS_HIGH_HZ = 8.0;  // filter out high-freq noise


// ---- FFT Helpers (pure functions) ----

/**
 * Pad array to next power of 2 (required by FFT)
 */
function padToPowerOf2(arr) {
  let n = 1;
  while (n < arr.length) n *= 2;
  const padded = new Float64Array(n);
  padded.set(arr);
  // Zero-pad the rest (already 0 by default)
  return padded;
}

/**
 * Apply Hann window to reduce spectral leakage
 */
function applyHannWindow(signal) {
  const N = signal.length;
  const windowed = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    windowed[i] = signal[i] * w;
  }
  return windowed;
}

/**
 * Remove DC component (mean) from signal
 */
function removeDC(signal) {
  const mean = signal.reduce((sum, v) => sum + v, 0) / signal.length;
  const result = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    result[i] = signal[i] - mean;
  }
  return result;
}

/**
 * Compute magnitude spectrum from FFT output
 * Returns array of { freq, magnitude } for positive frequencies only
 */
function computeSpectrum(signal, sampleRate) {
  const padded = padToPowerOf2(signal);
  const N = padded.length;
  const fft = new FFT(N);

  const input = fft.toComplexArray(padded, null);
  const output = fft.createComplexArray();
  fft.realTransform(output, padded);
  fft.completeSpectrum(output);

  const spectrum = [];
  const freqResolution = sampleRate / N;

  // Only positive frequencies (first half)
  for (let i = 1; i < N / 2; i++) {
    const re = output[2 * i];
    const im = output[2 * i + 1];
    const magnitude = Math.sqrt(re * re + im * im) / N;
    const freq = i * freqResolution;
    spectrum.push({ freq, magnitude });
  }

  return spectrum;
}

/**
 * Apply bandpass filter in frequency domain
 */
function bandpassFilter(spectrum, lowHz, highHz) {
  return spectrum.filter(s => s.freq >= lowHz && s.freq <= highHz);
}

/**
 * Find peaks in spectrum (local maxima above threshold)
 */
function findSpectralPeaks(spectrum, threshold = 0) {
  const peaks = [];
  for (let i = 1; i < spectrum.length - 1; i++) {
    if (spectrum[i].magnitude > spectrum[i - 1].magnitude &&
        spectrum[i].magnitude > spectrum[i + 1].magnitude &&
        spectrum[i].magnitude > threshold) {
      peaks.push(spectrum[i]);
    }
  }
  // Sort by magnitude descending
  peaks.sort((a, b) => b.magnitude - a.magnitude);
  return peaks;
}


// ---- Time-domain peak detection (for damping calculation) ----

/**
 * Find all local extrema (maxima AND minima) in a time-domain signal.
 * Uses absolute amplitudes so both peaks and troughs contribute
 * to damping measurement. This is critical for high-damping signals
 * where the oscillation dies in 1-2 cycles — we need every extremum.
 *
 * Filters out extrema below 3% of max amplitude to avoid noise.
 * Returns array of { index, amplitude } sorted by time order.
 */
function findTimeDomainPeaks(signal) {
  // Compute the max absolute amplitude
  let maxAmp = 0;
  for (let i = 0; i < signal.length; i++) {
    const a = Math.abs(signal[i]);
    if (a > maxAmp) maxAmp = a;
  }

  const minAmplitude = maxAmp * 0.10;
  const peaks = [];

  for (let i = 1; i < signal.length - 1; i++) {
    // Local maximum (hilltop)
    const isMax = signal[i] > signal[i - 1] && signal[i] > signal[i + 1];
    // Local minimum (valley)
    const isMin = signal[i] < signal[i - 1] && signal[i] < signal[i + 1];

    if (isMax || isMin) {
      const amp = Math.abs(signal[i]);
      if (amp >= minAmplitude) {
        peaks.push({ index: i, amplitude: amp });
      }
    }
  }
  return peaks;
}

/**
 * Compute logarithmic decrement between consecutive peaks
 * δ = ln(A₁ / A₂)
 */
function logarithmicDecrement(a1, a2) {
  if (a2 <= 0 || a1 <= 0) return null;
  return Math.log(a1 / a2);
}

/**
 * Convert logarithmic decrement to damping ratio
 * ξ = δ / √(4π² + δ²)
 */
function dampingRatioFromDecrement(delta) {
  if (delta === null) return null;
  const fourPiSquared = 4 * Math.PI * Math.PI;
  return Math.abs(delta) / Math.sqrt(fourPiSquared + delta * delta);
}


// ---- Stability Analysis ----

/**
 * Compute positional variance of a landmark over time
 * High variance = instability (tremor, weakness)
 * Returns variance in each axis
 */
function computeVariance(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sumSqDiff = values.reduce((s, v) => s + (v - mean) * (v - mean), 0);
  return sumSqDiff / (n - 1);
}

/**
 * Compute tremor index from high-frequency content
 * Tremor shows up as power in 4-8 Hz range
 */
function computeTremorIndex(spectrum) {
  const tremorBand = spectrum.filter(s => s.freq >= 4.0 && s.freq <= 8.0);
  const totalPower = spectrum.reduce((s, p) => s + p.magnitude * p.magnitude, 0);
  if (totalPower === 0) return 0;
  const tremorPower = tremorBand.reduce((s, p) => s + p.magnitude * p.magnitude, 0);
  return tremorPower / totalPower;
}


// ============================================================
// PUBLIC API — Main analysis functions
// ============================================================

/**
 * Analyze damping characteristics of a single landmark trajectory
 *
 * @param {number[]} values - Time series of one coordinate (e.g., ankle.y)
 *                            at consistent sample rate
 * @param {number} sampleRate - Frames per second (e.g., 30)
 * @returns {DampingResult}
 *
 * @typedef {Object} DampingResult
 * @property {number|null} damping_factor - ξ value (0-1)
 * @property {string} damping_class - 'organic_healthy'|'organic_weak'|'mechanical'|'inconclusive'
 * @property {number} dominant_freq_hz - Primary movement frequency
 * @property {number} tremor_index - Power ratio in tremor band (0-1)
 * @property {number} variance - Positional variance
 * @property {Object[]} spectrum_peaks - Top spectral peaks
 * @property {boolean} sufficient_data - Whether enough data was collected
 */
export function analyzeDamping(values, sampleRate) {
  // Guard: minimum data
  if (!values || values.length < MIN_SAMPLES) {
    return {
      damping_factor: null,
      damping_class: 'inconclusive',
      dominant_freq_hz: 0,
      tremor_index: 0,
      variance: 0,
      spectrum_peaks: [],
      sufficient_data: false,
    };
  }

  // Step 1: Remove DC and apply window
  const cleaned = removeDC(new Float64Array(values));
  const windowed = applyHannWindow(cleaned);

  // Step 2: FFT → spectrum
  const fullSpectrum = computeSpectrum(windowed, sampleRate);
  const spectrum = bandpassFilter(fullSpectrum, BANDPASS_LOW_HZ, BANDPASS_HIGH_HZ);

  // Step 3: Find spectral peaks
  const avgMag = spectrum.length > 0
    ? spectrum.reduce((s, p) => s + p.magnitude, 0) / spectrum.length
    : 0;
  const spectralPeaks = findSpectralPeaks(spectrum, avgMag * 0.5);
  const dominantFreq = spectralPeaks.length > 0 ? spectralPeaks[0].freq : 0;

  // Step 4: Tremor index
  const tremorIndex = computeTremorIndex(spectrum);

  // Step 5: Positional variance
  const variance = computeVariance(values);

  // Step 6: Time-domain damping ratio
  const timePeaks = findTimeDomainPeaks(cleaned);

  let dampingFactor = null;
  if (timePeaks.length >= MIN_PEAKS_FOR_DAMPING) {
    const dampingRatios = [];
    for (let i = 0; i < timePeaks.length - 1; i++) {
      // Only use pairs with monotonic amplitude decrease (real decay, not noise)
      if (timePeaks[i].amplitude <= timePeaks[i + 1].amplitude) continue;
      const deltaHalf = logarithmicDecrement(timePeaks[i].amplitude, timePeaks[i + 1].amplitude);
      // Consecutive extrema (peak→trough) are half-period apart → δ_full = 2 × δ_half
      const xi = dampingRatioFromDecrement(deltaHalf * 2);
      if (xi !== null && isFinite(xi)) {
        dampingRatios.push(xi);
      }
    }

    if (dampingRatios.length > 0) {
      // Use median for robustness against outliers
      dampingRatios.sort((a, b) => a - b);
      const mid = Math.floor(dampingRatios.length / 2);
      dampingFactor = dampingRatios.length % 2 === 0
        ? (dampingRatios[mid - 1] + dampingRatios[mid]) / 2
        : dampingRatios[mid];
    }
  }

  // Step 7: Classification
  const dampingClass = classifyDamping(dampingFactor, tremorIndex);

  return {
    damping_factor: dampingFactor,
    damping_class: dampingClass,
    dominant_freq_hz: Math.round(dominantFreq * 100) / 100,
    tremor_index: Math.round(tremorIndex * 1000) / 1000,
    variance: Math.round(variance * 10000) / 10000,
    spectrum_peaks: spectralPeaks.slice(0, 5).map(p => ({
      freq: Math.round(p.freq * 100) / 100,
      magnitude: Math.round(p.magnitude * 10000) / 10000,
    })),
    sufficient_data: true,
  };
}


/**
 * Classify damping factor into anatomic category
 * Uses both damping ratio AND tremor index for cross-validation
 */
export function classifyDamping(dampingFactor, tremorIndex = 0) {
  if (dampingFactor === null) return 'inconclusive';

  // High tremor + low-ish damping = weak (not healthy)
  if (tremorIndex > 0.3 && dampingFactor < DAMPING_THRESHOLDS.WEAK_MAX) {
    return 'organic_weak';
  }

  if (dampingFactor < DAMPING_THRESHOLDS.HEALTHY_MAX) {
    return 'organic_healthy';
  }
  if (dampingFactor < DAMPING_THRESHOLDS.WEAK_MAX) {
    return 'organic_weak';
  }
  if (dampingFactor < DAMPING_THRESHOLDS.INCONCLUSIVE_MAX) {
    return 'inconclusive';
  }
  return 'mechanical';
}


/**
 * Compare damping between two limbs (left vs right)
 *
 * @param {DampingResult} limbA - Result for one side
 * @param {DampingResult} limbB - Result for other side
 * @returns {SymmetryResult}
 *
 * @typedef {Object} SymmetryResult
 * @property {number} symmetry_index - 0 (totally asymmetric) to 1 (perfectly symmetric)
 * @property {boolean} is_symmetric - true if difference < threshold
 * @property {number} damping_delta - absolute difference in damping factors
 * @property {string} asymmetry_type - 'none'|'damping'|'frequency'|'both'
 */
export function compareSymmetry(limbA, limbB) {
  // If either doesn't have sufficient data, can't compare
  if (!limbA.sufficient_data || !limbB.sufficient_data) {
    return {
      symmetry_index: 0,
      is_symmetric: false,
      damping_delta: null,
      asymmetry_type: 'insufficient_data',
    };
  }

  if (limbA.damping_factor === null || limbB.damping_factor === null) {
    return {
      symmetry_index: 0,
      is_symmetric: false,
      damping_delta: null,
      asymmetry_type: 'insufficient_data',
    };
  }

  const dampingDelta = Math.abs(limbA.damping_factor - limbB.damping_factor);
  const freqDelta = Math.abs(limbA.dominant_freq_hz - limbB.dominant_freq_hz);

  const dampingAsymmetric = dampingDelta >= 0.05;
  const freqAsymmetric = freqDelta >= 0.5;

  let asymmetryType = 'none';
  if (dampingAsymmetric && freqAsymmetric) asymmetryType = 'both';
  else if (dampingAsymmetric) asymmetryType = 'damping';
  else if (freqAsymmetric) asymmetryType = 'frequency';

  // Symmetry index: 1.0 = identical, 0.0 = completely different
  // Based on damping delta: 0.0 delta = 1.0 symmetry, 0.5+ delta = ~0.0 symmetry
  const symmetryIndex = Math.max(0, 1 - (dampingDelta / 0.5));

  return {
    symmetry_index: Math.round(symmetryIndex * 1000) / 1000,
    is_symmetric: !dampingAsymmetric,
    damping_delta: Math.round(dampingDelta * 1000) / 1000,
    asymmetry_type: asymmetryType,
  };
}


/**
 * Analyze stability during single-leg stand
 *
 * @param {number[]} xValues - Lateral position over time
 * @param {number[]} yValues - Vertical position over time
 * @param {number} sampleRate - FPS
 * @returns {StabilityResult}
 *
 * @typedef {Object} StabilityResult
 * @property {number} sway_magnitude - Total sway (RMS of x variance)
 * @property {number} tremor_index - High-frequency content ratio
 * @property {string} stability_class - 'stable'|'unstable_tremor'|'unstable_sway'|'inconclusive'
 */
export function analyzeStability(xValues, yValues, sampleRate) {
  if (!xValues || !yValues || xValues.length < MIN_SAMPLES) {
    return {
      sway_magnitude: 0,
      tremor_index: 0,
      stability_class: 'inconclusive',
      sufficient_data: false,
    };
  }

  const xVariance = computeVariance(xValues);
  const swayMagnitude = Math.sqrt(xVariance);

  // FFT on x-axis for tremor detection
  const cleaned = removeDC(new Float64Array(xValues));
  const windowed = applyHannWindow(cleaned);
  const spectrum = computeSpectrum(windowed, sampleRate);
  const filtered = bandpassFilter(spectrum, BANDPASS_LOW_HZ, BANDPASS_HIGH_HZ);
  const tremorIndex = computeTremorIndex(filtered);

  let stabilityClass;
  if (tremorIndex > 0.3) {
    stabilityClass = 'unstable_tremor';    // high-freq shaking = weakness
  } else if (swayMagnitude > 0.03) {
    stabilityClass = 'unstable_sway';      // low-freq swaying = prosthetic/balance issue
  } else {
    stabilityClass = 'stable';
  }

  return {
    sway_magnitude: Math.round(swayMagnitude * 10000) / 10000,
    tremor_index: Math.round(tremorIndex * 1000) / 1000,
    stability_class: stabilityClass,
    sufficient_data: true,
  };
}


// ---- Export thresholds for testing ----
export { DAMPING_THRESHOLDS, MIN_PEAKS_FOR_DAMPING, MIN_SAMPLES };
