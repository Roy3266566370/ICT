import json
import re

from app.api.routes_publish import render_standalone_html


def test_export_preserves_executable_spec_and_slide_geometry():
    spec = {'spec_version':'1.0','object_id':'formula','kind':'parametric',
      'parameters':[{'id':'x','label':'x','default':3,'source':{'page':2,'element_id':'p02_s01','bbox':None,'status':'original','excerpt':'y=x^2'}}],
      'expressions':[{'id':'y','expr':'x**2'}],
      'anchor':{'page':2,'element_id':'p02_s01','bbox':{'x':10,'y':20,'w':200,'h':100}},
      'views':[{'type':'text','template':'y={{y}}'}]}
    snapshot={'title':'Testing </script> safety','published_at':'2026-11-02T00:00:00Z',
      'pages':[{'page_no':2,'title':'Equation','width':1000,'height':750,'image':None}],
      'ispecs':[spec]}
    html=render_standalone_html(snapshot,'no-private-files')
    data=json.loads(re.search(r'<script id="export-data" type="application/json">(.*?)</script>',html,re.S)[1])
    assert data['specs'][0]['expressions']==spec['expressions']
    assert data['specs'][0]['anchor']==spec['anchor']
    assert data['pages'][0]['width']==1000
    assert 'id="offline-root"' in html
    assert '<script src=' not in html
    assert '<link ' not in html
    assert 'Testing </script> safety' not in html
    assert 'id="project-backup"' in html
    assert 'id="project-backup-download"' in html
    backup = json.loads(re.search(r'<script id="project-backup" type="application/json">(.*?)</script>', html, re.S)[1])
    assert backup['scene_document'] is None
    assert backup['ispecs'][0]['object_id'] == 'formula'
    assert backup['values']['formula']['x'] == 3


def test_export_preserves_dynamic_scene_nodes_through_public_whitelist():
    import base64
    from app.documents.presentation import public_document

    tiny_png = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\nfake').decode('ascii')
    raw_doc = {
        'schema_version': '1.0',
        'revision': 3,
        'title': '矩阵运算动态课件',
        'pages': [{
            'page_no': 1,
            'width': 960,
            'height': 540,
            'modified': True,
            'background_url': tiny_png,
            'preparation': {'status': 'ready', 'frozen_ids': []},
            'nodes': [
                {
                    'id': 'vec_1', 'type': 'vector', 'x': 100, 'y': 100, 'width': 180, 'height': 16,
                    'rotation': 30, 'z': 2, 'opacity': 1, 'text': '', 'style': {'stroke': '#008844', 'line_style': 'dashed', 'arrow_end': True},
                    'flow': {'enabled': True, 'speed': 2.5},
                    'viewer_editable': True,
                    'viewer_parameters': ['geometry', 'style', 'flow'],
                },
                {
                    'id': 'math_1', 'type': 'math_scene', 'x': 300, 'y': 120, 'width': 420, 'height': 320,
                    'rotation': 0, 'z': 3, 'opacity': 1, 'text': '', 'style': {'stroke': '#167abc', 'line_style': 'dotted'},
                    'flow': {'enabled': True, 'speed': 1.5},
                    'viewer_editable': True,
                    'math_scene': {
                        'template': 'matrix_vector',
                        'view_box': {'x': [-4, 4], 'y': [-3, 3]},
                        'matrix': [[2, 1], [1, 2]],
                        'vector': [1, 1],
                        'show_grid': True,
                        'show_circle': True,
                        'radius': 1,
                        'progress': 1,
                        'animation_step': 0.02,
                        'viewer_parameters': ['vector', 'progress'],
                    },
                },
                {
                    'id': 'mat_img_1', 'type': 'image', 'x': 40, 'y': 200, 'width': 220, 'height': 140,
                    'rotation': 0, 'z': 1, 'opacity': 1, 'text': '', 'style': {},
                    'image_url': tiny_png,
                    'viewer_editable': True,
                    'matrix_ocr': {
                        'matrices': [{'values': [[1, 2], [0, 1]], 'cells': [
                            {'row': 0, 'col': 0, 'bbox': [0.1, 0.1, 0.3, 0.3]},
                            {'row': 0, 'col': 1, 'bbox': [0.5, 0.1, 0.3, 0.3]},
                            {'row': 1, 'col': 0, 'bbox': [0.1, 0.5, 0.3, 0.3]},
                            {'row': 1, 'col': 1, 'bbox': [0.5, 0.5, 0.3, 0.3]},
                        ]}],
                    },
                },
                {
                    'id': 'diag_1', 'type': 'diagram', 'x': 40, 'y': 360, 'width': 400, 'height': 150,
                    'rotation': 0, 'z': 4, 'opacity': 1, 'text': '', 'style': {'stroke': '#008844', 'line_style': 'dashed'},
                    'flow': {'enabled': True, 'speed': 1},
                    'viewer_editable': True,
                    'diagram': {
                        'version': 1,
                        'nodes': [
                            {'id': 'a', 'label': '等价', 'x': 0.2, 'y': 0.5, 'shape': 'rounded'},
                            {'id': 'b', 'label': '相似', 'x': 0.8, 'y': 0.5, 'shape': 'rounded'},
                        ],
                        'edges': [{'from': 'a', 'to': 'b', 'label': '变换'}],
                        'order': ['a', 'b'],
                        'confidence': 1,
                        'warnings': [],
                    },
                },
                {
                    'id': 'demo_1', 'type': 'demo', 'x': 480, 'y': 360, 'width': 420, 'height': 160,
                    'rotation': 0, 'z': 5, 'opacity': 1, 'text': '', 'style': {},
                    'viewer_editable': True,
                    'demo': {
                        'title': '矩阵演示',
                        'summary': '动态过程',
                        'explain': ['观察变化'],
                        'params': [{'id': 'k', 'label': '系数', 'min': 0, 'max': 2, 'step': 0.1, 'default': 1}],
                        'public_params': ['k'],
                        'timeline': {
                            'duration_s': 6,
                            'stops': [{'t': 0, 'label': '起点'}, {'t': 1, 'label': '终点'}],
                        },
                        'program': "function render(input){return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],nodes:[{id:'p',type:'circle',cx:10+input.t*input.k*50,cy:100,r:8,style:{fill:'#112233'}}]};}",
                    },
                },
            ],
        }],
    }
    cleaned = public_document(raw_doc)
    snapshot = {
        'title': '矩阵运算动态课件',
        'published_at': '2026-11-21T00:00:00Z',
        'pages': [{'page_no': 1, 'title': '第 1 页', 'width': 12192000, 'height': 6858000, 'image': None}],
        'ispecs': [],
        'scene_document': cleaned,
    }
    html = render_standalone_html(snapshot, 'no-private-files')
    data = json.loads(re.search(r'<script id="export-data" type="application/json">(.*?)</script>', html, re.S)[1])
    nodes = {n['id']: n for n in data['document']['pages'][0]['nodes']}
    assert nodes['vec_1']['flow'] == {'enabled': True, 'speed': 2.5}
    assert nodes['vec_1']['viewer_editable'] is True
    assert nodes['vec_1']['viewer_parameters'] == ['geometry', 'style', 'flow']
    assert nodes['math_1']['math_scene']['matrix'] == [[2, 1], [1, 2]]
    assert nodes['mat_img_1']['matrix_ocr']['matrices'][0]['values'] == [[1, 2], [0, 1]]
    assert len(nodes['diag_1']['diagram']['nodes']) == 2
    assert nodes['demo_1']['demo']['timeline']['duration_s'] == 6
