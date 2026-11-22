from io import BytesIO
from types import SimpleNamespace
from PIL import Image
import pytest

from app.living.vision import LivingVisionClient
from app.ppt_ai.client import PPTAIError


class Transport:
    def __init__(self): self.calls = []
    def post(self, url, **kwargs):
        self.calls.append(kwargs['json_body'])
        return 200, {'choices': [{'finish_reason': 'stop', 'message': {'content': '{"elements":[]}'}}]}


def client():
    settings = SimpleNamespace(living_figure_vision_provider='test', living_figure_vision_model='test-vl',
        living_figure_vision_base_url='https://example.invalid/v1', living_figure_vision_api_key='test',
        living_figure_vision_timeout_s=20, living_figure_max_calls=3)
    return LivingVisionClient(settings=settings, transport=Transport())


def test_element_labels_precede_every_image_and_share_page_context():
    data = BytesIO(); Image.new('RGBA', (32, 32), (0, 0, 0, 0)).save(data, format='PNG')
    images = [(f'n_{i}', data.getvalue()) for i in range(3)]
    page = {'nodes': [{'id': identifier, 'text': '真实本页文字', 'x': i*50, 'y': 10, 'width': 40, 'height': 40}
                      for i, (identifier, _) in enumerate(images)]}
    vision = client()
    assert vision.recognize_math_page(images=images, page=page, prompt='protocol')['elements'] == []
    content = vision.transport.calls[0]['messages'][0]['content']
    for i in range(3):
        assert f'n_{i}' in content[2*i]['text'] and content[2*i+1]['type'] == 'image_url'
    assert '真实本页文字' in content[-1]['text'] and '元素位置' in content[-1]['text']
    assert len(vision.transport.calls) == 1


def test_page_image_limit_rejects_before_provider_call():
    vision = client()
    with pytest.raises(PPTAIError):
        vision.recognize_math_page(images=[('id', b'png')]*9, page={'nodes': []}, prompt='')
    assert not vision.transport.calls
