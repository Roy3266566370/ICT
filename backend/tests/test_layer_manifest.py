"""Layer manifest compatibility, including partial pages with frozen objects."""
from app.documents.layer_export import EXPORTER_VERSION
from app.documents.layers import manifest_ready


def test_current_manifest_can_be_partially_ready():
    assert manifest_ready({
        'status': 'ready', 'exporter_version': EXPORTER_VERSION,
        'frozen_ids': ['n_3'],
    })


def test_old_manifest_with_frozen_objects_is_reprepared():
    assert not manifest_ready({
        'status': 'ready', 'exporter_version': EXPORTER_VERSION - 1,
        'frozen_ids': ['n_3'],
    })


def test_old_manifest_without_frozen_objects_remains_compatible():
    assert manifest_ready({
        'status': 'ready', 'exporter_version': 2,
        'frozen_ids': [],
    })
