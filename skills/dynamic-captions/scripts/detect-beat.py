"""detect-beat.py : beat times of a song -> beat.json  (for make-captions --beat)

Usage (Python with librosa):
  python detect-beat.py <song or video file> --out beat.json [--bpm-hint 88] [--start 0] [--end 0]

Output: {"bpm": 87.9, "beats": [0.52, 1.20, ...], "confidence": 0.0..1.0}
- --bpm-hint: the real tempo if you know it (Suno/ledger BPM). Rap often gets detected at half/double speed; the hint fixes that.
- confidence: share of beats that land on a clear onset. Under 0.35 the beat pulse should not be used (it would look random).
- The beat times are relative to the start of the FILE you pass. If the video was cut later than the song, use make-captions --shift.
"""
import argparse, json, subprocess, tempfile, os
import numpy as np
import librosa

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--out", default="beat.json")
ap.add_argument("--bpm-hint", type=float, default=0.0)
ap.add_argument("--start", type=float, default=0.0)
ap.add_argument("--end", type=float, default=0.0)
a = ap.parse_args()

tmp = tempfile.mkdtemp(prefix="capbeat_")
wav = os.path.join(tmp, "a.wav")
cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", a.src, "-vn", "-ac", "1", "-ar", "22050"]
if a.start > 0:
    cmd += ["-ss", str(a.start)]
if a.end > 0:
    cmd += ["-t", str(a.end - a.start)]
subprocess.run(cmd + [wav], check=True)
y, sr = librosa.load(wav, sr=22050, mono=True)
oenv = librosa.onset.onset_strength(y=y, sr=sr)
start_bpm = a.bpm_hint if a.bpm_hint > 0 else 100.0
tempo, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, start_bpm=start_bpm, tightness=120 if a.bpm_hint > 0 else 100, units="time")
tempo = float(np.atleast_1d(tempo)[0])
beats = [round(float(b) + a.start, 3) for b in beats]
# confidence: onset strength at the beat frames compared with the overall median
frames = librosa.time_to_frames(np.array(beats) - a.start, sr=sr)
frames = frames[(frames >= 0) & (frames < len(oenv))]
conf = float(np.mean(oenv[frames] > np.median(oenv))) if len(frames) else 0.0
json.dump({"bpm": round(tempo, 2), "beats": beats, "confidence": round(conf, 3)}, open(a.out, "w"), indent=1)
print(f"bpm {tempo:.1f} | beats {len(beats)} | confidence {conf:.2f} -> {a.out}")
