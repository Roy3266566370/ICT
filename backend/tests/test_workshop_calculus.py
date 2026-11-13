from app.workshop.model import validate_canvas_doc


def test_calculus_composite_preserves_function_port_and_expression():
    doc = validate_canvas_doc({
        'version': 1, 'title': '高数积木', 'zoom': 1, 'strokes': [], 'wires': [],
        'nodes': [{
            'id': 'group', 'type': 'composite', 'x': 0, 'y': 0, 'params': {},
            'sub': {
                'nodes': [
                    {'id': 'f', 'type': 'functionSource', 'x': 0, 'y': 0, 'params': {'a': 2}, 'text': 'a*sin(x)'},
                    {'id': 'po', 'type': 'portOut', 'x': 300, 'y': 0, 'params': {}},
                ],
                'wires': [{'id': 'w', 'from': 'f', 'to': 'po'}],
                'ports': [{'id': 'po', 'dir': 'out', 'label': 'f(x)', 'kind': 'function'}],
            },
        }],
    })
    sub = doc['nodes'][0]['sub']
    assert sub['ports'][0]['kind'] == 'function'
    assert sub['nodes'][0]['text'] == 'a*sin(x)'


def test_cleared_function_expression_remains_empty_after_save():
    doc = validate_canvas_doc({
        'version': 1, 'nodes': [{'id': 'f', 'type': 'functionSource', 'x': 0, 'y': 0, 'params': {}, 'text': ''}],
        'wires': [], 'strokes': [],
    })
    assert doc['nodes'][0]['text'] == ''
