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
