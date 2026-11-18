from types import SimpleNamespace
import sys

from PIL import Image

from app.labs import extract


def test_missing_local_weights_never_initializes_downloader(monkeypatch, tmp_path):
    package = tmp_path / 'rapid_latex_ocr'
    package.mkdir()
    monkeypatch.setattr(extract, 'find_spec', lambda _: SimpleNamespace(origin=str(package / '__init__.py')), raising=False)
    monkeypatch.setattr(extract, '_LATEX_OCR_ENGINE', None)
    monkeypatch.setattr(extract, '_LATEX_OCR_RETRY_AT', 0)
    monkeypatch.setitem(sys.modules, 'rapid_latex_ocr', SimpleNamespace(LaTeXOCR=lambda: 'downloaded'))
    assert extract._latex_ocr_engine() is None


def test_complete_local_models_are_passed_explicitly(monkeypatch, tmp_path):
    (tmp_path / 'models').mkdir()
    for name in ('image_resizer.onnx', 'encoder.onnx', 'decoder.onnx', 'tokenizer.json'):
        (tmp_path / 'models' / name).write_bytes(b'local')
    (tmp_path / 'config.yaml').write_text('local')
    monkeypatch.setattr(extract, 'find_spec', lambda _: SimpleNamespace(origin=str(tmp_path / '__init__.py')), raising=False)
    monkeypatch.setattr(extract, '_LATEX_OCR_ENGINE', None)
    monkeypatch.setattr(extract, '_LATEX_OCR_RETRY_AT', 0)
    seen = {}
    def initialize(**kwargs):
        seen.update(kwargs)
        return 'engine'
    monkeypatch.setitem(sys.modules, 'rapid_latex_ocr', SimpleNamespace(LaTeXOCR=initialize))
    assert extract._latex_ocr_engine() == 'engine'
    assert set(seen) == {'config_path', 'image_resizer_path', 'encoder_path', 'decoder_path', 'tokenizer_json'}
    assert all(path.is_file() for path in seen.values())


def test_math_ocr_terminates_only_its_worker_on_deadline(monkeypatch):
    events = []
    class Connection:
        def close(self): pass
        def poll(self, timeout):
            events.append(('timeout', timeout))
            return False
    class Process:
        def __init__(self, **kwargs): pass
        def start(self): events.append('start')
        def is_alive(self): return True
        def terminate(self): events.append('terminate')
        def join(self): events.append('join')
        def close(self): events.append('close')
    context = SimpleNamespace(Pipe=lambda **_: (Connection(), Connection()), Process=Process)
    monkeypatch.setattr(extract, '_local_latex_paths', lambda: {'available': True}, raising=False)
    monkeypatch.setattr(extract, 'get_context', lambda _: context, raising=False)
    monkeypatch.setattr(extract, '_LATEX_OCR_RETRY_AT', 0)
    assert extract._math_ocr(Image.new('RGB', (1, 1)), loose=True) is None
    assert 'terminate' in events
    assert 'join' in events
    assert any(isinstance(event, tuple) and 0 < event[1] <= 15 for event in events)
