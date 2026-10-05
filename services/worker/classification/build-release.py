"""Build a classifier-only release from already verified local dependencies."""
import argparse
import json
from pathlib import Path
import shutil

WORKER = Path(__file__).resolve().parents[1]
REPO = WORKER.parents[1]


def build(destination):
    if destination.exists() or destination.is_symlink():
        raise ValueError('DESTINATION_EXISTS')
    if not (WORKER / 'dist/classification/cli.js').is_file():
        raise ValueError('WORKER_BUILD_REQUIRED')
    destination.mkdir(mode=0o755, parents=True)
    for directory in ['classification']:
        shutil.copytree(WORKER / 'dist' / directory, destination / 'dist' / directory)
    for filename in ['places/api.js', 'places/config.js', 'places/media.js', 'runtime/temp-workdir.js']:
        target = destination / 'dist' / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(WORKER / 'dist' / filename, target)
    shutil.copytree(REPO / 'node_modules/zod', destination / 'node_modules/zod')
    shutil.copyfile(WORKER / 'places-hermes/transcribe.py', destination / 'transcribe.py')
    shutil.copyfile(WORKER / 'places-hermes/requirements-asr.txt', destination / 'requirements-asr.txt')
    (destination / 'package.json').write_text(json.dumps({'private': True, 'type': 'module'}) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    build(parser.parse_args().destination)
