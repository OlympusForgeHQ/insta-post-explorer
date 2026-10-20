"""Local full-audio transcription; stdout contains only the bounded transcript."""
import argparse
import json
import math
import os
import sys


class AsrUnavailable(RuntimeError):
    pass


def load_model(cache, threads):
    # Hugging Face captures these paths at import time. Keep the existing model
    # layout directly under download_root while isolating all home/token access.
    cache = os.path.abspath(cache)
    hf_home = os.path.join(cache, 'huggingface')
    os.environ.update({
        'HF_HOME': hf_home,
        'HF_TOKEN_PATH': os.path.join(hf_home, 'token'),
        'HF_HUB_CACHE': cache,
        'HUGGINGFACE_HUB_CACHE': cache,
        'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1',
        'HF_HUB_OFFLINE': '1',
    })
    try:
        from faster_whisper import WhisperModel
        return WhisperModel('small', device='cpu', compute_type='int8',
                            cpu_threads=threads, num_workers=1, download_root=cache,
                            local_files_only=True, use_auth_token=False)
    except Exception as error:
        raise AsrUnavailable('ASR_UNAVAILABLE') from error


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--audio')
    mode.add_argument('--check', action='store_true')
    parser.add_argument('--cache', required=True)
    args = parser.parse_args()
    threads = int(os.environ.get('CLASSIFICATION_ASR_CPU_THREADS', '2'))
    if not 1 <= threads <= 4:
        raise ValueError('TRANSCRIPT_CPU_THREADS_INVALID')
    model = load_model(args.cache, threads)
    if args.check:
        print(json.dumps({'ready': True}))
        return
    segments, info = model.transcribe(args.audio, beam_size=5, vad_filter=True,
                                      condition_on_previous_text=False)
    # Faster-whisper derives this duration from decoded audio samples before VAD.
    # Restored segment timestamps use that full timeline, not duration_after_vad.
    duration = info.duration
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('TRANSCRIPT_DURATION_INVALID')
    result = []
    discarded_tail = 0
    for count, segment in enumerate(segments, start=1):
        # Bound the generator even when silence or out-of-audio text is discarded.
        if count > 2000:
            raise ValueError('TRANSCRIPT_LIMIT')
        if (not math.isfinite(segment.start) or not math.isfinite(segment.end)
                or segment.start < 0 or segment.end < segment.start):
            raise ValueError('TRANSCRIPT_TIMING_INVALID')
        # Whisper can emit a terminal tail beyond the decoded audio. Discard it
        # without moving unsupported text into the recording. An in-range return
        # after that tail is inconsistent timing, not a recoverable overshoot.
        if segment.start >= duration:
            discarded_tail += 1
            continue
        if discarded_tail:
            raise ValueError('TRANSCRIPT_TIMING_INVALID')
        # Whisper's no-speech and confidence filters suppress silent hallucinations.
        if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1:
            continue
        # Only an overlapping segment's end can be clipped.
        result.append({'startMs': round(segment.start * 1000),
                       'endMs': round(min(segment.end, duration) * 1000),
                       'text': segment.text.strip()})
    if discarded_tail:
        if not any(row['text'] for row in result):
            raise ValueError('TRANSCRIPT_TIMING_INVALID')
        sys.stderr.write(json.dumps({'stage': 'asr_tail_discarded',
                                     'discardedSegments': discarded_tail}) + '\n')
    print(json.dumps({'segments': result}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        sys.stderr.write('ASR_UNAVAILABLE\n' if isinstance(error, AsrUnavailable)
                         else 'ASR_FAILED\n')
        sys.exit(1)
