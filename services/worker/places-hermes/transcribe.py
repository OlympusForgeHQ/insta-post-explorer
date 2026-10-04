"""Local full-audio transcription; stdout contains only the bounded transcript."""
import argparse
import json
import sys
from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--cache', required=True)
    args = parser.parse_args()
    model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=2,
                         num_workers=1, download_root=args.cache)
    segments, _ = model.transcribe(args.audio, beam_size=5, vad_filter=True,
                                   condition_on_previous_text=False)
    result = []
    for segment in segments:
        # Whisper's no-speech and confidence filters suppress silent hallucinations.
        if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1:
            continue
        result.append({'startMs': round(segment.start * 1000),
                       'endMs': round(segment.end * 1000), 'text': segment.text.strip()})
        if len(result) > 2000:
            raise ValueError('TRANSCRIPT_LIMIT')
    print(json.dumps({'segments': result}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('TRANSCRIPTION_FAILED\n')
        sys.exit(1)
