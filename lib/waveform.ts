const FALLBACK_WAVEFORM = [
  0.18, 0.3, 0.44, 0.6, 0.42, 0.28, 0.5, 0.34,
  0.22, 0.4, 0.64, 0.46, 0.26, 0.54, 0.36, 0.2,
  0.32, 0.58, 0.74, 0.48, 0.3, 0.62, 0.42, 0.24,
  0.38, 0.56, 0.7, 0.44, 0.28, 0.52, 0.34, 0.2,
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function meteringToAmplitude(metering: number) {
  const normalized = clamp((metering + 60) / 60, 0, 1);
  return Math.pow(normalized, 0.72);
}

export function downsampleWaveform(samples: number[], targetBars = 40) {
  const cleanSamples = samples.filter((sample) => Number.isFinite(sample));

  if (cleanSamples.length === 0) {
    return FALLBACK_WAVEFORM;
  }

  const barCount = clamp(targetBars, 32, 48);
  const chunkSize = Math.max(1, Math.ceil(cleanSamples.length / barCount));
  const bars: number[] = [];

  for (let index = 0; index < barCount; index++) {
    const start = index * chunkSize;
    const chunk = cleanSamples.slice(start, start + chunkSize);

    if (chunk.length === 0) {
      bars.push(0);
      continue;
    }

    const peak = Math.max(...chunk);
    const average = chunk.reduce((sum, sample) => sum + sample, 0) / chunk.length;
    bars.push(peak * 0.72 + average * 0.28);
  }

  const max = Math.max(...bars);

  if (max <= 0) {
    return FALLBACK_WAVEFORM;
  }

  return bars.map((bar) => Number(clamp(0.14 + (bar / max) * 0.86, 0.14, 1).toFixed(3)));
}

export function getFallbackWaveform() {
  return FALLBACK_WAVEFORM;
}
