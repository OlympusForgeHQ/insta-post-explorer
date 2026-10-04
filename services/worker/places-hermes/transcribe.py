"""Local full-audio transcription; stdout contains only the bounded transcript."""
import argparse
import json
import math
import sys
from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--cache', required=True)
    args = parser.parse_args()
    model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=2,
                         num_workers=1, download_root=args.cache)
    segments, info = model.transcribe(args.audio, beam_size=5, vad_filter=True,
                                      condition_on_previous_text=False)
    # Faster-whisper derives this duration from decoded audio samples before VAD.
    # Restored segment timestamps use that full timeline, not duration_after_vad.
    duration = info.duration
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('TRANSCRIPT_DURATION_INVALID')
    result = []
    for segment in segments:
        # Whisper's no-speech and confidence filters suppress silent hallucinations.
        if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1:
            continue
        # Reject invalid timing before rounding; never move text from beyond the
        # audio back inside it. Only an overlapping segment's end can be clipped.
        if (not math.isfinite(segment.start) or not math.isfinite(segment.end)
                or segment.start < 0 or segment.end < segment.start
                or segment.start >= duration):
            raise ValueError('TRANSCRIPT_TIMING_INVALID')
        result.append({'startMs': round(segment.start * 1000),
                       'endMs': round(min(segment.end, duration) * 1000),
                       'text': segment.text.strip()})
        if len(result) > 2000:
            raise ValueError('TRANSCRIPT_LIMIT')
    print(json.dumps({'segments': result}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('TRANSCRIPTION_FAILED\n')
        sys.exit(1)
