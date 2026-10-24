"""transcribe.py : word-level timestamps for a video/audio file -> words.json

Usage (use the Python that has openai-whisper):
  python transcribe.py <video_or_audio> --out words.json [--lang ko] [--model large-v3-turbo]

Output: {"language": "ko", "words": [{"text": "...", "start": 0.0, "end": 0.4}]}
Korean text is space-separated eojeol units. Review the result against the real script
(spelling, names) before styling: ASR errors become big on-screen text.
"""
import argparse, json, os, re, subprocess, sys, tempfile

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--out", default="words.json")
ap.add_argument("--lang", default="ko")
ap.add_argument("--model", default="large-v3-turbo")
ap.add_argument("--prompt", default="", help="optional vocabulary hint (names, product terms)")
ap.add_argument("--prompt-file", default="", help="text file with the real lyrics/script: used as a spelling hint (first 600 characters of the last lines are kept)")
a = ap.parse_args()

tmp = tempfile.mkdtemp(prefix="capasr_")
wav = os.path.join(tmp, "a.wav")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", a.src, "-vn", "-ac", "1", "-ar", "16000", wav], check=True)

import whisper  # noqa: E402

hint = a.prompt
if a.prompt_file:
    txt = " ".join(open(a.prompt_file, encoding="utf-8").read().split())
    hint = (hint + " " + txt[:600]).strip()
model = whisper.load_model(a.model)
res = model.transcribe(wav, language=a.lang, word_timestamps=True, initial_prompt=hint or None,
                       condition_on_previous_text=False, temperature=0.0)
words = []
for seg in res["segments"]:
    if seg.get("no_speech_prob", 0) > 0.8:
        continue
    for w in seg.get("words", []):
        t = w["word"].strip()
        if t:
            words.append({"text": t, "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3)})
# --- hallucination guards (patterns seen with Whisper: invented text in the final silence, broken glyphs) ---
# 1) words that start inside the trailing silence are dropped (silencedetect -35dB / 0.6 s; real speech is about -16..-26 dB)
r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", wav, "-af", "silencedetect=noise=-35dB:d=0.6", "-f", "null", "-"], capture_output=True, text=True)
starts = [float(m) for m in re.findall(r"silence_start: ([0-9.]+)", r.stderr)]
ends = re.findall(r"silence_end: ([0-9.]+)", r.stderr)
dropped = []
if starts and len(starts) > len(ends):  # silence that runs to the end of the file
    cut = starts[-1] - 0.05
    dropped = [w for w in words if w["start"] >= cut]
    words = [w for w in words if w["start"] < cut]
# 2) broken output check: music-note or replacement characters over 20% means the model failed on this audio
bad = sum(1 for w in words if re.search(r"[\u266a\ufffd]", w["text"]))
if words and bad / len(words) > 0.2:
    print(f"FAIL: {bad}/{len(words)} words contain music/replacement characters. Retry with a larger model or isolate the voice.", file=sys.stderr)
    sys.exit(3)
json.dump({"language": a.lang, "precision": "word-level", "words": words}, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"words: {len(words)} -> {a.out}" + (f" (dropped {len(dropped)} words inside trailing silence: {' '.join(w['text'] for w in dropped)})" if dropped else ""))
