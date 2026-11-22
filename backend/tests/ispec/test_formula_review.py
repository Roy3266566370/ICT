from app.ispec.formula_review import review_reason, review_formula


def test_integral_sentinel_and_known_good_formula():
    assert '算子' in review_reason(r'\mathrm{d}_{0}^{1}\frac{1}{x+1}\mathrm{d}x', .99)
    assert review_reason(r'\int_{0}^{1}\frac{1}{x+1}\mathrm{d}x', .99) is None
    assert review_reason('x+1', .89)
    assert review_reason(r'\badcommand{', .99)


def test_visual_review_requires_valid_replacement(monkeypatch):
    from app.living.vision import LivingVisionClient
    monkeypatch.setattr(LivingVisionClient, 'available', True)
    draft = r'd_0^1 x dx'
    calls = []

    def generate(self, **kwargs):
        calls.append(kwargs)
        return {'latex': r'\int_0^1 x\,dx'}

    monkeypatch.setattr(LivingVisionClient, 'generate_json', generate)
    assert review_formula(b'png', draft, .98) == (r'\int_0^1 x\,dx', 'vision_confirmed', None)
    assert len(calls) == 1
    assert calls[0]['image_png'] == b'png'
    monkeypatch.setattr(LivingVisionClient, 'available', False)
    assert review_formula(b'png', draft, .98)[1] == 'needs_review'


def test_confirmed_definite_integral_rebuilds_curve_and_parameter():
    from app.ispec.native_math import build_native_math_specs
    from app.ispec.validator import validate_ispec
    latex = r'\int_{0}^{1}\frac{1}{(x+1)(x^2-2x+2)}\mathrm{d}x'
    spec, = build_native_math_specs({'page_no': 6, 'elements': [{
        'element_id': 'p06_s01', 'bbox': {'x': 0, 'y': 0, 'w': 10, 'h': 10},
        'math_text': latex, 'recognition_method': 'user_confirmed',
        'image_recognition': {'status': 'user_confirmed'},
    }]}, 'test')
    assert not validate_ispec(spec)
    assert spec['parameters'][0]['source']['status'] == 'confirmed'
    assert spec['datasets'][0]['rows'][0] == [0, .5]
    assert spec['datasets'][0]['rows'][-1] == [1, .5]
