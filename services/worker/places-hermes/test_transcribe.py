import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parent
TARGET = Path(os.environ.get('TRANSCRIBE_UNDER_TEST', ROOT / 'transcribe.py'))
with patch.dict(sys.modules, {'faster_whisper': SimpleNamespace(WhisperModel=Mock())}):
    spec = importlib.util.spec_from_file_location('places_transcribe', TARGET)
    transcriber = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(transcriber)


def segment(start, end, text='Closing recommendation.', **overrides):
    return SimpleNamespace(start=start, end=end, text=text,
                           no_speech_prob=overrides.get('no_speech_prob', 0.1),
                           avg_logprob=overrides.get('avg_logprob', -0.2))


class TranscriptionTimingTests(unittest.TestCase):
    def test_classification_thread_budget_preserves_places_default_and_rejects_bad_limits(self):
        for value, expected in [(None, 2), ('1', 1), ('2', 2), ('3', 3), ('4', 4)]:
            with self.subTest(value=value), patch.dict(os.environ, {}, clear=True):
                if value is not None:
                    os.environ['CLASSIFICATION_ASR_CPU_THREADS'] = value
                model = Mock()
                model.transcribe.return_value = (iter([segment(0, 1, 'Original words.')]),
                                                 SimpleNamespace(duration=1))
                output = io.StringIO()
                with patch.object(transcriber, 'WhisperModel', return_value=model) as factory, \
                     patch.object(sys, 'argv', ['transcribe.py', '--audio', '/local/audio.wav',
                                                '--cache', '/local/model-cache']), \
                     contextlib.redirect_stdout(output):
                    transcriber.main()
                self.assertEqual(factory.call_args.kwargs['cpu_threads'], expected)
                self.assertEqual(json.loads(output.getvalue())['segments'][0]['text'],
                                 'Original words.')
        for invalid in ['0', '-1', '5', '1.5', 'invalid', '']:
            with self.subTest(invalid=invalid), \
                 patch.dict(os.environ, {'CLASSIFICATION_ASR_CPU_THREADS': invalid}):
                with self.assertRaises(ValueError):
                    self.transcribe([segment(0, 1)], 1)

    def transcribe(self, segments, duration):
        model = Mock()
        # The pre-VAD timeline remains authoritative when silence is removed.
        model.transcribe.return_value = (iter(segments), SimpleNamespace(
            duration=duration, duration_after_vad=1.0))
        output = io.StringIO()
        with patch.object(transcriber, 'WhisperModel', return_value=model), \
             patch.object(sys, 'argv', ['transcribe.py', '--audio', '/local/audio.wav',
                                        '--cache', '/local/model-cache']), \
             contextlib.redirect_stdout(output):
            transcriber.main()
        return json.loads(output.getvalue())['segments']

    def test_clips_observed_tail_overshoots_without_changing_start_or_text(self):
        for start, end, duration in [(50.020, 54.180, 53.124),
                                     (97.080, 99.280, 97.707)]:
            with self.subTest(start=start, end=end, duration=duration):
                rows = self.transcribe([segment(start, end)], duration)
                self.assertEqual(rows, [{'startMs': round(start * 1000),
                                         'endMs': round(duration * 1000),
                                         'text': 'Closing recommendation.'}])

    def test_rejects_invalid_bounds_before_rounding_or_clipping(self):
        invalid = [(-0.0001, 1, 10), (2.0002, 2.0001, 10),
                   (10, 11, 10), (10.1, 12, 10),
                   (float('nan'), 1, 10), (0, float('inf'), 10),
                   (0, 1, 0), (0, 1, -1),
                   (0, 1, float('nan')), (0, 1, float('inf'))]
        for start, end, duration in invalid:
            with self.subTest(start=start, end=end, duration=duration):
                with self.assertRaises(ValueError):
                    self.transcribe([segment(start, end)], duration)

    def test_preserves_in_bounds_speech_and_existing_silence_filter(self):
        rows = self.transcribe([
            segment(5.25, 8.5, ' Actual words. '),
            segment(8.5, 9, 'Suppressed silence.', no_speech_prob=0.9, avg_logprob=-2),
        ], 10)
        self.assertEqual(rows, [{'startMs': 5250, 'endMs': 8500, 'text': 'Actual words.'}])


if __name__ == '__main__':
    unittest.main()
