import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
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
                with patch.dict(sys.modules, {'faster_whisper': SimpleNamespace(WhisperModel=Mock(return_value=model))}), \
                     patch.object(sys, 'argv', ['transcribe.py', '--audio', '/local/audio.wav',
                                                '--cache', '/local/model-cache']), \
                     contextlib.redirect_stdout(output):
                    transcriber.main()
                    self.assertEqual(sys.modules['faster_whisper'].WhisperModel.call_args.kwargs['cpu_threads'], expected)
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
        with patch.dict(sys.modules, {'faster_whisper': SimpleNamespace(WhisperModel=Mock(return_value=model))}), \
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



class TranscriptionIsolationTests(unittest.TestCase):
    def invoke(self, mode='check', failure=None):
        with tempfile.TemporaryDirectory(prefix='places-asr-isolation-') as folder:
            root = Path(folder)
            cache = root / 'existing-cache'
            cache.mkdir()
            # Match the existing explicit download_root layout, outside HF_HOME/hub.
            model_path = cache / 'models--Systran--faster-whisper-small'
            model_path.mkdir()
            (model_path / 'cached-model').touch()
            fake_module = root / 'faster_whisper.py'
            fake_module.write_text("""
import os
from pathlib import Path
from types import SimpleNamespace
cache = Path(os.environ['TEST_CACHE'])
assert os.environ.get('HF_HOME') == str(cache / 'huggingface')
assert os.environ.get('HF_TOKEN_PATH') == str(cache / 'huggingface' / 'token')
assert os.environ.get('HF_HUB_CACHE') == str(cache)
assert os.environ.get('HUGGINGFACE_HUB_CACHE') == str(cache)
assert os.environ.get('HF_HUB_DISABLE_IMPLICIT_TOKEN') == '1'
assert os.environ.get('HF_HUB_OFFLINE') == '1'
if os.environ.get('TEST_FAILURE') == 'import':
    raise ImportError('private import path /home/argos/secret')
class WhisperModel:
    def __init__(self, name, **kwargs):
        assert name == 'small'
        assert kwargs['download_root'] == str(cache)
        assert kwargs['local_files_only'] is True
        assert kwargs['use_auth_token'] is False
        assert (cache / 'models--Systran--faster-whisper-small' / 'cached-model').exists()
        if os.environ.get('TEST_FAILURE') == 'load':
            raise PermissionError('private cache path /home/argos/secret')
    def transcribe(self, *args, **kwargs):
        assert os.environ['TEST_MODE'] == 'audio', 'preflight must only load the model'
        if os.environ.get('TEST_FAILURE') == 'transcribe':
            raise RuntimeError('private signed media URL and content')
        return iter([]), SimpleNamespace(duration=1)
""", encoding='utf-8')
            env = {**os.environ, 'PYTHONPATH': folder, 'TEST_CACHE': str(cache),
                   'TEST_MODE': mode, 'TEST_FAILURE': failure or '',
                   'HOME': str(root / 'inaccessible-home'),
                   'HF_HOME': '/home/argos/private-hf',
                   'HF_TOKEN_PATH': '/home/argos/private-hf/token',
                   'HF_HUB_CACHE': '/home/argos/private-hf/hub',
                   'HUGGINGFACE_HUB_CACHE': '/home/argos/private-hf/hub'}
            args = ['--check'] if mode == 'check' else ['--audio', str(root / 'audio.wav')]
            return subprocess.run([sys.executable, '-B', str(TARGET), *args,
                                   '--cache', str(cache)], env=env, text=True,
                                  capture_output=True, timeout=5)

    def test_initializes_private_offline_cache_before_import_and_loads_it_for_preflight(self):
        for mode, expected in [('check', {'ready': True}), ('audio', {'segments': []})]:
            with self.subTest(mode=mode):
                result = self.invoke(mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), expected)
                self.assertEqual(result.stderr, '')

    def test_reports_sanitized_model_unavailability_separately_from_transcription_failure(self):
        for failure, mode, code in [('import', 'check', 'ASR_UNAVAILABLE'),
                                    ('load', 'check', 'ASR_UNAVAILABLE'),
                                    ('load', 'audio', 'ASR_UNAVAILABLE'),
                                    ('transcribe', 'audio', 'ASR_FAILED')]:
            with self.subTest(failure=failure, mode=mode):
                result = self.invoke(mode, failure)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr, code + '\n')

if __name__ == '__main__':
    unittest.main()
