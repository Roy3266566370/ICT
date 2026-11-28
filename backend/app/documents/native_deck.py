"""Seed editable slides for presentations created without an upload."""

from uuid import uuid4

from .store import _create

THEMES = {
    'academic-paper': ('象牙学术', '#FAF7EE', '#233A63', '#A44929', '#263044', '#FFFCF5', '#526EA1', '#69717D', '#DED7C8'),
    'midnight-tech': ('深海科技', '#151B36', '#83E8EA', '#FFC267', '#F0F4FF', '#202A49', '#A89CF4', '#ABB8D1', '#394765'),
    'minimal-ink': ('清墨极简', '#FFFFFF', '#252A35', '#345ADD', '#343C4A', '#F4F6F9', '#737D93', '#697384', '#D9DEE6'),
    'warm-chalk': ('学院黑板', '#193831', '#F7EED5', '#F2C96F', '#F5F2E6', '#24473E', '#86BEAD', '#B7C7BB', '#47665B'),
    'executive-slate': ('商务青蓝', '#EDF2F6', '#243A55', '#087D72', '#26364A', '#F9FBFD', '#55769F', '#5F7082', '#CDD8E2'),
    'editorial-sand': ('燕麦人文', '#F5EADD', '#74442E', '#3E6354', '#352F30', '#FFF7ED', '#A16C46', '#72645C', '#DDCCBB'),
}

TEMPLATES = {
    'blank': ('academic-paper', ()),
    'lecture': ('academic-paper', ('学习目标', '核心概念与例题', '课堂小结')),
    'business': ('executive-slate', ('汇报摘要', '数据与发现', '建议与下一步')),
    'technology': ('midnight-tech', ('问题与背景', '技术方案', '验证与展望')),
    'defense': ('minimal-ink', ('研究背景', '方法与结果', '结论与展望')),
    'lab': ('warm-chalk', ('实验目标', '实验过程', '观察与结论')),
}


def create_native_deck(title, aspect_ratio, template_id, theme_id, outline=None):
    default_theme, sections = TEMPLATES[template_id]
    theme_id = theme_id or default_theme
    theme_name, background, primary, accent, text, surface, secondary, muted, border = THEMES[theme_id]
    width, height = (720, 540) if aspect_ratio == '4:3' else (960, 540)
    pages = []
    for page_no, heading in enumerate([slide.title for slide in outline] if outline else (title, *sections), 1):
        generated=outline[page_no-1] if outline else None
        layout=generated.layout_id if generated else (('cover' if page_no == 1 else 'lesson') if sections else 'blank')
        page = {
            'page_no': page_no, 'id': f'p_{page_no}', 'source_page_no': None,
            'width': width, 'height': height, 'nodes': [], 'modified': True,
            'preparation': {'status': 'ready'}, 'background_color': background,
            'background_modified': True,
            'layout_id': layout, 'hide_master': layout in ('cover','section'),
        }

        def add(kind, name, content, x, y, w, h, style, **extra):
            node = _create(page, f'u_{uuid4().hex}', {
                'type': kind, 'name': name, 'text': content,
                'x': x, 'y': y, 'width': w, 'height': h, 'style': style, **extra,
            })
            page['nodes'].append(node)

        if sections or generated:
            cover = layout in ('cover','section')
            add('shape', '主题装饰条', '', 54, 64, 72, 5, {'fill': accent})
            add('text', '标题', heading, 54, 112 if cover else 96, width - 108,
                168 if cover else 100, {'font_size': 46 if cover else 36, 'color': primary, 'bold': True})
            if not generated:
                add('text', '副标题' if cover else '正文', '讲者 · 日期' if cover else '在这里填写本页要点',
                    54, 316 if cover else 220, width - 108, 110, {'font_size': 22, 'color': text})
            else:
                points=[point.strip() for point in generated.points]
                split=layout in ('two-column','text-image','text-plugin')
                body_w=(width-128)/2 if split else width-108
                body_y=300 if cover else 210
                groups=[points[:3],points[3:]] if layout=='two-column' else [points]
                for column,items in enumerate(groups):
                    if items:
                        add('text','正文','\n'.join('• '+point for point in items),54+column*(body_w+20),
                            body_y,body_w,height-body_y-36,{'font_size':17 if split else 20,'color':text})
                if layout=='text-plugin':
                    labels={'taylor-error':'泰勒展开与余项','la01-matrix-det-basis':'矩阵变换与基变换',
                            'projectile-drag':'抛体运动','biz-breakeven':'盈亏平衡'}
                    kind=generated.template_kind or 'taylor-error'
                    add('workshop_plugin','定象坊沙盘','',54+body_w+20,194,body_w,282,{},
                        workshop_plugin={'template_kind':kind,'title':labels[kind]},viewer_editable=True)
                elif layout=='text-image':
                    add('shape','图片占位','',54+body_w+20,210,body_w,240,{'fill':surface,'stroke':border,'stroke_width':1})
        pages.append(page)
    return {
        'schema_version': '1.0', 'source_key': uuid4().hex, 'title': title, 'revision': 0,
        'structure_modified': True, 'pages': pages,
        'theme': {
            'id': theme_id, 'name': theme_name, 'aspect_ratio': aspect_ratio,
            'palette': {'background': background, 'surface': surface, 'primary': primary,
                        'secondary': secondary, 'accent': accent, 'text': text,
                        'muted': muted, 'border': border},
            'fonts': {'heading': 'Arial', 'body': 'Arial'},
        },
    }
