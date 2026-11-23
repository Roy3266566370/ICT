"""Test optional Qwen matching with repository fixture pixels and a disposable document."""
from pathlib import Path
import json
import shutil
import sys
from tempfile import TemporaryDirectory
from time import monotonic

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))

from app import render
from app.documents import figure_service, layers, store
from app.living.vision import LivingVisionClient


def main():
    with TemporaryDirectory(prefix='ict-m3-vision-') as directory:
        workspace = Path(directory)
        store.UPLOAD_DIR = workspace / 'uploads'
        render.RENDERS_DIR = workspace / 'renders'
        material_id = 'probe'
        source = render.pages_dir(material_id)
        source.mkdir(parents=True)
        shutil.copyfile(ROOT / 'frontend/e2e/fixtures/basis-alternate.png', source / 's01.png')
        document = layers.ensure_document(material_id, '换基图')
        node_id = document['pages'][0]['nodes'][0]['id']
        pixel = figure_service.vectorize(material_id, 1, node_id, expected_revision=0)
        warm = figure_service.vectorize(material_id, 1, node_id, expected_revision=0)
        started = monotonic()
        enhanced = figure_service.vectorize(material_id, 1, node_id, expected_revision=0,
                                            stage='vision', preview_id=pixel['preview_id'])
        elapsed = round(monotonic() - started, 3)
        diagnostics = list(store.document_root(material_id).rglob('vision-*.json'))
        transport = [json.loads(path.read_text(encoding='utf-8')) for path in diagnostics]
        before = {item['id']: item['points'] for item in pixel['scene']['objects']}
        after = {item['id']: item['points'] for item in enhanced['scene']['objects']}
        assert before == after, 'Vision must not move or create geometry'
        assert warm['diagnostics']['cache_hit']
        results = {
            'model': LivingVisionClient().profile.model if pixel['vision_available'] else None,
            'pixel_ms': pixel['diagnostics']['elapsed_ms'], 'warm_ms': warm['diagnostics']['elapsed_ms'],
            'candidate_objects': len(before),
            'applicable_objects': len({node['figure_object_id'] for node in pixel['nodes']}),
            'vision_elapsed_seconds': elapsed, 'vision': enhanced['diagnostics'], 'raw_diagnostics': transport,
        }
    Path(__file__).with_name('vision-result.json').write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in results.items() if key != 'raw_diagnostics'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
