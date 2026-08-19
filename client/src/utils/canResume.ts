export function canResume(pos: number, dur: number): boolean {
  return isFinite(pos)
    && isFinite(dur)
    && dur > 0
    && pos > 10
    && pos < dur
    && pos / dur < 0.9;
}
