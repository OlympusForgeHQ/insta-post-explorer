"""Package the Places API consumer from a tested worker build; no secrets or DB client."""
import argparse
import json
from pathlib import Path
import shutil

WORKER = Path(__file__).resolve().parents[1]
REPO = WORKER.parents[1]


def build(destination):
    if destination.exists() or destination.is_symlink():
        raise ValueError('DESTINATION_EXISTS')
    if not (WORKER / 'dist/places/consumer.js').is_file():
        raise ValueError('WORKER_BUILD_REQUIRED')
    destination.mkdir(mode=0o755, parents=True)
    shutil.copytree(WORKER / 'dist/places', destination / 'dist/places')
    runtime = destination / 'dist/runtime'
    runtime.mkdir()
    shutil.copyfile(WORKER / 'dist/runtime/temp-workdir.js', runtime / 'temp-workdir.js')
    shutil.copytree(REPO / 'node_modules/zod', destination / 'node_modules/zod')
    shutil.copyfile(WORKER / 'places-hermes/transcribe.py', destination / 'transcribe.py')
    shutil.copyfile(WORKER / 'places-hermes/requirements-asr.txt', destination / 'requirements-asr.txt')
    (destination / 'package.json').write_text(json.dumps({'private': True, 'type': 'module'}) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    build(parser.parse_args().destination)
